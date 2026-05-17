import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Полностью исправленный конфиг Vite для Railway
export default defineConfig({
  // Указываем Vite, что корень фронтенда — это папка client,
  // чтобы он сразу же нашёл index.html
  root: 'client',
  
  plugins: [react()],
  
  build: {
    // Папка сборки (указывается относительно корня root, то есть client)
    // client/../dist/client в итоге красиво соберётся в корневую dist/client!
    outDir: '../dist/client',
    emptyOutDir: true, // Очищаем папку перед сборкой
  },
  
  resolve: {
    alias: {
      // Удобные импорты через @ внутри папки client/src
      '@': path.resolve(__dirname, './src'),
    },
  },
  
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
});
