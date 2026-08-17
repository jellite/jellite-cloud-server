# One-time GCP setup

Steps performed once, manually, before the first `infra/sync-and-deploy.sh` run.

## 1. GCP project and required APIs

```bash
gcloud config set project <your-gcp-project>
gcloud services enable run.googleapis.com cloudbuild.googleapis.com drive.googleapis.com storage.googleapis.com
```

For GCS cover hosting, create a bucket and allow public object reads because Jellyfin clients
request image URLs without an authorization header:

```bash
gcloud storage buckets create gs://<covers-bucket> --location=<bucket-location>
gcloud storage buckets add-iam-policy-binding gs://<covers-bucket> \
  --member=allUsers --role=roles/storage.objectViewer
```

The identity used by the sync exporter also needs `roles/storage.objectUser` on the bucket.
If Public Access Prevention is enforced, use a CDN or another public image endpoint instead and
set `GCS_PUBLIC_BASE_URL` accordingly.

## 2. Service account

Create a service account key (`<your-service-account>.json`, e.g.
`jellite-service-account@<your-gcp-project>.iam.gserviceaccount.com`). This same SA plays
two roles:

- **Locally (sync script)**: not used for uploads — see section 3 below for why.
- **In Cloud Run (backend)**: should be attached as the service's *runtime service
  account* (`--service-account` in `infra/deploy.sh`), so the backend reads from Google
  Drive via Application Default Credentials — **without** copying the key file into the
  container image.

Make sure the key file **never** ends up in the repository (already covered by
`.gitignore` via the `jellite-*.json` / `service-account*.json` patterns).

## 3. Google Drive with your music

Run `node infra/check-drive-access.mjs` to confirm:

- The Drive folder with your music exists and is shared with the service account.
- Whether it's a regular folder in "My Drive" or a Shared Drive (SA membership implies
  Google Workspace).
- Whether **read** access works (SA can see the folder contents — needed for backend
  streaming).
- Whether **upload** works. If your account is not on Google Workspace, a regular "My
  Drive" folder will reject service-account uploads with `storageQuotaExceeded` —
  "Service Accounts do not have storage quota. Leverage shared drives ... or use OAuth
  delegation instead." Service accounts always have 0 GB of their own storage,
  regardless of granted permissions.

**Solution implemented in this repo**: the sync script uploads via **OAuth2 as your own
Google account** (see section 3a below), not the service account. The backend on Cloud
Run still uses the service account exclusively for read/streaming — that works
regardless of the Workspace/My Drive distinction.

Future alternative: activating Google Workspace and moving the music to a real Shared
Drive (SA as Content Manager) removes the need for OAuth and lets the SA upload files
too — optional, the current setup works without it.

## 3a. One-time OAuth2 authorization (for uploads)

1. Create an OAuth Client ID of type **Desktop app** in the GCP Console, in your project
   (download the file to e.g. `~/Downloads/client_secret_...apps.googleusercontent.com.json`).
2. Run the one-time authorization directly from the downloaded file (supported via
   `--client-secret-file`, no need to manually copy the Client ID/Secret). **Note**:
   `npm run ... --workspace sync` runs the script with its working directory set to
   `sync/`, so relative paths resolve from there, not the repo root — use absolute
   paths:

   ```bash
   npm run authorize --workspace sync -- \
     --client-secret-file /path/to/client_secret_*.apps.googleusercontent.com.json \
     --token-file /path/to/jellite/.oauth-token.json
   ```

3. This produces a `.oauth-token.json` file in the repo root (gitignored — pattern
   `*oauth-token*.json`) containing a refresh token, used by the sync script on every
   subsequent run (`--oauth-token-file /path/to/jellite/.oauth-token.json`).

Verify end-to-end by doing a real test upload of a single file to your Drive folder with
this token before running a full sync.

## 4. Backend secrets / environment variables

Set these in Cloud Run (via `--set-env-vars` in `infra/deploy.sh`, or Secret Manager if
you'd rather not pass the password/token on the command line):

- `JELLITE_USERNAME`, `JELLITE_PASSWORD` — credentials for the single configured user.
- `JELLITE_ACCESS_TOKEN` — static bearer token (e.g. `openssl rand -hex 32`).
- `IMAGE_HOSTING` — `sqlite` (default) or `gcs`.
- `GCS_BUCKET_NAME` — required for `IMAGE_HOSTING=gcs`.
- `GCS_COVERS_PREFIX` — optional object prefix, default `covers`.
- `GCS_PUBLIC_BASE_URL` — optional public URL prefix for the cover objects.

The defaults in `backend/.env.example` are **not** safe to use in production.

## 5. Region and service name

By default `infra/deploy.sh` uses region `europe-central2` and service name `jellite` —
override with the `GCP_REGION` / `SERVICE_NAME` environment variables if needed.

## 6. First run

```bash
export GCP_PROJECT=<your-gcp-project>
export RUNTIME_SERVICE_ACCOUNT=<your-service-account-email>

infra/sync-and-deploy.sh \
  --library-root /path/to/your/music/library \
  --playlists-dir /path/to/your/playlists \
  --drive-folder-id <your-drive-folder-id> \
  --oauth-token-file /path/to/jellite/.oauth-token.json
```

(`--key-file` is not needed for uploads — see sections 3/3a. The service account key is
only used for read/streaming access by the backend on Cloud Run.)
