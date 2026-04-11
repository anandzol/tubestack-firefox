import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// Configures multi-build outputs for extension components (popup, background, content script)
const isPopupBuild = process.env.BUILD_TARGET === 'popup';
const isBgBuild = process.env.BUILD_TARGET === 'background';

function getConfig() {
  if (isPopupBuild) {
    return defineConfig({
      plugins: [react()],
      root: resolve(__dirname, 'src/popup'),
      base: './',
      build: {
        outDir: resolve(__dirname, 'dist'),
        emptyOutDir: false,
        rollupOptions: {
          input: resolve(__dirname, 'src/popup/popup.html'),
          output: {
            entryFileNames: 'popup.js',
            assetFileNames: 'popup-[name][extname]',
          },
        },
        minify: false,
        target: 'esnext',
      },
    });
  }

  if (isBgBuild) {
    return defineConfig({
      build: {
        outDir: 'dist',
        emptyOutDir: false,
        lib: {
          entry: resolve(__dirname, 'src/background/service-worker.js'),
          name: 'background',
          fileName: () => 'background.js',
          formats: ['es'],
        },
        minify: false,
        target: 'esnext',
      },
    });
  }

  // Default: content script build (IIFE, single bundle)
  return defineConfig({
    plugins: [react()],
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: {
        input: resolve(__dirname, 'src/content/content-main.jsx'),
        output: {
          entryFileNames: 'content-bundle.js',
          assetFileNames: (assetInfo) => {
            if (assetInfo.name && assetInfo.name.endsWith('.css')) {
              return 'content-bundle.css';
            }
            return 'assets/[name]-[hash][extname]';
          },
          format: 'iife',
          inlineDynamicImports: true,
        },
      },
      cssCodeSplit: false,
      target: 'esnext',
      minify: false,
    },
    resolve: {
      alias: { '@': resolve(__dirname, 'src') },
    },
  });
}

export default getConfig();
