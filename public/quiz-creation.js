let currentQuizId = null;
let questions = [];
let isSubmitting = false;
let hasUnsavedInput = false;

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
            setTimeout(() => {
                window.location.href = 'teacher-auth.html';
            }, 300);
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
    loadCurrentQuiz();
    setupAddQuestionForm();
    setupAIGenerateForm();
    loadQuestions();
    setupUnsavedChangeTracking();
});

function checkTeacherAuth() {
    if (!localStorage.getItem('sessionToken')) {
        window.location.href = 'teacher-auth.html';
    }
}

function loadCurrentQuiz() {
    currentQuizId = localStorage.getItem('currentQuizId');
    const quizTitle = localStorage.getItem('currentQuizTitle');

    if (!currentQuizId) {
        showToast('No quiz selected', 'warning');
        window.location.href = 'teacher-dashboard.html';
        return;
    }

    document.getElementById('quiz-title').innerText = quizTitle || 'Quiz';
}

function setupUnsavedChangeTracking() {
    const form = document.getElementById('add-question-form');
    form.querySelectorAll('input, textarea, select').forEach((field) => {
        field.addEventListener('input', () => {
            hasUnsavedInput = true;
        });
    });

    window.addEventListener('beforeunload', (event) => {
        if (!hasUnsavedInput) return;
        event.preventDefault();
        event.returnValue = '';
    });

    document.getElementById('question-text').addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            form.requestSubmit();
        }
    });
}

function setupAddQuestionForm() {
    const form = document.getElementById('add-question-form');

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (isSubmitting) return;

        const questionText = document.getElementById('question-text').value.trim();
        const optionA = document.getElementById('option-a').value.trim();
        const optionB = document.getElementById('option-b').value.trim();
        const optionC = document.getElementById('option-c').value.trim();
        const optionD = document.getElementById('option-d').value.trim();
        const correctOption = document.getElementById('correct-option').value;

        const errorDiv = document.getElementById('question-error');
        const button = document.getElementById('add-question-btn');
        errorDiv.innerText = '';

        if (!questionText || !optionA || !optionB || !optionC || !optionD || !correctOption) {
            errorDiv.innerText = 'All fields are required';
            return;
        }

        if (questionText.length < 5) {
            errorDiv.innerText = 'Question must be at least 5 characters';
            return;
        }

        const optionSet = new Set([optionA.toLowerCase(), optionB.toLowerCase(), optionC.toLowerCase(), optionD.toLowerCase()]);
        if (optionSet.size < 4) {
            errorDiv.innerText = 'Options must be different from each other';
            return;
        }

        isSubmitting = true;
        button.disabled = true;
        button.textContent = 'Adding...';

        try {
            const { response, data } = await requestJson(`/api/quiz/${currentQuizId}/question`, {
                method: 'POST',
                body: JSON.stringify({
                    question_text: questionText,
                    option_a: optionA,
                    option_b: optionB,
                    option_c: optionC,
                    option_d: optionD,
                    correct_option: correctOption
                })
            });

            if (!response.ok) {
                errorDiv.innerText = data?.error || 'Failed to add question';
                return;
            }

            form.reset();
            hasUnsavedInput = false;
            showToast('Question added successfully', 'success');
            loadQuestions();
            document.getElementById('question-text').focus();
        } catch (error) {
            errorDiv.innerText = error.name === 'AbortError'
                ? 'Server timeout. Please retry.'
                : 'Server error — check your connection';
        } finally {
            isSubmitting = false;
            button.disabled = false;
            button.textContent = '➕ Add Question';
        }
    });
}

