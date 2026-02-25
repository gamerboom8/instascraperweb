const token = localStorage.getItem('token');
if (token) {
  window.location.href = '/dashboard.html';
}

const form = document.getElementById('loginForm');
const message = document.getElementById('message');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  message.textContent = 'Logging in...';

  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;

  const response = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const result = await response.json();
  if (!response.ok) {
    message.textContent = result.error || 'Login failed';
    return;
  }

  localStorage.setItem('token', result.token);
  window.location.href = '/dashboard.html';
});
