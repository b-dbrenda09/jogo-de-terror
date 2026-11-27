import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
assert.ok(!/<script[^>]+src\s*=/i.test(html), 'No external JavaScript requests in the standalone HTML');
assert.ok(!/<script[^>]+type=["']module/i.test(html), 'No file:// module import dependency');
assert.ok(html.includes('pointer-lock-request') && html.includes('first-render-completed'), 'Updated startup code is embedded');
assert.ok(html.includes('Three.js') && html.includes('MIT License'), 'Bundled licenses preserved');
console.log('OK: standalone HTML embeds the updated startup, JavaScript and licenses; no external script/module entry.');
