# Migration Monitor

A multi-user website migration auditing platform. Users can create an account, enter an old and new website URL, and track route coverage and content parity from a private dashboard.

## What is included

- Email/password authentication with hashed passwords and server-side sessions
- User-scoped migration projects and audit runs
- PostgreSQL schema through Prisma
- Persistent background worker using Playwright
- Sitemap discovery plus same-origin link crawling
- HTTP status, title, H1, meta description, word count, and content similarity checks
- Live progress, summary metrics, per-page results, and repeat audits
- Basic SSRF protection for submitted URLs and resolved host addresses

## Architecture

The web process handles authentication, project management, and dashboard rendering. The worker process polls PostgreSQL for queued runs and performs browser-based audits independently. This prevents long crawls from being tied to an HTTP request.

Main tables:

- `User` and `Session`
- `MigrationProject` (belongs to a user)
- `MigrationRun` (belongs to a project)
- `PageResult` and `RunEvent`

## Local setup

Requirements: Node.js 20+, Docker, and about 400 MB for Chromium.

1. Create the environment file:

   ```powershell
   Copy-Item .env.example .env
   ```

2. Start PostgreSQL:

   ```powershell
   docker compose up -d postgres
   ```

3. Install dependencies, create the database schema, and install Chromium:

   ```powershell
   npm.cmd install
   npm.cmd run db:push
   npm.cmd run setup:browser
   ```

4. Run the web app and worker in separate terminals:

   ```powershell
   npm.cmd run dev
   ```

   ```powershell
   npm.cmd run worker
   ```

Open `http://localhost:3000`, create an account, and submit an old/new URL pair.

## Commands

| Command | Purpose |
|---|---|
| `npm.cmd run dev` | Development web server |
| `npm.cmd run worker` | Audit queue worker |
| `npm.cmd run db:push` | Apply the Prisma schema locally |
| `npm.cmd run db:migrate` | Create/apply a development migration |
| `npm.cmd run typecheck` | TypeScript validation |
| `npm.cmd run lint` | ESLint validation |
| `npm.cmd run build` | Production build |

## Production notes

- Run at least one web process and one worker process.
- Use a managed PostgreSQL database with encrypted backups.
- Put the web app behind HTTPS so the session cookie is secure.
- For untrusted public usage, run workers in an isolated network/container and add DNS rebinding protection at the network layer.
- Add email verification, password reset, rate limiting, and audit quotas before opening public signups.
