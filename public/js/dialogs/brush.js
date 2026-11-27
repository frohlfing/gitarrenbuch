/**
 * Dialog "Kopieren" (Pinsel, Alt+C): welche Eigenschaften der Schläge kopiert werden.
 */

import * as edit from '../lib/notation.js';
import {barsAndRest, beatTick, BRUSH_HINTS, BRUSH_KINDS, chosenBrushKinds} from '../pages/editor.js';
import {closeOverlay, openOverlay} from '../ui/overlay.js';

/** @typedef {import('../pages/editor.js').NoteEditor} NoteEditor */

/**
 * Dialog "Pinsel" (Alt+C): Welche Eigenschaften der Schläge am Cursor bzw. in der Auswahl kopiert werden.
 * @param {NoteEditor} editor Bearbeitungsseite
 * @returns {void}
 */
export function openBrushDialog(editor) {
    const beats = editor.brushBeats();
    const end = beats[beats.length - 1];
    const extent = barsAndRest(editor.score, beatTick(beats[0]), beatTick(end) + edit.beatTicks(end));
    openOverlay(`
        <h2>Kopieren</h2>
        <p>${extent} ausgewählt</p>
        <div class="brush-kinds">${BRUSH_KINDS.map(([key, label]) => `<label title="${BRUSH_HINTS[key]}">
            <input type="checkbox" value="${key}"${chosenBrushKinds().includes(key) ? ' checked' : ''}> ${label}</label>`).join('')}
        </div>
        <div class="struct-actions">
            <button class="btn btn-primary" type="button" id="brushOk">Kopieren</button>
            <button class="btn" type="button" id="brushCancel">Abbrechen</button>
        </div>
    `, true);
    const ok = /** @type {HTMLButtonElement} */ (document.getElementById('brushOk'));
    const boxes = /** @type {HTMLInputElement[]} */ ([...document.querySelectorAll('.brush-kinds input')]);
    const update = () => {
        ok.disabled = !boxes.some(b => b.checked);
    };
    boxes.forEach(b => b.addEventListener('change', update));
    update();
    document.getElementById('brushCancel').addEventListener('click', closeOverlay);
    ok.addEventListener('click', () => {
        editor.copyBrush(boxes.filter(b => b.checked).map(b => b.value));
        closeOverlay();
    });
    ok.focus();
}
