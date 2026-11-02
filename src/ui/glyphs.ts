/**
 * One set of original line glyphs (24×24, stroked) shared by the canvas map
 * (via Path2D) and the HTML ledger (via inline SVG), so a place looks the same
 * everywhere it appears.
 */
import type { PlaceType } from '../lib/model';

export const GLYPHS: Record<PlaceType, string> = {
  // Awning on two posts over a counter, one cup with steam.
  tapri: 'M3 9 L12 4 L21 9 Z M5 9 V19 M19 9 V19 M3 19 H21 M9.5 13 H14.5 V16.5 H9.5 Z M11 11.5 Q10.4 10.6 11 9.8 M13 11.5 Q12.4 10.6 13 9.8',
  // Arched reading-room window with mullions (after old-city wada windows).
  vachanalay: 'M5 21 V11 A7 7 0 0 1 19 11 V21 Z M12 4 V21 M5 14 H19 M8 17.5 H10 M14 17.5 H16',
  // Stone steps meeting a river.
  ghat: 'M2 7 H7 V10 H11 V13 H15 V16 H22 M2 20.5 Q4.5 18.5 7 20.5 T12 20.5 T17 20.5 T22 20.5',
  // Marquee with bulbs and a screen.
  cinema: 'M3 5 H21 V15 H3 Z M6 15 V20 M18 15 V20 M6.5 8.5 H17.5 V12 H6.5 Z',
  // Cup and saucer with steam.
  cafe: 'M5 10 H16 V14 A5 5 0 0 1 11 19 H10 A5 5 0 0 1 5 14 Z M16 11 H17.5 A2 2 0 0 1 17.5 15 H16 M3 21.5 H18 M9 3.5 Q8 5.25 9 7 M12.5 3.5 Q11.5 5.25 12.5 7',
};

export function glyphSVG(type: PlaceType | null, size = 22, cls = 'glyph'): string {
  if (!type) {
    return `<svg class="${cls}" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-dasharray="2 2.6"/><path d="M12 8.5 V15.5 M8.5 12 H15.5" stroke="currentColor"/></svg>`;
  }
  return `<svg class="${cls}" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path d="${GLYPHS[type]}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

const cache = new Map<string, Path2D>();
export function glyphPath(type: PlaceType): Path2D {
  let p = cache.get(type);
  if (!p) {
    p = new Path2D(GLYPHS[type]);
    cache.set(type, p);
  }
  return p;
}
