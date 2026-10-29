# Standalone graphics brief

Write `graphics-build/DESIGN.md` before authoring. A standalone title, overlay, or stat needs no transcript, film scaffold, or fabricated timeline. For a film, read its existing brief, brand/style, approved timeline and relevant transcript; link each graphic by its existing plan item ID.

Keep this brief short. Specify values that let another editor reproduce the graphic:

| Field | Record |
| --- | --- |
| Identity | Item ID, revision, purpose, recipe and exact verified copy |
| Output | Canvas width/height; exact FPS numerator/denominator; alpha or opaque |
| Timing | Entrance start/end, hold end, exit end, nominal length and tail, in integer frames; easing and explicit endpoint states |
| Typography | Local font file, SHA-256, family, license/provenance, size, line height, tracking |
| Appearance | Explicit colors, placement, normalized safe bounds, SVG geometry or counter formatting |
| Assets | Local project-relative paths, hashes and rights/provenance; original geometry where applicable |
| Direction | Applicable project style and recorded overrides; unresolved conflicts |
| Delivery | Editable composition source, separate rendered layer, and review evidence paths |

Use one section per item ID. In `graphics-plan.json`, keep the existing v1 fields and use `notes` to point to the brief. Recipe parameters belong here, not in new plan-item fields. Existing plan sorting, overlap, and gap rules remain unchanged.

Frame `f` occurs at `f * denominator / numerator` seconds. Derive renderer timestamps from those frames. A required safety tail is at least `ceil(0.5 * numerator / denominator)` frames. Otherwise explicitly choose no tail, and verify the exit before EOF. Record holds; existing duplicate-frame checks still apply to intended moving ranges.

Build the readable static layout first. Resolve project style conflicts before final rendering. The existing 8%/10% safe-zone and stagger differences are not permission to silently relax a rule. Choose and record a scoped resolution; preserve the shared defaults. Missing copy, fonts, asset rights or exact timing blocks a final. Preview substitutions are labeled and remain unapproved.

## Canonical parameter check

The recipes use the original check below. It validates declared inputs; it does not prove a file exists, a font loaded, an asset license, or a human approval. Before final rendering, check actual local bytes against the declared hashes, loaded font faces, and the resolved style. The verification harness exercises both declarations and actual assets.

