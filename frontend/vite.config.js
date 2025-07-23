import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  
  // Development server configuration
  server: {
    host: '0.0.0.0',
    port: 3000,
    // Proxy API calls to backend during development
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
      '/socket.io': {
        target: process.env.VITE_SOCKET_URL || 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
        ws: true,
      }
    }
  },
  
  // Build configuration
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: 'esbuild', // Use esbuild instead of terser (faster and built-in)
    
    // Optimize chunk splitting
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          bootstrap: ['bootstrap', 'react-bootstrap'],
          utils: ['axios', 'socket.io-client', 'moment']
        }
      }
    },
    
    // Target modern browsers
    target: 'es2020',
    
    // Increase chunk size warning limit
    chunkSizeWarningLimit: 1000
  },
  
  // Environment variables
  define: {
    __API_URL__: JSON.stringify(process.env.VITE_API_URL || 'http://localhost:3001'),
    __SOCKET_URL__: JSON.stringify(process.env.VITE_SOCKET_URL || 'http://localhost:3001'),
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version || '1.0.0'),
  },
  
  // Base path for deployment
  base: '/',
  
  // CSS configuration
  css: {
    devSourcemap: true
  },
  
  // Optimize dependencies
  optimizeDeps: {
    include: ['react', 'react-dom', 'bootstrap', 'react-bootstrap', 'axios', 'socket.io-client', 'moment']
  }
})