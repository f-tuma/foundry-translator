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
      for (const extension of ["js", "css"]) this.emitFile({ type: "asset",
        fileName: `reader/reader-${packageJson.version}.${extension}`,
        source: readFileSync(new URL(`./public/reader/reader.${extension}`, import.meta.url), "utf8") });
      this.emitFile({ type: "asset", fileName: "reader/index.html",
        source: readFileSync(new URL("./public/reader/index.html", import.meta.url), "utf8")
          .replace("./reader.css", `./reader-${packageJson.version}.css`)
          .replace("./reader.js", `./reader-${packageJson.version}.js`) });
    },
  }],
  test: {
    setupFiles: ["tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
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
