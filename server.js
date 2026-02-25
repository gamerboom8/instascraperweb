require('dotenv').config();
const path = require('path');
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const port = Number(process.env.PORT || 3000);
const jwtSecret = process.env.JWT_SECRET;
const isTestMode = process.env.TEST_MODE === 'true';
const databaseUrl = process.env.DATABASE_URL;

if (!jwtSecret) {
  throw new Error('JWT_SECRET is required');
}

if (!databaseUrl && !isTestMode) {
  throw new Error('DATABASE_URL is required unless TEST_MODE=true');
}

const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));


const requireDatabase = (res) => {
  if (!pool) {
    res.status(503).json({ error: 'Database is disabled in TEST_MODE (set DATABASE_URL to enable persistence)' });
    return false;
  }
  return true;
};

const toPublicUser = (row) => ({
  id: row.id,
  email: row.email,
  role: row.role,
  credits: row.credits,
  themeColor: row.theme_color,
  brandName: row.brand_name,
});

const authRequired = async (req, res, next) => {
  if (!requireDatabase(res)) {
    return;
  }
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.slice('Bearer '.length);

  try {
    const payload = jwt.verify(token, jwtSecret);
    const { rows } = await pool.query(
      'SELECT id, email, role, credits, theme_color, brand_name FROM users WHERE id = $1',
      [payload.userId]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Session invalid' });
    }

    req.user = toPublicUser(rows[0]);
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

const adminOnly = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  return next();
};


app.get('/health', async (_req, res) => {
  if (!pool) {
    return res.status(200).json({ status: 'ok', mode: 'test', database: 'disabled' });
  }

  try {
    await pool.query('SELECT 1');
    return res.status(200).json({ status: 'ok', mode: isTestMode ? 'test' : 'production', database: 'connected' });
  } catch (error) {
    return res.status(503).json({ status: 'error', database: 'unreachable' });
  }
});

app.post('/api/login', async (req, res) => {
  if (!requireDatabase(res)) {
    return;
  }
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
  if (rows.length === 0) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const user = rows[0];
  const validPassword = await bcrypt.compare(password, user.password_hash);
  if (!validPassword) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ userId: user.id }, jwtSecret, { expiresIn: '12h' });
  return res.json({ token, user: toPublicUser(user) });
});

app.get('/api/me', authRequired, (req, res) => {
  return res.json({ user: req.user });
});

app.post('/api/scrape', authRequired, async (req, res) => {
  if (!requireDatabase(res)) {
    return;
  }
  const { creditsToUse = 1, tool = 'Generic Scraper' } = req.body;

  const creditsCost = Number(creditsToUse);
  if (!Number.isInteger(creditsCost) || creditsCost <= 0) {
    return res.status(400).json({ error: 'creditsToUse must be a positive integer' });
  }

  const { rows } = await pool.query(
    `
      UPDATE users
      SET credits = credits - $1, updated_at = NOW()
      WHERE id = $2 AND credits >= $1
      RETURNING id, email, role, credits, theme_color, brand_name;
    `,
    [creditsCost, req.user.id]
  );

  if (rows.length === 0) {
    return res.status(400).json({ error: 'Insufficient credits' });
  }

  return res.json({
    message: `Simulated scrape executed with ${tool}.`,
    creditsUsed: creditsCost,
    user: toPublicUser(rows[0]),
  });
});

app.get('/api/admin/settings', authRequired, adminOnly, async (_req, res) => {
  if (!requireDatabase(res)) {
    return;
  }
  const { rows } = await pool.query(
    `
      SELECT id, email, role, credits, theme_color, brand_name, created_at
      FROM users
      ORDER BY created_at ASC;
    `
  );

  return res.json({ users: rows.map(toPublicUser) });
});

app.patch('/api/admin/settings', authRequired, adminOnly, async (req, res) => {
  if (!requireDatabase(res)) {
    return;
  }
  const { themeColor, brandName } = req.body;

  if (!themeColor || !brandName) {
    return res.status(400).json({ error: 'themeColor and brandName are required' });
  }

  await pool.query(
    `
      UPDATE users
      SET theme_color = $1, brand_name = $2, updated_at = NOW()
      WHERE role = 'client';
    `,
    [themeColor, brandName]
  );

  return res.json({ message: 'Brand settings updated for all client accounts.' });
});

app.post('/api/admin/clients', authRequired, adminOnly, async (req, res) => {
  if (!requireDatabase(res)) {
    return;
  }
  const { email, password, credits = 0 } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const { rows } = await pool.query(
    `
      INSERT INTO users (email, password_hash, role, credits)
      VALUES ($1, $2, 'client', $3)
      RETURNING id, email, role, credits, theme_color, brand_name;
    `,
    [email.toLowerCase().trim(), passwordHash, Number(credits) || 0]
  );

  return res.status(201).json({ user: toPublicUser(rows[0]) });
});

app.patch('/api/admin/clients/:id', authRequired, adminOnly, async (req, res) => {
  if (!requireDatabase(res)) {
    return;
  }
  const { id } = req.params;
  const { password, credits } = req.body;

  const fields = [];
  const values = [];

  if (typeof credits !== 'undefined') {
    fields.push(`credits = $${fields.length + 1}`);
    values.push(Number(credits));
  }

  if (password) {
    const passwordHash = await bcrypt.hash(password, 12);
    fields.push(`password_hash = $${fields.length + 1}`);
    values.push(passwordHash);
  }

  if (fields.length === 0) {
    return res.status(400).json({ error: 'No updates provided' });
  }

  values.push(id);
  const { rows } = await pool.query(
    `
      UPDATE users
      SET ${fields.join(', ')}, updated_at = NOW()
      WHERE id = $${fields.length + 1} AND role = 'client'
      RETURNING id, email, role, credits, theme_color, brand_name;
    `,
    values
  );

  if (rows.length === 0) {
    return res.status(404).json({ error: 'Client not found' });
  }

  return res.json({ user: toPublicUser(rows[0]) });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  return res.status(500).json({ error: 'Unexpected server error' });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
