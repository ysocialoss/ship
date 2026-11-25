import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Same-origin API calls, so the session cookie works without CORS.
    proxy: { '/api': 'http://localhost:3000' },
  },
})
