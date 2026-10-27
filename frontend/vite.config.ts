import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// /api and /evidence go to the FastAPI backend, so no CORS setup is needed
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
      '/evidence': 'http://localhost:8000',
    },
  },
})
