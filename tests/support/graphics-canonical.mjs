import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export function canonicalSource(root = sourceRoot) {
  return ['graphics-brief', 'graphics-recipes', 'graphics-review'].map((name) => {
    const text = fs.readFileSync(path.join(root, 'runtime/references', `${name}.md`), 'utf8');
    const match = text.match(new RegExp('<!-- qs-example: ' + name + ' -->\\s*```js\\n([\\s\\S]*?)\\n```'));
    if (!match) throw new Error(`Missing canonical example: ${name}`);
    return match[1];
  }).join('\n');
}
export async function loadCanonical(root = sourceRoot) {
  return import(`data:text/javascript;base64,${Buffer.from(canonicalSource(root)).toString('base64')}`);
}
export function fixtureBrief(recipe = 'masked-title', fps = 24000, portrait = false) {
  const scale = fps / 24000;
  return {
    schemaVersion: 1, itemId: recipe, revision: 'original-fixture-v1', recipe,
    purpose: 'Original local graphics regression fixture',
    copy: recipe === 'masked-title' ? ['Quiet geometry', 'An original fixture'] : recipe === 'counter-stat' ? ['Fixture count'] : [],
    canvas: {width: portrait ? 360 : 640, height: portrait ? 640 : 360},
    fps: {numerator: fps, denominator: 1001},
    frames: {enterStart: 0, enterEnd: Math.round(36 * scale), holdEnd: Math.round(84 * scale), exitEnd: Math.round(108 * scale), nominal: Math.round(120 * scale), tail: Math.ceil(0.5 * fps / 1001)},
    safe: {x0: 0.1, y0: portrait ? 200 / 1920 : 0.1, x1: 0.9, y1: portrait ? 1620 / 1920 : 0.9},
    style: {source: 'Original neutral fixture', conflicts: [], fontFamily: 'FixtureRoboto', fontSize: portrait ? 29 : 38, lineHeight: 1.2, tracking: 0, color: '#f6f1ea', accent: '#65ccb8', panelColor: '#17212b'},
    fonts: [{path: 'assets/fixture-font.ttf', sha256: '0'.repeat(64), license: 'Local licensed font; not redistributed'}],
    assets: [], alpha: true, tailPolicy: 'required',
    params: {staggerFrames: Math.ceil(0.4 * fps / 1001), startValue: 0, targetValue: 37.5, decimals: 1, prefix: '', suffix: '%', countEndFrame: Math.round(60 * scale)},
  };
}
