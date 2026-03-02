let currentQuizId = null;

const API_HEADERS = () => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${localStorage.getItem('sessionToken') || ''}`
});

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container') || createToastContainer();
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

function createToastContainer() {
    const container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
    return container;
}

async function requestJson(url, options = {}, timeoutMs = 12000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
            headers: {
                ...(options.headers || {}),
                ...API_HEADERS()
            }
        });

        let data = null;
        try {
            data = await response.json();
        } catch {
            data = null;
        }

        if (response.status === 401) {
            showToast('Session expired. Please log in again.', 'warning');
            logout(false);
            return { response, data };
        }

        return { response, data };
    } finally {
        clearTimeout(timeout);
    }
}

function showConfirm(title, message) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'confirm-overlay';
        overlay.innerHTML = `
            <div class="confirm-dialog">
                <h3>${title}</h3>
                <p>${message}</p>
                <div class="confirm-actions">
                    <button class="btn btn-secondary" id="confirm-cancel">Cancel</button>
                    <button class="btn btn-danger" id="confirm-ok">Delete</button>
                </div>
            </div>`;

        document.body.appendChild(overlay);
        overlay.querySelector('#confirm-cancel').onclick = () => {
            overlay.remove();
            resolve(false);
        };
        overlay.querySelector('#confirm-ok').onclick = () => {
            overlay.remove();
            resolve(true);
        };
    });
}

document.addEventListener('DOMContentLoaded', () => {
    checkTeacherAuth();
    loadStats();
    loadQuizzes();
    setupCreateQuizForm();
});

function checkTeacherAuth() {
    const sessionToken = localStorage.getItem('sessionToken');
    const teacherName = localStorage.getItem('teacherName');

    if (!sessionToken) {
        window.location.href = 'teacher-auth.html';
        return;
    }

    document.getElementById('teacher-name').innerText = teacherName || 'Teacher';
}

async function loadStats() {
    try {
        const { response, data } = await requestJson('/api/teacher/stats', { method: 'GET' });
        if (!response?.ok || !data) return;

        document.getElementById('stat-quizzes').textContent = data.total_quizzes || 0;
        document.getElementById('stat-questions').textContent = data.total_questions || 0;
        document.getElementById('stat-attempts').textContent = data.total_attempts || 0;
        document.getElementById('stat-passed').textContent = data.total_passed || 0;
    } catch (error) {
        console.error('Stats load failed:', error);
    }
}

function setupCreateQuizForm() {
    const form = document.getElementById('create-quiz-form');
    form.addEventListener('submit', async (event) => {
        event.preventDefault();

        const button = form.querySelector('button[type="submit"]');
        const errorDiv = document.getElementById('create-quiz-error');
        errorDiv.innerText = '';

        const title = document.getElementById('quiz-title').value.trim();
        const description = document.getElementById('quiz-description').value.trim();
        const passingScore = Number.parseInt(document.getElementById('quiz-passing-score').value, 10);

        if (!title || title.length < 2) {
            errorDiv.innerText = 'Title must be at least 2 characters';
            return;
        }

        if (!Number.isInteger(passingScore) || passingScore < 1 || passingScore > 100) {
            errorDiv.innerText = 'Passing score must be between 1 and 100';
            return;
        }

        button.disabled = true;
        button.textContent = 'Creating...';

        try {
            const { response, data } = await requestJson('/api/quiz/create', {
                method: 'POST',
                body: JSON.stringify({
                    title,
                    description,
                    passing_score_percentage: passingScore
                })
            });

            if (!response.ok) {
                errorDiv.innerText = data?.error || 'Failed to create quiz';
                return;
            }

            localStorage.setItem('currentQuizId', data.quizId);
            localStorage.setItem('currentQuizTitle', title);
            closeCreateQuizModal();
            showToast('Quiz created! Now add questions.', 'success');

            setTimeout(() => {
                window.location.href = 'quiz-creation.html';
            }, 350);
        } catch (error) {
            errorDiv.innerText = error.name === 'AbortError' ? 'Server timeout. Please retry.' : 'Server error';
        } finally {
            button.disabled = false;
            button.textContent = 'Create Quiz';
        }
    });
}

async function loadQuizzes() {
    const quizzesList = document.getElementById('quizzes-list');

    try {
        const { response, data } = await requestJson('/api/teacher/quizzes', { method: 'GET' });

        if (!response.ok || !Array.isArray(data)) {
            quizzesList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⚠️</div><p>Error loading quizzes</p></div>';
            return;
        }

        if (data.length === 0) {
            quizzesList.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <div class="empty-state-icon">📝</div>
                    <h3>No quizzes yet</h3>
                    <p>Create your first quiz to get started.</p>
                    <button onclick="showCreateQuizModal()" class="btn btn-primary">+ Create Quiz</button>
                </div>`;
            return;
        }

        quizzesList.innerHTML = data.map(quiz => `
            <div class="quiz-card">
                <div class="quiz-card-header">
                    <h3>${escapeHtml(quiz.title)}</h3>
                </div>
                <p class="quiz-description">${escapeHtml(quiz.description || 'No description')}</p>
                <div class="quiz-meta">
                    <span class="quiz-meta-item"><span class="meta-icon">🎯</span> ${quiz.passing_score_percentage}% to pass</span>
                    <span class="quiz-meta-item"><span class="meta-icon">❓</span> ${quiz.question_count || 0} questions</span>
                    <span class="quiz-meta-item"><span class="meta-icon">👥</span> ${quiz.attempt_count || 0} attempts</span>
                </div>
                <p class="quiz-date">Created ${new Date(quiz.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</p>
                <div class="quiz-actions">
                    <button onclick="editQuiz(${quiz.id}, '${escapeJs(quiz.title)}')" class="btn btn-secondary btn-small">✏️ Edit</button>
                    <button onclick="showAccessCodes(${quiz.id}, '${escapeJs(quiz.title)}')" class="btn btn-secondary btn-small">🔑 Codes</button>
                    <button onclick="showResults(${quiz.id}, '${escapeJs(quiz.title)}')" class="btn btn-secondary btn-small">📊 Results</button>
                    <button onclick="deleteQuiz(${quiz.id}, '${escapeJs(quiz.title)}')" class="btn btn-danger btn-small">🗑</button>
                </div>
            </div>`).join('');
    } catch (error) {
        quizzesList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔌</div><h3>Connection Error</h3><p>Make sure the server is running</p></div>';
    }
}

