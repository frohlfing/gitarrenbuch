/**
 * Symbole für die Knöpfe des Bearbeitungsmodus, selbst gezeichnet als SVG (24 × 24, in currentColor), dazu Zeichen
 * der Notenschrift Bravura (SMuFL, SIL Open Font License), die alphaTab mitbringt. Speichern, Rückgängig und
 * Wiederholen sind aus den Material Icons (Apache 2.0).
 */

/** Gemeinsame Attribute der gezeichneten Symbole: Linien in currentColor, runde Enden. */
const STROKE = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

/**
 * Inhalt der SVG-Symbole (ohne <svg>), viewBox 0 0 24 24.
 * @type {Object<string, string>}
 */
const PATHS = {
  // Material Icons (Apache 2.0)
  save: '<path fill="currentColor" stroke="none" d="M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7l-4-4z'
    + 'm-5 16a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm3-10H5V5h10v4z"/>',
  undo: '<path fill="currentColor" stroke="none" d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62A7.95 7.95 0 0 1 '
    + '12.5 10c3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 10.53 17.15 8 12.5 8z"/>',
  redo: '<path fill="currentColor" stroke="none" d="M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22'
    + 'L3.9 16a8 8 0 0 1 7.6-5.5c1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z"/>',
  // Schlag: Notenkopf mit Hals, daneben Plus bzw. Minus
  insertBeat: '<ellipse cx="7" cy="17" rx="3.2" ry="2.4" fill="currentColor" stroke="none"/><path d="M10 17V5"/>'
    + '<path d="M18 7v8M14 11h8"/>',
  deleteBeat: '<ellipse cx="7" cy="17" rx="3.2" ry="2.4" fill="currentColor" stroke="none"/><path d="M10 17V5"/>'
    + '<path d="M14 11h8"/>',
  // Takt: zwei Taktstriche, dazwischen Plus bzw. Minus
  insertBar: '<path d="M4 4v16M20 4v16M12 8v8M8 12h8"/>',
  deleteBar: '<path d="M4 4v16M20 4v16M8 12h8"/>',
  // Hammer-on / Pull-off: Bogen über "H"
  hammer: '<path d="M4 9q8-7 16 0"/><path d="M8 11v9M16 11v9M8 15.5h8"/>',
  // Slide: schräge Linie zwischen zwei Tab-Ziffern (Punkten)
  slide: '<circle cx="5" cy="17" r="2" fill="currentColor" stroke="none"/>'
    + '<circle cx="19" cy="7" r="2" fill="currentColor" stroke="none"/><path d="M7.5 15.3 16.5 8.7"/>',
  // Bend: waagerecht, dann nach oben gebogen mit Pfeilspitze
  bend: '<path d="M3 19h6q6 0 7-12"/><path d="m12.5 9.5 3.5-4 3 4.5"/>',
  // Vibrato: Wellenlinie
  vibrato: '<path d="M2 12q2.5-5 5 0t5 0 5 0 5 0"/>',
  // Saite dämpfen: Kreuz wie im Tab
  dead: '<path d="M6 6l12 12M18 6 6 18"/>',
  // Halbton höher / tiefer: Pfeil mit "½"
  semitoneUp: '<path d="M7 20V5M3 9l4-4 4 4"/><text x="13" y="17" font-size="9" fill="currentColor" stroke="none"'
    + ' font-family="sans-serif">½</text>',
  semitoneDown: '<path d="M7 4v15M3 15l4 4 4-4"/><text x="13" y="13" font-size="9" fill="currentColor" stroke="none"'
    + ' font-family="sans-serif">½</text>',
  // Anschlagpfeile: Abwärts (von der tiefen zur hohen Saite) steht in den Noten als Pfeil nach oben
  brushDown: '<path d="M12 21V4M7 9l5-5 5 5"/>',
  brushUp: '<path d="M12 3v17M7 15l5 5 5-5"/>',
  // Arpeggio: Wellenlinie senkrecht mit Pfeilspitze, Richtung wie bei den Anschlagpfeilen
  arpeggioDown: '<path d="M12 21q-3-2 0-4t0-4 0-4 0-5"/><path d="M8 8l4-4 4 4"/>',
  arpeggioUp: '<path d="M12 3q3 2 0 4t0 4 0 4 0 5"/><path d="M8 16l4 4 4-4"/>',
};

/**
 * Zeichen der Notenschrift Bravura (SMuFL-Codepunkte).
 * @type {Object<string, string>}
 */
export const GLYPHS = {
  whole: '', half: '', quarter: '', eighth: '', sixteenth: '', thirtySecond: '',
  dot: '', tie: '', restQuarter: '',
  sharp: '', flat: '', natural: '',
  pickDown: '', pickUp: '',
  gClef: '',
};

/**
 * Gezeichnetes Symbol als SVG.
 * @param {string} name Schlüssel in PATHS
 * @returns {string} SVG
 */
export function svgIcon(name){
  return `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" ${STROKE}>${PATHS[name]}</svg>`;
}

/**
 * Zeichen der Notenschrift als Inhalt eines Knopfs.
 * @param {string} text Zeichen aus GLYPHS (auch mehrere)
 * @param {boolean} [centered] Zeichen, die um die Mitte stehen (Vorzeichen, Anschlag, Schlüssel); Notenwerte stehen
 *   auf der Grundlinie und ragen nach oben
 * @returns {string} HTML
 */
export function glyph(text, centered = false){
  return `<span class="smufl${centered ? ' smufl-c' : ''}">${text}</span>`;
}