function setupAIGenerateForm() {
    const form = document.getElementById('ai-generate-form');
    if (!form) return;

    let isGenerating = false;

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (isGenerating) return;

        const topic = document.getElementById('ai-topic').value.trim();
        const depth = document.getElementById('ai-depth').value;
        const difficulty = document.getElementById('ai-difficulty').value;
        const numberOfQuestions = parseInt(document.getElementById('ai-count').value, 10);

        const errorDiv = document.getElementById('ai-error');
        const button = document.getElementById('ai-generate-btn');
        errorDiv.innerText = '';

        if (!topic || topic.length < 3) {
            errorDiv.innerText = 'Topic must be at least 3 characters';
            return;
        }

        if (topic.length > 200) {
            errorDiv.innerText = 'Topic must be at most 200 characters';
            return;
        }

        if (!numberOfQuestions || numberOfQuestions < 1 || numberOfQuestions > 20) {
            errorDiv.innerText = 'Number of questions must be between 1 and 20';
            return;
        }

        isGenerating = true;
        button.disabled = true;
        button.textContent = 'Generating... this may take a moment';

        try {
            const { response, data } = await requestJson(`/api/quiz/${currentQuizId}/generate-questions`, {
                method: 'POST',
                body: JSON.stringify({ topic, depth, difficulty, numberOfQuestions })
            }, 60000);

            if (!response.ok) {
                errorDiv.innerText = data?.error || 'Failed to generate questions';
                return;
            }

            form.reset();
            document.getElementById('ai-depth').value = 'intermediate';
            document.getElementById('ai-difficulty').value = 'medium';
            document.getElementById('ai-count').value = '5';
            showToast(data.message || `Generated ${data.count} questions`, 'success');
            loadQuestions();
        } catch (error) {
            errorDiv.innerText = error.name === 'AbortError'
                ? 'Request timed out. Try fewer questions.'
                : 'Server error — check your connection';
        } finally {
            isGenerating = false;
            button.disabled = false;
            button.textContent = 'Generate Questions';
        }
    });
}

async function loadQuestions() {
    const questionsList = document.getElementById('questions-display');

    try {
        const { response, data } = await requestJson(`/api/quiz/${currentQuizId}/questions`, {
            method: 'GET'
        });

        if (!response.ok || !Array.isArray(data)) {
            questionsList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⚠️</div><p>Error loading questions</p></div>';
            return;
        }

        questions = data;
        document.getElementById('question-count').innerText = questions.length;

        if (questions.length === 0) {
            questionsList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📭</div><p>No questions added yet. Add your first question above.</p></div>';
            return;
        }

        questionsList.innerHTML = questions.map((question, index) => `
            <div class="question-item">
                <div class="question-header">
                    <h4>${index + 1}. ${escapeHtml(question.question_text)}</h4>
                    <button class="btn btn-danger btn-small btn-icon" onclick="deleteQuestion(${question.id})" title="Delete question">🗑</button>
                </div>
                <div class="question-options">
                    <div class="option ${question.correct_option === 'A' ? 'correct' : ''}"><strong>A:</strong> ${escapeHtml(question.option_a)}</div>
                    <div class="option ${question.correct_option === 'B' ? 'correct' : ''}"><strong>B:</strong> ${escapeHtml(question.option_b)}</div>
                    <div class="option ${question.correct_option === 'C' ? 'correct' : ''}"><strong>C:</strong> ${escapeHtml(question.option_c)}</div>
                    <div class="option ${question.correct_option === 'D' ? 'correct' : ''}"><strong>D:</strong> ${escapeHtml(question.option_d)}</div>
                </div>
            </div>`).join('');
    } catch {
        questionsList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔌</div><h3>Connection Error</h3><p>Make sure the server is running</p></div>';
    }
}

async function deleteQuestion(questionId) {
    const confirmed = await showConfirm('Delete Question', 'Are you sure you want to delete this question?');
    if (!confirmed) return;

    try {
        const { response, data } = await requestJson(`/api/quiz/${currentQuizId}/question/${questionId}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            showToast(data?.error || 'Failed to delete question', 'error');
            return;
        }

        showToast('Question deleted', 'success');
        loadQuestions();
    } catch {
        showToast('Error deleting question', 'error');
    }
}

function finishQuiz() {
    if (questions.length === 0) {
        showToast('Please add at least one question before finishing', 'warning');
        return;
    }

    hasUnsavedInput = false;
    localStorage.removeItem('currentQuizId');
    localStorage.removeItem('currentQuizTitle');
    showToast('Quiz saved', 'success');

    setTimeout(() => {
        window.location.href = 'teacher-dashboard.html';
    }, 350);
}

function logout() {
    const token = localStorage.getItem('sessionToken');
    if (token) {
        fetch('/api/teacher/logout', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        }).catch(() => {});
    }

    hasUnsavedInput = false;
    localStorage.removeItem('sessionToken');
    localStorage.removeItem('teacherId');
    localStorage.removeItem('teacherName');
    localStorage.removeItem('currentQuizId');
    localStorage.removeItem('currentQuizTitle');
    window.location.href = 'teacher-auth.html';
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

window.addEventListener('scroll', () => {
    document.getElementById('navbar')?.classList.toggle('scrolled', window.scrollY > 10);
});
