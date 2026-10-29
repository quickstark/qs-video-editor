import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

test('graphics test network guard denies fetch, HTTPS and sockets before outbound access', t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'qs-network-guard-'));
  t.after(() => fs.rmSync(base, {recursive: true, force: true}));
  const log = path.join(base, 'attempts.jsonl');
  const code = `import https from 'node:https'; import net from 'node:net';\nlet denied=0;for(const call of [()=>fetch('https://example.invalid/a'),()=>https.get('https://example.invalid/a'),()=>net.createConnection({host:'example.invalid',port:443})]){try{call()}catch(e){if(e.message.includes('denied nonlocal'))denied++;else throw e}}if(denied!==3)throw Error('Guard failed');`;
  const r = spawnSync(process.execPath, ['--import', pathToFileURL(path.resolve('tests/support/graphics-network-guard.mjs')).href, '--input-type=module', '-e', code], {encoding: 'utf8', env: {...process.env, QS_GRAPHICS_NETWORK_LOG: log}});
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(log, 'utf8').trim().split('\n').length, 3);
});
