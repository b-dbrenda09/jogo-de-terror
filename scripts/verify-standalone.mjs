import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
assert.equal(scripts.length, 2, 'Expected startup feedback and the standalone game');
for (const [, attributes, source] of scripts) {
  assert.equal(attributes.trim(), '', 'Expected a classic inline script');
  new Script(source, { filename: 'dist/index.html' });
}
const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
assert.ok(!/<(?:link|img|audio|video|source)\b[^>]*(?:src|href)\s*=\s*["'](?!data:)/i.test(markup),
  'The standalone markup must not load external assets');
assert.ok(html.includes('pointer-lock-request') && html.includes('first-render-completed'), 'Updated startup code is embedded');
assert.ok(html.includes('Three.js') && html.includes('MIT License'), 'Bundled licenses preserved');
console.log('OK: standalone HTML embeds the updated startup, JavaScript and licenses; no external script/module entry.');
