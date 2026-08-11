document.addEventListener('DOMContentLoaded', () => {
  if (localStorage.getItem('auth_token')) {
    window.location.href = 'index.html';
    return;
  }

  const form = document.getElementById('login-form');
  const errorEl = document.getElementById('login-error');
  const apiBase = window.APP_CONFIG?.API_BASE_URL || '';

  const passwordInput = document.getElementById('password');
  const toggleBtn = document.getElementById('toggle-password-btn');
  if (toggleBtn && passwordInput) {
    const eyeClosedLine = toggleBtn.querySelector('.eye-closed');
    toggleBtn.addEventListener('click', () => {
      const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
      passwordInput.setAttribute('type', type);
      if (type === 'text') {
        eyeClosedLine.classList.remove('hidden');
      } else {
        eyeClosedLine.classList.add('hidden');
      }
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.classList.add('hidden');
    const password = document.getElementById('password').value;

    try {
      const res = await fetch(`${apiBase}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');
      localStorage.setItem('auth_token', data.token);
      window.location.href = 'index.html';
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
    }
  });
});
