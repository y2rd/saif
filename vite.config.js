import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
  ],
  build: {
    target: ['es2018', 'edge79', 'firefox72', 'chrome79', 'safari13'],
    cssTarget: 'chrome79',
  }
})