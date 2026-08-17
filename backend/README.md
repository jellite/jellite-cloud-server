# @jellite/backend

API-only, read-only backend implementing a minimal Jellyfin-compatible API subset (see
[`docs/SPEC.md`](../docs/SPEC.md) section 4). Serves playlist/track metadata and proxies audio
bytes straight from Google Drive with `Range` support for seeking. Cover art can be served from
SQLite (`IMAGE_HOSTING=sqlite`, the default) or as redirects to WebP objects in public GCS
(`IMAGE_HOSTING=gcs`).

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
- `IMAGE_HOSTING` — `sqlite` (default) or `gcs`.
- `GCS_BUCKET_NAME` — required in `gcs` mode.
- `GCS_COVERS_PREFIX` — object prefix, default `covers`.
- `GCS_PUBLIC_BASE_URL` — optional public URL prefix; defaults to
  `https://storage.googleapis.com/<GCS_BUCKET_NAME>`.
- `JELLITE_USERNAME` / `JELLITE_PASSWORD` — the single hardcoded user's credentials.
- `JELLITE_ACCESS_TOKEN` — static bearer token accepted on all authenticated endpoints.
- `GOOGLE_APPLICATION_CREDENTIALS` — only needed locally; on Cloud Run, prefer attaching
  the runtime service account directly (see `../infra/setup-gcp.md`).

The hosting mode can also be passed directly when starting the backend:

```bash
npm run backend -- --image-hosting sqlite
npm run backend -- --image-hosting gcs --gcs-bucket <bucket-name> --gcs-covers-prefix covers
```

## Build & run production image

See `../infra/deploy.sh`, which builds this Dockerfile with the current
`data/jellite.sqlite` baked in and deploys it to Cloud Run.
