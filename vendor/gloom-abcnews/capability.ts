import type { PluginCapability } from "gloomberb/capabilities";
import { isYoutubeVideoId } from "./channel";
import type { AbcStory, ResolvedVideo } from "./types";

export const ABC_VIDEO_CAPABILITY_ID = "abcnews.video";

export interface AbcVideoServices {
  live(options: { force: boolean }): Promise<ResolvedVideo>;
  video(videoId: string, options: { force: boolean }): Promise<ResolvedVideo>;
  stories(options: { force: boolean }): Promise<AbcStory[]>;
}

function parseForce(input: { force?: unknown } | null): boolean {
  if (input?.force !== undefined && typeof input.force !== "boolean") throw new Error("force must be a boolean.");
  return input?.force === true;
}

const forceOnly = {
  parse(value: unknown) {
    return { force: parseForce(value as { force?: unknown } | null) };
  },
};

/**
 * One capability, two sets of services. The native entry (`index.ts`) resolves
 * through youtubei.js in the terminal and the desktop's native process, which
 * the desktop webview reaches through this same call, so youtubei.js never
 * ships in the browser bundle. The browser entry (`index.browser.ts`) answers
 * on the web build, which has no native process, with YouTube embeds and the
 * feed through the web app's proxy (`web.ts`).
 */
export function createAbcVideoCapability(services: AbcVideoServices): PluginCapability {
  return {
    id: ABC_VIDEO_CAPABILITY_ID,
    kind: "plugin-service",
    name: "ABC News video",
    operations: {
      live: {
        kind: "query",
        rendererSafe: true,
        input: forceOnly,
        handler: ({ force }) => services.live({ force }),
      },
      video: {
        kind: "query",
        rendererSafe: true,
        input: {
          parse(value: unknown) {
            const input = value as { videoId?: unknown; force?: unknown } | null;
            if (!isYoutubeVideoId(input?.videoId)) throw new Error("Unknown video.");
            return { videoId: input.videoId, force: parseForce(input) };
          },
        },
        handler: ({ videoId, force }) => services.video(videoId, { force }),
      },
      stories: {
        kind: "query",
        rendererSafe: true,
        input: forceOnly,
        handler: ({ force }) => services.stories({ force }),
      },
    },
  };
}
