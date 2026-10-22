/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: { outDir: 'dist', chunkSizeWarningLimit: 800 },
  test: { environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}'] },
});
