import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: fileURLToPath(new URL('./frontend', import.meta.url)),
  plugins: [react(), tailwindcss()],
  define: { 'import.meta.env.VITE_CONSOLE': JSON.stringify('1') },
  build: {
    outDir: fileURLToPath(new URL('./dist-console', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: { input: { console: fileURLToPath(new URL('./frontend/console.html', import.meta.url)) } },
  },
});
