# NewsLens — Smart Image Archive

Newsroom asset management system: photo ingest, AI tagging, full-text search, collections. API-first — the backend is the product; the React client is a faithful implementation of the original design system.

## Stack

- **API**: Node.js + Express (`server/`)
- **DB**: PostgreSQL 15 — `images` table with a generated `search_vector` tsvector column + GIN index (exact-word matching), soft delete + favorites
- **Storage**: Cloudflare R2 (presigned uploads), `R2_PUBLIC_BASE_URL` for public URLs
- **AI tagging**: Google Gemini (`@google/genai`) — configurable master prompt, 25-tag cap
- **Client**: Vite + React + Tailwind (local build, no CDN)

## API

| Method | Route                                      | Description                                      |
| ------ | ------------------------------------------ | ------------------------------------------------ |
| GET    | `/api/health`                              | Liveness                                         |
| POST   | `/api/upload-url`                          | Presigned R2 upload URL (60s)                    |
| POST   | `/api/images`                              | Register uploaded image                          |
| GET    | `/api/images?view=all\|favorites\|trash`   | List images                                      |
| PATCH  | `/api/images/:objectKey`                   | Update tags / favorite / deleted                 |
| DELETE | `/api/images/:objectKey`                   | Soft delete                                      |
| GET    | `/api/search?q=&sort=rank\|newest\|oldest` | Tag search, ts_rank ordered                      |
| POST   | `/api/images/tag`                          | Gemini AI tagging (base64 thumbnail or imageUrl) |

`objectKey` contains `/` — always URL-encode it in path params.

## Client screens

`dashboard` (filters, quick actions, quick-tag), `upload` (drag & drop), `detail` (zoom, AI tag, favorites, add-to-collection, keyboard: `←/→`, `Cmd+T`), `search` (date/type filters, saved searches, batch select), `collections`, `settings & help`.

Collections and saved searches live in `localStorage` (`newsweekly_*` keys) — move to the DB when multiuser is needed.

## Run locally

```bash
# DB (docker)
docker run -d --name smart-archive-db -p 5432:5432 \
  -e POSTGRES_USER=smart_archive -e POSTGRES_PASSWORD=smart_archive \
  -e POSTGRES_DB=smart_image_archive -v smart-archive-pgdata:/var/lib/postgresql/data \
  postgres:15

# API
cp server/.env.example server/.env   # add R2 + GEMINI creds
cd server && npm install && npm run db:init && npm run dev

# Client
cd client && npm install && npm run dev
```

## Test

```bash
cd server && npm test
```

Integration suite (`node:test` + real Postgres) covering every route: validation, duplicate 409s, favorites/trash views, soft delete/restore, search ranking + sort, injection attempts, and AI-tag guard rails. Runs in CI against a `postgres:15` service container.

## Deploy (Railway)

The repo root has no package.json — Railpack needs `start.sh` (committed, executable), which:

1. Installs server deps, applies the schema (`db:init`, idempotent) on every boot
2. Builds the client once if `client/dist` is missing
3. Runs the Express API on `$PORT`

In production the API also serves the built client (SPA fallback for non-`/api` routes), so one service serves the whole app. Target root when creating the service, add a Postgres plugin, and set `DATABASE_URL` (+ optional R2/Gemini vars). The `db:init` inside `start.sh` handles migrations on deploy — schema is fully idempotent.

## Env vars (`server/.env.example`)

`PORT`, `DATABASE_URL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_BASE_URL`, `GEMINI_API_KEY`, `GEMINI_MODEL`
