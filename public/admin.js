const token = localStorage.getItem('token');
if (!token) {
  window.location.href = '/';
}

const messageEl = document.getElementById('adminMessage');
const clientsTable = document.getElementById('clientsTable');

async function fetchSettings() {
  const response = await fetch('/api/admin/settings', {
    headers: { Authorization: `Bearer ${token}` },
  });

  const result = await response.json();
  if (!response.ok) {
    messageEl.textContent = result.error || 'Unable to load admin settings';
    if (response.status === 403 || response.status === 401) {
      setTimeout(() => {
        window.location.href = '/dashboard.html';
      }, 1000);
    }
    return;
  }

  const firstClient = result.users.find((user) => user.role === 'client');
  if (firstClient) {
    document.getElementById('brandName').value = firstClient.brandName;
    document.getElementById('themeColor').value = firstClient.themeColor;
  }

  renderClients(result.users.filter((user) => user.role === 'client'));
}

function renderClients(clients) {
  clientsTable.innerHTML = '';

  if (clients.length === 0) {
    clientsTable.innerHTML = '<tr><td colspan="4">No clients yet.</td></tr>';
    return;
  }

  for (const client of clients) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${client.email}</td>
      <td>${client.credits}</td>
      <td><input type="number" min="0" value="${client.credits}" data-credits-id="${client.id}" /></td>
      <td><input type="password" placeholder="new password" data-pass-id="${client.id}" /></td>
      <td><button data-save-id="${client.id}">Save</button></td>
    `;
    clientsTable.appendChild(row);
  }

  clientsTable.querySelectorAll('button[data-save-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.getAttribute('data-save-id');
      const creditsInput = clientsTable.querySelector(`input[data-credits-id="${id}"]`);
      const passInput = clientsTable.querySelector(`input[data-pass-id="${id}"]`);

      const payload = { credits: Number(creditsInput.value) };
      if (passInput.value) {
        payload.password = passInput.value;
      }

      const response = await fetch(`/api/admin/clients/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const result = await response.json();
      messageEl.textContent = response.ok
        ? `Updated ${result.user.email}`
        : result.error || 'Unable to update client';
      fetchSettings();
    });
  });
}

document.getElementById('brandForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  const response = await fetch('/api/admin/settings', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      brandName: document.getElementById('brandName').value,
      themeColor: document.getElementById('themeColor').value,
    }),
  });

  const result = await response.json();
  messageEl.textContent = response.ok ? result.message : result.error || 'Unable to save brand settings';
  fetchSettings();
});

document.getElementById('createClientForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  const response = await fetch('/api/admin/clients', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      email: document.getElementById('newEmail').value,
      password: document.getElementById('newPassword').value,
      credits: Number(document.getElementById('newCredits').value),
    }),
  });

  const result = await response.json();
  messageEl.textContent = response.ok ? `Created ${result.user.email}` : result.error || 'Unable to create client';
  fetchSettings();
});

document.getElementById('backBtn').addEventListener('click', () => {
  window.location.href = '/dashboard.html';
});

document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('token');
  window.location.href = '/';
});

fetchSettings();
