import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: true,
    lib: {
      entry: "src/main.ts",
      formats: ["es"],
      fileName: () => "foundry-translate.js",
    },
    outDir: "dist",
    sourcemap: true,
  },
});
