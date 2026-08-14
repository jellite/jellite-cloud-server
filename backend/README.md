# @jellite/backend

API-only, read-only backend implementing a minimal Jellyfin-compatible API subset (see
[`docs/SPEC.md`](../docs/SPEC.md) section 4). Serves playlist/track metadata and cover art
from a read-only SQLite DB, and proxies audio bytes straight from Google Drive with `Range`
support for seeking.

## Local development

```bash
cp .env.example .env   # then edit values
npm install             # from repo root (npm workspaces)
npm run dev --workspace backend
```

Requires `data/jellite.sqlite` to exist (produced by `sync/`, see `../sync/README.md`).

## Environment variables

See `.env.example` for the full list. Key ones:

- `DB_PATH` — path to the read-only SQLite DB (defaults to `./data/jellite.sqlite`).
- `JELLITE_USERNAME` / `JELLITE_PASSWORD` — the single hardcoded user's credentials.
- `JELLITE_ACCESS_TOKEN` — static bearer token accepted on all authenticated endpoints.
- `GOOGLE_APPLICATION_CREDENTIALS` — only needed locally; on Cloud Run, prefer attaching
  the runtime service account directly (see `../infra/setup-gcp.md`).

## Build & run production image

See `../infra/deploy.sh`, which builds this Dockerfile with the current
`data/jellite.sqlite` baked in and deploys it to Cloud Run.