function editQuiz(quizId, title) {
    localStorage.setItem('currentQuizId', quizId);
    localStorage.setItem('currentQuizTitle', title || 'Quiz');
    window.location.href = 'quiz-creation.html';
}

async function deleteQuiz(quizId, title) {
    const confirmed = await showConfirm('Delete Quiz', `Delete "${title}" and all related questions, codes, and results?`);
    if (!confirmed) return;

    try {
        const { response, data } = await requestJson(`/api/quiz/${quizId}`, { method: 'DELETE' });
        if (!response.ok) {
            showToast(data?.error || 'Failed to delete quiz', 'error');
            return;
        }

        showToast('Quiz deleted', 'success');
        loadQuizzes();
        loadStats();
    } catch {
        showToast('Error deleting quiz', 'error');
    }
}

function showAccessCodes(quizId, quizTitle) {
    currentQuizId = quizId;
    document.getElementById('modal-quiz-title').innerText = quizTitle;
    document.getElementById('access-code-modal').classList.remove('hidden');
    loadAccessCodes(quizId);
}

async function loadAccessCodes(quizId) {
    const codesList = document.getElementById('access-codes-list');
    codesList.innerHTML = '<div class="loading"><div class="spinner"></div>Loading...</div>';

    try {
        const { response, data } = await requestJson(`/api/quiz/${quizId}/access-codes`, { method: 'GET' });

        if (!response.ok || !Array.isArray(data)) {
            codesList.innerHTML = '<p class="text-muted text-center">Error loading access codes</p>';
            return;
        }

        if (data.length === 0) {
            codesList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔑</div><p>No access codes yet. Generate one above.</p></div>';
            return;
        }

        codesList.innerHTML = data.map(code => {
            const isExpired = code.expires_at && new Date(code.expires_at) < new Date();
            const isActive = code.active && !isExpired;
            const expiryText = code.expires_at ? new Date(code.expires_at).toLocaleString() : 'Never';

            return `
                <div class="access-code-item ${!isActive ? 'inactive' : ''}">
                    <div class="code-display">
                        <div class="code-value">
                            <strong>${escapeHtml(code.code)}</strong>
                            <button class="copy-btn" onclick="copyCode('${escapeJs(code.code)}')" title="Copy code">📋</button>
                        </div>
                        <span class="code-status ${isActive ? 'active' : 'inactive'}">${isActive ? '● Active' : '● Inactive'}</span>
                    </div>
                    <div class="code-meta">
                        <span class="code-expiry">Expires: ${expiryText}</span>
                        <span class="code-usage">Used: ${code.usage_count || 0} times</span>
                        <span class="code-created">Created: ${new Date(code.created_at).toLocaleString()}</span>
                    </div>
                    <div class="mt-1">
                        <button class="btn btn-secondary btn-small" onclick="toggleAccessCode(${code.id})">
                            ${code.active ? 'Disable' : 'Enable'} Code
                        </button>
                    </div>
                </div>`;
        }).join('');
    } catch {
        codesList.innerHTML = '<p class="text-muted text-center">Failed to load access codes</p>';
    }
}

async function toggleAccessCode(codeId) {
    try {
        const { response, data } = await requestJson(`/api/access-code/${codeId}/toggle`, { method: 'PATCH' });
        if (!response.ok) {
            showToast(data?.error || 'Failed to update access code', 'error');
            return;
        }

        showToast(data.message || 'Access code updated', 'success');
        if (currentQuizId) loadAccessCodes(currentQuizId);
    } catch {
        showToast('Could not update access code', 'error');
    }
}

