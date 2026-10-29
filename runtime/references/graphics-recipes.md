# Three deterministic graphics recipes

Use these original examples as starting points for project-owned editable composition source. They are not a second runtime installation or a new renderer. Keep the common contracts in the shared references. Read the [brief](graphics-brief.md) first and run the [bounded review](graphics-review.md) on the actual output.

| ID | Inputs and behavior |
| --- | --- |
| `masked-title` | One or two exact lines. Each line rises inside a padded mask, holds fully readable, and exits. `staggerFrames` explicitly separates line entrances. |
| `svg-assemble` | Three original geometric paths, kept as editable SVG groups. Their translated/opacity entrances overlap by at most two moving parts, hold as one graphic, then exit. Adapt the geometry for the job; do not copy an unlicensed logo. |
| `counter-stat` | Verified label, finite start/target, 0–3 decimal places, fixed prefix/suffix, and a count-end frame before the readable hold. The number is computed from time, not accumulated. |

All phases are in integer frames. The master timeline seeks an ordinary numeric property whose setter paints the exact state for that time. This works when GSAP callbacks are suppressed: no `onUpdate`, timers, event-driven playback, random values, or live locale/clock state drive pixels. Numeric formatting uses `toFixed` with explicit precision. Holds and the exit are explicit, and the remaining nominal/tail frames are transparent for overlays.

## Canonical implementation

Build the static DOM synchronously inside a non-clip wrapper, then register the caller-owned paused GSAP master timeline under the composition ID. The composition root and clip retain explicit dimensions, FPS and duration. HyperFrames owns clip lifecycle; this code animates only the graphic inside it. Load the brief's local font files in the composition and verify them before final capture. Preserve authored asset paths when embedding brief metadata: serialize JSON with `/` escaped as `\u002f` (and `<` as `\u003c`). The pinned compiler embeds CSS font URLs; it must not replace a provenance path in the brief with a data URI. The fixture harness tests this handoff.

The fixture harness extracts this exact example and the brief/review examples. It does not carry a second toy implementation of the recipes. The generated HTML, SVG and font copy live only in the temporary fixture workspace.

