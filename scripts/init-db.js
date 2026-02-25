require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function init() {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD must be defined in .env');
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'client')),
      credits INTEGER NOT NULL DEFAULT 0,
      theme_color TEXT NOT NULL DEFAULT '#4f46e5',
      brand_name TEXT NOT NULL DEFAULT 'ScrapeForge',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const passwordHash = await bcrypt.hash(adminPassword, 12);
  await pool.query(
    `
      INSERT INTO users (email, password_hash, role, credits)
      VALUES ($1, $2, 'admin', 0)
      ON CONFLICT (email)
      DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin', updated_at = NOW();
    `,
    [adminEmail, passwordHash]
  );

  console.log('Database initialized and admin account ensured.');
}

init()
  .catch((error) => {
    console.error('Failed to initialize database:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
