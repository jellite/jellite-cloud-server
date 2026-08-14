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

Service account **nie ma własnego miejsca na Google Drive** (0 GB na "Mój dysk"), a
**diagnostyka (patrz niżej) potwierdziła, że SA na razie nic nie widzi** — folder trzeba
jeszcze udostępnić. Sposób zależy od typu konta Google, na którym jest folder "jellite":

### Wariant A — masz Google Workspace (konto firmowe/organizacyjne)

1. W Google Drive utwórz nowy **Współdzielony dysk** (Shared Drive), np. "Jellite Music"
   (menu "Współdzielone dyski" w lewym pasku — jeśli go nie widzisz, konto nie jest
   Workspace, użyj Wariantu B).
2. Dodaj `jellite-service-account@jellite.iam.gserviceaccount.com` jako członka z rolą
   **Menedżer treści** (Content Manager) lub wyższą.
3. Przenieś/wgraj tam pliki muzyczne (albo pozwól, by robił to skrypt sync).
4. ID dysku znajdziesz w URL po `/drive/folders/` — to jest `--drive-folder-id`.
5. Zweryfikuj: `node infra/check-drive-access.mjs` powinno pokazać dysk na liście
   "Shared Drives the service account is a member of".

### Wariant B — zwykłe konto Gmail (bez Workspace)

Zwykłe konto Gmail nie ma Współdzielonych dysków. Opcje:

- **B1 (prostsza, ale z ograniczeniem)**: udostępnij istniejący folder "jellite" ze
  swojego "Mojego dysku" bezpośrednio kontu
  `jellite-service-account@jellite.iam.gserviceaccount.com` (jak zwykłemu
  współpracownikowi — prawo "Edytor"). SA będzie mógł wtedy **czytać/streamować** pliki
  z tego folderu (to wystarcza dla backendu). **Uwaga**: nowe pliki wgrywane przez SA do
  tego folderu stają się własnością SA i zużywają jego zerowy limit miejsca — **upload
  przez skrypt sync się nie powiedzie**. W tym wariancie pliki audio trzeba wgrywać do
  folderu ręcznie (Twoim kontem), a skrypt sync uruchamiać z `--dry-run` pomijając upload,
  albo ręcznie uzupełniać `drive_file_id` w bazie.
- **B2 (zalecana, jeśli zależy na automatycznym uploadzie)**: kup/aktywuj Google
  Workspace (nawet najtańszy plan) dla domeny/konta, żeby mieć dostęp do prawdziwych
  Współdzielonych dysków (Wariant A) — to jedyny sposób, by SA miał własny limit miejsca
  do zapisu.

Po udostępnieniu folderu zweryfikuj: `node infra/check-drive-access.mjs --name jellite`
powinno pokazać folder na liście "Folders named jellite" (z adnotacją "regular folder, not
a Shared Drive" w Wariancie B).

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
