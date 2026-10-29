import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {graphicsAssetFindings, writeGraphicsFixture} from './support/graphics-fixture-server.mjs';
import {loadCanonical, fixtureBrief} from './support/graphics-canonical.mjs';

const api = await loadCanonical();
test('standalone brief needs only graphic inputs; missing fonts, timing and style conflicts block', () => {
  for (const recipe of ['masked-title', 'svg-assemble', 'counter-stat']) {
    const brief = fixtureBrief(recipe);
    assert.deepEqual(api.inspectGraphicsBrief(brief), []);
    assert.equal('timeline' in brief, false);
    assert.equal('transcript' in brief, false);
  }
  for (const change of [b => b.fonts = [], b => b.frames.exitEnd = b.frames.holdEnd, b => b.fps.denominator = 0, b => b.style.conflicts.push('8% versus 10% safe bounds'), b => b.fonts[0].path = 'https://example.invalid/font.ttf', b => b.safe.x1 = 2]) {
    const brief = fixtureBrief(); change(brief);
    assert.ok(api.inspectGraphicsBrief(brief).length > 0);
  }
});
test('canonical recipes have exact endpoint states and no accumulated seek history', () => {
  for (const fps of [24000, 30000]) for (const recipe of ['masked-title', 'svg-assemble', 'counter-stat']) {
    const b = fixtureBrief(recipe, fps);
    const at = f => api.graphicsStateAtFrame(b, f);
    const mid = at(b.frames.enterEnd + 3);
    at(b.frames.nominal); at(2); at(b.frames.holdEnd);
    assert.deepEqual(at(b.frames.enterEnd + 3), mid);
    assert.equal(at(b.frames.exitEnd).opacity, 0);
    assert.equal(at(b.frames.nominal + b.frames.tail - 1).opacity, 0);
    if (recipe === 'masked-title') assert.ok(mid.lines.every(x => x.opacity === 1 && x.yPercent === 0));
    if (recipe === 'svg-assemble') assert.ok(mid.parts.every(x => x.opacity === 1 && x.y === 0));
    if (recipe === 'counter-stat') assert.equal(at(b.params.countEndFrame).text, '37.5%');
  }
});
test('counter formatting is explicit, handles negatives, and never needs playback callbacks', () => {
  const b = fixtureBrief('counter-stat'); b.params.targetValue = -12.25; b.params.decimals = 2; b.params.prefix = 'USD '; b.params.suffix = '';
  assert.equal(api.graphicsStateAtFrame(b, b.params.countEndFrame).text, 'USD -12.25');
  assert.equal(api.graphicsStateAtFrame(b, 0).text, 'USD 0.00');
  b.params.targetValue = Infinity;
  assert.ok(api.inspectGraphicsBrief(b).length > 0);
});
const checks = () => Object.fromEntries(['assets', 'fonts', 'format', 'alpha', 'layout', 'motion', 'privacy', 'first-last-second'].map(k => [k, 'passed']));
const round = (n = 1) => ({frameCount: 120, round: n, revision: 'fixture-v1', briefSha256: 'a'.repeat(64), sourceSha256: 'b'.repeat(64), renderSha256: String(n).repeat(64), checks: checks(), playback: {status: 'passed', startFrame: 0, endFrame: 119}, findings: []});
const review = config => api.graphicsReviewOutcome({current: config.rounds?.length ? Object.fromEntries(['briefSha256', 'sourceSha256', 'renderSha256'].map(k => [k, config.rounds.at(-1)[k]])) : null, ...config});
test('review loop stops early, permits two corrections, and cannot turn exhaustion into approval', () => {
  assert.equal(review({revision: 'fixture-v1', rounds: [round()]}).status, 'passed');
  const bad = round(); bad.checks.layout = 'failed'; bad.findings = [{id: 'clipping', severity: 'error', category: 'technical', status: 'open'}];
  const one = review({revision: 'fixture-v1', rounds: [bad]});
  assert.equal(one.status, 'needs-review'); assert.equal(one.canRevise, true);
  const done = review({revision: 'fixture-v1', rounds: [bad, round(2)]});
  assert.equal(done.status, 'passed'); assert.equal(done.canRevise, false);
  const exhausted = review({revision: 'fixture-v1', rounds: [bad, {...bad, round: 2, renderSha256: '2'.repeat(64)}, {...bad, round: 3, renderSha256: '3'.repeat(64)}]});
  assert.equal(exhausted.status, 'needs-review'); assert.equal(exhausted.canRevise, false);
  assert.equal(review({revision: 'fixture-v1', rounds: [round(), round(2), round(3), round(4)]}).status, 'blocked');
});
test('review evidence is revision-bound and missing prerequisites/playback cannot pass', () => {
  assert.equal(review({revision: 'fixture-v1', prerequisites: ['missing font'], rounds: []}).status, 'blocked');
  const missing = round(); missing.playback.status = 'not-run';
  assert.equal(review({revision: 'fixture-v1', rounds: [missing]}).status, 'needs-review');
  assert.equal(review({revision: 'different', rounds: [round()]}).status, 'blocked');
  const claimed = round(); claimed.findings = [{id: 'wrong-fps', severity: 'error', category: 'technical', status: 'accepted', decision: 'fixture decision'}];
  assert.equal(review({revision: 'fixture-v1', rounds: [claimed]}).status, 'needs-review');
});

