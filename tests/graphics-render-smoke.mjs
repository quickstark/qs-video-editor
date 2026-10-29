#!/usr/bin/env node
// Optional maintainer integration test. Uses already installed tools; never installs them.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {fixtureBrief, loadCanonical, sourceRoot} from './support/graphics-canonical.mjs';
import {fileSha256, sha256, fontMetadata, graphicsAssetFindings, writeGraphicsFixture, serveGraphicsFixtures} from './support/graphics-fixture-server.mjs';

const options = {};
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i];
  if (key === '--browser-only') options.browserOnly = true;
  else if (['--workspace', '--font', '--chrome', '--output', '--case'].includes(key) && process.argv[i + 1]) options[key.slice(2)] = process.argv[++i];
  else throw new Error(`Unknown or incomplete option: ${key}`);
}
if (!options.workspace || !options.font) throw new Error('Usage: node tests/graphics-render-smoke.mjs --workspace <installed graphics workspace> --font <licensed local TTF> [--chrome <executable>] [--output <new directory>] [--case <recipe>] [--browser-only]');
if (options.case && !['masked-title', 'svg-assemble', 'counter-stat'].includes(options.case)) throw new Error('Unknown recipe case');
const workspace = fs.realpathSync(options.workspace), fontFile = fs.realpathSync(options.font);
const inside = (parent, child) => child === parent || child.startsWith(parent + path.sep);
const requestedOutput = options.output ? path.resolve(options.output) : fs.mkdtempSync(path.join(os.tmpdir(), 'qs-graphics-render-'));
let ancestor = requestedOutput;const rest = [];
while (!fs.existsSync(ancestor)) {rest.unshift(path.basename(ancestor));ancestor = path.dirname(ancestor);}
const output = path.join(fs.realpathSync(ancestor), ...rest);
const cacheRoot = fs.realpathSync(path.join(os.homedir(), '.codex/plugins/cache'));
assert.ok(!inside(fs.realpathSync(sourceRoot), output) && !inside(workspace, output) && !inside(cacheRoot, output), 'Test output must be outside the plugin, installed cache and existing workspace');
if (options.output) {assert.ok(!fs.existsSync(output), 'Choose a new output directory');fs.mkdirSync(output, {recursive: true});}
const dependencies = path.join(workspace, 'node_modules');
const require = createRequire(path.join(dependencies, 'hyperframes/package.json'));
const hyperframes = path.join(dependencies, 'hyperframes'), gsap = path.join(dependencies, 'gsap');
assert.equal(JSON.parse(fs.readFileSync(path.join(hyperframes, 'package.json'))).version, '0.7.109');
assert.equal(JSON.parse(fs.readFileSync(path.join(gsap, 'package.json'))).version, '3.14.2');
const hf = path.join(hyperframes, 'bin/hyperframes.mjs'), gsapFile = path.join(gsap, 'dist/gsap.min.js');
const puppeteer = (await import(pathToFileURL(require.resolve('puppeteer-core')))).default;
const chrome = options.chrome ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => fs.existsSync(p));
assert.ok(chrome, 'Pass an installed Chrome executable with --chrome');
const font = fontMetadata(fontFile);assert.ok(font[13] || font[14], 'The fixture font must contain license metadata');
const networkLog = path.join(output, 'network-attempts.jsonl');
const guard = path.join(sourceRoot, 'tests/support/graphics-network-guard.mjs');
const env = {...process.env, HYPERFRAMES_NO_TELEMETRY: '1', HYPERFRAMES_NO_UPDATE_CHECK: '1', HYPERFRAMES_NO_AUTO_INSTALL: '1', CI: '1', GEMINI_API_KEY: 'qs-synthetic-never-valid', QS_GRAPHICS_NETWORK_LOG: networkLog, NODE_OPTIONS: `--import=${pathToFileURL(guard).href}`};
for (const key of Object.keys(env)) if (/KEY|TOKEN|SECRET|PASSWORD/.test(key) && key !== 'GEMINI_API_KEY') delete env[key];
function command(executable, args, {cwd = output, guarded = false, maxBytes = 256 * 1024 * 1024} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {cwd, env: guarded ? env : {...process.env, HYPERFRAMES_NO_TELEMETRY: '1'}, stdio: ['ignore', 'pipe', 'pipe']});
    const stdout = [], stderr = [];let count = 0;
    const timer = setTimeout(() => {child.kill('SIGTERM');reject(new Error(`Timed out: ${path.basename(executable)} ${args[0]}`));}, 180000);
    child.stdout.on('data', b => {count += b.length;if (count > maxBytes) child.kill('SIGTERM');else stdout.push(b);});
    child.stderr.on('data', b => stderr.push(b));
    child.on('error', error => {clearTimeout(timer);reject(error);});
    child.on('close', code => {clearTimeout(timer);const out = Buffer.concat(stdout), err = Buffer.concat(stderr).toString();if (code !== 0) reject(new Error(`${path.basename(executable)} ${args.slice(0, 3).join(' ')} exited ${code}: ${err.slice(-5000)}\n${out.toString().slice(-3000)}`));else resolve({stdout: out, stderr: err});});
  });
}
function browserLayout() {
  const b = window.fixture.brief;
  return [...document.querySelectorAll('[data-graphic-part="line"],[data-graphic-part="digits"],[data-graphic-part="label"],[data-graphic-part^="geometry-"]')].map(el => {
    let r = el.getBoundingClientRect();
    if (el.namespaceURI !== 'http://www.w3.org/2000/svg' && el.textContent) { const range = document.createRange(); range.selectNodeContents(el); r = range.getBoundingClientRect(); }
    return {part: el.dataset.graphicPart, x: r.x, y: r.y, right: r.right, bottom: r.bottom, inside: r.x >= b.safe.x0*b.canvas.width-1 && r.right <= b.safe.x1*b.canvas.width+1 && r.y >= b.safe.y0*b.canvas.height-1 && r.bottom <= b.safe.y1*b.canvas.height+1};
  });
}
const api = await loadCanonical();
const server = await serveGraphicsFixtures(output);
const denied = [];
const browser = await puppeteer.launch({executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-gpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--force-color-profile=srgb', '--disable-background-networking', '--disable-component-update', '--disable-default-apps', '--no-first-run']});
const summary = {hyperframes: '0.7.109', gsap: '3.14.2', browser: await browser.version(), font: {family: font[1], copyright: font[0], license: font[13] ?? font[14], sha256: fileSha256(fontFile)}, cases: [], playbackReview: 'not claimed; automated full-frame analysis and visual evidence are separate from a human review'};
try {
  const cases = options.case ? [[options.case, 24000, false]] : ['masked-title', 'svg-assemble', 'counter-stat'].flatMap(recipe => [[recipe, 24000, false], [recipe, 30000, false], [recipe, 24000, true]]);
  for (let index = 0; index < cases.length; index++) {
    const [recipe, fps, portrait] = cases[index], id = `${recipe}-${fps}${portrait ? '-portrait' : ''}`;
    const directory = path.join(output, id), brief = fixtureBrief(recipe, fps, portrait);
    const fingerprint = writeGraphicsFixture(directory, brief, {gsapFile, fontFile});
    assert.deepEqual(api.inspectGraphicsBrief(brief), []);
    assert.deepEqual(graphicsAssetFindings(directory, brief), [], 'Actual local assets must match their declared hashes');
    const page = await browser.newPage(), errors = [], requests = [];
    await page.setViewport({...brief.canvas, deviceScaleFactor: 1});
    await page.setRequestInterception(true);
    page.on('request', request => {const host = new URL(request.url()).hostname;if (host !== '127.0.0.1') {denied.push(host);request.abort();} else {requests.push(request.url());request.continue();}});
    page.on('pageerror', error => errors.push(String(error)));
    page.on('response', response => {if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) errors.push(`HTTP ${response.status()}: ${response.url()}`);});
    await page.goto(`${server.url}/${id}/`, {waitUntil: 'networkidle0'});
    await page.evaluate(async () => { await document.fonts.load('20px FixtureRoboto'); await document.fonts.ready; });
    assert.equal(await page.evaluate(() => document.fonts.check('20px FixtureRoboto')), true, 'Declared local font must load');
    assert.deepEqual(errors, []);
    const proofFrame = recipe === 'counter-stat' ? brief.params.countEndFrame + 2 : brief.frames.enterEnd + 2;
    await page.evaluate(f => window.fixture.seek(f, true), proofFrame);
    const firstPixels = Buffer.from(await page.screenshot({omitBackground: true}));
    const firstState = await page.evaluate(() => window.fixture.graphic.state());
    const points = [brief.frames.nominal, 2, brief.frames.holdEnd + 4, 0, proofFrame];
    for (const f of points) await page.evaluate(frame => window.fixture.seek(frame, true), f);
    assert.deepEqual(await page.evaluate(() => window.fixture.graphic.state()), firstState, 'Backward callback-suppressed seek must restore state');
    assert.equal(sha256(Buffer.from(await page.screenshot({omitBackground: true}))), sha256(firstPixels), 'Backward seek must restore the exact PNG pixels');
    const actualText = await page.evaluate(() => document.querySelector('[data-graphic-part="digits"]')?.textContent);
    if (recipe === 'counter-stat') assert.equal(actualText, '37.5%');
    const layout = await page.evaluate(browserLayout);
    assert.ok(layout.every(r => r.inside), JSON.stringify(layout));
    if (index === 0) {
      await page.evaluate(() => { document.querySelector('[data-graphic-part="line"]').textContent = 'Original overflow fixture '.repeat(20); });
      assert.ok((await page.evaluate(browserLayout)).some(r => !r.inside), 'Actual overflowing text must fail layout measurement');
      await page.evaluate(() => { document.querySelector('[data-graphic-part="line"]').textContent = window.fixture.brief.copy[0]; });
      const font = path.join(directory, brief.fonts[0].path), saved = fs.readFileSync(font);
      fs.unlinkSync(font);
      assert.equal(fs.existsSync(font), false, 'Missing actual font is a blocked prerequisite');
      const missing = api.graphicsReviewOutcome({revision: brief.revision, prerequisites: graphicsAssetFindings(directory, brief), rounds: []});
      assert.equal(missing.status, 'blocked');
      fs.writeFileSync(font, saved);
      assert.equal(fileSha256(font), brief.fonts[0].sha256);
      summary.injectedDefects = {actualTextOverflow: 'detected', missingActualFont: 'blocked and restored'};
    }
    fs.writeFileSync(path.join(directory, 'hold.png'), firstPixels);
    await page.close();
    const result = {id, fps: `${fps}/1001`, canvas: brief.canvas, ...fingerprint, callbackSuppressedSeeking: 'passed', repeatedFramePixels: 'identical', localFontLoaded: true, measuredSafeBounds: layout};
    console.log(JSON.stringify({case: id, browserSeekingAndLayout: 'passed'}));
    if (!options.browserOnly) {
      console.log(JSON.stringify({case: id, phase: 'check', state: 'started'}));
      const check = await command(process.execPath, [hf, 'check', directory, '--json', '--no-browser-gpu'], {guarded: true});
      fs.writeFileSync(path.join(directory, 'hyperframes-check.json'), check.stdout);
      if (index === 0) {
        await command(process.execPath, [hf, 'snapshot', directory, '--json', '--at', `${proofFrame*1001/fps}`, '--describe', 'false', '--no-end', '--no-browser-gpu'], {guarded: true});
        result.snapshotWithDummyVisionKey = 'passed with --describe false';
      }
      console.log(JSON.stringify({case: id, phase: 'render', state: 'started'}));
      const movie = path.join(directory, 'alpha.mov');
      const rendered = await command(process.execPath, [hf, 'render', directory, '--json', '--fps', `${fps}/1001`, '--format', 'mov', '--quality', 'draft', '--workers', '1', '--no-browser-gpu', '--output', movie], {guarded: true});
      fs.writeFileSync(path.join(directory, 'render.log'), rendered.stdout.toString() + '\n' + rendered.stderr);
      assert.doesNotMatch(rendered.stderr + rendered.stdout.toString(), /Browser:PAGEERROR|sub_timeline_readiness_timeout|correctness warnings/, 'Renderer errors or correctness warnings invalidate output');
      const probe = JSON.parse((await command('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate,avg_frame_rate,nb_read_frames,pix_fmt', '-of', 'json', movie])).stdout);
      const stream = probe.streams[0], total = brief.frames.nominal + brief.frames.tail;
      assert.equal(stream.width, brief.canvas.width);assert.equal(stream.height, brief.canvas.height);
      assert.equal(stream.r_frame_rate, `${fps}/1001`);assert.equal(stream.avg_frame_rate, `${fps}/1001`);assert.equal(Number(stream.nb_read_frames), total);
      const raw = (await command('ffmpeg', ['-v', 'error', '-i', movie, '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'])).stdout;
      const bytes = brief.canvas.width * brief.canvas.height * 4;assert.equal(raw.length, bytes * total);
      const hashes = [];let semiTransparent = false, moving = 0, duplicates = 0;
      for (let f = 0; f < total; f++) {
        const frame = raw.subarray(f * bytes, (f + 1) * bytes);hashes.push(sha256(frame));
        let alphaPixels = 0;
        for (let p = 3; p < frame.length; p += 4) {if (frame[p]) alphaPixels++;if (frame[p] > 0 && frame[p] < 255) semiTransparent = true;}
        if (f === 0 || f >= brief.frames.exitEnd) assert.equal(alphaPixels, 0, `Unexpected opaque frame at ${f}`);
        const motion = (f > brief.frames.enterStart && f < brief.frames.enterEnd) || (f > brief.frames.holdEnd && f < brief.frames.exitEnd) || (recipe === 'counter-stat' && f > brief.frames.enterEnd && f < brief.params.countEndFrame);
        if (motion) {moving++;if (hashes[f] === hashes[f - 1]) duplicates++;}
      }
      assert.ok(semiTransparent, 'Decoded alpha must retain intermediate opacity');
      assert.ok(duplicates / moving <= 0.08, `Unexpected duplicate moving frames: ${duplicates}/${moving}`);
      const proofTime = String(proofFrame * 1001 / fps);
      for (const color of ['white', 'black']) await command('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=${brief.canvas.width}x${brief.canvas.height}:r=${fps}/1001`, '-i', movie, '-filter_complex', '[0:v][1:v]overlay=shortest=1:format=auto', '-ss', proofTime, '-frames:v', '1', path.join(directory, `over-${color}.png`)]);
      const review = path.join(directory, 'moving-background.mp4');
      await command('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', `testsrc2=s=${brief.canvas.width}x${brief.canvas.height}:r=${fps}/1001`, '-i', movie, '-filter_complex', '[0:v][1:v]overlay=shortest=1:format=auto', '-frames:v', String(total), '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', review]);
      Object.assign(result, {hyperframesCheck: 'passed', decodedFrameCount: total, pixelFormat: stream.pix_fmt, decodedAlpha: 'passed', movingFrameDuplicates: {duplicates, moving}, movingBackground: 'passed', renderSha256: fileSha256(movie), reviewSha256: fileSha256(review)});
      console.log(JSON.stringify({case: id, actualRender: 'passed', frames: total, alpha: stream.pix_fmt, duplicates: `${duplicates}/${moving}`}));
    }
    summary.cases.push(result);
  }
  assert.deepEqual(denied, [], 'Canonical fixtures must make no remote browser requests');
  assert.equal(fs.existsSync(networkLog) ? fs.readFileSync(networkLog, 'utf8') : '', '', 'Renderer/snapshot process attempted outbound access');
  summary.browserRemoteAttempts = denied.length;summary.nodeRemoteAttempts = 0;summary.fullMatrix = !options.case && !options.browserOnly;
  fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify({graphicsVerification: 'passed', cases: summary.cases.length, actualRenders: options.browserOnly ? 0 : summary.cases.length, fullMatrix: summary.fullMatrix, remoteAttempts: 0, output}));
} finally {
  await browser.close();await server.close();
  if (!options.output) fs.rmSync(output, {recursive: true, force: true});
}
