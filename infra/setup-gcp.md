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

## 3. Google Drive z muzyką — status potwierdzony

Uruchomiony `node infra/check-drive-access.mjs` potwierdził:

- **Folder "jellite" istnieje i jest udostępniony service accountowi**
  (id: `1VO32-V4DGRr2WzG-boZAqo3Wmo9nHh1i`).
- To **zwykły folder** na "Moim dysku", **nie** Współdzielony dysk (SA nie jest członkiem
  żadnego Shared Drive) — a więc konto nie ma (jeszcze) Google Workspace.
- **Odczyt działa** (SA widzi zawartość folderu — potrzebne do streamowania w backendzie).
- **Upload nie działa**: próbny upload zwrócił `storageQuotaExceeded` — "Service Accounts
  do not have storage quota. Leverage shared drives ... or use OAuth delegation instead."
  Service account ma zawsze 0 GB własnego miejsca, niezależnie od nadanych uprawnień.

**Rozwiązanie zaimplementowane w tym repo**: skrypt sync wykonuje upload przez **OAuth2
jako Twoje własne konto Google** (patrz sekcja 3a), a nie przez service account. Backend w
Cloud Run nadal używa service accounta wyłącznie do odczytu/streamowania — to działa już
teraz, bez zmian.

Alternatywa na przyszłość: aktywacja Google Workspace i przeniesienie muzyki na prawdziwy
Współdzielony dysk (SA jako Content Manager) eliminuje potrzebę OAuth i pozwala SA też
wgrywać pliki — nieobowiązkowe, obecne rozwiązanie działa bez tego.

## 3a. Jednorazowa autoryzacja OAuth2 (do uploadu)

1. W [GCP Console](https://console.cloud.google.com/apis/credentials?project=jellite) →
   **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
   - Typ aplikacji: **Desktop app**.
   - Jeśli to pierwszy OAuth client w projekcie, skonfiguruj najpierw "OAuth consent
     screen" (typ "External", status "Testing" wystarczy — dodaj swój adres e-mail jako
     "Test user").
2. Pobierz/skopiuj wygenerowany **Client ID** i **Client secret**.
3. Uruchom jednorazową autoryzację (otworzy się URL do zalogowania kontem, które jest
   właścicielem folderu "jellite"):

   ```bash
   npm run authorize --workspace sync -- \
     --client-id <CLIENT_ID> \
     --client-secret <CLIENT_SECRET> \
     --token-file ./.oauth-token.json
   ```

4. Powstanie plik `.oauth-token.json` (poza repo, w `.gitignore` — wzorzec
   `*oauth-token*.json`) z refresh tokenem — używany później przez skrypt sync
   (`--oauth-token-file ./.oauth-token.json`). Ten krok wykonujesz **raz** (token się
   odnawia automatycznie).

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
  --drive-folder-id 1VO32-V4DGRr2WzG-boZAqo3Wmo9nHh1i \
  --oauth-token-file /Users/zenedith/git/jellite/.oauth-token.json
```

(`--key-file` nie jest już potrzebny do uploadu — patrz sekcja 3/3a. Klucz service accounta
nadal służy tylko do odczytu/streamowania w backendzie w Cloud Run.)
