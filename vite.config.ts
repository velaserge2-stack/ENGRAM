import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/**
 * Genera `sw.js` con la lista exacta del "app shell" y una versión derivada
 * de su contenido: cualquier cambio de código produce un SW nuevo → aviso de actualización.
 */
function serviceWorker(): Plugin {
  return {
    name: 'engrama-sw',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const publicFiles = ['manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'];
      const assets = ['./', ...files, ...publicFiles].map((f) => (f === './' ? f : './' + f));
      const hash = createHash('sha256');
      for (const f of files) {
        const c = bundle[f]!;
        hash.update(f);
        hash.update(c.type === 'chunk' ? c.code : typeof c.source === 'string' ? c.source : Buffer.from(c.source));
      }
      const version = `${pkg.version}-${hash.digest('hex').slice(0, 10)}`;
      const src = readFileSync(new URL('./src/sw.js', import.meta.url), 'utf8')
        .replace('__VERSION__', version)
        .replace('__ASSETS__', JSON.stringify(assets));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: src });
    },
  };
}

export default defineConfig({
  // Rutas relativas: funciona en una subcarpeta (GitHub Pages) sin reconfigurar
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  worker: { format: 'es' },
  build: {
    target: 'safari15',
    sourcemap: false,
    // nombres ASCII: los ejemplos tienen acentos y espacios
    rollupOptions: { output: { chunkFileNames: 'assets/c-[hash].js' } },
  },
  plugins: [serviceWorker()],
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
} as never);
