/**
 * Dialog "Akkorde nach …" bzw. "Liedtext nach …" (Dialog "Spuren"): Akkorde oder Liedtext in eine andere Spur ziehen.
 */

import * as edit from '../lib/notation.js';
import {chordsTrack, lyricsTrack, parseScore, trackName} from '../lib/notation.js';
import {closeOverlay, openOverlay} from '../ui/overlay.js';
import {escapeHtml} from '../lib/format.js';

/** @typedef {import('../pages/editor.js').NoteEditor} NoteEditor */

/**
 * Stellt im Dialog "Spuren" um, welche Spur Akkorde bzw. Text trägt: Sie ziehen ganz in die gewählte Spur um
 * (moveContent() in notation.js). Probehalber auf frisch gelesene Noten gerechnet: Ändert sich dabei nichts an
 * der Lage und fällt nichts weg, geschieht es ohne Rückfrage; sonst fragt ein Dialog, ob Schläge eingefügt
 * (geteilt und angebunden, klingt gleich) oder Akkorde bzw. Silben auf den Schlag davor gesetzt werden sollen.
 * Ohne Akkorde bzw. Text merkt sich der Editor nur die Wahl (contentChoice).
 * @param {NoteEditor} editor Bearbeitungsseite
 * @param {'chords'|'lyrics'} kind Akkorde oder Text
 * @param {number} index Zielspur
 * @returns {void}
 */
export function moveContentTo(editor, kind, index) {
    const chords = kind === 'chords';
    const has = chords ? chordsTrack(editor.score) : lyricsTrack(editor.score);
    const name = `„${trackName(editor.score.tracks[index])}“`;
    if (!has) {
        editor.contentChoice[kind] = index;
        editor.toast(chords ? `Neue Akkorde kommen in ${name}.` : `Der Liedtext kommt in ${name}.`);
        editor.renderSongPanels();
        return;
    }

    /** @param {import('../lib/notation.js').MoveMode} mode @returns {import('../lib/notation.js').MoveResult} */
    const trial = mode => edit.moveContent(editor.alphaTab, parseScore(editor.alphaTab, editor.tex), kind, index, mode);
    const shift = trial('shift');
    const insert = trial('insert');

    /** @param {import('../lib/notation.js').MoveMode} mode @returns {void} */
    const apply = mode => {
        let result = shift;
        editor.change(() => {
            result = edit.moveContent(editor.alphaTab, editor.score, kind, index, mode);
        }, {label: `${chords ? 'Akkorde' : 'Liedtext'} nach ${name} verschoben`});
        editor.toast(`${chords ? 'Akkorde' : 'Liedtext'} jetzt in ${name}`
            + (result.split ? `; ${result.split} ${result.split === 1 ? 'Schlag' : 'Schläge'} geteilt` : '')
            + (result.shifted ? `; ${result.shifted} auf den Schlag davor gesetzt` : '') + '.');
    };
    if (!shift.shifted && !shift.lost && !shift.dropped) {
        apply('shift');
        return;
    }
    const noun = chords ? ['Akkord', 'Akkorde'] : ['Silbe', 'Silben'];
    const n = (count, [one, more]) => `${count} ${count === 1 ? one : more}`;
    const lost = r => r.lost ? ` ${n(r.lost, noun)} ${r.lost === 1 ? 'fällt' : 'fallen'} weg: Dort steht in ${name} `
        + 'schon ein anderer Akkord.' : '';
    const facts = [
        shift.exact ? `${n(shift.exact, noun)} ${shift.exact === 1 ? 'passt' : 'passen'} auf einen Schlag von ${name}.`
            : '',
        shift.shifted ? `${n(shift.shifted, noun)} ${shift.shifted === 1 ? 'liegt' : 'liegen'} dort mitten in einem `
            + 'Schlag.' : '',
        shift.dropped ? `${n(shift.dropped, noun)} in anderen Spuren ${shift.dropped === 1 ? 'wird' : 'werden'} gelöscht `
            + '(der Text steht danach nur noch in einer Spur).' : '',
    ].filter(Boolean);
    const options = shift.shifted ? [
        ['insert', 'Schläge einfügen', `Der klingende Schlag wird geteilt und angebunden, es klingt gleich `
        + `(${n(insert.split, ['Stelle', 'Stellen'])}).`
        + (insert.shifted ? ` ${n(insert.shifted, noun)} lassen sich nicht teilen (Triole) und kommen auf den Schlag `
            + 'davor.' : '') + lost(insert)],
        ['shift', 'Auf den Schlag davor', `${chords ? 'Der Akkord' : 'Die Silbe'} rutscht nach vorne auf den klingenden `
        + `Schlag.${chords ? '' : ' Silben auf einem Schlag werden zusammengefasst.'}` + lost(shift)],
    ] : [['shift', 'Verschieben', lost(shift).trim()]];
    openOverlay(`
        <h2>${chords ? 'Akkorde' : 'Liedtext'} nach ${escapeHtml(name)}</h2>
        <div class="struct-form">
            ${facts.map(f => `<p>${escapeHtml(f)}</p>`).join('')}
            ${options.map(([mode, label, hint]) => `
            <div class="move-option">
                <button class="btn${mode === options[0][0] ? ' btn-primary' : ''}" type="button" data-move="${mode}">${escapeHtml(label)}</button><span class="hint">${escapeHtml(hint)}</span></div>`)
                    .join('')}
            <div class="struct-actions"><button class="btn" type="button" data-move="">Abbrechen</button></div>
        </div>
    `);
    for (const button of document.querySelectorAll('[data-move]')) {
        button.addEventListener('click', () => {
            const mode = (/** @type {HTMLElement} */ (button)).dataset.move;
            closeOverlay();
            if (mode) apply(/** @type {import('../lib/notation.js').MoveMode} */ (mode));
            else editor.renderSongPanels();
        });
    }
}
