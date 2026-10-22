import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 开发：vite 在 18421，API 和图片转发到 18420 的 server
export default defineConfig({
  plugins: [react()],
  server: {
    port: 18421,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:18420',
      '/media': 'http://127.0.0.1:18420',
    },
  },
});
