# Jellite — Specyfikacja projektu

Status: **draft v0.1** (do dalszej iteracji)

## 1. Przegląd i cele

Jellite to serwer muzyczny **kompatybilny z podzbiorem API Jellyfin**, przeznaczony do
uruchomienia w chmurze (Google Cloud Run) i obsługi klientów typu Finamp. Kluczowe
wymagania:

- **Szybki / responsywny** — pobranie listy playlist, pobranie utworów z playlisty
  oraz rozpoczęcie odtwarzania mają być natychmiastowe (cel: metadane < ~200 ms,
  time-to-first-byte audio ograniczony głównie przez Google Drive).
- **Tylko API — brak GUI.** Jellite nie dostarcza żadnego interfejsu użytkownika (w
  odróżnieniu np. od pełnego serwera Jellyfin). Rolę klienta/UI pełni zewnętrzna
  aplikacja (np. Finamp), która rozmawia z Jellite przez Jellyfin API.
- **Zgodność z Jellyfin API** — tylko minimalny, wystarczający podzbiór (patrz sekcja 4).
- **Minimalna liczba interakcji z Google Drive** — aby uniknąć dodatkowych kosztów/limitów,
  metadane i obrazki są w całości wstępnie zsynchronizowane do lokalnej bazy SQLite;
  Drive jest odpytywane tylko przy faktycznym streamowaniu audio.
- **Niski koszt utrzymania** — Cloud Run skalowany do zera, brak dodatkowej bazy danych
  w chmurze (SQLite wbudowane w obraz kontenera), brak dedykowanego reverse proxy.

## 2. Poza zakresem (non-goals)

- Brak GUI / web playera.
- Brak transkodowania audio (bezpośredni passthrough FLAC/M4A).
- Brak wsparcia dla wielu użytkowników — jeden, statycznie skonfigurowany użytkownik.
- Brak edycji biblioteki/playlist przez API (tylko odczyt — biblioteka jest zarządzana
  wyłącznie przez skrypt synchronizacyjny uruchamiany lokalnie).
- Brak "live" skanowania biblioteki przez backend w chmurze — źródłem prawdy o
  bibliotece i playlistach są lokalne pliki (`.sorted` + `.m3u`) przetwarzane offline.
- Brak automatycznego usuwania z Google Drive utworów, które zniknęły z lokalnej
  biblioteki/playlist (tylko logowanie ostrzeżenia — usuwanie ręczne).

## 3. Model danych (SQLite)

Baza jest generowana/aktualizowana wyłącznie przez skrypt synchronizacyjny (offline,
lokalnie) i wbudowywana w obraz kontenera backendu przy każdym deployu. Backend w
chmurze otwiera ją w trybie **tylko do odczytu**.

```sql
-- Utwory
CREATE TABLE tracks (
  id              TEXT PRIMARY KEY,       -- stabilny identyfikator (np. hash ze ścieżki względnej)
  relative_path   TEXT NOT NULL UNIQUE,   -- ścieżka względna w bibliotece lokalnej
  drive_file_id   TEXT NOT NULL,          -- ID pliku na Google Shared Drive
  title           TEXT,
  artist          TEXT,
  album           TEXT,
  duration_ms     INTEGER,
  container       TEXT,                  -- 'flac' | 'm4a'
  file_size       INTEGER,                -- do wykrywania nowych/zmienionych plików
  cover_thumbnail BLOB,                   -- miniatura okładki (JPEG), wyekstrahowana z tagów
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

-- Playlisty (źródło: pliki .m3u)
CREATE TABLE playlists (
  id         TEXT PRIMARY KEY,   -- slug z nazwy pliku .m3u
  name       TEXT NOT NULL,      -- oryginalna nazwa pliku (bez rozszerzenia)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Powiązanie utwór <-> playlista z zachowaniem kolejności
CREATE TABLE playlist_tracks (
  playlist_id TEXT NOT NULL REFERENCES playlists(id),
  track_id    TEXT NOT NULL REFERENCES tracks(id),
  position    INTEGER NOT NULL,
  PRIMARY KEY (playlist_id, position)
);

-- Pojedynczy, statycznie skonfigurowany użytkownik
CREATE TABLE users (
  id       TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  -- hasło/token pochodzą z env vars backendu, tabela służy tylko do zwrócenia
  -- poprawnego kształtu obiektu User w odpowiedziach Jellyfin API
  jellyfin_user_id TEXT NOT NULL UNIQUE
);
```

Uwagi:
- Obraz playlisty (dla widoku listy playlist) = okładka pierwszego utworu w playliście
  (fallback: brak obrazka).
- `id` utworu/playlisty powinno być deterministyczne (np. `sha1(relative_path)` /
  `slug(nazwa_pliku)`), aby powtórne synchronizacje nie zmieniały identyfikatorów
  używanych przez klienta (np. w historii odtwarzania).

