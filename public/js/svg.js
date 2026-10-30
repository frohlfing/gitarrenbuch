/**
 * Grafiken als SVG-Text: Griffbild eines Akkords (für die Griffbild-Seite, später auch fürs Leadsheet).
 * Gezeichnet wird in currentColor, damit Bildschirm und Druck dieselbe Grafik nutzen.
 */

import {escapeHtml} from './api.js';
import {barreFret, diagramFirstFret, parseGrip} from './chords.js';

/** Anzahl der gezeichneten Bünde. */
const FRETS_SHOWN = 5;
/** Abstand der Saiten in SVG-Einheiten. */
const STRING_GAP = 16;
/** Abstand der Bünde in SVG-Einheiten. */
const FRET_GAP = 20;
/** Linker Rand (Platz für die Bundangabe). */
const LEFT = 22;
/** Oberer Rand (Akkordname, Kennzeichen x und o). */
const TOP = 40;

/**
 * Griffbild eines Akkords.
 * @param {string} name Akkordname, steht über dem Griffbild
 * @param {string} grip Griff von der tiefen E-Saite aus, z. B. "x32010"
 * @returns {string} SVG-Element als Text
 */
export function chordDiagramSvg(name, grip){
  const frets = parseGrip(grip);
  const first = diagramFirstFret(frets);
  const strings = frets.length;
  const width = LEFT + (strings - 1) * STRING_GAP + 12;
  const height = TOP + FRETS_SHOWN * FRET_GAP + 8;
  const x = i => LEFT + i * STRING_GAP;
  const y = fret => TOP + (fret - first + 0.5) * FRET_GAP;
  const parts = [];

  parts.push(`<text x="${(LEFT + x(strings - 1)) / 2}" y="14" text-anchor="middle" font-size="14"
    fill="currentColor">${escapeHtml(name)}</text>`);
  // Saiten und Bünde, bei Griffen ab dem 1. Bund ein dicker Sattel.
  for(let i = 0; i < strings; i++){
    parts.push(`<line x1="${x(i)}" y1="${TOP}" x2="${x(i)}" y2="${TOP + FRETS_SHOWN * FRET_GAP}"/>`);
  }
  for(let f = 0; f <= FRETS_SHOWN; f++){
    const w = f === 0 && first === 1 ? 4 : 1;
    parts.push(`<line x1="${x(0)}" y1="${TOP + f * FRET_GAP}" x2="${x(strings - 1)}" y2="${TOP + f * FRET_GAP}"
      stroke-width="${w}"/>`);
  }
  if(first > 1){
    parts.push(`<text class="fret-label" x="${LEFT - 6}" y="${y(first) + 4}" text-anchor="end" font-size="11"
      fill="currentColor">${first}</text>`);
  }
  // Kennzeichen über dem Sattel, Barré, Fingerpunkte.
  frets.forEach((f, i) => {
    if(f < 0) parts.push(`<text x="${x(i)}" y="${TOP - 6}" text-anchor="middle" font-size="12"
      fill="currentColor">×</text>`);
    if(f === 0) parts.push(`<circle cx="${x(i)}" cy="${TOP - 10}" r="4" fill="none"/>`);
  });
  const barre = barreFret(frets);
  if(barre !== null){
    // Wie alphaTab: von der tiefsten bis zur höchsten Saite in diesem Bund.
    const from = frets.indexOf(barre);
    const to = frets.lastIndexOf(barre);
    parts.push(`<rect x="${x(from) - 6}" y="${y(barre) - 6}" width="${x(to) - x(from) + 12}" height="12"
      rx="6" fill="currentColor" stroke="none"/>`);
  }
  frets.forEach((f, i) => {
    if(f > 0 && f !== barre) parts.push(`<circle cx="${x(i)}" cy="${y(f)}" r="6" fill="currentColor" stroke="none"/>`);
  });

  return `<svg class="chord-diagram" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"
    role="img" aria-label="${escapeHtml(`${name}: ${grip}`)}" fill="none" stroke="currentColor"
    stroke-width="1">${parts.join('')}</svg>`;
}
