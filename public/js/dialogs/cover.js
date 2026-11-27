/**
 * Dialog "Cover" (aus den Stammdaten): Cover suchen, eigenes Bild hochladen oder löschen.
 */

import {byId, formField} from '../ui/form.js';
import {bindDropzone} from './import.js';
import {storeSong} from '../lib/songs.js';
import {closeOverlay, dialog, openOverlay, openStackedOverlay, overlay} from '../ui/overlay.js';
import {deleteCover, searchCovers, setCover, uploadCover} from '../lib/api.js';
import {escapeHtml} from '../lib/format.js';

/** @typedef {import('../lib/api.js').Song} Song */

/**
 * Kantenlänge, auf die die kürzere Seite eigener Cover vor dem Hochladen höchstens verkleinert wird (wie bei
 * Deezer/iTunes). Der Server schneidet das Bild danach mittig auf COVER_MAX_SIZE × COVER_MAX_SIZE zu.
 */
const COVER_MAX_SIZE = 500;

/**
 * Wandelt ein beliebiges Bild im Browser in ein JPEG um und verkleinert es so, dass die kürzere Seite höchstens
 * COVER_MAX_SIZE misst (kleinere Uploads; das Quadrat schneidet der Server aus, siehe crop_cover() in
 * api/lib/coverstore.php).
 * @param {File} file Bilddatei (JPEG, PNG, WebP, …)
 * @returns {Promise<Blob>} JPEG
 */
async function toCoverJpeg(file) {
    const bitmap = await createImageBitmap(file).catch(() => {
        throw new Error('Die Datei ist kein lesbares Bild.');
    });
    const scale = Math.min(1, COVER_MAX_SIZE / Math.min(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return new Promise((resolve, reject) => canvas.toBlob(
        blob => blob ? resolve(blob) : reject(new Error('Bild konnte nicht umgewandelt werden.')),
        'image/jpeg',
        0.88
    ));
}

/**
 * Dialog zum Ändern des Covers: Treffer von Deezer und iTunes zur Auswahl, eigenes Bild hochladen, Cover entfernen.
 * Die Suche startet sofort mit Interpret und Titel des Songs; beides lässt sich für eine neue Suche ändern.
 * @param {Song} song Song
 * @param {(saved: Song) => void} onSaved wird nach jeder Änderung aufgerufen
 * @param {{artist: ?string, title: string}} [query] Vorbelegung der Suche, sonst Interpret und Titel des Songs
 * @returns {void}
 */
export function openCoverForm(song, onSaved, query = song) {
    // Aus einem offenen Formular heraus über diesem öffnen, damit dessen Eingaben erhalten bleiben.
    const open = overlay.classList.contains('open') ? openStackedOverlay : openOverlay;
    open(`
        <h2>Cover</h2>
        <div id="formError"></div>
        <div class="form-grid">
            ${formField('coverArtist', 'Interpret', query.artist)}
            ${formField('coverTitle', 'Titel', query.title)}
        </div>
        <div class="btn-row"><button class="btn" id="coverSearchBtn" type="button">Suchen</button></div>
        <div class="cover-results" id="coverResults"></div>
        <div class="form-field">
            <label for="coverInput">Eigenes Bild</label>
            <label class="dropzone" id="dropzone">
                <input type="file" id="coverInput" accept="image/*">
                <span>Bild hierherziehen oder tippen zum Auswählen</span>
            </label>
            <a class="field-link" id="coverWebSearch" href="#" target="_blank" rel="noopener">Bilder bei DuckDuckGo suchen</a>
        </div>
        <div class="btn-row">
            ${song.files.includes('cover')
                ? '<button class="btn btn-danger" id="coverDeleteBtn" type="button">Cover entfernen</button>'
                : ''}
            <button class="btn" id="cancelBtn" type="button">Schließen</button>
        </div>
    `);

    const results = byId('coverResults');

    /**
     * Führt eine Änderung aus, übernimmt das Ergebnis und schließt den Dialog; Fehler erscheinen im Dialog.
     * @param {() => Promise<Song>} action API-Aufruf
     * @returns {Promise<void>}
     */
    const apply = async action => {
        byId('formError').innerHTML = '';
        dialog.classList.add('busy');
        try {
            const saved = await action();
            storeSong(saved);
            closeOverlay();
            onSaved(saved);
        } catch (err) {
            byId('formError').innerHTML = `<div class="error-box">${escapeHtml(err.message)}</div>`;
        } finally {
            dialog.classList.remove('busy');
        }
    };

    /**
     * Sucht mit den Werten aus den Feldern und zeigt die Treffer.
     * @returns {Promise<void>}
     */
    const search = async () => {
        const title = byId('coverTitle').value.trim();
        if (!title) return;
        results.innerHTML = '<p class="hint">Suche läuft &hellip;</p>';
        try {
            const hits = await searchCovers(byId('coverArtist').value.trim(), title);
            results.innerHTML = hits.length
                ? hits.map((h, i) => `
                    <button class="cover-hit" type="button" data-hit="${i}" title="${escapeHtml(`${h.artist} – ${h.album}`)}">
                        <img src="${escapeHtml(h.preview)}" alt="" loading="lazy">
                        <span>${escapeHtml(h.album)}</span>
                        <small>${h.source === 'deezer' ? 'Deezer' : 'iTunes'}</small>
                    </button>
                `).join('')
                : '<p class="hint">Keine Treffer.</p>';
            results.onclick = e => {
                const btn = (/** @type {HTMLElement} */ (e.target)).closest('[data-hit]');
                if (btn) void apply(() => setCover(song.slug, hits[Number(btn.dataset.hit)].url));
            };
        } catch (err) {
            results.innerHTML = `<p class="hint">${escapeHtml(err.message)}</p>`;
        }
    };

    // Weitere Bilder: DuckDuckGo-Bildersuche nach Interpreten und Titel; das gefundene Bild lädt man als eigenes Bild
    // hoch.
    const webSearch = /** @type {HTMLAnchorElement} */ (/** @type {*} */ (byId('coverWebSearch')));
    const updateWebSearch = () => {
        const words = [byId('coverArtist').value.trim(), byId('coverTitle').value.trim()].filter(Boolean).join(' ');
        webSearch.href = `https://duckduckgo.com/?${new URLSearchParams({q: words, ia: 'images', iax: 'images'})}`;
    };
    updateWebSearch();

    byId('coverSearchBtn').addEventListener('click', () => void search());
    for (const id of ['coverArtist', 'coverTitle']) {
        byId(id).addEventListener('keydown', e => {
            if (e.key === 'Enter') void search();
        });
        byId(id).addEventListener('input', updateWebSearch);
    }
    bindDropzone(file => void apply(async () => uploadCover(song.slug, await toCoverJpeg(file))));
    byId('coverDeleteBtn')?.addEventListener('click', () => void apply(() => deleteCover(song.slug)));
    byId('cancelBtn').addEventListener('click', closeOverlay);
    void search();
}
