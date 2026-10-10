import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Notice, PaneStatusBody, usePaneFooter } from "gloomberb/components";
import { useCapabilityInvoker, useShortcut } from "gloomberb/react";
import { colors } from "gloomberb/theme";
import { Box, ImageSurface, MediaSurface, Text, useRendererHost, useUiHost, type MediaSurfaceHandle } from "gloomberb/ui";
import { formatRelativeAge, getCurrentPluginTarget, isPlainKey, wrapTextLines } from "gloomberb/utils";
import { ABC_VIDEO_CAPABILITY_ID } from "./capability";
import type { AbcStory, ResolvedVideo } from "./types";

type PlaybackState = "idle" | "loading" | "playing" | "paused" | "error";

export type VideoSource = { kind: "live" } | { kind: "story"; story: AbcStory };

/** Re-resolve this long before expiry so playback never starts on a dead URL. */
const URL_SAFETY_MARGIN_MS = 60_000;
/** Lines of a story's summary under its still, in the terminal. */
const SUMMARY_MAX_LINES = 4;

function isPlayableNow(video: ResolvedVideo | null): video is ResolvedVideo {
  return !!video && Date.now() < video.expiresAt - URL_SAFETY_MARGIN_MS;
}

interface VideoPlayerProps {
  paneId: string;
  focused: boolean;
  width: number;
  height: number;
  source: VideoSource;
  /** Where `o` goes: the channel's live page, or the story's own watch page. */
  openUrl: string;
  /**
   * Start the terminal player as soon as the video resolves. Only for an
   * explicit request (Enter on a story): a pane restored from the saved layout
   * must never take the terminal over on its own.
   */
  autoPlay?: boolean;
}

