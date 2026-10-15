import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  server: { host: '0.0.0.0', port: 5173, strictPort: true, allowedHosts: ['.e2b.app'], proxy: { '/api': 'http://127.0.0.1:3001' } },
  preview: { host: '0.0.0.0', port: 5173, strictPort: true, allowedHosts: ['.e2b.app'] },
  plugins: [react(), tailwindcss(), viteSingleFile()],
  build: { emptyOutDir: mode !== "admin", rollupOptions: { input: path.resolve(__dirname, mode === "admin" ? "admin.html" : "index.html") } },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
}));
