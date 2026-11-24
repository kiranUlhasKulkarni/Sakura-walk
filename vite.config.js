import { defineConfig } from 'vite';

// The GLB models live in the project root and are imported as assets
// (see src/config.js), so Vite fingerprints and copies them into dist/.
export default defineConfig({
  base: './', // relative asset paths: the build works from any host or sub-path
  server: { port: 5175, open: false },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  assetsInclude: ['**/*.glb'],
});
