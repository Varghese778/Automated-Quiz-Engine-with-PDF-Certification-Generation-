let isSubmitting = false;

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

async function requestJson(url, options = {}, timeoutMs = 10000) {
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

const studentNameInput = document.getElementById('student-name');
const codeInput = document.getElementById('access-code');

studentNameInput.value = localStorage.getItem('lastStudentName') || '';

codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
});

document.getElementById('access-code-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (isSubmitting) return;

    const studentName = studentNameInput.value.trim();
    const code = codeInput.value.trim().toUpperCase();
    const errorDiv = document.getElementById('access-error');
    const button = document.getElementById('access-btn');

    errorDiv.innerText = '';

    if (!studentName || studentName.length < 2) {
        errorDiv.innerText = 'Please enter your name (at least 2 characters)';
        return;
    }

    if (code.length < 4) {
        errorDiv.innerText = 'Please enter a valid access code';
        return;
    }

    isSubmitting = true;
    button.disabled = true;
    button.textContent = 'Verifying...';

    try {
        const { response, data } = await requestJson('/api/student/access', {
            method: 'POST',
            body: JSON.stringify({ code })
        });

        if (!response.ok) {
            errorDiv.innerText = data?.error || 'Invalid or expired access code';
            return;
        }

        localStorage.setItem('lastStudentName', studentName);

        sessionStorage.setItem('quizInfo', JSON.stringify({
            quizId: data.quizId,
            accessCodeId: data.accessCodeId,
            quizTitle: data.quiz.title,
            passingScorePercentage: data.quiz.passing_score_percentage,
            questionCount: data.questionCount || 0,
            studentName
        }));

        sessionStorage.removeItem('quizProgress');

        showToast('Access granted! Loading quiz...', 'success');
        setTimeout(() => {
            window.location.href = 'student-quiz.html';
        }, 350);
    } catch (error) {
        errorDiv.innerText = error.name === 'AbortError'
            ? 'Server timeout. Please retry.'
            : 'Connection error — make sure the server is running';
    } finally {
        isSubmitting = false;
        button.disabled = false;
        button.textContent = '🚀 Start Quiz';
    }
});

window.addEventListener('scroll', () => {
    document.getElementById('navbar')?.classList.toggle('scrolled', window.scrollY > 10);
});
