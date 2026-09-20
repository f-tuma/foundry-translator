import { defineConfig } from "vitest/config";
import { readFileSync } from "node:fs";
import packageJson from "./package.json";

export default defineConfig({
  plugins: [{
    name: "versioned-module-styles",
    generateBundle() {
      // Foundry imports module CSS separately; a stable URL survives upgrades in browser caches.
      this.emitFile({
        type: "asset",
        fileName: `styles/foundry-translate-${packageJson.version}.css`,
        source: readFileSync(new URL("./public/styles/foundry-translate.css", import.meta.url), "utf8"),
      });
    },
  }],
  test: {
    setupFiles: ["tests/setup.ts"],
  },
  build: {
    emptyOutDir: true,
    lib: {
      entry: "src/main.ts",
      formats: ["es"],
      fileName: () => `foundry-translate-${packageJson.version}.js`,
    },
    outDir: "dist",
    sourcemap: true,
  },
});
