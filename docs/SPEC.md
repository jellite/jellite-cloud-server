# Jellite — Project Specification

Status: **draft v0.1** (subject to further iteration)

## 1. Overview and goals

Jellite is a music server **compatible with a subset of the Jellyfin API**, designed to
run in the cloud (Google Cloud Run) and serve clients such as Finamp. Key requirements:

- **Fast / responsive** — fetching the playlist list, fetching a playlist's tracks, and
  starting playback should feel instant (target: metadata < ~200 ms, audio
  time-to-first-byte bounded mainly by Google Drive).
- **API only — no GUI.** Jellite provides no user interface (unlike a full Jellyfin
  server). The client/UI role is played by an external app (e.g. Finamp) that talks to
  Jellite over the Jellyfin API.
- **Jellyfin API compatibility** — only the minimal subset needed (see section 4).
- **Minimal Google Drive interaction** — to avoid extra cost/quota issues, all metadata
  and images are fully pre-synced into a local SQLite database; Drive is only queried
  when actually streaming audio.
- **Low maintenance cost** — Cloud Run scaled to zero, no additional cloud database
  (SQLite baked into the container image), no dedicated reverse proxy.

## 2. Non-goals

- No GUI / web player.
- No audio transcoding (direct FLAC/M4A passthrough).
- No multi-user support — a single, statically configured user.
- No library/playlist editing via the API (read-only — the library is managed entirely
  by the sync script, run locally).
- No "live" library scanning by the cloud backend — the source of truth for the library
  and playlists is local files (`.m3u`) processed offline.
- No automatic removal from Google Drive of tracks that disappeared from the local
  library/playlists (only a warning is logged — removal is manual).

## 3. Data model (SQLite)

The database is generated/updated exclusively by the sync script (offline, locally) and
baked into the backend container image on every deploy. The cloud backend opens it in
**read-only** mode.

```sql
-- Tracks
CREATE TABLE tracks (
  id              TEXT PRIMARY KEY,       -- stable identifier (e.g. hash of relative path)
  relative_path   TEXT NOT NULL UNIQUE,   -- path relative to the local library root
  drive_file_id   TEXT NOT NULL,          -- Google Drive file ID
  title           TEXT,
  artist          TEXT,
  album           TEXT,
  duration_ms     INTEGER,
  container       TEXT,                  -- 'flac' | 'm4a'
  file_size       INTEGER,                -- used to detect new/changed files
  cover_thumbnail BLOB,                   -- cover art thumbnail (JPEG), extracted from tags
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

-- Playlists (source: .m3u files)
CREATE TABLE playlists (
  id         TEXT PRIMARY KEY,   -- slug derived from the .m3u file name
  name       TEXT NOT NULL,      -- original file name (without extension)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Track <-> playlist association, preserving order
CREATE TABLE playlist_tracks (
  playlist_id TEXT NOT NULL REFERENCES playlists(id),
  track_id    TEXT NOT NULL REFERENCES tracks(id),
  position    INTEGER NOT NULL,
  PRIMARY KEY (playlist_id, position)
);

-- Single, statically configured user
CREATE TABLE users (
  id       TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  -- password/token come from the backend's env vars; this table only exists to
  -- return a correctly-shaped User object in Jellyfin API responses
  jellyfin_user_id TEXT NOT NULL UNIQUE
);
```

Notes:
- The playlist image (for the playlist list view) is the cover of the playlist's first
  track (fallback: no image).
- Track/playlist `id`s should be deterministic (e.g. `sha1(relative_path)` /
  `slug(file_name)`), so repeated syncs don't change identifiers used by the client
  (e.g. in playback history).

## 4. Jellyfin API subset to implement

The backend implements only the endpoints below, sufficient for clients such as Finamp.
The exact JSON shape is verified/refined during backend implementation (the Jellyfin API
is partially undocumented; clients tolerate missing fields, but key fields must be
present).

