# Local SQLite database output

This directory holds `jellite.sqlite`, generated locally by running the sync script (see
`sync/` and `infra/setup-gcp.md`). The file itself is intentionally **not** committed to
git (see `.gitignore`) — it's rebuilt from the master track list + `.m3u` playlists and
baked into the backend's container image at deploy time (see `infra/deploy.sh`).
