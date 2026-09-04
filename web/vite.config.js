import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig(({ mode }) => {
  // Terceiro argumento vazio: carrega o .env inteiro para uso AQUI, no processo
  // de build. Nada disso vai para o bundle — só o que tem prefixo VITE_ chega
  // ao navegador, e por isso segredo nunca entra num VITE_*.
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],
    resolve: { alias: { '@': path.resolve(process.cwd(), 'src') } },
    server: {
      port: 5173,
      // O front fala com a API pelo mesmo origin: evita CORS e deixa o SSE simples.
      // O front NÃO conhece a Travelfusion — quem tem credencial é a API.
      proxy: {
        '/api': {
          target: env.VITE_API_TARGET || 'http://localhost:3010',
          changeOrigin: true,
          rewrite: (requestPath) => requestPath.replace(/^\/api/, ''),
        },
      },
    },
  };
});
