import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // Source, including the index.html entry, lives in src/; the only page outside it is the built dist/index.html.
  root: 'src',
  build: { outDir: '../dist', emptyOutDir: true },
  // Everything, fonts included, is inlined into dist/index.html, so it also works opened from file://.
  plugins: [viteSingleFile()],
  resolve: {
    alias: {
      // hydra-synth's package exports only its raw source; use the prebuilt bundle (what the CDN served).
      'hydra-synth/dist/hydra-synth.js': fileURLToPath(new URL('node_modules/hydra-synth/dist/hydra-synth.js', import.meta.url)),
    },
  },
});
