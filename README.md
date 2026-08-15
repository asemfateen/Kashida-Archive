# Kashida Archive

Kashida is an automated newsroom design platform that lets journalists and media teams design their brand templates once and generate professional, ready-to-publish news images in seconds.

This repository houses **Kashida Archive** — the dedicated digital asset management and AI-tagging system built to organize the visual assets, templates, and generated graphics for the platform. The goal is a completely streamlined news design and archival experience: ingest, AI-tag, search, and organize your visual library in one place.

## Features

- **Photo ingest** — presigned Cloudflare R2 uploads with per-file status tracking (drag & drop or browse)
- **AI tagging** — one-click Gemini tagging per image (left-click the **AI** button, right-click to edit the master prompt, `Cmd/Ctrl+T`), tags **merged** into the existing set (never overwritten, duplicates removed case-insensitively)
- **Fuzzy search** — PostgreSQL full-text (`tsvector`) + `pg_trgm` trigram similarity ranking, so typos ("protestt") still find the right tags; sort by relevance/newest/oldest
- **Admin auth** — single-operator JWT login (`/login`), all `/api/*` routes protected except health, login and raw image serving
- **Favorites & trash** — soft delete with restore, favorites view
- **Global taskbar** — fixed Home link + search (`Cmd/Ctrl+K`), avatar opens the `/profile` page with logout
- **Keyboard-first** — `Cmd/Ctrl+K` search, `Cmd/Ctrl+T` AI tag, `←/→` navigate assets, `Esc` close dialogs
- **API-first** — the backend is the product; the React client is a faithful implementation of the original design system

## Stack

- **API**: Node.js + Express (`server/`)
- **DB**: PostgreSQL 15 — `images` table with a generated `search_vector` tsvector column + GIN index, soft delete + favorites
- **Storage**: Cloudflare R2 (presigned uploads), `R2_PUBLIC_BASE_URL` for public URLs
- **AI tagging**: Google Gemini (`@google/genai`) — configurable master prompt, 25-tag cap
- **Client**: Vite + React + Tailwind (local build, no CDN)

## API

| Method | Route                                      | Description                                       |
| ------ | ------------------------------------------ | ------------------------------------------------- |
| POST   | `/api/auth/login`                          | Exchange admin credentials for a JWT              |
| GET    | `/api/health`                              | Liveness (no auth)                                |
| POST   | `/api/upload-url`                          | Presigned R2 upload URL (60s)                     |
| POST   | `/api/images`                              | Register uploaded image                           |
| GET    | `/api/images?view=all\|favorites\|trash`   | List images                                       |
| PATCH  | `/api/images/:objectKey`                   | Update tags / favorite / deleted                  |
| DELETE | `/api/images/:objectKey`                   | Soft delete                                       |
| GET    | `/api/search?q=&sort=rank\|newest\|oldest` | Tag search — `tsvector` + `pg_trgm` fuzzy, ranked |
| POST   | `/api/images/tag`                          | Gemini AI tagging (base64 thumbnail or imageUrl)  |

Every `/api/*` route except `/api/health`, `/api/auth/login` and `/api/images/serve*` requires `Authorization: Bearer <jwt>`. `objectKey` contains `/` — always URL-encode it in path params.

## Client screens

`login` (admin sign-in), `dashboard` (quick actions, quick-tag), `upload` (drag & drop), `detail` (zoom, AI tag, favorites, keyboard: `←/→`, `Cmd+T`), `search` (fuzzy results, saved searches, batch select), `settings & help`, `profile` (session info, logout). A fixed global taskbar (Home link, search with `Cmd/Ctrl+K`, avatar → profile) is present on every authed screen.

## Run locally

```bash
# DB (docker)
docker run -d --name kashida-archive-db -p 5432:5432 \
  -e POSTGRES_USER=smart_archive -e POSTGRES_PASSWORD=smart_archive \
  -e POSTGRES_DB=smart_image_archive -v kashida-archive-pgdata:/var/lib/postgresql/data \
  postgres:15

# API
cp server/.env.example server/.env   # add R2 + GEMINI creds
npm install
npm run db:init -w server            # or: cd server && npm install && npm run db:init
npm run dev -w server

# Client
npm run dev -w client
```

## Environment variables (`server/.env.example`)

| Variable               | Required | Description                                                 |
| ---------------------- | -------- | ----------------------------------------------------------- |
| `PORT`                 | no       | API port (default `3000`)                                   |
| `DATABASE_URL`         | yes*     | PostgreSQL connection string (`postgresql://…`)             |
| `ADMIN_USER`           | prod     | Admin username for `/api/auth/login` (dev fallback `admin`) |
| `ADMIN_PASS`           | prod     | Admin password for `/api/auth/login` (dev fallback `admin`) |
| `JWT_SECRET`           | prod     | Secret for signing login tokens (dev fallback set)          |
| `R2_ACCOUNT_ID`        | uploads  | Cloudflare account ID for R2                                |
| `R2_ACCESS_KEY_ID`     | uploads  | R2 API token access key                                     |
| `R2_SECRET_ACCESS_KEY` | uploads  | R2 API token secret key                                     |
| `R2_BUCKET_NAME`       | uploads  | R2 bucket name                                              |
| `R2_PUBLIC_BASE_URL`   | no       | Public base URL for stored images (`https://…`)             |
| `GEMINI_API_KEY`       | AI tags  | Google AI Studio API key                                    |

*Required in production — without it the API boots in degraded mode and serves 503s.
In production the API refuses to boot unless `ADMIN_USER`, `ADMIN_PASS` and `JWT_SECRET` are set (the `admin`/`admin` fallback only applies outside `NODE_ENV=production`).
Copy `server/.env.example` → `server/.env` and fill in real values. Never commit `.env`.

## Test

```bash
npm test
```

Integration suite (`node:test` + real Postgres) covering every route: auth (login, 401s, forged tokens), validation, duplicate 409s, favorites/trash views, soft delete/restore, search ranking + sort + fuzzy typo matching, injection attempts, AI-tag guard rails, and the tag-merge logic. Runs in CI against a `postgres:15` service container.

## Deploy

The repo root has a `package.json` with npm workspaces (`server`, `client`) so Node-capable platforms (Railway, Render, Fly.io) detect Node:

- `npm ci` at root installs both workspaces (root `package-lock.json` committed)
- `npm run build` (root) builds the Vite client → `client/dist` ships in the image
- `npm start` (root) runs the Express API on `$PORT`; the idempotent schema migration runs on every boot

In production the API also serves the built client (SPA fallback for non-`/api` routes), so one service serves the whole app. Add a Postgres plugin, set `DATABASE_URL` (+ optional R2/Gemini vars), and you're live.