/** One player for the live channel and for stories, on both renderers. */
export function VideoPlayer({ paneId, focused, width, height, source, openUrl, autoPlay = false }: VideoPlayerProps) {
  // The web build shares the desktop's renderer, and plays YouTube's embed in it.
  const isDesktop = useUiHost().kind === "desktop-web";
  const isWeb = getCurrentPluginTarget() === "web";
  const renderer = useRendererHost();
  const capabilities = useCapabilityInvoker();
  const story = source.kind === "story" ? source.story : null;
  const [video, setVideo] = useState<ResolvedVideo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [playbackState, setPlaybackState] = useState<PlaybackState>("idle");
  // Live starts muted, as TV does. A story is a video the person chose, so it
  // plays with sound. Should the desktop's web view refuse to autoplay with
  // sound, the player waits, paused, for `p`.
  const [muted, setMuted] = useState(!story);
  const mediaRef = useRef<MediaSurfaceHandle | null>(null);
  const recoveredRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const autoPlayedRef = useRef(false);
  const label = story ? "story" : "live";
  const storyId = story?.id ?? null;

  // On the desktop and in the terminal, stories resolve to a direct MP4. The
  // YouTube embed is no use on the desktop: the app's page has no web origin to
  // send as referrer, and YouTube refuses an embed without one (player error
  // 153). The web build has an origin, and resolves both to the embed.
  const load = useCallback(async (force = false): Promise<ResolvedVideo | null> => {
    const generation = ++generationRef.current;
    setLoading(true);
    setError(null);
    setPlaybackError(null);
    try {
      const next = storyId
        ? await capabilities.invokeCapability<ResolvedVideo>(ABC_VIDEO_CAPABILITY_ID, "video", { videoId: storyId, force })
        : await capabilities.invokeCapability<ResolvedVideo>(ABC_VIDEO_CAPABILITY_ID, "live", { force });
      if (generation !== generationRef.current) return null;
      setVideo(next);
      return next;
    } catch (cause) {
      if (generation !== generationRef.current) return null;
      setVideo(null);
      setError(cause instanceof Error ? cause.message : String(cause));
      return null;
    } finally {
      if (generation === generationRef.current) setLoading(false);
    }
  }, [capabilities, storyId]);

  const refresh = useCallback(() => { void load(true); }, [load]);

  useEffect(() => {
    void load();
    return () => { generationRef.current += 1; };
  }, [load]);

  // Only the desktop player consumes a URL it cannot renew on its own. The
  // terminal player owns its URL for the life of the process, and the web's
  // embed URLs do not expire: renewing one would restart what is playing.
  useEffect(() => {
    if (!video || !isDesktop || isWeb) return;
    const delay = Math.max(5_000, video.expiresAt - URL_SAFETY_MARGIN_MS - Date.now());
    const timer = setTimeout(() => { void load(true); }, delay);
    return () => clearTimeout(timer);
  }, [isDesktop, isWeb, load, video]);

  // A dead URL surfaces as a media error; re-resolve once per video so a
  // silent expiry recovers without the user pressing anything.
  const handlePlaybackError = useCallback((message: string) => {
    setPlaybackError(message);
    if (!video || recoveredRef.current === video.videoId) return;
    recoveredRef.current = video.videoId;
    void load(true);
  }, [load, video]);

  const playInTerminal = useCallback(async (current: ResolvedVideo | null) => {
    if (!renderer.playTerminalMedia) return;
    setPlaybackError(null);
    const playable = isPlayableNow(current) ? current : await load();
    if (!playable) return;
    setPlaybackState("playing");
    try {
      await renderer.playTerminalMedia(playable.mediaUrl, playable.title, { muted });
      setPlaybackState("paused");
    } catch (cause) {
      setPlaybackState("error");
      setPlaybackError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [load, muted, renderer]);

  // Enter on a story is the request to play it.
  useEffect(() => {
    if (!autoPlay || isDesktop || !video || autoPlayedRef.current) return;
    autoPlayedRef.current = true;
    void playInTerminal(video);
  }, [autoPlay, isDesktop, playInTerminal, video]);

  // Leaving the player must take the player process with it; it is not tied
  // to the React tree that started it.
  useEffect(() => () => renderer.stopTerminalMedia?.(), [renderer]);

  const togglePlayback = useCallback(async () => {
    setPlaybackError(null);
    try {
      if (isDesktop) await mediaRef.current?.toggle();
      else await playInTerminal(video);
    } catch (cause) {
      setPlaybackState("error");
      setPlaybackError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [isDesktop, playInTerminal, video]);

  const toggleMute = useCallback(() => {
    if (isDesktop) {
      const nextMuted = mediaRef.current?.toggleMuted();
      if (typeof nextMuted === "boolean") setMuted(nextMuted);
      return;
    }
    setMuted((current) => !current);
  }, [isDesktop]);

  const open = useCallback(() => { void renderer.openExternal(openUrl); }, [openUrl, renderer]);

  // Plain keys only: Cmd/Ctrl+Shift+O pops the pane out, Shift+R refreshes all.
  useShortcut((event) => {
    if (!focused || event.targetEditable || event.defaultPrevented) return;
    if (isPlainKey(event, "p") && video) {
      event.preventDefault?.();
      void togglePlayback();
    } else if (isPlainKey(event, "m") && video) {
      event.preventDefault?.();
      toggleMute();
    } else if (isPlainKey(event, "o")) {
      event.preventDefault?.();
      open();
    } else if (isPlainKey(event, "r")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      refresh();
    }
  });

  const status = loading
    ? "resolving"
    : error || playbackError
      ? `${label} error`
      : playbackState === "playing"
        ? `playing ${label}`
        : playbackState === "loading"
          ? `buffering ${label}`
          : video ? label : "offline";

  usePaneFooter(`${paneId}:player`, () => ({
    info: [{
      id: "abc-player-status",
      parts: [{
        text: status,
        tone: error || playbackError ? "warning" : playbackState === "playing" ? "positive" : "value",
      }],
    }],
    hints: [
      {
        id: "playback",
        key: "p",
        label: playbackState === "playing" ? "ause" : "lay",
        onPress: () => { void togglePlayback(); },
        disabled: loading || !video || (!isDesktop && !renderer.playTerminalMedia),
      },
      {
        id: "mute",
        key: "m",
        label: muted ? "unmute" : "ute",
        onPress: toggleMute,
        disabled: loading || !video,
      },
      { id: "open", key: "o", label: "pen", onPress: open },
    ],
  }), [error, isDesktop, loading, muted, open, playbackError, playbackState, renderer, status, toggleMute, togglePlayback, video]);

  const retryAction = <Button label="Try again" variant="primary" onPress={refresh} />;
  const subtitle = story ? formatRelativeAge(story.publishedAt) : null;
  // The terminal shows a still until mpv takes over, so a story's summary is
  // the one thing there to read. The desktop gives the whole body to the video.
  const summaryLines = !isDesktop && story?.summary
    ? wrapTextLines(story.summary, Math.max(1, width - 4), SUMMARY_MAX_LINES)
    : [];
  const reservedRows = (playbackError ? 2 : 0) + (summaryLines.length ? summaryLines.length + 1 : 0);

  return (
    <Box flexDirection="column" width={width} height={height}>
      <PaneStatusBody
        loading={loading && !video}
        error={error ?? (!loading && !video ? "ABC NEWS is offline." : null)}
        loadingLabel={story ? "Resolving story..." : "Resolving ABC NEWS live stream..."}
        align="center"
        actions={retryAction}
      >
        {video ? isDesktop ? (
          <MediaSurface
            // A failed player keeps its fallback even when handed a new URL, so
            // a re-resolved video remounts it. An embed re-resolves to the same
            // URL, so `r` needs the resolution time to reload it.
            key={`${video.mediaUrl}|${video.resolvedAt}`}
            src={video.mediaUrl}
            title={video.title}
            poster={video.posterUrl}
            autoPlay
            muted={muted}
            mediaHandleRef={mediaRef}
            flexGrow={1}
            flexBasis={0}
            minHeight={0}
            onPlaybackStateChange={setPlaybackState}
            onMutedChange={setMuted}
            onError={handlePlaybackError}
          >
            <PaneStatusBody error={playbackError ?? "Video unavailable."} align="center" actions={retryAction} />
          </MediaSurface>
        ) : (
          <Box flexGrow={1} flexDirection="column" alignItems="center" justifyContent="center" gap={1}>
            <ImageSurface
              src={video.posterUrl}
              alt={video.title}
              objectFit="contain"
              width="100%"
              height={Math.max(5, height - reservedRows)}
            >
              <Box flexGrow={1} justifyContent="center" alignItems="center">
                {/* A story's detail bar already names it, so its fallback is the age. */}
                {subtitle ? <Text fg={colors.textMuted}>{subtitle}</Text> : <Text fg={colors.text}>{video.title}</Text>}
              </Box>
            </ImageSurface>
            {summaryLines.length ? (
              <Box flexDirection="column" paddingX={2} width="100%">
                {summaryLines.map((line, index) => <Text key={index} fg={colors.textMuted}>{line}</Text>)}
              </Box>
            ) : null}
            {playbackError ? <Notice tone="negative">{playbackError}</Notice> : null}
          </Box>
        ) : null}
      </PaneStatusBody>
    </Box>
  );
}