| Endpoint | Method | Description |
|---|---|---|
| `/Users/AuthenticateByName` | POST | Login; compared against a hardcoded/env user+password; returns a static `AccessToken` + `User` object. |
| `/` | GET/HEAD | Not part of the Jellyfin API — a "ping + login" endpoint for clients (e.g. foobar2000-mobile) that probe the server root with `Authorization: Basic` instead of calling `AuthenticateByName`. Returns `200 OK` with no body, protected by `requireAuth` (see below). |
| `/System/Info/Public` | GET | Server identification (name, version, Id) — used by the client to detect the server type. |
| `/Users/{userId}` | GET | The logged-in (single) user's data. |
| `/Users/{userId}/Views` or `/Items?includeItemTypes=Playlist` | GET | List of playlists as a `BaseItemDto` collection (type `Playlist`). |
| `/Playlists/{id}/Items` | GET | Ordered list of a playlist's tracks, with fields required for playback (Id, Name, Artists, Album, RunTimeTicks, index). |
| `/Items/{id}/Images/Primary` | GET | Returns the image (from the SQLite `cover_thumbnail` BLOB) with `Cache-Control`/`ETag` headers. |
| `/Audio/{id}/stream` (or `/Audio/{id}/universal`) | GET | Streams audio bytes — proxied from Google Drive (`files.get?alt=media`), with full `Range` header support (seek), passed through 1:1 to Drive and back to the client. |

Authorization: all endpoints except `AuthenticateByName` and `System/Info/Public`
require an `X-Emby-Token` / `X-MediaBrowser-Token` header matching the static token
generated when the backend is configured.

Additionally, as an alternative to the token above, `requireAuth` accepts the standard
`Authorization: Basic base64(username:password)` header compared directly against the
static `JELLITE_USERNAME`/`JELLITE_PASSWORD` — some clients (e.g. the foobar2000 mobile
app) never call `AuthenticateByName` at all, instead probing the server directly with
Basic Auth requests (e.g. `HEAD /`). For such clients a `GET /` endpoint (and thus
implicitly `HEAD /`) is also exposed, protected by `requireAuth`, returning `200 OK` with
no body — it serves purely as a "ping + login check" and is not part of the actual
Jellyfin API.

Seek support is implemented **exclusively** via standard HTTP `Range` requests on the
streaming endpoint — no separate API endpoint is needed for this.

## 5. Sync flow (sync script)

The script runs **locally** (not in the cloud), with access to the local music library
and a local copy of the SQLite file. Inputs:

1. Path to the `.m3u` playlists directory (file name = playlist name, lines = paths to
   tracks relative to the playlists directory, in playback order).
2. Path to the local library root directory (used to resolve relative paths to physical
   files and to store `relative_path` in the database).
