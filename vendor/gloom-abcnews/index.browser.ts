import type { GloomPluginContext } from "gloomberb/types/plugin";
import { abcNewsPlugin } from "./plugin";
import { createAbcVideoCapability } from "./capability";
import { createWebServices } from "./web";

/**
 * The browser entry. In the desktop app its webview never runs plugin
 * capability handlers (the native process answers them from `index.ts`), so
 * this capability only ever serves the web build, which has no native process.
 */
const web = createWebServices();

export default {
  ...abcNewsPlugin,
  capabilities: [createAbcVideoCapability(web)],
  setup(ctx: GloomPluginContext) {
    web.attachStoriesCache(ctx.persistence);
  },
  dispose() {
    web.resetStoriesCache();
  },
};
