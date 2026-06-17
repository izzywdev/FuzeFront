import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import federation from '@originjs/vite-plugin-federation'

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'container',
      remotes: {
        // Placeholder remote so the federation plugin emits the full host runtime
        // (including the shared scope). Real remotes are registered at runtime via
        // __federation_method_setRemote(). With no declared remote, the host build
        // leaves __rf_placeholder__shareScope unresolved → runtime ReferenceError.
        _dynamic: 'http://localhost/remoteEntry.js',
      },
      shared: ['react', 'react-dom'],
    }),
  ],
  build: {
    modulePreload: false,
    target: 'esnext',
    minify: false,
    cssCodeSplit: false,
  },
  server: {
    port: 5173,
    cors: true,
  },
})
