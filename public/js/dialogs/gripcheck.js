/**
 * Dialog "Griffe prüfen" (Menü "Bereinigen"): Noten der Akkordspur, die nicht zu ihrem Akkord passen.
 */

import {chordNoteProblems, replaceChordNotes} from '../lib/chordcheck.js';
import {closeOverlay, openOverlay} from '../ui/overlay.js';
import {escapeHtml} from '../lib/format.js';
import {gripText} from '../lib/chordgrips.js';
import {loadChordCatalogOrEmpty} from '../lib/api.js';
import {trackName} from '../lib/notation.js';

/** @typedef {import('../pages/editor.js').NoteEditor} NoteEditor */

/**
 * Menü "Bereinigen", Eintrag "Griffe prüfen": zeigt, wo die Noten der Akkordspur nicht zu ihrem Akkord passen
 * (chordNoteProblems() in chordcheck.js), und ersetzt die angehakten durch den Griff des Akkords (ein Schritt für
 * "Rückgängig"). Ein Klick auf eine Taktzahl setzt den Cursor dorthin.
 * @param {NoteEditor} editor Bearbeitungsseite
 * @returns {Promise<void>}
 */
export async function checkChordNotes(editor) {
    const index = editor.contentTrack('chords');
    const staff = editor.score.tracks[index]?.staves[0];
    if (!staff || staff.tuning.length !== 6) {
        editor.toast('Die Akkordspur hat keine sechs Saiten, dort gibt es keine Griffe zu prüfen.');
        return;
    }
    const chordCatalog = await loadChordCatalogOrEmpty();
    const problems = chordNoteProblems(staff, chordCatalog);
    if (!problems.length) {
        editor.toast('Alle Noten der Akkordspur passen zu ihren Akkorden.');
        return;
    }
    const rows = problems.map((p, k) => {
        const bars = [...new Set(p.regions.map(r => r.bar))];
        const links = bars.slice(0, 30).map(b => `<button type="button" data-check-bar="${b}" title="Zu Takt ${b + 1}">${b + 1}</button>`).join(' ');
        const title = `${p.reason}. Gespielt: ${p.played}; ersetzen durch ${p.grip ? gripText(p.grip) : '– (kein Griff)'}`;
        return `
            <tr title="${escapeHtml(title)}">
                <td>
                    <input type="checkbox" data-check-row="${k}"${p.grip ? ' checked' : ' disabled'} aria-label="${escapeHtml(p.name)} ersetzen">
                </td>
                <td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.sounds || '–')}</td>
                <td class="check-bars">${links}${bars.length > 30 ? ` … (${bars.length})` : ''}</td>
            </tr>
        `;
    }).join('');
    openOverlay(`
        <h2>Griffe prüfen</h2>
        <p>In der Spur „${escapeHtml(trackName(editor.score.tracks[index]))}“ werden akkordfremde Noten gespielt:</p>
        <table class="ebar-table check-table"><thead><tr><th></th><th>Akkord</th><th>Klingt wie</th><th>Takte</th></tr>
            </thead><tbody>${rows}</tbody>
        </table>
        <div class="struct-actions">
            <button class="btn btn-primary" type="button" id="checkReplace">Griffe anpassen</button>
            <button class="btn" type="button" id="checkClose">Schließen</button>
        </div>
    `);
    const boxes = /** @type {HTMLInputElement[]} */ ([...document.querySelectorAll('[data-check-row]')]);
    const replace = /** @type {HTMLButtonElement} */ (document.getElementById('checkReplace'));
    const update = () => {
        replace.disabled = !boxes.some(b => b.checked);
    };
    boxes.forEach(b => b.addEventListener('change', update));
    update();
    document.getElementById('checkClose').addEventListener('click', closeOverlay);
    for (const link of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('[data-check-bar]'))) {
        link.addEventListener('click', () => {
            closeOverlay();
            editor.pos = {...editor.pos, track: index};
            editor.moveTo({bar: Number(link.dataset.checkBar), beat: 0});
        });
    }
    replace.addEventListener('click', () => {
        const keys = new Set(boxes.filter(b => b.checked).map(b => {
            const p = problems[Number(b.dataset.checkRow)];
            return `${p.name}|${p.sounds}`;
        }));
        closeOverlay();
        let count = 0;
        editor.change(() => {
            const current = editor.score.tracks[index].staves[0];
            const chosen = chordNoteProblems(current, chordCatalog).filter(p => keys.has(`${p.name}|${p.sounds}`));
            count = replaceChordNotes(editor.alphaTab, current, chosen);
        }, {label: 'Griffe ersetzt'});
        editor.toast(`${count} ${count === 1 ? 'Schlag' : 'Schläge'} mit dem Griff des Akkords ersetzt.`);
    });
}
