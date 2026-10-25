import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  plugins: [react()],
  server: {
    // docs/design/tokens.css lives outside web/
    fs: { allow: [repoRoot] },
    proxy: {
      // SSE passes through: http-proxy streams the response without buffering.
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false },
    },
  },
});