## 4. Podzbiór Jellyfin API do zaimplementowania

Backend implementuje tylko poniższe endpointy, w zakresie wystarczającym dla klientów
typu Finamp. Dokładny kształt JSON zostanie zweryfikowany/dopracowany w fazie
implementacji backendu (Jellyfin API jest częściowo nieudokumentowane, klienci są
tolerancyjne na brakujące pola, ale kluczowe pola muszą być obecne).

| Endpoint | Metoda | Opis |
|---|---|---|
| `/Users/AuthenticateByName` | POST | Logowanie; porównanie z hardcoded/env user+hasło; zwraca statyczny `AccessToken` + obiekt `User`. |
| `/System/Info/Public` | GET | Identyfikacja serwera (nazwa, wersja, Id) — używane przez klienta do wykrycia typu serwera. |
| `/Users/{userId}` | GET | Dane zalogowanego (jedynego) użytkownika. |
| `/Users/{userId}/Views` lub `/Items?includeItemTypes=Playlist` | GET | Lista playlist jako kolekcja `BaseItemDto` (typ `Playlist`). |
| `/Playlists/{id}/Items` | GET | Lista utworów playlisty w kolejności, z polami wymaganymi do odtwarzania (Id, Name, Artists, Album, RunTimeTicks, indeks). |
| `/Items/{id}/Images/Primary` | GET | Zwraca obrazek (z `cover_thumbnail` BLOB w SQLite) z nagłówkami `Cache-Control`/`ETag`. |
| `/Audio/{id}/stream` (lub `/Audio/{id}/universal`) | GET | Strumieniowanie bajtów audio — proxy z Google Drive (`files.get?alt=media`), z pełnym wsparciem nagłówka `Range` (seek), przekazywanym 1:1 do Drive i z powrotem do klienta. |

Autoryzacja: wszystkie endpointy poza `AuthenticateByName` i `System/Info/Public`
wymagają nagłówka `X-Emby-Token` / `X-MediaBrowser-Token` zgodnego ze statycznym
tokenem wygenerowanym przy starcie/konfiguracji backendu.

Wsparcie dla wyboru momentu odtworzenia utworu (seek) realizowane jest **wyłącznie**
przez standardowe żądania HTTP `Range` na endpoint streamingu — nie jest potrzebny
osobny endpoint API do tego celu.

## 5. Przepływ synchronizacji (sync script)

Skrypt uruchamiany **lokalnie** (nie w chmurze), z dostępem do lokalnej biblioteki
muzycznej i lokalnej kopii pliku SQLite. Wejścia:

1. Ścieżka do pliku master listy (np. `file1.sorted`) — pełna, posortowana,
   zdeduplikowana lista wszględnych ścieżek wszystkich unikalnych utworów w bibliotece.
2. Ścieżka do katalogu z playlistami `.m3u` (nazwa pliku = nazwa playlisty, linie =
   ścieżki względne do utworów, w kolejności odtwarzania).
3. Ścieżka do katalogu-korzenia lokalnej biblioteki (do rozwiązywania ścieżek
   względnych na pliki fizyczne).
4. Ścieżka do lokalnego pliku bazy SQLite (tworzona, jeśli nie istnieje).

Kroki:

1. **Diff nowych plików** — porównanie master listy z `relative_path` już obecnymi
   w tabeli `tracks` (dopasowanie dodatkowo po `file_size`, aby wykryć zmienione pliki).
2. **Dla każdego nowego/zmienionego pliku**:
   - odczyt tagów (artist/title/album/duration) i osadzonej okładki,
   - wygenerowanie miniatury okładki (zmniejszenie do rozsądnego rozmiaru, JPEG),
   - upload surowego pliku audio na Google Shared Drive (jeśli jeszcze nie wgrany),
   - zapis/aktualizacja rekordu w `tracks` (w tym `drive_file_id`).
3. **Przebudowa playlist** — dla każdego pliku `.m3u`: upsert rekordu w `playlists`,
   usunięcie starych wpisów w `playlist_tracks` dla tej playlisty i wstawienie na
   nowo w aktualnej kolejności (dopasowanie utworów po `relative_path`).
4. **Wykrywanie osieroconych utworów** — utwory obecne w bazie, ale nieobecne już w
   master liście: **tylko log ostrzeżenia** (bez automatycznego usuwania z Drive/bazy
   w v1).
5. **Deploy** — wywołanie skryptu deployu, który buduje obraz kontenera backendu z
   aktualnym plikiem SQLite wbudowanym w obraz i wdraża go na Cloud Run
   (`gcloud run deploy --source ...`).

