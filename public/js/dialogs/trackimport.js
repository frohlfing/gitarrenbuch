/**
 * Dialog "Spur aus Guitar-Pro-Datei importieren" (Dialog "Spuren").
 */

import * as edit from '../lib/notation.js';
import {describeScoreLoss, parseScore, readGpFile, trackName} from '../lib/notation.js';
import {closeOverlay, openOverlay} from '../ui/overlay.js';
import {escapeHtml} from '../lib/format.js';

/** @typedef {import('../pages/editor.js').NoteEditor} NoteEditor */

/**
 * Übernimmt eine Spur aus einer anderen Guitar-Pro-Datei (Knopf "Spur aus Guitar-Pro-Datei importieren"): Die Datei
 * wird wie beim Import gelesen und bereinigt (readGpFile() in notation.js), dann fragt ein Dialog nach der Spur und den
 * Takten, ab denen sie passt (der Song kann z. B. ein kürzeres Intro haben). Die Spur kommt ans Ende, ohne Akkorde und
 * Text (edit.importTrack()).
 * @param {NoteEditor} editor Bearbeitungsseite
 * @param {File} file gewählte Datei
 * @returns {Promise<void>}
 */
export async function importTrackFile(editor, file) {
    let tex = '';
    let loss = null;
    try {
        ({tex, loss} = await readGpFile(file));
    } catch (err) {
        editor.toast(err.message);
        return;
    }
    const parse = () => parseScore(editor.alphaTab, tex);
    const source = parse();
    const bars = editor.score.masterBars.length;
    openOverlay(`
        <h2>Spur aus ${escapeHtml(file.name)}</h2>
        <form class="struct-form" id="trackImportForm">
            <div class="form-field"><label for="trackImportTrack">Spur</label>
                <select id="trackImportTrack">${source.tracks.map(t => `<option value="${t.index}">${escapeHtml(trackName(t))}
                    (${t.staves[0].bars.length} Takte)</option>`).join('')}</select>
            </div>
            <div class="form-field"><label for="trackImportFrom">Ab Takt der Datei</label>
                <input type="number" id="trackImportFrom" min="1" max="${source.masterBars.length}" value="1">
            </div>
            <div class="form-field"><label for="trackImportAt">Auf Takt des Songs</label>
                <input type="number" id="trackImportAt" min="1" max="${bars}" value="1">
            </div>
            <p class="hint">Taktart, Tempo, Vorzeichen und Abschnitte bleiben die des Songs; Takte davor werden Pausen, was über das
                Ende (${bars} Takte) hinausgeht, fällt weg. Akkorde und Text der Datei kommen nicht mit.
            </p>
            ${loss?.length ? `<p class="hint">${escapeHtml(describeScoreLoss(loss))}</p>` : ''}
            <div class="struct-actions">
                <button class="btn btn-primary" type="submit">Übernehmen</button>
                <button class="btn" type="button" id="trackImportCancel">Abbrechen</button>
            </div>
        </form>
    `);
    document.getElementById('trackImportCancel').addEventListener('click', closeOverlay);
    document.getElementById('trackImportForm').addEventListener('submit', e => {
        e.preventDefault();
        const value = id => Number(/** @type {HTMLInputElement} */ (document.getElementById(id)).value);
        const index = value('trackImportTrack');
        const from = Math.max(1, value('trackImportFrom') || 1) - 1;
        const at = Math.min(bars, Math.max(1, value('trackImportAt') || 1)) - 1;
        closeOverlay();
        let result = {bars: 0, cut: 0, misfit: [], octaves: 0, misses: 0};
        // Frisch gelesen: importTrack() hängt die Takte der Quelle um.
        editor.changeTracks(score => {
                result = edit.importTrack(editor.alphaTab, score, parse().tracks[index], from, at);
            },
            editor.score.tracks.length, 0, 'Spur aus Guitar-Pro-Datei übernommen');
        const misfit = result.misfit.length ? `; Länge passt nicht zur Taktart in Takt `
            + `${result.misfit.slice(0, 8).map(i => i + 1).join(', ')}${result.misfit.length > 8 ? ' …' : ''}` : '';
        editor.toast(`Spur „${trackName(editor.score.tracks.at(-1))}“ übernommen: ${result.bars} Takte`
            + (result.cut ? `, ${result.cut} am Ende weggefallen` : '') + misfit
            + (result.octaves ? `; ${result.octaves} Noten für den Capo eine Oktave höher` : '')
            + (result.misses ? `; ${result.misses} Noten passten nicht ins Tuning des Songs` : '') + '.');
    });
}
