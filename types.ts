export interface ResolvedVideo {
  videoId: string;
  title: string;
  isLive: boolean;
  /** HLS for live; a direct MP4 (sound and picture in one file) for a story. */
  mediaUrl: string;
  watchUrl: string;
  posterUrl?: string;
  resolvedAt: number;
  expiresAt: number;
}

export interface AbcStory {
  id: string;
  title: string;
  /** Epoch milliseconds; plain JSON so it round-trips through the plugin cache. */
  publishedAt: number;
  watchUrl: string;
  thumbnailUrl?: string;
  /** The description's opening, without the channel's subscribe and link boilerplate. */
  summary?: string;
}
