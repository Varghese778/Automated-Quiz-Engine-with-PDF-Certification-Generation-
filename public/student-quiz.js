let quizInfo = null;
let questions = [];
let currentQuestionIndex = 0;
let answers = {};
let isSubmitting = false;
let certificateToken = null;

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

async function requestJson(url, options = {}, timeoutMs = 15000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                ...(options.headers || {})
            }
        });

        let data = null;
        try {
            data = await response.json();
        } catch {
            data = null;
        }

        return { response, data };
    } finally {
        clearTimeout(timeout);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    loadQuizInfo();
    setupForm();
    setupCertificateDownload();
    setupKeyboardNavigation();
});

function loadQuizInfo() {
    const info = sessionStorage.getItem('quizInfo');
    if (!info) {
        showToast('No quiz selected', 'warning');
        window.location.href = 'student-access.html';
        return;
    }

    quizInfo = JSON.parse(info);
    document.getElementById('quiz-title').innerText = quizInfo.quizTitle;

    const savedProgress = sessionStorage.getItem('quizProgress');
    if (savedProgress) {
        try {
            const parsed = JSON.parse(savedProgress);
            if (parsed.quizId === quizInfo.quizId && parsed.accessCodeId === quizInfo.accessCodeId) {
                answers = parsed.answers || {};
                currentQuestionIndex = Number.isInteger(parsed.currentQuestionIndex) ? parsed.currentQuestionIndex : 0;
            }
        } catch {
            sessionStorage.removeItem('quizProgress');
        }
    }

    fetchQuestions();
}

function setupForm() {
    document.getElementById('quiz-form').addEventListener('submit', (event) => {
        event.preventDefault();
        submitQuiz();
    });
}

function setupKeyboardNavigation() {
    document.addEventListener('keydown', (event) => {
        if (document.getElementById('quiz-form').classList.contains('hidden')) return;

        if (event.key === 'ArrowRight') {
            event.preventDefault();
            nextQuestion();
        }

        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            previousQuestion();
        }
    });
}

function persistProgress() {
    if (!quizInfo) return;

    sessionStorage.setItem('quizProgress', JSON.stringify({
        quizId: quizInfo.quizId,
        accessCodeId: quizInfo.accessCodeId,
        currentQuestionIndex,
        answers
    }));
}

async function fetchQuestions() {
    try {
        const { response, data } = await requestJson(`/api/quiz/${quizInfo.quizId}/student-questions/${quizInfo.accessCodeId}`, {
            method: 'GET'
        });

        if (!response.ok || !Array.isArray(data)) {
            showToast(data?.error || 'Error loading quiz questions', 'error');
            return;
        }

        questions = data;
        if (questions.length === 0) {
            document.getElementById('quiz-content').innerHTML = '<div class="empty-state"><div class="empty-state-icon">📭</div><p>No questions in this quiz yet</p></div>';
            return;
        }

        if (currentQuestionIndex >= questions.length) {
            currentQuestionIndex = questions.length - 1;
        }

        document.getElementById('nav-buttons').style.display = 'flex';
        renderQuestion();
    } catch (error) {
        showToast(error.name === 'AbortError' ? 'Server timeout. Please retry.' : 'Error loading quiz — check your connection', 'error');
        document.getElementById('quiz-content').innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔌</div><h3>Connection Error</h3><p>Make sure the server is running</p></div>';
    }
}

function renderQuestion() {
    if (currentQuestionIndex >= questions.length) return;

    const question = questions[currentQuestionIndex];
    const quizContent = document.getElementById('quiz-content');
    const isLast = currentQuestionIndex === questions.length - 1;

    quizContent.innerHTML = `
        <div class="question-block">
            <div class="question-text">${currentQuestionIndex + 1}. ${escapeHtml(question.question_text)}</div>
            <div class="options-list">
                ${['A', 'B', 'C', 'D'].map((opt) => {
                    const optionKey = `option_${opt.toLowerCase()}`;
                    const isSelected = answers[question.id] === opt;
                    return `
                        <label class="option-label ${isSelected ? 'selected' : ''}">
                            <input type="radio" name="question_${question.id}" value="${opt}" ${isSelected ? 'checked' : ''}>
                            <span class="option-letter">${opt}</span>
                            <span>${escapeHtml(question[optionKey])}</span>
                        </label>`;
                }).join('')}
            </div>
        </div>`;

    document.getElementById('prev-btn').style.display = currentQuestionIndex > 0 ? 'inline-flex' : 'none';
    document.getElementById('next-btn').style.display = isLast ? 'none' : 'inline-flex';
    document.getElementById('submit-btn').style.display = isLast ? 'inline-flex' : 'none';

    updateProgressBar();

    document.querySelectorAll(`input[name="question_${question.id}"]`).forEach((input) => {
        input.addEventListener('change', (event) => {
            answers[question.id] = event.target.value;
            document.querySelectorAll('.option-label').forEach(label => label.classList.remove('selected'));
            event.target.closest('.option-label').classList.add('selected');
            persistProgress();
            updateProgressBar();
        });
    });
}