test('partial playback and stale current hashes never count as a complete review', () => {
  const partial = round(); partial.playback.endFrame = 20;
  assert.equal(review({revision: 'fixture-v1', rounds: [partial]}).status, 'needs-review');
  assert.equal(review({revision: 'fixture-v1', rounds: [round()], current: {briefSha256: 'a'.repeat(64), sourceSha256: 'b'.repeat(64), renderSha256: 'f'.repeat(64)}}).status, 'blocked');
});

test('all initial states are transparent and pure evaluation preserves the brief', () => {
  for (const recipe of ['masked-title', 'svg-assemble', 'counter-stat']) {
    const b = fixtureBrief(recipe), before = JSON.stringify(b);
    assert.equal(api.graphicsStateAtFrame(b, 0).opacity, 0);
    for (const f of [3, 100, 20, 132, 0]) api.graphicsStateAtFrame(b, f);
    assert.equal(JSON.stringify(b), before);
  }
  const b = fixtureBrief(); b.fonts[0].path = 'assets/../outside.ttf';
  assert.ok(api.inspectGraphicsBrief(b).length);
});

test('malformed findings and unsupported fractional FPS fail safely', () => {
  const b = fixtureBrief(); b.fps = {numerator: 1, denominator: 2};
  assert.ok(api.inspectGraphicsBrief(b).length);
  const bad = round(); bad.findings = [null];
  assert.equal(review({revision: 'fixture-v1', rounds: [bad]}).status, 'blocked');
});


test('font URL compilation preserves authored local provenance in the embedded brief', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'qs-brief-compile-'));
  try {
    const asset = path.join(temp, 'original.fixture'); fs.writeFileSync(asset, 'Original synthetic bytes');
    const b = fixtureBrief();
    writeGraphicsFixture(path.join(temp, 'composition'), b, {gsapFile: asset, fontFile: asset});
    const html = fs.readFileSync(path.join(temp, 'composition/index.html'), 'utf8');
    // The pinned compiler embeds a CSS font and replaces matching literal URLs in HTML.
    const compiled = html.replaceAll('assets/fixture-font.ttf', 'data:font/ttf;base64,ZmFrZQ==');
    const literal = compiled.match(/const brief=(.*);/)[1];
    const restored = JSON.parse(JSON.stringify(vm.runInNewContext('(' + literal + ')')));
    assert.equal(restored.fonts[0].path, 'assets/fixture-font.ttf');
    assert.deepEqual(api.inspectGraphicsBrief(restored), []);
  } finally {fs.rmSync(temp, {recursive: true, force: true});}
});


test('actual missing or changed local assets block review with concrete findings', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'qs-assets-'));
  try {
    const b = fixtureBrief();
    b.assets = [{path: 'assets/missing.fixture', sha256: 'a'.repeat(64), license: 'Original synthetic fixture'}];
    const findings = graphicsAssetFindings(temp, b);
    assert.ok(findings.some(f => f.includes('fonts: missing local file')));
    assert.ok(findings.some(f => f.includes('assets: missing local file')));
    assert.equal(api.graphicsReviewOutcome({revision: b.revision, prerequisites: findings}).status, 'blocked');
    fs.mkdirSync(path.join(temp, 'assets')); fs.writeFileSync(path.join(temp, b.fonts[0].path), 'wrong original bytes');
    assert.ok(graphicsAssetFindings(temp, b).some(f => f.includes('fonts: SHA-256 differs')));
    b.copy.push('Extra unused label');b.recipe = 'counter-stat';
    assert.ok(api.inspectGraphicsBrief(b).some(f => f.includes('one label')));
  } finally {fs.rmSync(temp, {recursive: true, force: true});}
});
