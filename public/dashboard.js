const token = localStorage.getItem('token');
if (!token) {
  window.location.href = '/';
}

const creditsEl = document.getElementById('credits');
const messageEl = document.getElementById('dashMessage');
const userLine = document.getElementById('userLine');
const dashBrand = document.getElementById('dashBrand');
const payloadTable = document.getElementById('payloadTable');
const pagesTable = document.getElementById('pagesTable');
const matchesTable = document.getElementById('matchesTable');

function applyTheme(user) {
  document.documentElement.style.setProperty('--accent', user.themeColor || '#4f46e5');
  dashBrand.textContent = user.brandName || 'ScrapeForge';
  userLine.textContent = `${user.email} (${user.role})`;
  creditsEl.textContent = user.credits;
}

function renderPayloadTable(payload) {
  payloadTable.innerHTML = '';
  const entries = Object.entries(payload || {});
  if (entries.length === 0) {
    payloadTable.innerHTML = '<tr><td colspan="2">No payload submitted yet.</td></tr>';
    return;
  }

  for (const [field, value] of entries) {
    const row = document.createElement('tr');
    const normalizedValue = Array.isArray(value) ? value.join(', ') : String(value);
    row.innerHTML = `<td>${field}</td><td>${normalizedValue}</td>`;
    payloadTable.appendChild(row);
  }
}

function renderPagesTable(pages) {
  pagesTable.innerHTML = '';
  if (!pages || pages.length === 0) {
    pagesTable.innerHTML = '<tr><td colspan="3">No pages crawled yet.</td></tr>';
    return;
  }

  for (const page of pages) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${page.url || '-'}</td>
      <td>${page.status || '-'}</td>
      <td>${page.title || '-'}</td>
    `;
    pagesTable.appendChild(row);
  }
}

function renderMatchesTable(matches) {
  matchesTable.innerHTML = '';

  if (!matches || matches.length === 0) {
    matchesTable.innerHTML = '<tr><td colspan="5">No matching contact buttons/links were found.</td></tr>';
    return;
  }

  for (const match of matches) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${match.page || '-'}</td>
      <td>${match.element || '-'}</td>
      <td>${match.text || '-'}</td>
      <td>${match.matchedPhrases || '-'}</td>
      <td>${match.href || '-'}</td>
    `;
    matchesTable.appendChild(row);
  }
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
renderPayloadTable(null);
renderPagesTable([]);
renderMatchesTable([]);

document.getElementById('scrapeForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  const extraUrls = document
    .getElementById('targetUrls')
    .value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);

  const payload = {
    tool: document.getElementById('tool').value,
    creditsToUse: Number(document.getElementById('creditsToUse').value),
    targetUrl: document.getElementById('targetUrl').value,
    targetUrls: extraUrls,
    maxPages: Number(document.getElementById('maxPages').value),
  };

  renderPayloadTable(payload);
  messageEl.textContent = 'Crawling website(s), please wait...';

  const response = await fetch('/api/scrape', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const result = await response.json();
  if (!response.ok) {
    messageEl.textContent = result.error || 'Failed to run crawl';
    renderPagesTable([]);
    renderMatchesTable([]);
    return;
  }

  applyTheme(result.user);
  renderPayloadTable(result.sentPayload || payload);
  renderPagesTable(result.crawl?.pages || []);
  renderMatchesTable(result.crawl?.matches || []);
  messageEl.textContent = `${result.message} Credits used: ${result.creditsUsed}. Targets: ${result.sentPayload?.uniqueTargetCount || 1}. Pages visited: ${result.crawl?.pagesVisited || 0}. Matches: ${result.crawl?.totalMatches || 0}.`;
});

document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('token');
  window.location.href = '/';
});

document.getElementById('adminBtn').addEventListener('click', () => {
  window.location.href = '/admin.html';
});
