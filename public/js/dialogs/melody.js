/**
 * Dialog "Melodie ableiten" (Knopf im Dialog "Spuren").
 */

import * as edit from '../lib/notation.js';
import {lyricsTrack, trackName} from '../lib/notation.js';
import {closeOverlay, isOverlayOpen, openOverlay, openStackedOverlay} from '../ui/overlay.js';
import {escapeHtml} from '../lib/format.js';

/** @typedef {import('../pages/editor.js').NoteEditor} NoteEditor */

/**
 * Dialog "Melodie ableiten" (Knopf im Dialog "Spuren", über ihm geöffnet): Hinweis, dass die höchsten Töne mit
 * Liedtext übernommen werden, der Schalter "Tonhöhe mithilfe der Audiospur korrigieren" (an, wenn der Song eine
 * Audiospur mit Sync-Punkten hat; sonst gesperrt, der Grund im Tooltip) und wie bei "Rhythmus ableiten" die
 * Radiobuttons "Spur neu anlegen" / "Spur überschreiben".
 * @param {NoteEditor} editor Bearbeitungsseite
 * @param {number} index Spur, aus der die Melodie kommt
 * @returns {void}
 */
export function openMelodyDialog(editor, index) {
    if (!lyricsTrack(editor.score)) {
        editor.toast('Der Song hat keinen Liedtext: Die Melodie richtet sich nach den Silben.');
        return;
    }
    const synced = editor.player.hasAudio && edit.playbackSyncPoints(editor.alphaTab, editor.score).length > 0;
    const why = !editor.player.hasAudio ? 'Keine Audiospur vorhanden.'
        : !synced ? 'Die Audiospur ist noch nicht mit den Noten synchronisiert.' : '';
    const html = `
        <h2>Melodie ableiten aus „${escapeHtml(trackName(editor.score.tracks[index]))}“</h2>
        <p class="rh-hint">Höchste Töne mit Liedtext werden übernommen.</p>
        <label class="rh-switch md-switch" title="${escapeHtml(why)}">
            <input type="checkbox" role="switch" class="switch" id="mdAudio" ${synced ? 'checked' : 'disabled'}> Tonhöhe mithilfe der Audiospur korrigieren
        </label>
        <div class="rh-target" role="radiogroup" aria-label="Wohin die Melodie kommt">
            <label><input type="radio" name="mdTarget" value="new" checked> Spur neu anlegen</label>
            <label><input type="radio" name="mdTarget" value="overwrite"> Spur überschreiben</label>
        </div>
        <div class="struct-actions">
            <button class="btn btn-primary" type="button" id="mdApply">Übernehmen</button>
            <button class="btn" type="button" id="mdCancel">Abbrechen</button>
        </div>
    `;
    if (isOverlayOpen()) openStackedOverlay(html);
    else openOverlay(html);
    document.getElementById('mdCancel').addEventListener('click', closeOverlay);
    document.getElementById('mdApply').addEventListener('click', () => {
        const audio = (/** @type {HTMLInputElement} */ (document.getElementById('mdAudio'))).checked;
        const overwrite = (/** @type {?HTMLInputElement} */ (document.querySelector('input[name="mdTarget"]:checked')))
            ?.value === 'overwrite';
        closeOverlay();
        void editor.deriveMelody(index, audio, overwrite);
    });
}