<!-- qs-example: graphics-recipes -->
```js
export function graphicsStateAtFrame(b, frame) {
  const issues = inspectGraphicsBrief(b);
  if (issues.length) throw new Error(issues.join('; '));
  if (typeof frame !== 'number' || !Number.isFinite(frame) || frame < 0) throw new Error('Frame must be finite and nonnegative');
  const f = b.frames, p = b.params;
  const progress = (start, end) => Math.max(0, Math.min(1, (frame - start) / (end - start)));
  const ease = t => 1 - (1 - t) ** 3;
  const opacity = ease(progress(f.enterStart, f.enterEnd)) * (1 - progress(f.holdEnd, f.exitEnd));
  const state = {opacity, frame, recipe: b.recipe};
  if (b.recipe === 'masked-title') {
    const length = f.enterEnd - f.enterStart - (b.copy.length - 1) * p.staggerFrames;
    state.lines = b.copy.map((_, i) => {
      const q = ease(progress(f.enterStart + i * p.staggerFrames, f.enterStart + i * p.staggerFrames + length));
      return {opacity: q, yPercent: 110 * (1 - q)};
    });
  }
  if (b.recipe === 'svg-assemble') {
    const length = f.enterEnd - f.enterStart - 2 * p.staggerFrames;
    state.parts = [0, 1, 2].map(i => {
      const q = ease(progress(f.enterStart + i * p.staggerFrames, f.enterStart + i * p.staggerFrames + length));
      return {opacity: q, y: 90 * (1 - q)};
    });
  }
  if (b.recipe === 'counter-stat') {
    const q = ease(progress(f.enterEnd, p.countEndFrame));
    const value = frame >= p.countEndFrame ? p.targetValue : p.startValue + (p.targetValue - p.startValue) * q;
    state.text = p.prefix + value.toFixed(p.decimals) + p.suffix;
  }
  return state;
}

export function buildGraphicsRecipe({root, timeline, brief: b}) {
  const issues = inspectGraphicsBrief(b);
  if (issues.length) throw new Error(issues.join('; '));
  if (!root?.ownerDocument || !timeline?.fromTo) throw new Error('A DOM wrapper and caller-owned timeline are required');
  const doc = root.ownerDocument, style = b.style;
  const node = (tag, name, parent) => {
    const el = doc.createElement(tag); el.dataset.graphicPart = name; parent.appendChild(el); return el;
  };
  const set = (el, values) => Object.assign(el.style, values);
  const area = node('div', 'safe-area', root);
  set(area, {position: 'absolute', left: `${100 * b.safe.x0}%`, top: `${100 * b.safe.y0}%`, width: `${100 * (b.safe.x1 - b.safe.x0)}%`, height: `${100 * (b.safe.y1 - b.safe.y0)}%`, display: 'grid', placeItems: 'center'});
  const subject = node('div', 'subject', area);
  set(subject, {fontFamily: style.fontFamily, fontSize: `${style.fontSize}px`, lineHeight: String(style.lineHeight), letterSpacing: `${style.tracking}px`, color: style.color, textAlign: 'center', maxWidth: '100%', boxSizing: 'border-box', backgroundColor: style.panelColor ?? 'transparent', padding: style.panelColor && style.panelColor !== 'transparent' ? '.35em .5em' : '0', borderRadius: '6px'});
  let lines = [], parts = [], digits = null;
  if (b.recipe === 'masked-title') {
    for (const copy of b.copy) {
      const mask = node('div', 'mask', subject), line = node('div', 'line', mask);
      set(mask, {overflow: 'hidden', padding: '.12em .18em .18em', margin: '-.12em -.18em -.18em'});
      set(line, {display: 'block', whiteSpace: 'nowrap'}); line.textContent = copy; lines.push(line);
    }
  }
  if (b.recipe === 'svg-assemble') {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = doc.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 300 180'); svg.setAttribute('aria-label', b.purpose);
    set(svg, {display: 'block', width: `${Math.min(300, b.canvas.width * (b.safe.x1 - b.safe.x0))}px`, maxWidth: '100%', height: 'auto', overflow: 'visible'}); subject.appendChild(svg);
    const paths = ['M24 144 L72 36 L120 144 Z', 'M132 36 H178 V144 H132 Z', 'M196 36 H276 V70 H230 V110 H276 V144 H196 Z'];
    paths.forEach((d, i) => {
      const group = doc.createElementNS(ns, 'g'), shape = doc.createElementNS(ns, 'path');
      group.dataset.graphicPart = `geometry-${i}`; shape.setAttribute('d', d); shape.setAttribute('fill', i === 1 ? style.accent : style.color);
      group.appendChild(shape); svg.appendChild(group); parts.push(group);
    });
  }
  if (b.recipe === 'counter-stat') {
    digits = node('div', 'digits', subject); digits.textContent = b.params.prefix + b.params.targetValue.toFixed(b.params.decimals) + b.params.suffix;
    set(digits, {fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: style.accent});
    const label = node('div', 'label', subject); label.textContent = b.copy[0]; set(label, {fontSize: '.55em', marginTop: '.35em'});
  }
  const paint = frame => {
    const state = graphicsStateAtFrame(b, frame); subject.style.opacity = String(state.opacity);
    state.lines?.forEach((value, i) => { lines[i].style.opacity = String(value.opacity); lines[i].style.transform = `translateY(${value.yPercent}%)`; });
    state.parts?.forEach((value, i) => { parts[i].style.opacity = String(value.opacity); parts[i].setAttribute('transform', `translate(0 ${value.y})`); });
    if (digits) digits.textContent = state.text;
    return state;
  };
  paint(b.recipe === 'counter-stat' ? b.params.countEndFrame : b.frames.enterEnd);
  let currentFrame = 0;
  const clock = {};
  Object.defineProperty(clock, 'frame', {enumerable: true, get: () => currentFrame, set: value => { currentFrame = Number(value); paint(currentFrame); }});
  const total = b.frames.nominal + b.frames.tail;
  timeline.fromTo(clock, {frame: 0}, {frame: total, duration: total * b.fps.denominator / b.fps.numerator, ease: 'none', immediateRender: false}, 0);
  paint(0);
  return {subject, state: () => graphicsStateAtFrame(b, currentFrame)};
}
```

Keep final copy, geometry and parameters in the editable project. A `style.panelColor` of `transparent` or an explicit hex color controls an optional static backing plate; declare it in the brief. The original fixtures use a dark plate to protect light copy over light, dark, and moving backgrounds. Use [review](graphics-review.md) to check real font loading and measured bounds; valid parameters alone do not prove that a long title fits.
