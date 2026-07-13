import { defineConfig } from "vite";
import packageJson from "./package.json";

export default defineConfig({
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
