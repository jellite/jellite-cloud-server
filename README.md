# jellite

Lekki, API-only serwer muzyczny kompatybilny z podzbiorem Jellyfin API, wdrażany na
Google Cloud Run. Pliki audio (FLAC/M4A) przechowywane są na Google Shared Drive,
metadane i playlisty w lokalnie budowanej bazie SQLite wbudowywanej w obraz kontenera.

Pełna specyfikacja projektu: [`docs/SPEC.md`](docs/SPEC.md).

## Status

Projekt jest w fazie specyfikacji — implementacja backendu, skryptu synchronizacyjnego
i infrastruktury nastąpi w kolejnych etapach (patrz sekcja "Kolejne fazy" w SPEC.md).

## Struktura repozytorium

```
docs/     — specyfikacja projektu
backend/  — (placeholder) serwer API kompatybilny z Jellyfin
sync/     — (placeholder) skrypt synchronizacji biblioteki -> Drive + SQLite + deploy
infra/    — (placeholder) skrypty/konfiguracja wdrożeniowa (Cloud Run, Dockerfile)
```
