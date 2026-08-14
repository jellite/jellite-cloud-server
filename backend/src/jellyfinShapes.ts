import { config } from "./config.js";
import type { PlaylistRow, TrackRow } from "./db.js";

/**
 * Minimal Jellyfin `BaseItemDto`-shaped object for a playlist. Only the fields that
 * Finamp-like clients rely on for browsing are populated; anything else is intentionally
 * left out per SPEC.md (read-only, no library management via the API).
 */
/**
 * Jellyfin's `/Users/{id}/Views` endpoint returns top-level libraries (e.g. "Movies",
 * "Music"), not individual playlists. Clients like Finamp filter this list client-side
 * and refuse to let the user pick a library unless one has `CollectionType: "music"`
 * (see finamp's view_selector.dart) — so Jellite fakes a single "Music" library here.
 * Playlists themselves are then fetched via `/Items` with this as the parentId.
 */
export const MUSIC_LIBRARY_ID = "music-library";

export function musicLibraryItem() {
  return {
    Id: MUSIC_LIBRARY_ID,
    Name: "Music",
    Type: "CollectionFolder",
    CollectionType: "music",
    IsFolder: true,
  };
}

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
        Type: "Default",
        Name: track.title ?? track.relative_path,
        RunTimeTicks: track.duration_ms != null ? Math.round(track.duration_ms * 10000) : undefined,
        Size: track.file_size ?? undefined,
        // Required non-nullable fields on Jellyfin's MediaSourceInfo — see note in
        // userDto() above about strict client-side deserialization (e.g. Finamp).
        IsRemote: false,
        SupportsTranscoding: false,
        SupportsDirectStream: true,
        SupportsDirectPlay: true,
        IsInfiniteStream: false,
        RequiresOpening: false,
        RequiresClosing: false,
        RequiresLooping: false,
        SupportsProbing: true,
        MediaStreams: [],
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
    ServerId: config.serverId,
    HasPassword: true,
    HasConfiguredPassword: true,
    // Some clients (e.g. Finamp) deserialize this response into strongly-typed models
    // with non-nullable bool/int fields for Policy/Configuration — omitting any of them
    // causes a "null is not a subtype of bool" crash client-side, so every field below is
    // required even though jellite itself only really cares about IsAdministrator /
    // EnableAllFolders.
    HasConfiguredEasyPassword: false,
    EnableAutoLogin: false,
    Configuration: {
      AudioLanguagePreference: "",
      PlayDefaultAudioTrack: true,
      SubtitleLanguagePreference: "",
      DisplayMissingEpisodes: false,
      GroupedFolders: [],
      SubtitleMode: "Default",
      DisplayCollectionsView: false,
      EnableLocalPassword: false,
      OrderedViews: [],
      LatestItemsExcludes: [],
      MyMediaExcludes: [],
      HidePlayedInLatest: true,
      RememberAudioSelections: true,
      RememberSubtitleSelections: true,
      EnableNextEpisodeAutoPlay: true,
    },
    Policy: {
      IsAdministrator: true,
      IsHidden: false,
      IsDisabled: false,
      MaxParentalRating: null,
      BlockedTags: [],
      EnableUserPreferenceAccess: true,
      AccessSchedules: [],
      BlockUnratedItems: [],
      EnableRemoteControlOfOtherUsers: false,
      EnableSharedDeviceControl: true,
      EnableRemoteAccess: true,
      EnableLiveTvManagement: false,
      EnableLiveTvAccess: false,
      EnableMediaPlayback: true,
      EnableAudioPlaybackTranscoding: false,
      EnableVideoPlaybackTranscoding: false,
      EnablePlaybackRemuxing: false,
      ForceRemoteSourceTranscoding: false,
      EnableContentDeletion: false,
      EnableContentDeletionFromFolders: [],
      EnableContentDownloading: true,
      EnableSyncTranscoding: false,
      EnableMediaConversion: false,
      EnabledDevices: [],
      EnableAllDevices: true,
      EnabledChannels: [],
      EnableAllChannels: true,
      EnabledFolders: [],
      EnableAllFolders: true,
      InvalidLoginAttemptCount: 0,
      LoginAttemptsBeforeLockout: -1,
      MaxActiveSessions: 0,
      EnablePublicSharing: false,
      BlockedMediaFolders: [],
      BlockedChannels: [],
      RemoteClientBitrateLimit: 0,
      AuthenticationProviderId: "Jellyfin.Server.Implementations.Users.DefaultAuthenticationProvider",
      PasswordResetProviderId: "Jellyfin.Server.Implementations.Users.DefaultPasswordResetProvider",
      SyncPlayAccess: "CreateAndJoinGroups",
    },
  };
}
