import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Configuração mínima do Vite. O backend vive em /api (funções serverless da Vercel)
// e é acessado via fetch a partir do frontend — nunca importado diretamente aqui.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Em desenvolvimento local com `vercel dev`, a própria Vercel expõe /api.
      // Este proxy é útil apenas se você rodar `vite` isolado com um servidor
      // de API separado (ex: `vercel dev --listen 3000`).
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
