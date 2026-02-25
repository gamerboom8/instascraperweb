const token = localStorage.getItem('token');
if (!token) {
  window.location.href = '/';
}

const creditsEl = document.getElementById('credits');
const messageEl = document.getElementById('dashMessage');
const userLine = document.getElementById('userLine');
const dashBrand = document.getElementById('dashBrand');

function applyTheme(user) {
  document.documentElement.style.setProperty('--accent', user.themeColor || '#4f46e5');
  dashBrand.textContent = user.brandName || 'ScrapeForge';
  userLine.textContent = `${user.email} (${user.role})`;
  creditsEl.textContent = user.credits;
}

async function fetchMe() {
  const response = await fetch('/api/me', { headers: { Authorization: `Bearer ${token}` } });
  const result = await response.json();

  if (!response.ok) {
    localStorage.removeItem('token');
    window.location.href = '/';
    return;
  }

  applyTheme(result.user);
  document.getElementById('adminBtn').style.display = result.user.role === 'admin' ? 'inline-block' : 'none';
}

fetchMe();

document.getElementById('scrapeForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const tool = document.getElementById('tool').value;
  const creditsToUse = Number(document.getElementById('creditsToUse').value);

  const response = await fetch('/api/scrape', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ tool, creditsToUse }),
  });

  const result = await response.json();
  if (!response.ok) {
    messageEl.textContent = result.error || 'Failed to run scrape';
    return;
  }

  applyTheme(result.user);
  messageEl.textContent = `${result.message} Credits used: ${result.creditsUsed}.`;
});

document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('token');
  window.location.href = '/';
});

document.getElementById('adminBtn').addEventListener('click', () => {
  window.location.href = '/admin.html';
});
