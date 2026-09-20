import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], server: { port: 4178, strictPort: true, proxy: { '/api': { target: 'http://127.0.0.1:4180', timeout: 260000, proxyTimeout: 260000 } } } });
