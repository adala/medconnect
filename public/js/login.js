
console.log('Script loaded');
document.addEventListener('DOMContentLoaded', function () {
    // Get form element
    const loginForm = document.getElementById('loginForm');

    if (!loginForm) {
        console.error('Login form not found');
        return;
    }

    // Toggle password visibility
    const togglePassword = document.getElementById('togglePassword');
    if (togglePassword) {
        togglePassword.addEventListener('click', function () {
            const password = document.getElementById('password');
            const type = password.getAttribute('type') === 'password' ? 'text' : 'password';
            password.setAttribute('type', type);
            this.querySelector('i').classList.toggle('fa-eye');
            this.querySelector('i').classList.toggle('fa-eye-slash');
        });
    }

    // Login form submission
    loginForm.addEventListener('submit', async function (e) {
        console.log('Form submit event triggered');
        e.preventDefault();
        e.stopPropagation();

        console.log('Prevent default called');

        const btn = document.getElementById('loginBtn');
        const spinner = btn.querySelector('.spinner-border');
        const originalText = btn.innerHTML;

        btn.disabled = true;
        spinner.classList.remove('d-none');
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span> Signing in...';

        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const rememberMe = document.getElementById('rememberMe').checked;

        console.log('Attempting login for:', email);

        try {
            const response = await fetch('/api/local/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: email,
                    password: password,
                    rememberMe: rememberMe
                })
            });

            const data = await response.json();
            console.log('Login response:', data);

            if (data.success) {
                if (data.data.token) {
                    localStorage.setItem('gateway_token', data.data.token);
                }

                if (data.data.requiresPasswordChange) {
                    window.location.href = '/change-password';
                } else {
                    window.location.href = '/';
                }
            } else {
                showError(data.error || 'Login failed');
            }
        } catch (error) {
            console.error('Login error:', error);
            showError('Network error. Please try again.');
        } finally {
            btn.disabled = false;
            spinner.classList.add('d-none');
            btn.innerHTML = originalText;
        }
    });

    function showError(message) {
        const alertDiv = document.createElement('div');
        alertDiv.className = 'alert alert-danger mt-3';
        alertDiv.innerHTML = `
                <i class="fas fa-exclamation-circle me-2"></i>
                ${message}
                <button type="button" class="btn-close float-end" data-bs-dismiss="alert"></button>
            `;

        const loginForm = document.getElementById('loginForm');
        loginForm.insertAdjacentElement('beforebegin', alertDiv);

        setTimeout(() => alertDiv.remove(), 5000);
    }
});
