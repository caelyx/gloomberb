import { describe, expect, test } from "bun:test";
import { builtinModules } from "node:module";

/**
 * Compiles the plugin the way Gloomberb compiles it for the desktop view and
 * the hosted web app (`Bun.build`, target browser, `gloomberb/*` and `react`
 * supplied by the host), and records any Node or Bun builtin the entry pulls in.
 */
describe("browser bundle", () => {
  test("nothing reachable from the entry imports a Node or Bun builtin", async () => {
    const builtins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`), "bun", "bun:ffi", "bun:sqlite", "bun:test"]);
    const reached: string[] = [];
    const result = await Bun.build({
      entrypoints: [new URL("../index.ts", import.meta.url).pathname],
      target: "browser",
      format: "esm",
      throw: false,
      plugins: [{
        name: "host-modules-and-builtins",
        setup(build) {
          build.onResolve({ filter: /^(react|gloomberb)(\/.*)?$/ }, (args) => ({ path: args.path, external: true }));
          build.onResolve({ filter: /.*/ }, (args) => {
            if (builtins.has(args.path)) reached.push(`${args.path} from ${args.importer}`);
            return undefined;
          });
        },
      }],
    });
    expect(result.logs.filter((log) => log.level === "error").map((log) => log.message)).toEqual([]);
    expect(result.success).toBe(true);
    expect(reached).toEqual([]);
    const output = await result.outputs[0]!.text();
    expect(output).not.toMatch(/\bBun\.(file|write|spawn|serve)\b/);
    // unpdf, and pdf.js with it, is compiled in rather than left as an import the host cannot resolve.
    expect(output).toContain("getDocumentProxy");
  }, 30_000);
});
