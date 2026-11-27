/**
 * Symbole der Oberfläche, selbst gezeichnet als SVG (24 × 24, in currentColor), Zeichen der Notenschrift Bravura
 * (SMuFL, SIL Open Font License), die alphaTab mitbringt, und der Kasten für einen Befehl zum Kopieren. Speichern,
 * Rückgängig und Wiederholen sind aus den Material Icons (Apache 2.0).
 */

import {escapeHtml} from '../lib/format.js';

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
    // Triolen-Feeling, viewBox 0 0 52 24 (svgIcon(name, 52, 60), die Fahne der Triole reicht bis 50): zwei Achtel =
    // zwei Achtel gebalkt (gerade) bzw. = Triole aus Viertel und Achtel (Shuffle)
    feelStraight: '<g fill="currentColor" stroke="none"><ellipse cx="5" cy="18" rx="3" ry="2.2"/>'
        + '<ellipse cx="16" cy="18" rx="3" ry="2.2"/><ellipse cx="35" cy="18" rx="3" ry="2.2"/>'
        + '<ellipse cx="44" cy="18" rx="3" ry="2.2"/></g>'
        + '<g stroke-width="1.6"><path d="M7.8 18V6M18.8 18V6M37.8 18V6M46.8 18V6"/>'
        + '<path d="M7.8 6q4 1 4 6M18.8 6q4 1 4 6"/><path d="M24.5 10.5h6M24.5 14.5h6"/></g>'
        + '<path d="M37.8 6.8h9" stroke-width="3"/>',
    feelShuffle: '<g fill="currentColor" stroke="none"><ellipse cx="5" cy="19" rx="3" ry="2.2"/>'
        + '<ellipse cx="14" cy="19" rx="3" ry="2.2"/><ellipse cx="33" cy="19" rx="3" ry="2.2"/>'
        + '<ellipse cx="43" cy="19" rx="3" ry="2.2"/>'
        + '<text x="40.5" y="7" font-size="7" font-weight="700" text-anchor="middle" font-family="sans-serif">3</text></g>'
        + '<g stroke-width="1.6"><path d="M7.8 19V8M16.8 19V8M35.8 19V10M45.8 19V10"/>'
        + '<path d="M45.8 10q4 1 2.5 7"/><path d="M23 11h6M23 15h6"/>'
        + '<path d="M32 8.5V4h6M43 4h5v4.5" stroke-width="1.2"/></g>'
        + '<path d="M7.8 8.8h9" stroke-width="3"/>',
    // Metrum umschreiben: Metronom (Gehäuse als Trapez, Pendel schräg mit Gewicht)
    timing: '<path d="M8.5 3h7l4 18h-15z"/><path d="M6 16.5h12"/><path d="M12 16.5 17.5 5"/>'
        + '<circle cx="15.4" cy="9.4" r="1.4" fill="currentColor"/>',
    // Transponieren: Pfeil nach oben und nach unten.
    transpose: '<path d="M7 20V5M3 9l4-4 4 4M17 4v15M13 15l4 4 4-4"/>',
    // Sync-Punkt setzen bzw. löschen: Marker der Wellenform (Linie mit Fähnchen) mit Plus bzw. Minus
    syncAdd: '<path d="M5 3v18M5 4h7v5H5"/><path d="M18 12v8M14 16h8"/>',
    syncRemove: '<path d="M5 3v18M5 4h7v5H5"/><path d="M14 16h8"/>',
    // Sync optimieren: zwei Marker bleiben, der dazwischen (gestrichelt) fällt weg
    syncOptimize: '<path d="M4 3v18M4 4h4v4H4M20 3v18M20 4h-4v4h4"/><path d="M12 5v14" stroke-dasharray="2 3"/>',
    // Tempo in der Partitur angeben: Marker der Wellenform mit Viertelnote
    tempoSet: '<path d="M4 3v18M4 4h6v5H4"/>'
        + '<ellipse fill="currentColor" stroke="none" cx="15" cy="17.5" rx="3.4" ry="2.5" transform="rotate(-20 15 17.5)"/>'
        + '<path d="M18 17V5"/>',
    // Tempoangabe korrigieren: Viertelnote "= " mit Häkchen
    tempoFix: '<ellipse fill="currentColor" stroke="none" cx="6" cy="17.5" rx="3.4" ry="2.5" transform="rotate(-20 6 17.5)"/>'
        + '<path d="M9 17V4"/><path d="M12.5 9.5h4M12.5 13.5h4"/><path d="M15.5 19l2.5 2.5 4.5-6" stroke-width="1.8"/>',
    // Lupe mit Plus bzw. Minus
    zoomIn: '<circle cx="10" cy="10" r="6.5"/><path d="M15 15l6 6M7 10h6M10 7v6"/>',
    zoomOut: '<circle cx="10" cy="10" r="6.5"/><path d="M15 15l6 6M7 10h6"/>',
    // Achtelnote (Melodie): Hals mit Fähnchen und gefüllter Notenkopf
    melodyNote: '<path d="M15 3v14M15 3q1 4 5 6"/><ellipse fill="currentColor" stroke="none" cx="11" cy="17.5" rx="4.2" ry="3"'
        + ' transform="rotate(-20 11 17.5)"/>',
    // Betonung (Akzent): kurzes, kräftiges ">"
    accent: '<path stroke-width="2.6" d="M7 7.5l10 4.5-10 4.5"/>',
    // Ausblenden: Decrescendo-Gabel mit leicht geschwungenen Linien wie in alphaTab, schließt sich nach rechts
    fadeOut: '<path d="M3 5Q11 10 21 12M3 19Q11 14 21 12"/>',
    // Slash-Note (Rhythmus ohne Tonhöhe): Hals und schräger Notenkopf
    slashNote: '<path d="M16 3v14"/><path fill="currentColor" stroke="none" d="M7 21h3.5l6-5.5H13z"/>',
    // Bereinigen: Besen (Stiel schräg nach oben rechts, Borsten unten links)
    clean: '<path d="M20.5 3.5L13 11"/><path d="M10.5 9.5l4 4c-.6 3-2.6 5.4-5 6.5-2.6-1.2-5-3.6-6.5-6.5 2.6-.6 5-2 7.5-4z"/>'
        + '<path d="M7 18.5l2.5-3M4.6 16.4l3-2.4"/>',
    // Silbe ziehen: "T" mit Pfeil zum Schlag hin, von links ("T→") bzw. von rechts ("←T")
    syllableFromLeft: '<text x="6.5" y="17" font-size="14" font-weight="700" text-anchor="middle" fill="currentColor"'
        + ' stroke="none" font-family="sans-serif">T</text><path d="M13 12h8M18 9l3 3-3 3"/>',
    syllableFromRight: '<path d="M3 12h8M6 9l-3 3 3 3"/><text x="17.5" y="17" font-size="14" font-weight="700"'
        + ' text-anchor="middle" fill="currentColor" stroke="none" font-family="sans-serif">T</text>',
    // Akkord erkennen: Zauberstab mit Funken
    chordDetect: '<path d="M4 20 14 10" stroke-width="2.2"/><path d="M17 3v3M17 9v3M13.5 6.5h3M17.5 6.5h3"/>'
        + '<path d="M8 4v2M7 5h2M20 15v2M19 16h2" stroke-width="1.4"/>',
    // Abschnitte: Liste mit Marken vor den Zeilen
    sections: '<path d="M10 6h10M10 12h10M10 18h10"/><path d="M4 4.5h3v3H4zM4 10.5h3v3H4zM4 16.5h3v3H4z"/>',
    // Neu laden: Kreispfeil
    reload: '<path d="M20 12a8 8 0 1 1-2.4-5.7M20 4v5h-5"/>',
    // Uploads: Büroklammer.
    upload: '<path d="M20 11.5l-8 8a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9.7 17.2a1.7 1.7 0 0 1-2.4-2.4L15 7"/>',
    // Ändern: Stift.
    edit: '<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1zM14.5 6.5l3 3"/>',
    // Papierkorb.
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
    // Verlauf: Uhr mit Pfeil gegen den Uhrzeigersinn.
    history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5M3.5 3.5v5h5M12 7.5V12l3 2"/>',
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
    // Auftakt: Startflagge (Stange mit wehender Fahne)
    anacrusis: '<path d="M5 21V3.5"/><path d="M5 4.5q3.5-2 7 0t7 0v8.5q-3.5 2-7 0t-7 0"/>',
    // Hammer-on / Pull-off: "H/P" über dem Bogen
    hammer: '<g fill="currentColor" stroke="none" font-family="sans-serif" font-size="10" text-anchor="middle">'
        + '<text x="5.5" y="12" font-weight="700">H</text><text x="12" y="12">/</text>'
        + '<text x="18.5" y="12" font-weight="700">P</text></g><path d="M4 21q8-9 16 0"/>',
    // Slide: "sl." über dem Bogen, wie beim Hammer-on
    slide: '<text x="12" y="12" fill="currentColor" stroke="none" font-family="sans-serif" font-size="10.5"'
        + ' font-weight="700" text-anchor="middle">sl.</text><path d="M4 21q8-9 16 0"/>',
    // Bend: waagerecht, dann nach oben gebogen mit Pfeilspitze
    bend: '<path d="M3 19h6q6 0 7-12"/><path d="m12.5 9.5 3.5-4 3 4.5"/>',
    // Vibrato: Wellenlinie
    vibrato: '<path d="M2 12q2.5-5 5 0t5 0 5 0 5 0"/>',
    // Ghost-Note: Notenkopf in runden Klammern wie im Tab
    ghost: '<path d="M7.5 5q-4 7 0 14M16.5 5q4 7 0 14"/>'
        + '<ellipse cx="12" cy="12" rx="3" ry="2.3" fill="currentColor" stroke="none" transform="rotate(-20 12 12)"/>',
    // Saite dämpfen: Kreuz wie im Tab
    dead: '<path d="M6 6l12 12M18 6 6 18"/>',
    // Tonleiterschritt höher / tiefer: Pfeil mit drei Treppenstufen (Tonleiter)
    scaleUp: '<path d="M6 20V5M2 9l4-4 4 4"/><path d="M12 20h3v-4h3v-4h3v-4" stroke-width="1.6"/>',
    scaleDown: '<path d="M6 4v15M2 15l4 4 4-4"/><path d="M12 4h3v4h3v4h3v4" stroke-width="1.6"/>',
    // Akkordton höher / tiefer: Pfeil mit drei übereinander stehenden Notenköpfen (Dreiklang)
    chordUp: '<path d="M6 20V5M2 9l4-4 4 4"/><g fill="currentColor" stroke="none">'
        + '<ellipse cx="17" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="12" rx="3" ry="2"/>'
        + '<ellipse cx="17" cy="6" rx="3" ry="2"/></g>',
    chordDown: '<path d="M6 4v15M2 15l4 4 4-4"/><g fill="currentColor" stroke="none">'
        + '<ellipse cx="17" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="12" rx="3" ry="2"/>'
        + '<ellipse cx="17" cy="6" rx="3" ry="2"/></g>',
    // Anschlagpfeile: Abwärts (von der tiefen zur hohen Saite) steht in den Noten als Pfeil nach oben
    brushDown: '<path d="M12 21V4M7 9l5-5 5 5"/>',
    brushUp: '<path d="M12 3v17M7 15l5 5 5-5"/>',
    // Arpeggio: Wellenlinie senkrecht mit Pfeilspitze, Richtung wie bei den Anschlagpfeilen
    // Pinsel (Eigenschaften kopieren) und Farbroller (übertragen).
    paintBrush: '<path d="M20 3.5 11.5 12"/><path d="M10 10.5l3.5 3.5c-.3 3.3-3 6.5-9.5 6.5 0-6.3 3-9.3 6-10z"/>',
    paintRoller: '<rect x="3" y="3" width="14" height="6" rx="1.5"/><path d="M17 6h3v5.5h-8V15"/><rect x="10.5" y="15"'
        + ' width="3" height="6" rx="1"/>',
    arpeggioDown: '<path d="M12 21q-3-2 0-4t0-4 0-4 0-5"/><path d="M8 8l4-4 4 4"/>',
    arpeggioUp: '<path d="M12 3q3 2 0 4t0 4 0 4 0 5"/><path d="M8 16l4 4 4-4"/>',
    copy: '<path fill="currentColor" stroke="none" d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11'
        + 'a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"/>',
    // Spuren: drei Zeilen mit Punkt; Leadsheet: Blatt mit Zeilen
    tracks: '<path d="M10 6h10M10 12h10M10 18h10"/><path fill="currentColor" d="M5 6m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M5 12m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M5 18m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0"/>',
    leadsheet: '<path d="M6 3h8l4 4v14H6zM14 3v4h4M9 11h6M9 14h6M9 17h4"/>',
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
 * @param {number} [width] Breite der viewBox (Höhe 24); die Symbole sind 24 breit, das Triolen-Feeling 52
 * @param {number} [pixels] Breite in Pixeln; ohne Angabe im Verhältnis der viewBox
 * @returns {string} SVG
 */