async function generateAccessCode() {
    if (!currentQuizId) return;

    const expirationInput = document.getElementById('expiration-date').value;
    const expirationDate = expirationInput ? new Date(expirationInput) : null;

    if (expirationDate && expirationDate <= new Date()) {
        showToast('Expiration must be in the future', 'warning');
        return;
    }

    try {
        const { response, data } = await requestJson(`/api/quiz/${currentQuizId}/access-code`, {
            method: 'POST',
            body: JSON.stringify({
                expires_at: expirationDate ? expirationDate.toISOString() : null
            })
        });

        if (!response.ok) {
            showToast(data?.error || 'Failed to generate code', 'error');
            return;
        }

        showToast(`Access code generated: ${data.code}`, 'success');
        copyCode(data.code);
        loadAccessCodes(currentQuizId);
    } catch {
        showToast('Error generating access code', 'error');
    }
}

function copyCode(code) {
    navigator.clipboard.writeText(code)
        .then(() => showToast('Code copied to clipboard', 'success'))
        .catch(() => {
            const textarea = document.createElement('textarea');
            textarea.value = code;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            textarea.remove();
            showToast('Code copied to clipboard', 'success');
        });
}

function showResults(quizId, quizTitle) {
    document.getElementById('results-quiz-title').innerText = quizTitle;
    document.getElementById('results-modal').classList.remove('hidden');
    loadResults(quizId);
}

async function loadResults(quizId) {
    const container = document.getElementById('results-content');
    container.innerHTML = '<div class="loading"><div class="spinner"></div>Loading results...</div>';

    try {
        const { response, data } = await requestJson(`/api/quiz/${quizId}/results`, { method: 'GET' });

        if (!response.ok || !Array.isArray(data)) {
            container.innerHTML = '<p class="text-muted text-center">Error loading results</p>';
            return;
        }

        if (data.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📭</div><h3>No attempts yet</h3><p>Share an access code with your students to get started.</p></div>';
            return;
        }

        const passCount = data.filter(row => row.passed).length;
        const avgScore = Math.round(data.reduce((sum, row) => sum + Number(row.percentage || 0), 0) / data.length);

        container.innerHTML = `
            <div style="display:flex; gap:1rem; margin-bottom:1rem;">
                <div class="stat-card" style="flex:1;">
                    <div class="stat-value">${data.length}</div>
                    <div class="stat-label">Total</div>
                </div>
                <div class="stat-card" style="flex:1;">
                    <div class="stat-value" style="color:var(--secondary);">${passCount}</div>
                    <div class="stat-label">Passed</div>
                </div>
                <div class="stat-card" style="flex:1;">
                    <div class="stat-value">${avgScore}%</div>
                    <div class="stat-label">Avg Score</div>
                </div>
            </div>
            <div class="results-table-wrapper">
                <table class="results-table">
                    <thead>
                        <tr>
                            <th>Student</th>
                            <th>Score</th>
                            <th>%</th>
                            <th>Status</th>
                            <th>Date</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.map(row => `
                            <tr>
                                <td><strong>${escapeHtml(row.candidate_name)}</strong></td>
                                <td>${row.score}/${row.total_questions}</td>
                                <td>${row.percentage}%</td>
                                <td><span class="badge ${row.passed ? 'passed' : 'failed'}">${row.passed ? '✓ Passed' : '✗ Failed'}</span></td>
                                <td>${new Date(row.date_taken).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                            </tr>`).join('')}
                    </tbody>
                </table>
            </div>`;
    } catch {
        container.innerHTML = '<p class="text-muted text-center">Failed to load results</p>';
    }
}

function showCreateQuizModal() {
    document.getElementById('create-quiz-modal').classList.remove('hidden');
    document.getElementById('quiz-title').focus();
}

function closeCreateQuizModal() {
    document.getElementById('create-quiz-modal').classList.add('hidden');
    document.getElementById('create-quiz-form').reset();
    document.getElementById('create-quiz-error').innerText = '';
}

function closeAccessCodeModal() {
    document.getElementById('access-code-modal').classList.add('hidden');
}

function closeResultsModal() {
    document.getElementById('results-modal').classList.add('hidden');
}

window.onclick = (event) => {
    ['create-quiz-modal', 'access-code-modal', 'results-modal'].forEach((id) => {
        const modal = document.getElementById(id);
        if (event.target === modal) {
            modal.classList.add('hidden');
        }
    });
};

document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    ['create-quiz-modal', 'access-code-modal', 'results-modal'].forEach((id) => {
        document.getElementById(id)?.classList.add('hidden');
    });
});

function logout(callApi = true) {
    const token = localStorage.getItem('sessionToken');

    if (callApi && token) {
        fetch('/api/teacher/logout', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        }).catch(() => {});
    }

    localStorage.removeItem('sessionToken');
    localStorage.removeItem('teacherId');
    localStorage.removeItem('teacherName');
    window.location.href = 'teacher-auth.html';
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function escapeJs(str) {
    if (!str) return '';
    return str
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/"/g, '\\"');
}

window.addEventListener('scroll', () => {
    document.getElementById('navbar')?.classList.toggle('scrolled', window.scrollY > 10);
});