Skrypt musi być **idempotentny** — wielokrotne uruchomienie bez zmian w bibliotece
nie powinno wywoływać żadnych uploadów ani zbędnego deployu (lub deploy powinien być
pomijany, jeśli baza się nie zmieniła).

## 6. Infrastruktura / wdrożenie

- **Przechowywanie audio**: Google Shared Drive (w ramach Google Workspace).
  Service account jest dodane jako członek Shared Drive (rola Content
  Manager/Manager) — dzięki temu ma własny limit miejsca dostarczany przez Workspace
  (w przeciwieństwie do zwykłego konta service account, które ma 0 GB własnego
  miejsca na "My Drive").
- **Backend**: Node.js + TypeScript + Express, kontener wdrażany na **Google Cloud
  Run**. Skaluje się do zera przy braku ruchu → brak kosztu w spoczynku.
- **Baza danych**: SQLite, **wbudowana w obraz kontenera** podczas deployu (nie ma
  zdalnej/hostowanej bazy danych, nie ma dodatkowych kosztów ani wymogu utrzymania
  połączenia). Backend otwiera plik w trybie tylko-do-odczytu.
- **Reverse proxy / logging**: brak dedykowanego komponentu (np. nginx) — wbudowane
  logowanie żądań Cloud Run (Cloud Logging) jest wystarczające, ponieważ jedyną rolą
  nginx na obecnym serwerze jellyfin jest optymalizacja ruchu, co nie jest wymagane
  w tym projekcie.
- **Uwierzytelnienie backendu wobec Google Drive**: Cloud Run może mieć przypisaną
  service account jako tożsamość uruchomieniową (runtime identity) — backend
  korzysta wtedy z Application Default Credentials, **bez potrzeby przechowywania
  pliku klucza JSON w obrazie/secretach**.
- **Uwierzytelnienie skryptu sync (lokalnie)**: skrypt sync, uruchamiany na
  komputerze lokalnym, potrzebuje pliku klucza JSON tej samej (lub osobnej) service
  account do wywołań Drive API (upload plików). Deploy z lokalnej maszyny wymaga
  standardowego `gcloud auth login` użytkownika (z uprawnieniami do Cloud Run/Cloud
  Build w danym projekcie GCP).
- **Sekrety**: hasło/token statycznego użytkownika oraz dane service account
  przechowywane jako zmienne środowiskowe Cloud Run / Google Secret Manager — nigdy
  w repozytorium git.

## 7. Wymagania niefunkcjonalne

- **Wydajność**: odpowiedzi na zapytania o metadane (lista playlist, lista utworów,
  obrazki) oparte wyłącznie o indeksowane zapytania SQLite — cel < ~200 ms. Streaming
  audio ograniczony głównie przepustowością i czasem odpowiedzi Google Drive, nie
  logiką backendu.
- **Koszt**: Cloud Run scale-to-zero (brak kosztu w spoczynku), brak Cloud SQL/innej
  hostowanej bazy, minimalne wywołania Drive API (tylko streaming + pojedyncze
  uploady podczas syncu — nie przy każdym żądaniu klienta).
- **Bezpieczeństwo**: pojedynczy statyczny token/hasło (odpowiednik "hardcoded"
  usera), brak możliwości zapisu/modyfikacji danych przez API, brak publicznego
  dostępu do Google Drive (tylko przez backend).
- **Idempotencja/powtarzalność**: skrypt sync i deploy mogą być uruchamiane
  wielokrotnie bez efektów ubocznych przy braku zmian.

## 8. Otwarte pytania / założenia do potwierdzenia w kolejnych fazach

- Dokładny kształt JSON wymagany przez konkretną wersję klienta Finamp — do
  zweryfikowania empirycznie podczas implementacji backendu (może wymagać dodatkowych
  pól nieopisanych tutaj).
- Format identyfikatora `id` utworu/playlisty (proponowane: `sha1` ścieżki
  względnej / slug nazwy pliku) — do potwierdzenia przed pierwszą synchronizacją
  (zmiana algorytmu po pierwszym uruchomieniu unieważni historię odtwarzania klienta).
- Docelowy rozmiar miniatury okładki (np. 300x300 JPEG) — do ustalenia z uwagi na
  rozmiar pliku SQLite wbudowywanego w obraz kontenera.
- Polityka wersjonowania/nazewnictwa usługi Cloud Run oraz regionu GCP.

## 9. Kolejne fazy (poza zakresem tego dokumentu)

1. Implementacja backendu (Express + SQLite + Drive proxy).
2. Implementacja skryptu synchronizacyjnego (parsowanie `.sorted`/`.m3u`, ekstrakcja
   tagów/okładek, upload Drive, przebudowa SQLite).
3. Implementacja skryptów infrastruktury (Dockerfile, `gcloud run deploy`, konfiguracja
   Shared Drive + service account).
4. Testy end-to-end z rzeczywistym klientem Finamp.
