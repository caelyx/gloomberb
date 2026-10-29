import type { ElectrobunConfig } from "electrobun/bun";
import pkg from "./package.json";
import { DESKTOP_APP_IDENTIFIER, DESKTOP_APP_NAME } from "./src/renderers/electrobun/shared/app-name";

// GLOOMBERB_DESKTOP_LOCAL=1 builds an unsigned app with no update feed or DMG,
// for a Mac without Gloom's Apple signing secrets. With the feed left on, the app
// would offer upstream's next release and replace this build with it.
const LOCAL_BUILD = process.env.GLOOMBERB_DESKTOP_LOCAL === "1";
const RELEASE_BASE_URL = LOCAL_BUILD ? "" : "https://github.com/gloom-sh/gloomberb/releases/latest/download";
const GENERATE_RELEASE_PATCH = !LOCAL_BUILD && process.platform !== "win32";

const config: ElectrobunConfig = {
  app: {
    // The bundle, the macOS menu bar and Dock, the update archives. Releases
    // also carry the archives under the old name for installs from before
    // the rename (scripts/write-legacy-desktop-files.ts).
    name: DESKTOP_APP_NAME,
    identifier: DESKTOP_APP_IDENTIFIER,
    version: pkg.version,
    description: pkg.description,
    urlSchemes: ["gloomberb"],
  },
  build: {
    bun: {
      entrypoint: "src/renderers/electrobun/bun/index.ts",
      sourcemap: "external",
    },
    copy: {
      "dist/electrobun-view": "views/mainview",
    },
    watch: [
      "src",
      "scripts/build-electrobun-view.ts",
      "electrobun.config.ts",
      "package.json",
    ],
    watchIgnore: [
      ".git",
      ".git/**",
      "dist/**",
      "build/**",
      "artifacts/**",
      "node_modules/**",
    ],
    mac: {
      codesign: !LOCAL_BUILD,
      createDmg: !LOCAL_BUILD,
      notarize: !LOCAL_BUILD,
      icons: "icon.iconset",
      defaultRenderer: "native",
    },
    win: {
      bundleCEF: true,
      defaultRenderer: "cef",
      icon: "src/assets/gloomberb-logo-windows.ico",
    },
  },
  scripts: {
    preBuild: "scripts/build-electrobun-view.ts",
    postBuild: "scripts/install-electrobun-tui-shim.ts",
    postWrap: "",
    postPackage: "",
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
  release: {
    baseUrl: RELEASE_BASE_URL,
    generatePatch: GENERATE_RELEASE_PATCH,
  },
};

export default config;
