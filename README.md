# Social Scraping Platform UI (Instascraperweb)

This project delivers a platform UI and API for:

- Login with credentials stored in PostgreSQL as password hashes.
- Admin-only page to customize brand/theme shown to all client accounts.
- Admin management of client credentials and credits.
- Credit consumption endpoint that simulates scraping operations.

## Quick start

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

## Notes

- Passwords are hashed with bcrypt.
- Auth uses JWT bearer tokens stored in localStorage.
- The scrape endpoint is simulated and decrements credits.
