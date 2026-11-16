import { defineConfig } from 'vite';

/** The back office (ADR 0035): static files, talking to the API at VITE_API_URL. */
export default defineConfig({
  // 5180, not Vite's usual 5173, which other local apps often hold.
  server: { port: 5180, strictPort: true },
  build: { target: 'es2022', sourcemap: true },
});
