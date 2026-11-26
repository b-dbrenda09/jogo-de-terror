import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const entry = '<script type="module" src="./src/main.js"></script>';
const projectFile = (name) => new URL(name, import.meta.url);

export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: fileURLToPath(projectFile('./src/main.js')),
      output: {
        format: 'iife',
        inlineDynamicImports: true,
      },
    },
  },
  plugins: [{
    name: 'standalone-game-html',
    apply: 'build',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const files = Object.values(bundle);
        const html = readFileSync(projectFile('./index.html'), 'utf8');
        if (files.length !== 1 || files[0].type !== 'chunk' || !html.includes(entry)) {
          this.error('Expected one JavaScript bundle and the game entry in index.html.');
        }

        const [script] = files;
        const license = readFileSync(projectFile('./LICENSE'), 'utf8');
        const threeLicense = readFileSync(new URL('../LICENSE', import.meta.resolve('three')), 'utf8');
        const code = script.code.replace(/<\/script/gi, (tag) => tag.replace('/', '\\/'));
        delete bundle[script.fileName];
        this.emitFile({
          type: 'asset',
          fileName: 'index.html',
          source: html.replace(entry, () =>
            `<!-- Bridge Horror House and Three.js licenses\n${license}\n${threeLicense}\n-->\n  <script>\n${code}\n  </script>`),
        });
        this.emitFile({ type: 'asset', fileName: 'LICENSE', source: license });
      },
    },
  }],
});
