# @jellite/upnp

A lightweight DLNA/UPnP MediaServer bridge that connects local hardware audio streamers (e.g. Yamaha MusicCast NP-S303, smart TVs, AV receivers) to your Jellite cloud backend.

## Features

- **SSDP Discovery**: Automatically advertises `urn:schemas-upnp-org:device:MediaServer:1` on your local network.
- **ContentDirectory Service**: Exposes Jellite playlists and tracks with metadata and cover art.
- **Pagination Support**: Fully compatible with chunked browse requests from hardware players.
- **Format Conversion**: Delivers DLNA-compliant JPEG thumbnails (`JPEG_TN`) converted on the fly from WebP images.
- **Audio Proxying**: Transparently proxies Google Drive audio streams with HTTP `Range` seek support.

## Usage

```bash
# Set environment variables and run
UPNP_HOST=192.168.1.100 \
UPNP_PORT=5050 \
JELLITE_BACKEND_URL=https://jellite.yourdomain.com \
JELLITE_API_KEY=your-access-token \
JELLITE_USER_ID=jellite-user \
npm run start --workspace upnp
```

Or for local development:

```bash
npm run dev --workspace upnp
```
