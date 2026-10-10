import { expect, test } from "bun:test";
import { CapabilityRegistry } from "gloomberb/capabilities";
import { ABC_VIDEO_CAPABILITY_ID, createAbcVideoCapability } from "./capability";
import type { ResolvedVideo } from "./types";

test("the renderer can only ask for well-formed video ids", async () => {
  const registry = new CapabilityRegistry();
  const calls: string[] = [];
  const video = (videoId: string) => ({ videoId } as ResolvedVideo);
  registry.register("abc-news", createAbcVideoCapability({
    live: async ({ force }) => { calls.push(`live:${force}`); return video("live"); },
    video: async (videoId, { force }) => { calls.push(`${videoId}:${force}`); return video(videoId); },
    stories: async () => [],
  }));
  const invoke = (operation: string, input: unknown) => registry.invoke(ABC_VIDEO_CAPABILITY_ID, operation, input, { renderer: true });

  await invoke("video", { videoId: "YVOEzEhbATA", force: true });
  await invoke("live", {});
  expect(calls).toEqual(["YVOEzEhbATA:true", "live:false"]);
  for (const videoId of ["short", "YVOEzEhbATA&list=x", "../../etc/pa", 42]) {
    await expect(invoke("video", { videoId })).rejects.toThrow("Unknown video");
  }
  await expect(invoke("stories", { force: "yes" })).rejects.toThrow("boolean");
});

test("the desktop entry bundles without the native resolver", async () => {
  const result = await Bun.build({ entrypoints: [new URL("./index.browser.ts", import.meta.url).pathname], target: "browser", external: ["gloomberb/*", "react", "react/*"] });
  expect(result.success).toBe(true);
  const bundle = await result.outputs[0]!.text();
  expect(bundle).toContain("abcnews.video");
  expect(bundle).not.toContain("Innertube");
  expect(bundle).not.toContain("youtubei.js");
});

test("the browser entry serves the web build itself", async () => {
  const { default: plugin } = await import("./index.browser");
  expect(plugin.targets).toContain("web");
  expect(plugin.capabilities?.map((capability) => capability.id)).toEqual([ABC_VIDEO_CAPABILITY_ID]);
  const manifest = await Bun.file(new URL("./gloom.json", import.meta.url)).json();
  expect(manifest.targets).toEqual(plugin.targets);
});
