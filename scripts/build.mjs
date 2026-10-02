/**
 * build.mjs — Builds the extension for a target browser.
 *
 *   node scripts/build.mjs                    # Chrome / Edge → dist/
 *   node scripts/build.mjs --browser=firefox  # Firefox      → dist-firefox/
 *
 * Both browsers share the same source and Vite config; only the output directory
 * and manifest differ. Using a Node script (instead of inline env vars) keeps the
 * build working on Windows, macOS, and Linux alike.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const viteBin = resolve(root, 'node_modules', 'vite', 'bin', 'vite.js');

const browserArg = process.argv.find((arg) => arg.startsWith('--browser='));
const browser = browserArg ? browserArg.split('=')[1] : 'chrome';

const TARGETS = {
  chrome: {
    outDir: 'dist',
    // Chrome's manifest lives at the repo root and references `dist/…`, so we
    // only need to stage the runtime assets alongside the build output.
    finalize(outDir) {
      cpSync(resolve(root, 'assets'), resolve(outDir, 'assets'), { recursive: true });
    },
  },
  firefox: {
    outDir: 'dist-firefox',
    // Firefox loads `dist-firefox/` as the extension root, so the Firefox
    // manifest (using `background.scripts`) becomes its manifest.json.
    finalize(outDir) {
      cpSync(resolve(root, 'assets', 'icons'), resolve(outDir, 'assets', 'icons'), { recursive: true });
      copyFileSync(resolve(root, 'manifest.firefox.json'), resolve(outDir, 'manifest.json'));
    },
  },
};

const target = TARGETS[browser];
if (!target) {
  console.error(`Unknown browser "${browser}". Expected one of: ${Object.keys(TARGETS).join(', ')}`);
  process.exit(1);
}

if (!existsSync(viteBin)) {
  console.error('Vite is not installed. Run `npm install` first.');
  process.exit(1);
}

function viteBuild(env = {}) {
  const result = spawnSync(process.execPath, [viteBin, 'build'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, OUT_DIR: target.outDir, ...env },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Content build runs first and clears the output directory.
viteBuild();
viteBuild({ BUILD_TARGET: 'background' });
viteBuild({ BUILD_TARGET: 'popup' });

target.finalize(resolve(root, target.outDir));

if (browser === 'firefox') {
  console.log(`\nFirefox build complete → ${target.outDir}/`);
  console.log('Load it via about:debugging#/runtime/this-firefox → Load Temporary Add-on…');
} else {
  console.log(`\n${browser} build complete → ${target.outDir}/`);
}
