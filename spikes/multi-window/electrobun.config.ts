import type { ElectrobunConfig } from "electrobun/bun";

// Unsigned local build only. Same Electrobun version Gloomberb pins (1.18.1);
// Gloomberb's patch to it only adds a Windows window icon, so it is not needed here.
const config: ElectrobunConfig = {
  app: {
    name: "GloomMultiWindowSpike",
    identifier: "dev.local.gloomberb-multi-window-spike",
    version: "0.0.1",
  },
  build: {
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    views: {
      mainview: {
        entrypoint: "src/mainview/index.ts",
      },
    },
    copy: {
      "src/mainview/index.html": "views/mainview/index.html",
    },
    mac: {
      codesign: false,
      notarize: false,
      createDmg: false,
      defaultRenderer: "native",
    },
  },
  runtime: {
    // Gloomberb keeps running while any window is open; mirror that so closing
    // window 2 never quits the spike.
    exitOnLastWindowClosed: true,
  },
};

export default config;
