import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(process.cwd(), 'src') } },
  server: {
    port: 5173,
    // O front fala com a API pelo mesmo origin: evita CORS e deixa o SSE simples.
    proxy: { '/api': { target: 'http://localhost:3010', changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') } },
  },
});
