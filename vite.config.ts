import { defineConfig } from "vitest/config";
import packageJson from "./package.json";

export default defineConfig({
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
