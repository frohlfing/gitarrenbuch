/**
 * Die Ansicht "Text & Akkorde" als HTML (Inhalt aus buildTextModel() in lib/textmodel.js).
 */

import {chordDiagramSvg} from './chorddiagram.js';
import {escapeHtml} from '../lib/format.js';

/** @typedef {import('../lib/textmodel.js').LinePart} LinePart */
/** @typedef {import('../lib/textmodel.js').TextLine} TextLine */
/** @typedef {import('../lib/textmodel.js').TextModel} TextModel */

// noinspection JSUnusedGlobalSymbols: für Leadsheet und Druck, noch ohne Aufrufer

/**
 * Alle Griffbilder des Songs in der Reihenfolge des ersten Anschlags. Für Leadsheet und Druck gedacht; der Player
 * zeigt nur den aktuellen Akkord.
 * @param {TextModel} model Inhalt aus buildTextModel()
 * @returns {string} HTML, leer ohne Griffbilder
 */
export function renderChordDiagrams(model) {
    return model.chords.filter(c => c.grip).map(c => chordDiagramSvg(c.name, c.grip)).join('');
}

/**
 * Zeichnet die Ansicht als HTML: je Abschnitt die Zeilen (die Griffbilder darüber zeichnet renderChordDiagrams()).
 * Jede Silbe steht mit ihren Akkorden in einem eigenen Block (Akkord oben, Silbe unten), so sitzt der Akkord auch in
 * Proportionalschrift genau über ihr, und lange Zeilen brechen auf schmalen Bildschirmen zwischen den Silben um. Jeder
 * Teil trägt seine Zeit (data-t, Ticks in Abspielreihenfolge), ein Taktanfang zusätzlich data-bar; daran hebt der
 * Player beim Abspielen den aktuellen Takt und die aktuelle Silbe hervor. Taktzeilen sehen aus wie die
 * Akkordzeile einer Textzeile, nur ohne Text. Ein Abschnitt kann einen Zusatz neben dem Namen tragen (note, z. B.
 * "wie oben" oder "2×" auf dem Leadsheet, siehe collapseSections() in js/ui/sheetview.js).
 * @param {{sections: {name: string, lines: TextLine[], note?: string}[]}} model Inhalt aus buildTextModel()
 * @returns {string} HTML
 */
export function renderTextView(model) {
    if (!model.sections.length) return '<p class="empty">Dieser Song hat weder Text noch Akkorde.</p>';
    const barline = '<span class="tv-barline">|</span>';

    /** @type {(p: LinePart) => string} */
    const chordHtml = p => (p.bar ? barline : '') + escapeHtml(p.chords.join(' '));
    const line = l => {
        if (l.hint !== undefined) return `<div class="tv-line tv-hint">${escapeHtml(l.hint)}</div>`;
        const parts = l.bars ? l.bars.map(b => ({t: b.t, text: '', bar: true, chords: b.chords})) : l.parts;
        // Ein Strich schließt die Zeile, wenn mit ihr ein Takt endet.
        const close = l.closed ? `<span class="tv-part tv-empty"><span class="tv-chord">${barline}</span><span class="tv-syl"> </span></span>` : '';
        return `<div class="tv-line${l.bars ? ' tv-barrow' : ''}">${parts.map(p => {
            // Silben mit Bindestrich gehören zum nächsten Wort: ohne Leerzeichen anschließen. Dehnt ein Akkord oder
            // Taktstrich die Silbe, füllt ein Strich die Lücke im Wort (tv-stretch).
            const joined = p.text.endsWith('-');
            // Ein Takt ohne Silbe braucht trotzdem die Höhe einer Textzeile, sonst rutscht sein Akkord nach unten.
            const word = joined ? p.text.slice(0, -1) : p.text ? p.text + ' ' : ' ';
            const classes = ['tv-part', joined && (p.chords.length || p.bar) ? 'tv-stretch' : '', p.text ? '' : 'tv-empty'];
            return `<span class="${classes.filter(Boolean).join(' ')}" data-t="${p.t}"${p.bar ? ' data-bar' : ''}>`
                + `<span class="tv-chord">${chordHtml(p)}</span>`
                + `<span class="tv-syl">${escapeHtml(word)}</span></span>`;
        }).join('')}${close}</div>`;
    };
    return `
    ${model.sections.map(s => `
      <section class="tv-section">
        ${s.name ? `<h3>${escapeHtml(s.name)}${s.note ? ` <span class="tv-note">${escapeHtml(s.note)}</span>` : ''}</h3>`
        : ''}
        ${s.lines.map(line).join('')}
      </section>`).join('')}
  `;
}
