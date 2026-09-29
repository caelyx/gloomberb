import { existsSync, readFileSync } from "fs";
import { join, relative } from "path";

import { bundleExternalPlugin } from "../src/plugins/bundle";
import { installPluginHostModules } from "../src/plugins/host-modules";
import { pluginFromModule, pluginSupportsTarget } from "../src/plugins/plugin-export";
import { WEB_BUNDLED_PLUGIN_PACKAGES } from "../src/plugins/web-bundled";
import type { GloomPlugin } from "../src/types/plugin";

/**
 * Compiles the plugins that ship inside the hosted web app.
 *
 * Each one is a devDependency installed from its own repository, so it is
 * compiled the same way the desktop compiles a plugin from disk: `gloomberb/*`
 * and `react` are rewritten to read the host's instances at runtime, and
 * everything else the plugin owns is bundled in (see `plugins/bundle.ts`).
 *
 * The compiled module is then imported here to read the plugin's own
 * declaration. That is deliberately not a second copy of the metadata in this
 * repo: the hosts the worker proxies and the targets the plugin supports are
 * whatever the plugin says they are, read from the artifact that will actually
 * be served.
 */

export interface CompiledWebPlugin {
  packageName: string;
  plugin: GloomPlugin;
  /**
   * Hosts the worker must proxy for this plugin: what the module declares plus
   * what its `gloom.json` manifest declares. Some plugins (Hacker News at the
   * pinned commit) list hosts only in the manifest.
   */
  hosts: string[];
  /** Emitted module, relative to the directory it was compiled into. */
  file: string;
}

function pluginPackageDir(packageName: string): string {
  const dir = join(process.cwd(), "node_modules", packageName);
  if (!existsSync(join(dir, "package.json"))) {
    throw new Error(
      `${packageName} is not installed. It is a devDependency of the web build; run "bun install".`,
    );
  }
  return dir;
}

async function readCompiledPlugin(outputPath: string, packageName: string): Promise<GloomPlugin> {
  let mod: unknown;
  try {
    mod = await import(outputPath);
  } catch (error) {
    // Module scope reached for something only a browser has. The host reads
    // every plugin's metadata in Bun (the desktop does it before compiling,
    // this build after), so a plugin has to be inert until it renders.
    throw new Error(`${packageName} could not be evaluated to read its metadata: ${error}`);
  }
  const plugin = pluginFromModule(mod);
  if (!plugin) {
    throw new Error(`${packageName} does not export a valid GloomPlugin.`);
  }
  if (!pluginSupportsTarget(plugin, "web")) {
    throw new Error(
      `${packageName} does not declare the "web" target, so it cannot ship in the web build. `
        + "Remove it from WEB_BUNDLED_PLUGIN_PACKAGES.",
    );
  }
  return plugin;
}

/**
 * Reads the package's `gloom.json`, when it has one, and checks it agrees with
 * the compiled module. The manifest is what the registry and the installers
 * read, so a plugin whose manifest names another id, leaves out `web`, or lists
 * something other than host strings is refused here rather than half-working
 * after deploy. Returns the union of both hosts lists.
 */
export function mergeManifestHosts(
  packageName: string,
  plugin: Pick<GloomPlugin, "id" | "hosts">,
  manifest: unknown,
): string[] {
  const hosts = new Set(plugin.hosts ?? []);
  if (manifest === undefined) return [...hosts];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error(`${packageName} has a gloom.json that is not a JSON object.`);
  }
  const { id, targets, hosts: manifestHosts } = manifest as Record<string, unknown>;
  if (id !== undefined && id !== plugin.id) {
    throw new Error(`${packageName}: gloom.json id "${String(id)}" does not match the plugin id "${plugin.id}".`);
  }
  if (targets !== undefined && (!Array.isArray(targets) || !targets.includes("web"))) {
    throw new Error(`${packageName}: gloom.json does not declare the "web" target.`);
  }
  if (manifestHosts !== undefined) {
    if (!Array.isArray(manifestHosts) || !manifestHosts.every((host) => typeof host === "string")) {
      throw new Error(`${packageName}: gloom.json "hosts" must be a list of host names.`);
    }
    for (const host of manifestHosts) hosts.add(host);
  }
  return [...hosts];
}

function readManifest(dir: string, packageName: string): unknown {
  const file = join(dir, "gloom.json");
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${packageName} has a gloom.json that is not valid JSON: ${error}`);
  }
}

/**
 * Compiles every web-bundled plugin into `outDir`, one directory per package.
 *
 * The per-package directory keeps the entry name the plugin chose, so nothing
 * here has to guess whether it compiled `index.tsx` or something else.
 */
export async function compileWebBundledPlugins(outDir: string): Promise<CompiledWebPlugin[]> {
  await installPluginHostModules();

  const compiled: CompiledWebPlugin[] = [];
  for (const packageName of WEB_BUNDLED_PLUGIN_PACKAGES) {
    const dir = pluginPackageDir(packageName);
    const result = await bundleExternalPlugin(dir, join(outDir, packageName), {
      minify: true,
      define: { "process.env.NODE_ENV": '"production"' },
    });
    const plugin = await readCompiledPlugin(result.outputPath, packageName);
    compiled.push({
      packageName,
      plugin,
      hosts: mergeManifestHosts(packageName, plugin, readManifest(dir, packageName)),
      file: relative(outDir, result.outputPath).replaceAll("\\", "/"),
    });
  }
  return compiled;
}
