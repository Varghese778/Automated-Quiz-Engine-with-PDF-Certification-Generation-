let isLoginSubmitting = false;
let isRegisterSubmitting = false;

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

function toggleForms() {
    document.getElementById('login-section').classList.toggle('active');
    document.getElementById('register-section').classList.toggle('active');
    document.getElementById('login-error').innerText = '';
    document.getElementById('register-error').innerText = '';
}

function togglePassword(inputId, btn) {
    const input = document.getElementById(inputId);
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    btn.textContent = showing ? '👁' : '🙈';
}

document.getElementById('register-password')?.addEventListener('input', (event) => {
    const password = event.target.value;
    const bars = document.querySelectorAll('#password-strength .bar');
    const hint = document.getElementById('password-hint');

    let strength = 0;
    if (password.length >= 8) strength += 1;
    if (password.length >= 10) strength += 1;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) strength += 1;
    if (/[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password)) strength += 1;

    const labels = ['', 'Weak', 'Fair', 'Good', 'Strong'];
    const classes = ['', 'weak', 'medium', 'medium', 'strong'];

    bars.forEach((bar, index) => {
        bar.className = 'bar';
        if (index < strength) bar.classList.add(classes[strength]);
    });

    hint.textContent = password.length === 0 ? 'Use at least 8 characters' : `${labels[strength]} password`;
});

if (localStorage.getItem('sessionToken')) {
    window.location.href = 'teacher-dashboard.html';
}

document.getElementById('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (isLoginSubmitting) return;

    const button = event.target.querySelector('button[type="submit"]');
    const errorDiv = document.getElementById('login-error');
    errorDiv.innerText = '';

    const email = document.getElementById('login-email').value.trim().toLowerCase();
    const password = document.getElementById('login-password').value;

    if (!email || !password) {
        errorDiv.innerText = 'Please fill in all fields';
        return;
    }

    isLoginSubmitting = true;
    button.disabled = true;
    button.textContent = 'Signing in...';

    try {
        const { response, data } = await requestJson('/api/teacher/login', {
            method: 'POST',
            body: JSON.stringify({ email, password })
        });

        if (!response.ok) {
            errorDiv.innerText = data?.error || 'Login failed';
            return;
        }

        localStorage.setItem('sessionToken', data.sessionToken);
        localStorage.setItem('teacherId', data.teacherId);
        localStorage.setItem('teacherName', data.name);

        showToast(`Welcome back, ${data.name}!`, 'success');
        setTimeout(() => {
            window.location.href = 'teacher-dashboard.html';
        }, 400);
    } catch (error) {
        errorDiv.innerText = error.name === 'AbortError'
            ? 'Server timeout. Please try again.'
            : 'Cannot reach server. Is it running?';
    } finally {
        isLoginSubmitting = false;
        button.disabled = false;
        button.textContent = 'Sign In';
    }
});

document.getElementById('register-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (isRegisterSubmitting) return;

    const button = event.target.querySelector('button[type="submit"]');
    const errorDiv = document.getElementById('register-error');
    errorDiv.innerText = '';

    const name = document.getElementById('register-name').value.trim();
    const email = document.getElementById('register-email').value.trim().toLowerCase();
    const password = document.getElementById('register-password').value;

    if (!name || !email || !password) {
        errorDiv.innerText = 'Please fill in all fields';
        return;
    }

    if (name.length < 2) {
        errorDiv.innerText = 'Name must be at least 2 characters';
        return;
    }

    if (password.length < 8) {
        errorDiv.innerText = 'Password must be at least 8 characters';
        return;
    }

    isRegisterSubmitting = true;
    button.disabled = true;
    button.textContent = 'Creating account...';

    try {
        const { response, data } = await requestJson('/api/teacher/register', {
            method: 'POST',
            body: JSON.stringify({ name, email, password })
        });

        if (!response.ok) {
            errorDiv.innerText = data?.error || 'Registration failed';
            return;
        }

        localStorage.setItem('sessionToken', data.sessionToken);
        localStorage.setItem('teacherId', data.teacherId);
        localStorage.setItem('teacherName', data.name || name);

        showToast('Account created! Welcome aboard 🎉', 'success');
        setTimeout(() => {
            window.location.href = 'teacher-dashboard.html';
        }, 400);
    } catch (error) {
        errorDiv.innerText = error.name === 'AbortError'
            ? 'Server timeout. Please try again.'
            : 'Cannot reach server. Is it running?';
    } finally {
        isRegisterSubmitting = false;
        button.disabled = false;
        button.textContent = 'Create Account';
    }
});

window.addEventListener('scroll', () => {
    document.getElementById('navbar')?.classList.toggle('scrolled', window.scrollY > 10);
});
