// Turns decoded engine screenshots (png-tools.mjs decodePng results) into the numbers stylized-validate-checks.mjs judges.
// Pure functions over { width, height, rgba }: stylized_validate.mjs decodes the saved PNGs and calls measureAll.
import { countNear, foreground, luminanceBands, pixel } from './png-tools.mjs';

export const FILL = [240, 196, 64];          // flat fill colour of the generated flipbook (stylized_build.py)
export const SPRITE_REGION = { x0: 380, y0: 100, x1: 900, y1: 620 };
export const LEFT_SPHERE = { x0: 340, y0: 200, x1: 640, y1: 520 };
export const RIGHT_SPHERE = { x0: 660, y0: 200, x1: 960, y1: 520 };
export const DRAWN_REGION = { x0: 300, y0: 60, x1: 980, y1: 660 };

/** Flat-colour bands inside the sprite or sphere against its backdrop colour (sampled at a fixed corner pixel). */
export function bandsIn(img, region, tolerance = 12) {
  const fg = foreground(img, pixel(img, 1000, 100), tolerance, region);
  const bands = luminanceBands(fg, { minShare: 0.07, gap: 1 });
  const flatShare = bands.runs.reduce((sum, r) => sum + r.share, 0);
  return { bands: bands.bands, levels: bands.levels, flatShare: +flatShare.toFixed(3), pixels: fg.length, runs: bands.runs };
}

/** Fill-colour pixels of the first `cells` cells of a flipbook decoded from its PNG (grid x grid, square cells). */
export function cellFillCounts(flipbook, grid = 4) {
  const cell = flipbook.width / grid, out = [];
  for (let f = 0; f < grid * grid; f++) {
    out.push(countNear(flipbook, FILL, 0, { x0: (f % grid) * cell, y0: Math.floor(f / grid) * cell, x1: (f % grid) * cell + cell, y1: Math.floor(f / grid) * cell + cell }));
  }
  return out;
}

/** What one flipbook screenshot shows: the on-screen fill-colour area, the sprite centre colour and the backdrop colour. */
export function drawnShot(img) {
  const fillColor = pixel(img, 640, 360);
  return { fill: countNear(img, fillColor, 8, DRAWN_REGION), center: fillColor, backdrop: pixel(img, 330, 120), ink: countNear(img, pixel(img, 330, 120), 0, DRAWN_REGION) };
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/**
 * @param {(name: string) => any} load   returns the decoded screenshot stylized_<name>.png
 * @param {number[]} cellFill            cellFillCounts() of the flipbook texture
 * @param {number[]} frames              the fixed flipbook frames shown by the stylized_frame_<n> shots
 */
export function measureAll(load, cellFill, frames) {
  const out = {
    toonSphere: bandsIn(load('meshes'), LEFT_SPHERE), plainSphere: bandsIn(load('meshes'), RIGHT_SPHERE),
    toonMasked: bandsIn(load('toon_masked'), SPRITE_REGION), toonTranslucent: bandsIn(load('toon_translucent'), SPRITE_REGION),
    stepped: bandsIn(load('stepped'), SPRITE_REGION), smooth: bandsIn(load('smooth'), SPRITE_REGION),
  };
  out.timed = Array.from({ length: 8 }, (_, i) => drawnShot(load(`drawn_t${i}`)).fill);
  out.fixed = frames.map((frame) => ({ frame, ...drawnShot(load(`frame_${frame}`)) }));
  const ratios = out.fixed.map((d) => d.fill / cellFill[d.frame]), mid = median(ratios);
  out.fixedRatioSpread = +Math.max(...ratios.map((r) => Math.abs(r - mid) / mid)).toFixed(3);
  out.fixedRatioMedian = +mid.toFixed(2);
  out.bright = drawnShot(load('frame_9_bright'));
  out.dark = drawnShot(load('frame_9_dark'));
  return out;
}
