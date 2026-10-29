import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {canonicalSource} from './graphics-canonical.mjs';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const fileSha256 = file => sha256(fs.readFileSync(file));
export function graphicsAssetFindings(directory, brief) {
  const root = fs.realpathSync(directory), findings = [];
  for (const kind of ['fonts', 'assets']) for (const asset of brief[kind]) {
    const file = path.resolve(root, asset.path);
    if (!file.startsWith(root + path.sep)) {findings.push(`${kind}: path leaves project: ${asset.path}`);continue;}
    try {
      if (!fs.realpathSync(file).startsWith(root + path.sep)) findings.push(`${kind}: resolved path leaves project: ${asset.path}`);
      else if (!fs.statSync(file).isFile()) findings.push(`${kind}: not a local file: ${asset.path}`);
      else if (fileSha256(file) !== asset.sha256) findings.push(`${kind}: SHA-256 differs: ${asset.path}`);
    } catch (error) {
      if (error.code === 'ENOENT') findings.push(`${kind}: missing local file: ${asset.path}`);
      else throw error;
    }
  }
  return findings;
}
export function fontMetadata(file) {
  const b = fs.readFileSync(file), count = b.readUInt16BE(4);
  let offset;
  for (let i = 0; i < count; i++) if (b.toString('ascii', 12 + i * 16, 16 + i * 16) === 'name') offset = b.readUInt32BE(20 + i * 16);
  if (offset === undefined) throw new Error('Font has no name table');
  const records = b.readUInt16BE(offset + 2), start = offset + b.readUInt16BE(offset + 4), names = {};
  for (let i = 0; i < records; i++) {
    const record = offset + 6 + i * 12, platform = b.readUInt16BE(record), id = b.readUInt16BE(record + 6), length = b.readUInt16BE(record + 8), at = start + b.readUInt16BE(record + 10);
    if (![0, 1, 13, 14].includes(id) || names[id]) continue;
    const bytes = b.subarray(at, at + length);
    names[id] = platform === 0 || platform === 3 ? Array.from({length: bytes.length / 2}, (_, n) => String.fromCharCode(bytes.readUInt16BE(n * 2))).join('') : bytes.toString('latin1');
  }
  return names;
}
export function writeGraphicsFixture(directory, brief, {gsapFile, fontFile}) {
  fs.mkdirSync(path.join(directory, 'assets'), {recursive: true});
  fs.copyFileSync(gsapFile, path.join(directory, 'assets/gsap.min.js'));
  fs.copyFileSync(fontFile, path.join(directory, 'assets/fixture-font.ttf'));
  brief.fonts[0].sha256 = fileSha256(fontFile);
  // Keep authored provenance distinct from compiler-owned CSS URL embedding.
  const parameters = JSON.stringify(brief).replace(/</g, '\\u003c').replace(/\//g, '\\u002f');
  const source = canonicalSource().replace(/^export /gm, '');
  const duration = (brief.frames.nominal + brief.frames.tail) * brief.fps.denominator / brief.fps.numerator;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><title>Original QS graphics fixture</title>
<meta name="viewport" content="width=${brief.canvas.width}, height=${brief.canvas.height}">
<script src="assets/gsap.min.js"></script>
<style>@font-face{font-family:FixtureRoboto;src:url('assets/fixture-font.ttf')}html,body{margin:0;background:transparent}*{box-sizing:border-box}#root{position:relative;width:${brief.canvas.width}px;height:${brief.canvas.height}px;overflow:hidden}.clip,#graphic{position:absolute;inset:0}</style></head>
<body><div id="root" data-composition-id="fixture" data-start="0" data-duration="${duration}" data-width="${brief.canvas.width}" data-height="${brief.canvas.height}" data-fps="${brief.fps.numerator / brief.fps.denominator}"><section id="graphic-clip" class="clip" data-start="0" data-duration="${duration}" data-track-index="1"><div id="graphic"></div></section></div>
<script>${source}
const brief=${parameters};
const timeline=gsap.timeline({paused:true});
const graphic=buildGraphicsRecipe({root:document.getElementById('graphic'),timeline,brief});
window.__timelines=window.__timelines||{};
window.__timelines["fixture"]=timeline;
window.fixture={brief,timeline,graphic,seek(frame,suppressed=true){timeline.seek(frame*brief.fps.denominator/brief.fps.numerator,suppressed);return graphic.state();}};
</script></body></html>`;
  fs.writeFileSync(path.join(directory, 'index.html'), html);
  fs.writeFileSync(path.join(directory, 'brief.json'), JSON.stringify(brief, null, 2) + '\n');
  fs.writeFileSync(path.join(directory, 'DESIGN.md'), `# Original ${brief.recipe} fixture\n\nNo transcript, film timeline, or full project scaffold.\n\nExact authoring parameters: [brief.json](brief.json).\nLocal font provenance is recorded by the harness; font bytes are not packaged.\n`);
  return {briefSha256: fileSha256(path.join(directory, 'brief.json')), sourceSha256: sha256(html)};
}
export async function serveGraphicsFixtures(root) {
  const types = {'.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.ttf': 'font/ttf', '.png': 'image/png'};
  const server = http.createServer((req, res) => {
    try {
      const requested = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
      const target = path.resolve(root, '.' + requested, requested.endsWith('/') ? 'index.html' : '');
      if (!target.startsWith(path.resolve(root) + path.sep) || !fs.statSync(target).isFile()) {res.writeHead(404);res.end();return;}
      res.setHeader('Content-Type', types[path.extname(target)] ?? 'application/octet-stream');
      fs.createReadStream(target).pipe(res);
    } catch {res.writeHead(404);res.end();}
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve))};
}
