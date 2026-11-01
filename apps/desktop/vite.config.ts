import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "startup-styles",
      // Use the same tokens and layout before the application modules or fonts load.
      transformIndexHtml() {
        return [
          {
            tag: "style",
            children: ["./src/shared/styles/tokens.css", "./src/app/startup.css"]
              .map((path) => readFileSync(new URL(path, import.meta.url), "utf8"))
              .join("\n"),
            injectTo: "head",
          },
        ];
      },
    },
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    // Startup HTML and React share this icon; data URLs are blocked by the image CSP.
    assetsInlineLimit: (file) => (file.endsWith("/app-icon.svg") ? false : undefined),
  },
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**", "**/target/**"],
    },
  },
});
