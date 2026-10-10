/**
 * Downstream: what a YouTube embed reports about itself.
 *
 * Once the host posts `{"event":"listening"}` to an embed loaded with
 * `enablejsapi=1`, YouTube's player answers on the frame's window with JSON
 * strings: `initialDelivery` and `infoDelivery` carry `playerState` and
 * `muted`, `onStateChange` carries the new state, and `onError` the error
 * code. Reading them lets the surface report what the player is actually
 * doing, rather than assuming autoplay worked and that `p` and `m` landed.
 */

type YoutubePlaybackState = "loading" | "playing" | "paused";

interface YoutubeEmbedReport {
  state?: YoutubePlaybackState;
  muted?: boolean;
  /** A sentence for the person watching. */
  error?: string;
}

/** Only YouTube's own player windows speak this protocol. */
export const YOUTUBE_EMBED_ORIGIN = /^https:\/\/www\.youtube(?:-nocookie)?\.com$/;

/**
 * The IFrame API's states: -1 unstarted (also where an autoplay the browser
 * refused stays), 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued.
 */
function playbackState(value: unknown): YoutubePlaybackState | undefined {
  switch (value) {
    case 1: return "playing";
    case 3: return "loading";
    case -1:
    case 0:
    case 2:
    case 5: return "paused";
    default: return undefined;
  }
}

function youtubeErrorMessage(code: number): string {
  switch (code) {
    case 101:
    case 150: return "The video's owner does not allow it to be played here.";
    case 100: return "This video is unavailable.";
    case 5: return "This browser could not play the video.";
    default: return `YouTube could not play this video (error ${code}).`;
  }
}

/** Null for anything that is not a report this surface uses. */
export function readYoutubeEmbedMessage(data: unknown): YoutubeEmbedReport | null {
  let message: unknown = data;
  if (typeof data === "string") {
    try {
      message = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!message || typeof message !== "object") return null;
  const { event, info } = message as { event?: unknown; info?: unknown };

  if (event === "onStateChange") {
    const state = playbackState(info);
    return state ? { state } : null;
  }
  if (event === "onError") {
    return typeof info === "number" ? { error: youtubeErrorMessage(info) } : null;
  }
  if ((event === "initialDelivery" || event === "infoDelivery") && info && typeof info === "object") {
    const { playerState, muted } = info as { playerState?: unknown; muted?: unknown };
    const report: YoutubeEmbedReport = {};
    const state = playbackState(playerState);
    if (state) report.state = state;
    if (typeof muted === "boolean") report.muted = muted;
    return report.state || report.muted !== undefined ? report : null;
  }
  return null;
}
