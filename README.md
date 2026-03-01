# Social Scraping Platform UI (Instascraperweb)

This project delivers a platform UI + API for:

- Login with credentials stored in PostgreSQL as password hashes.
- Admin-only page to customize brand/theme shown to all client accounts.
- Admin management of client credentials and credits.
- Credit consumption endpoint that performs a real multi-page crawl for contact-intent elements (links/buttons/forms).

## Local quick start

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy and configure env vars:

   ```bash
   cp .env.example .env
   ```

3. Ensure PostgreSQL is running and `DATABASE_URL` points to your DB.

4. Initialize DB and create/update the admin account:

   ```bash
   npm run init-db
   ```

5. Start the server:

   ```bash
   npm start
   ```

Open `http://localhost:3000`.

## EasyPanel deployment (recommended)

This repository is now deploy-ready for EasyPanel using the included `Dockerfile`.

### 1) Create a PostgreSQL service in EasyPanel

- Create a new **PostgreSQL** app in EasyPanel.
- Copy its connection string and use it as `DATABASE_URL` in the web app.

### 2) Create the web app from this repo

- In EasyPanel, create a new app from your Git repository.
- Build method: **Dockerfile** (auto-detected).
- Exposed port: `3000` (container already exposes this).

### 3) Set required environment variables

Add these variables in EasyPanel:

- `PORT=3000`
- `DATABASE_URL=postgresql://...`
- `JWT_SECRET=<strong-random-secret>`
- `ADMIN_EMAIL=<your-admin-email>`
- `ADMIN_PASSWORD=<your-initial-admin-password>`
- `TEST_MODE=false`

### 4) Run DB initialization once

After first deployment, run this command in the web app console/terminal:

```bash
npm run init-db
```

This creates the table and ensures the admin user exists.

### 5) Healthcheck

Set EasyPanel health check path to:

```text
/health
```

## Notes

- Passwords are hashed with bcrypt.
- Auth uses JWT bearer tokens.
- The scrape endpoint is simulated and decrements credits.
- If you rotate `ADMIN_PASSWORD`, re-run `npm run init-db` to update the admin hash.


## Test mode (start without database)

If you want the app process to boot without PostgreSQL (for UI smoke tests / container checks), set:

```text
TEST_MODE=true
```

With `TEST_MODE=true` and no `DATABASE_URL`, the server starts and `/health` returns healthy with database disabled.
Database-backed routes (`/api/*`) will return `503` until you provide a real `DATABASE_URL`.

## Can I point to a brand new PostgreSQL database?

Yes. You can switch `DATABASE_URL` to any new PostgreSQL instance.
After pointing to the new database, run:

```bash
npm run init-db
```

That command creates the required `users` table (if missing) and seeds/updates the admin account.


## Smart crawler behavior

- `/api/scrape` accepts `targetUrl` + optional `targetUrls[]`, deduplicates repeated URLs, and crawls internal pages up to `maxPages` (1-25) per target.
- It detects contact-intent phrases like `contact us`, `entre em contato`, `fale conosco`, `chat with us`, `support`, `whatsapp`, and more.
- Dashboard UI shows JSON payload, visited pages, and crawler findings in separate tables for easier review.
