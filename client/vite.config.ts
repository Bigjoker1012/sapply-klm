import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Настройка сборщика Vite для ERP KLM
export default defineConfig({
  plugins: [react()],
  build: {
    // Указываем Vite собирать готовый фронтенд в корневую папку dist/client
    // Это свяжет клиентскую часть с бэкендом при деплое на Railway
    outDir: path.resolve(__dirname, '../dist/client'),
    emptyOutDir: true, // Очищать папку перед новой сборкой
  },
  resolve: {
    alias: {
      // Удобные импорты через @
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      // Настройка прокси, чтобы локально запросы к /api уходили на бэкенд (порт 8080)
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
});