function nextQuestion() {
    if (currentQuestionIndex < questions.length - 1) {
        currentQuestionIndex += 1;
        persistProgress();
        renderQuestion();
    }
}

function previousQuestion() {
    if (currentQuestionIndex > 0) {
        currentQuestionIndex -= 1;
        persistProgress();
        renderQuestion();
    }
}

function updateProgressBar() {
    const total = questions.length;
    const percentage = total === 0 ? 0 : ((currentQuestionIndex + 1) / total) * 100;
    const answeredCount = Object.keys(answers).length;

    document.getElementById('progress-fill').style.width = `${percentage}%`;
    document.getElementById('progress-text').innerText = `Question ${currentQuestionIndex + 1} of ${total} · ${answeredCount} answered`;
}

async function submitQuiz() {
    if (isSubmitting) return;

    if (Object.keys(answers).length !== questions.length) {
        const remaining = questions.length - Object.keys(answers).length;
        showToast(`Please answer all questions (${remaining} remaining)`, 'warning');
        return;
    }

    const submitButton = document.getElementById('submit-btn');
    submitButton.disabled = true;
    submitButton.textContent = 'Submitting...';
    isSubmitting = true;

    try {
        const { response, data } = await requestJson('/api/submit-quiz', {
            method: 'POST',
            body: JSON.stringify({
                candidate_name: quizInfo.studentName || 'Student',
                answers,
                quizId: quizInfo.quizId,
                accessCodeId: quizInfo.accessCodeId
            })
        });

        if (!response.ok) {
            showToast(`Error submitting quiz: ${data?.error || 'Unknown error'}`, 'error');
            return;
        }

        certificateToken = data.certificateToken || null;
        showResults(data);
    } catch (error) {
        showToast(error.name === 'AbortError' ? 'Submission timed out. Please retry.' : 'Error submitting quiz — check your connection', 'error');
    } finally {
        isSubmitting = false;
        submitButton.disabled = false;
        submitButton.textContent = '✅ Submit Quiz';
    }
}

function showResults(result) {
    document.getElementById('quiz-form').classList.add('hidden');

    const resultContainer = document.getElementById('result-container');
    resultContainer.classList.remove('hidden');
    resultContainer.classList.remove('result-passed', 'result-failed');

    const percentage = Math.round((result.score / result.total_questions) * 100);

    document.getElementById('score-display').innerText = `You scored ${result.score} out of ${result.total_questions}`;
    document.getElementById('percentage-display').innerText = `${percentage}%`;

    const statusDisplay = document.getElementById('status-display');
    const certButton = document.getElementById('download-cert-btn');
    const resultIcon = document.getElementById('result-icon');

    if (result.passed) {
        resultIcon.innerHTML = '🏆';
        statusDisplay.innerText = 'Congratulations! You passed!';
        resultContainer.classList.add('result-passed');
        certButton.classList.remove('hidden');
        certButton.dataset.resultId = result.result_id;
        certButton.dataset.token = certificateToken || '';
        showToast(result.duplicate ? 'Submission already recorded. Showing latest result.' : 'Congratulations! You passed! 🎉', 'success');
    } else {
        resultIcon.innerHTML = '📚';
        statusDisplay.innerText = 'You did not pass this time. Keep studying and try again!';
        resultContainer.classList.add('result-failed');
        certButton.classList.add('hidden');
        certButton.dataset.resultId = '';
        certButton.dataset.token = '';
        showToast('Better luck next time!', 'info');
    }

    sessionStorage.removeItem('quizInfo');
    sessionStorage.removeItem('quizProgress');
}

function setupCertificateDownload() {
    document.getElementById('download-cert-btn').addEventListener('click', async function () {
        const resultId = this.dataset.resultId;
        const token = this.dataset.token;

        if (!resultId || !token) {
            showToast('Certificate is not available for this attempt', 'error');
            return;
        }

        this.innerText = '⏳ Generating PDF...';
        this.disabled = true;

        try {
            const response = await fetch(`/api/certificate/${encodeURIComponent(resultId)}?token=${encodeURIComponent(token)}`);
            if (!response.ok) {
                const data = await response.json().catch(() => null);
                throw new Error(data?.error || 'Failed to generate certificate');
            }

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'Quiz_Certificate.pdf';
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            a.remove();

            showToast('Certificate downloaded', 'success');
        } catch (error) {
            showToast(error.message || 'Error downloading certificate', 'error');
        } finally {
            this.innerText = '📄 Download Certificate';
            this.disabled = false;
        }
    });
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