export function svgIcon(name, width = 24, pixels = 0) {
    const height = width > 24 ? 26 : 20; // das breite Triolen-Feeling braucht Platz, damit man es erkennt
    return `<svg viewBox="0 0 ${width} 24" width="${pixels || width * height / 24}" height="${height}" aria-hidden="true" ${STROKE}>${PATHS[name]}</svg>`;
}

/**
 * Befehl zum Kopieren: Code mit Knopf "Befehl kopieren" (Klick siehe copyCommand()).
 * @param {string} command Befehl
 * @returns {string} HTML
 */
export function commandBox(command) {
    return `<div class="command-box"><code>${escapeHtml(command)}</code>
      <button class="ebtn" type="button" data-copy="${escapeHtml(command)}" title="Befehl kopieren"
        aria-label="Befehl kopieren">${svgIcon('copy')}</button></div>`;
}

/**
 * Kopiert den Befehl eines Knopfs (data-copy) in die Zwischenablage; der Knopf zeigt kurz "Kopiert".
 * @param {HTMLElement} button Knopf aus commandBox()
 * @returns {void}
 */
export function copyCommand(button) {
    void navigator.clipboard.writeText(button.dataset.copy).then(() => {
        button.setAttribute('aria-pressed', 'true');
        button.title = 'Kopiert';
        window.setTimeout(() => {
            button.setAttribute('aria-pressed', 'false');
            button.title = 'Befehl kopieren';
        }, 1500);
    });
}

/**
 * Zeichen der Notenschrift als Inhalt eines Knopfs.
 * @param {string} text Zeichen aus GLYPHS (auch mehrere)
 * @param {boolean} [centered] Zeichen, die um die Mitte stehen (Vorzeichen, Anschlag, Schlüssel); Notenwerte stehen
 *   auf der Grundlinie und ragen nach oben
 * @param {string} [extra] weitere CSS-Klassen (z. B. "smufl-pickdown", siehe css/base.css)
 * @returns {string} HTML
 */
export function glyph(text, centered = false, extra = '') {
    return `<span class="smufl${centered ? ' smufl-c' : ''}${extra ? ' ' + extra : ''}">${text}</span>`;
}
