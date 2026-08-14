# jellite

Lekki, API-only serwer muzyczny kompatybilny z podzbiorem Jellyfin API, wdrażany na
Google Cloud Run. Pliki audio (FLAC/M4A) przechowywane są na Google Drive (zwykły folder
na "Moim dysku", nie Współdzielony dysk — patrz `infra/setup-gcp.md` sekcja 3), metadane
i playlisty w lokalnie budowanej bazie SQLite wbudowywanej w obraz kontenera.

Pełna specyfikacja projektu: [`docs/SPEC.md`](docs/SPEC.md).

## Status

Faza specyfikacji i implementacji (backend + sync + infra) ukończone. Konfiguracja Google
Drive/OAuth **wykonana i zweryfikowana end-to-end** realnym uploadem utworu z biblioteki
(patrz `infra/setup-gcp.md`) — sync jest gotowy do użycia. Pierwsza pełna synchronizacja
całej biblioteki (12692 utworów, 35 playlist) i pierwszy deploy na Cloud Run **zakończone
sukcesem** — serwis odpowiada poprawnie na realne żądania Jellyfin API.

## Struktura repozytorium

```
docs/     — specyfikacja projektu (docs/SPEC.md)
backend/  — serwer API kompatybilny z Jellyfin (Express + TypeScript)
sync/     — skrypt synchronizacji biblioteki (playlisty .m3u) -> Google Drive + SQLite
infra/    — skrypty wdrożeniowe (Cloud Run) + jednorazowa konfiguracja GCP
data/     — baza jellite.sqlite, commitowana do repo przez Git LFS (patrz data/README.md)
```

**Wymaga Git LFS** (`brew install git-lfs && git lfs install`) — `data/jellite.sqlite` jest
dużym plikiem binarnym zmieniającym się przy każdym syncu i jest śledzony przez LFS, żeby
`git clone`/`fetch` pobierały tylko aktualną wersję zamiast każdej historycznej z osobna.

## Szybki start

```bash
git lfs install                     # jednorazowo, przed pierwszym clone/pull tego repo
npm install                         # instaluje backend + sync (npm workspaces)
npm run build                       # kompiluje oba pakiety TypeScript
npm run backend                     # uruchamia sam backend (bez syncu), na porcie 8080

# jednorazowa konfiguracja GCP + OAuth — patrz infra/setup-gcp.md (już wykonana dla
# obecnego projektu/konta; poniższe potrzebne tylko przy uruchamianiu od zera)
infra/sync-and-deploy.sh \
  --library-root /Volumes/music/LOSSLESS \
  --playlists-dir /Volumes/music/LOSSLESS/playlists \
  --drive-folder-id 1VO32-V4DGRr2WzG-boZAqo3Wmo9nHh1i \
  --oauth-token-file ./.oauth-token.json
```

### Gotowe skróty synchronizacji (bez deployu)

Wymagają `.oauth-token.json` i (dla `unraid-sync`) `jellite-bf32aae81e7e.json` w korzeniu
repo (skopiowanych z Twojej głównej maszyny — patrz sekcja poniżej o transferze sekretów).
Zapisują bazę do `data/jellite.sqlite`, bez deployu na Cloud Run — użyj
`infra/sync-and-deploy.sh`, gdy chcesz też wdrożyć.

```bash
npm run macos-sync    # biblioteka na tym Macu: /Volumes/music/LOSSLESS
npm run unraid-sync   # biblioteka na serwerze Unraid: /mnt/user/music/LOSSLESS
```

