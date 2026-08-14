# Jednorazowa konfiguracja GCP

Kroki wykonywane raz, ręcznie, przed pierwszym `infra/sync-and-deploy.sh`.

## 1. Projekt GCP i wymagane API

```bash
gcloud config set project jellite
gcloud services enable run.googleapis.com cloudbuild.googleapis.com drive.googleapis.com
```

## 2. Service account

Masz już plik klucza (`jellite-bf32aae81e7e.json`, SA:
`jellite-service-account@jellite.iam.gserviceaccount.com`, projekt `jellite`). Ten sam SA
pełni dwie role:

- **Lokalnie (skrypt sync)**: uwierzytelnia się kluczem JSON, żeby wgrywać nowe pliki na
  Shared Drive.
- **W Cloud Run (backend)**: powinien być podpięty jako *runtime service account* usługi
  (`--service-account` w `infra/deploy.sh`), dzięki czemu backend czyta z Google Drive przez
  Application Default Credentials — **bez** kopiowania pliku klucza do obrazu kontenera.

Upewnij się, że plik klucza **nigdy** nie trafia do repozytorium (już objęty `.gitignore`
przez wzorzec `jellite-*.json`).

## 3. Google Shared Drive z muzyką

Service account **nie ma własnego miejsca na Google Drive** (0 GB na "Mój dysk") — dlatego
pliki muszą trafiać na **Współdzielony dysk (Shared Drive)** w ramach Google Workspace:

1. W Google Drive (konto Workspace) utwórz nowy Współdzielony dysk, np. "Jellite Music".
2. Dodaj `jellite-service-account@jellite.iam.gserviceaccount.com` jako członka z rolą
   **Menedżer treści** (Content Manager) lub wyższą.
3. Skopiuj **ID** dysku/folderu z URL (fragment po `/folders/`) — to jest wartość
   `--drive-folder-id` przekazywana do skryptu sync.

## 4. Sekrety / zmienne środowiskowe backendu

Ustaw w Cloud Run (przez `--set-env-vars` w `infra/deploy.sh` lub Secret Manager, jeśli
wolisz nie trzymać hasła/tokenu w linii poleceń):

- `JELLITE_USERNAME`, `JELLITE_PASSWORD` — dane logowania jedynego użytkownika.
- `JELLITE_ACCESS_TOKEN` — statyczny token (np. `openssl rand -hex 32`).

Domyślne wartości w `backend/.env.example` **nie** są bezpieczne do użycia w produkcji.

## 5. Region i nazwa usługi

Domyślnie `infra/deploy.sh` używa regionu `europe-central2` i nazwy usługi `jellite` —
nadpisz przez zmienne środowiskowe `GCP_REGION` / `SERVICE_NAME`, jeśli potrzeba.

## 6. Pierwsze uruchomienie

```bash
export GCP_PROJECT=jellite
export RUNTIME_SERVICE_ACCOUNT=jellite-service-account@jellite.iam.gserviceaccount.com

infra/sync-and-deploy.sh \
  --library-root /sciezka/do/korzenia/biblioteki \
  --master-list /Users/zenedith/git/radiomore/packages/music-sync/file1.sorted \
  --playlists-dir /Users/zenedith/git/radiomore/packages/music-sync/src/domain/playlist \
  --drive-folder-id <ID_WSPOLDZIELONEGO_DYSKU_LUB_FOLDERU> \
  --key-file /Users/zenedith/git/jellite/jellite-bf32aae81e7e.json
```
