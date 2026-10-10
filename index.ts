import type { GloomPluginContext } from "gloomberb/types/plugin";
import { abcNewsPlugin } from "./plugin";
import { createAbcVideoCapability } from "./capability";
import { attachStoriesCache, loadStories, resetStoriesCache } from "./feed";
import { resetYoutube, resolveLive, resolveVideo } from "./youtube";

export default {
  ...abcNewsPlugin,
  capabilities: [createAbcVideoCapability({ live: resolveLive, video: resolveVideo, stories: loadStories })],
  setup(ctx: GloomPluginContext) {
    attachStoriesCache(ctx.persistence);
  },
  dispose() {
    resetYoutube();
    resetStoriesCache();
  },
};
