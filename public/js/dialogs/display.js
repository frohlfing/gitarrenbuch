/**
 * Dialog "Darstellung" (Player, Menü ⋮): Skalierung der Noten.
 */

import {closeOverlay, openOverlay} from '../ui/overlay.js';

/** @typedef {import('../pages/player.js').Player} Player */

/**
 * Dialog "Darstellung" aus dem Menü: Skalierung von Noten und Chords. Gilt für alle Songs; "Speichern" übernimmt sie
 * und merkt sie im Browser (localStorage, savePrefs() in pages/player.js), "Abbrechen" lässt alles, wie es war.
 * @param {Player} songPlayer Player der Playerseite
 * @returns {Promise<void>}
 */
export async function openDisplayDialog(songPlayer) {
    // Der Player ist schon geladen; import() liefert ihn sofort.
    const {SCALES} = await import('../pages/player.js');
    const {scale} = songPlayer.display;
    openOverlay(`
        <h2>Darstellung</h2>
        <div class="form-field">
            <label for="displayScale">Skalierung</label>
            <select id="displayScale">
                ${SCALES.map(s => `<option value="${s}"${s === scale ? ' selected' : ''}>${Math.round(s * 100)} %</option>`)
                    .join('')}
            </select>
        </div>
        <div class="struct-actions">
            <button class="btn btn-primary" id="displayOk" type="button">Speichern</button>
            <button class="btn" id="displayCancel" type="button">Abbrechen</button>
        </div>
    `, true);
    document.getElementById('displayCancel').addEventListener('click', closeOverlay);
    document.getElementById('displayOk').addEventListener('click', () => {
        songPlayer.setDisplay({
            scale: Number(/** @type {HTMLSelectElement} */ (document.getElementById('displayScale')).value),
        });
        closeOverlay();
    });
}
