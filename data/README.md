# Local SQLite database output

This directory holds `jellite.sqlite`, generated locally by running the sync script (see
`sync/` and `infra/setup-gcp.md`). The file is derived from the `.m3u` playlists in your
own library and is baked into the backend's container image at deploy time (see
`infra/deploy.sh`).

## Not committed to this repository

`data/jellite.sqlite` is **not** committed here — it's specific to your own music library
(track metadata, cover art, and Google Drive file IDs) and can be large. Generate your own
copy locally:

```bash
npm run sync -- \
  --library-root /path/to/your/music/library \
  --playlists-dir /path/to/your/playlists \
  --db data/jellite.sqlite \
  --drive-folder-id <your-drive-folder-id> \
  --oauth-token-file ./.oauth-token.json
```

See `sync/README.md` for details. If you maintain a private fork of this project for your
own deployment, you may choose to commit the database there (e.g. via Git LFS) so
`infra/deploy.sh` can deploy directly from a checkout without re-running a full sync first.

`data/jellite.sqlite-wal` and `data/jellite.sqlite-shm` are **never** committed (see
`.gitignore`) — they're ephemeral SQLite WAL-mode sidecar files, regenerated automatically
whenever the DB is opened (both backend and sync use `journal_mode=WAL`), and hold no data
that isn't already checkpointed into `jellite.sqlite` itself. The sync script automatically
runs `PRAGMA wal_checkpoint(TRUNCATE)` before it exits, so `jellite.sqlite` is always ready
to commit/deploy immediately after a sync run without a manual step.