3. Path to the local SQLite database file (created if it doesn't exist).

There is no separate "master list" — the set of tracks to sync is **the union of every
path referenced by any `.m3u` playlist**. Files present in the library but not part of
any playlist are entirely skipped (the library root is never scanned wholesale).

Steps:

1. **Collect paths** — parse every `.m3u` file in the playlists directory, collect the
   unique set of track paths (normalized relative to the library root).
2. **Diff new files** — compare the collected paths against `relative_path` values
   already present in the `tracks` table (also matched by `file_size` to detect changed
   files).
3. **For each new/changed file**:
   - read tags (artist/title/album/duration) and the embedded cover art,
   - generate a cover thumbnail (resized to a reasonable size, JPEG),
   - upload the raw audio file to Google Drive (via OAuth2, see section 6), if not
     already uploaded,
   - insert/update the corresponding `tracks` row (including `drive_file_id`).
4. **Rebuild playlists** — for each `.m3u` file: upsert the `playlists` row, delete
   existing `playlist_tracks` entries for that playlist, and re-insert them in the
   current order (tracks matched by `relative_path`).
5. **Detect orphaned tracks** — tracks present in the database but no longer referenced
   by any playlist: **only a warning is logged** (no automatic removal from Drive/DB in
   v1).
6. **Deploy** — invoke the deploy script, which builds the backend container image with
   the current SQLite file baked in and deploys it to Cloud Run
   (`gcloud run deploy --source ...`).

The script must be **idempotent** — running it repeatedly with no library changes
should trigger no uploads and no unnecessary deploy (or the deploy should be skipped if
the database didn't change).

## 6. Infrastructure / deployment

- **Audio storage**: Google Drive. A Shared Drive under Google Workspace was originally
  assumed, but real-world testing showed that a regular Google account is **not** a
  Workspace account — it's a regular folder in "My Drive" shared with the service
  account. Service accounts always have 0 GB of their own storage (confirmed
  empirically: an upload attempt returned `storageQuotaExceeded`), so **uploads are done
  via OAuth2 as the folder owner** (one-time authorization, see `infra/setup-gcp.md`
  section 3a and `sync/README.md`), not the service account. Read/streaming in the
  backend still uses the service account, since the folder is shared with it for
  read access — that works without OAuth.
- **Backend**: Node.js + TypeScript + Express, deployed as a container on **Google Cloud
  Run**. Scales to zero when idle → no cost at rest.
- **Database**: SQLite, **baked into the container image** at deploy time (no
  remote/hosted database, no extra cost or connection-management requirement). The
  backend opens the file in read-only mode.
- **Reverse proxy / logging**: no dedicated component (e.g. nginx) — Cloud Run's built-in
  request logging (Cloud Logging) is sufficient.
- **Backend authentication to Google Drive**: Cloud Run can have a service account
  attached as its runtime identity — the backend then uses Application Default
  Credentials, **without needing to store a JSON key file** in the image/secrets. This
  is sufficient for read/streaming.
- **Sync script authentication (locally)**: to **upload** new files, the sync script
  uses OAuth2 (the folder owner's account, one-time authorization with a locally saved
  refresh token — see `sync/README.md`), not a service account key. Deploying from a
  local machine requires standard user `gcloud auth login` (with Cloud Run/Cloud Build
  permissions on the target GCP project).
- **Secrets**: the static user's password/token, the service account key, and the OAuth2
  token are stored locally / as Cloud Run environment variables or Google Secret
  Manager — never in the git repository.

## 7. Non-functional requirements

- **Performance**: metadata queries (playlist list, track list, images) rely solely on
  indexed SQLite queries — target < ~200 ms. Audio streaming is bounded mainly by Google
  Drive's bandwidth and response time, not backend logic.
- **Cost**: Cloud Run scale-to-zero (no cost at rest), no Cloud SQL / other hosted
  database, minimal Drive API calls (only streaming + individual uploads during sync —
  not on every client request).
- **Security**: a single static token/password (a "hardcoded" user), no ability to
  write/modify data via the API, no public access to Google Drive (only through the
  backend).
- **Idempotency/repeatability**: the sync and deploy scripts can be run repeatedly with
  no side effects when nothing has changed.

## 8. Open questions / assumptions to confirm in later phases

- The exact JSON shape required by a given Finamp client version — to be verified
  empirically during backend implementation (may require additional fields not
  described here).
- The format of track/playlist `id`s (`sha1` of the relative path for tracks, slug of
  the `.m3u` file name for playlists) — confirmed by a real test (uploading a single
  track from a real library, see `sync/README.md`); do not change the algorithm after
  the first full sync, as it would invalidate the client's playback history.
- Target cover thumbnail size (e.g. 300x300 JPEG) — to be decided based on the resulting
  SQLite file size baked into the container image.
- Versioning/naming policy for the Cloud Run service and the GCP region.

## 9. Next phases (out of scope for this document)

1. Backend implementation (Express + SQLite + Drive proxy).
2. Sync script implementation (`.m3u` parsing, tag/cover extraction, Drive upload,
   SQLite rebuild).
3. Infrastructure scripts implementation (Dockerfile, `gcloud run deploy`, Google Drive
   configuration — OAuth2 for uploads + service account for reads).
4. End-to-end tests with a real Finamp client.
