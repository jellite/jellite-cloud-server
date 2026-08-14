# jellite

Lekki, API-only serwer muzyczny kompatybilny z podzbiorem Jellyfin API, wdrażany na
Google Cloud Run. Pliki audio (FLAC/M4A) przechowywane są na Google Shared Drive,
metadane i playlisty w lokalnie budowanej bazie SQLite wbudowywanej w obraz kontenera.

Pełna specyfikacja projektu: [`docs/SPEC.md`](docs/SPEC.md).

## Status

Faza specyfikacji ukończona. Faza 2 (implementacja) gotowa: działający backend (Express +
SQLite + Google Drive proxy), skrypt synchronizacji biblioteki oraz skrypty wdrożeniowe na
Cloud Run. Zweryfikowane lokalnie end-to-end (sync → SQLite → API). Pozostaje: realny test
z Google Shared Drive i wdrożeniem na Cloud Run (wymaga jednorazowej konfiguracji GCP, patrz
`infra/setup-gcp.md`).

## Struktura repozytorium

```
docs/     — specyfikacja projektu (docs/SPEC.md)
backend/  — serwer API kompatybilny z Jellyfin (Express + TypeScript)
sync/     — skrypt synchronizacji biblioteki -> Google Drive + SQLite
infra/    — skrypty wdrożeniowe (Cloud Run) + jednorazowa konfiguracja GCP
data/     — lokalna baza jellite.sqlite (generowana przez sync, niecommitowana)
```

## Szybki start

```bash
npm install                         # instaluje backend + sync (npm workspaces)
npm run build                       # kompiluje oba pakiety TypeScript

# jednorazowa konfiguracja GCP — patrz infra/setup-gcp.md
infra/sync-and-deploy.sh --library-root ... --playlists-dir ... \
  --drive-folder-id ... --oauth-token-file ./.oauth-token.json
```
