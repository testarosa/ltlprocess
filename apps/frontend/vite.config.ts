import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  envDir: "../..",
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        authRedirect: fileURLToPath(new URL("./auth-redirect.html", import.meta.url))
      }
    }
  },
  server: {
    port: Number(process.env.FRONTEND_PORT ?? 5173)
  }
});