<!-- qs-example: graphics-brief -->
```js
export function inspectGraphicsBrief(b) {
  const errors = [];
  const add = (condition, message) => { if (!condition) errors.push(message); };
  const text = v => typeof v === 'string' && v.trim().length > 0;
  const finite = v => typeof v === 'number' && Number.isFinite(v);
  const integer = v => Number.isSafeInteger(v) && v >= 0;
  const local = v => text(v) && !/^[a-z][a-z0-9+.-]*:|^[\\/]|\\|\0/i.test(v) && !v.split('/').some(p => p === '..' || p === '.' || p === '');
  if (!b || typeof b !== 'object' || Array.isArray(b)) return ['Brief must be an object'];
  add(b.schemaVersion === 1, 'Brief schemaVersion must be 1');
  for (const key of ['itemId', 'revision', 'purpose']) add(text(b[key]), `Missing ${key}`);
  add(['masked-title', 'svg-assemble', 'counter-stat'].includes(b.recipe), 'Unknown recipe');
  add(Array.isArray(b.copy) && (b.recipe === 'svg-assemble' || b.copy.length > 0) && b.copy.every(text), 'Exact verified copy is required (use [] for the text-free SVG recipe)');
  if (b.recipe === 'svg-assemble') add(b.copy?.length === 0, 'SVG assembly has no text; declare copy as []');
  if (b.recipe === 'counter-stat') add(b.copy?.length === 1, 'Counter requires exactly one label');
  if (b.recipe === 'masked-title') add(b.copy?.length <= 2, 'Masked title supports one or two lines');
  const c = b.canvas ?? {}, fps = b.fps ?? {}, f = b.frames ?? {}, s = b.safe ?? {}, style = b.style ?? {};
  add(integer(c.width) && c.width > 0 && integer(c.height) && c.height > 0, 'Positive integer canvas dimensions are required');
  add(integer(fps.numerator) && fps.numerator > 0 && integer(fps.denominator) && fps.denominator > 0 && fps.numerator / fps.denominator >= 1 && fps.numerator / fps.denominator <= 240, 'Exact rational FPS is required (1 through 240)');
  const phaseNames = ['enterStart', 'enterEnd', 'holdEnd', 'exitEnd', 'nominal', 'tail'];
  add(phaseNames.every(k => integer(f[k])), 'Every phase and tail must be an integer frame');
  add(f.enterStart < f.enterEnd && f.enterEnd < f.holdEnd && f.holdEnd < f.exitEnd && f.exitEnd <= f.nominal, 'Require entrance < readable hold < exit <= nominal frames');
  add(typeof b.alpha === 'boolean', 'Alpha/opaque output must be explicit');
  add(['required', 'none'].includes(b.tailPolicy), 'Tail policy must be required or none');
  if (b.tailPolicy === 'none') add(f.tail === 0 && f.exitEnd < f.nominal, 'No-tail output must exit before EOF');
  if (b.tailPolicy === 'required' && fps.denominator > 0) add(f.tail >= Math.ceil(0.5 * fps.numerator / fps.denominator), 'Required tail is at least half a second in whole frames');
  add(['x0', 'y0', 'x1', 'y1'].every(k => finite(s[k]) && s[k] >= 0 && s[k] <= 1) && s.x0 < s.x1 && s.y0 < s.y1, 'Safe bounds must be ordered normalized proportions');
  add(text(style.source), 'Record the applicable style source');
  add(Array.isArray(style.conflicts) && style.conflicts.length === 0, 'Resolve style conflicts before authoring a final');
  add(text(style.fontFamily) && /^[\w -]+$/.test(style.fontFamily), 'Explicit safe font family is required');
  add(finite(style.fontSize) && style.fontSize > 0 && finite(style.lineHeight) && style.lineHeight >= 1 && finite(style.tracking), 'Explicit font size, line height and tracking are required');
  if (style.panelColor !== undefined) add(style.panelColor === 'transparent' || /^#[\da-f]{6}$/i.test(style.panelColor), 'panelColor must be transparent or a six-digit color');
  for (const key of ['color', 'accent']) add(/^#[\da-f]{6}$/i.test(style[key] ?? ''), `Use a six-digit ${key} color`);
  for (const key of ['fonts', 'assets']) {
    add(Array.isArray(b[key]), `${key} must be an array`);
    for (const asset of Array.isArray(b[key]) ? b[key] : []) {
      add(local(asset?.path), `${key}: use a local project-relative path`);
      add(/^[\da-f]{64}$/i.test(asset?.sha256 ?? ''), `${key}: SHA-256 is required`);
      add(text(asset?.license), `${key}: license/provenance is required`);
    }
  }
  if (b.recipe !== 'svg-assemble') add(b.fonts?.length > 0, 'Local licensed font files are required');
  const p = b.params ?? {};
  if (b.recipe === 'masked-title' || b.recipe === 'svg-assemble') {
    add(integer(p.staggerFrames), 'Explicit staggerFrames is required');
    const count = b.recipe === 'svg-assemble' ? 3 : b.copy?.length ?? 0;
    const duration = f.enterEnd - f.enterStart - (count - 1) * p.staggerFrames;
    add(duration > 0, 'Entrance must contain the whole stagger');
    if (b.recipe === 'svg-assemble') add(p.staggerFrames > 0 && duration <= 2 * p.staggerFrames, 'SVG assembly moves at most two parts at once');
  }
  if (b.recipe === 'counter-stat') {
    add(finite(p.startValue) && finite(p.targetValue) && Math.abs(p.startValue) <= 1e12 && Math.abs(p.targetValue) <= 1e12, 'Counter values must be finite and within 1e12');
    add(integer(p.decimals) && p.decimals <= 3, 'Counter decimals must be 0 through 3');
    add(typeof p.prefix === 'string' && typeof p.suffix === 'string', 'Counter prefix and suffix must be explicit strings');
    add(integer(p.countEndFrame) && p.countEndFrame > f.enterEnd && p.countEndFrame < f.holdEnd, 'Counter must reach its target before a readable hold');
  }
  return errors;
}
```

The browser example's `brief` object uses these same fields. A design document is the human-readable authority; a parameter object is its exact authoring input, not an extension of the film timeline or graphics-plan schema.
