import { config } from "./config.js";
import type { PlaylistRow, TrackRow } from "./db.js";

/**
 * Minimal Jellyfin `BaseItemDto`-shaped object for a playlist. Only the fields that
 * Finamp-like clients rely on for browsing are populated; anything else is intentionally
 * left out per SPEC.md (read-only, no library management via the API).
 */
export function playlistToItem(playlist: PlaylistRow, trackCount: number) {
  return {
    Id: playlist.id,
    Name: playlist.name,
    Type: "Playlist",
    MediaType: "Audio",
    IsFolder: true,
    ChildCount: trackCount,
    ImageTags: { Primary: playlist.id },
  };
}

export function trackToItem(track: TrackRow, playlistId?: string, index?: number) {
  return {
    Id: track.id,
    Name: track.title ?? track.relative_path,
    Type: "Audio",
    MediaType: "Audio",
    IsFolder: false,
    Album: track.album ?? undefined,
    Artists: track.artist ? [track.artist] : [],
    AlbumArtist: track.artist ?? undefined,
    RunTimeTicks: track.duration_ms != null ? Math.round(track.duration_ms * 10000) : undefined,
    IndexNumber: index,
    PlaylistItemId: playlistId ? `${playlistId}:${track.id}` : undefined,
    ImageTags: track.cover_thumbnail ? { Primary: track.id } : undefined,
    MediaSources: [
      {
        Id: track.id,
        Container: track.container ?? undefined,
        Protocol: "File",
        SupportsDirectPlay: true,
        SupportsDirectStream: true,
        SupportsTranscoding: false,
        Path: track.relative_path,
      },
    ],
  };
}

export function serverInfoPublic() {
  return {
    Id: config.serverId,
    ServerName: config.serverName,
    Version: config.serverVersion,
    ProductName: "Jellite",
    OperatingSystem: "Cloud Run",
    StartupWizardCompleted: true,
  };
}

export function userDto() {
  return {
    Id: config.userId,
    Name: config.username,
    HasPassword: true,
    HasConfiguredPassword: true,
    Policy: {
      IsAdministrator: true,
      EnableAllFolders: true,
    },
  };
}
