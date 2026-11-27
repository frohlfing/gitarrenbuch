/**
 * Dialog "Song importieren" (Übersichtsseite, "Neuer Song"): Guitar-Pro-Datei einlesen, bereinigen und anlegen.
 */

import {byId, formField} from '../ui/form.js';
import {addUpload, importSong} from '../lib/api.js';
import {storeSong} from '../lib/songs.js';
import {closeOverlay, openOverlay, overlay} from '../ui/overlay.js';
import {escapeHtml} from '../lib/format.js';
import {openSongForm} from './songform.js';

/** @typedef {import('../lib/api.js').Song} Song */

/**
 * "Interpret - Titel" aus dem Dateinamen, falls die GP-Datei selbst keinen Titel enthält.
 * @param {string} fileName Dateiname, z. B. "Bob Marley - Three Little Birds.gp"
 * @returns {{artist: string, title: string}} ohne " - " ist alles Titel
 */
function metaFromFileName(fileName) {
    const base = fileName.replace(/\.[^.]+$/, '').trim();
    const m = base.match(/^(.+?)\s+-\s+(.+)$/);
    return m ? {artist: m[1].trim(), title: m[2].trim()} : {artist: '', title: base};
}

/**
 * Verdrahtet die Ablagefläche #dropzone im offenen Overlay: Auswahl über das Dateifeld darin oder Drag & Drop.
 * Abgelegt werden darf überall im Dialog. Ohne preventDefault() würde der Browser die Datei selbst öffnen.
 * closeOverlay() entfernt die Handler wieder.
 * @param {(file: File) => void} onFile wird mit der gewählten bzw. abgelegten Datei aufgerufen
 * @returns {void}
 */
export function bindDropzone(onFile) {
    const dropzone = document.getElementById('dropzone');
    const input = /** @type {HTMLInputElement} */ (dropzone.querySelector('input[type="file"]'));
    input.addEventListener('change', () => {
        if (input.files[0]) onFile(input.files[0]);
    });
    // Im Overlay darf überall im Dialog abgelegt werden, im Panel der Bearbeitungsseite nur auf der Fläche.
    const target = overlay.classList.contains('open') ? overlay : dropzone;
    target.ondragover = e => {
        e.preventDefault();
        dropzone.classList.add('dragover');
    };
    target.ondragleave = e => {
        if (!target.contains(/** @type {Node} */ (e.relatedTarget))) dropzone.classList.remove('dragover');
    };
    target.ondrop = e => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        const dropped = e.dataTransfer?.files[0];
        if (dropped) onFile(dropped);
    };
}

/**
 * Warnt im Import-Dialog, dass beim Umwandeln etwas verloren geht, und wartet auf die Entscheidung des Benutzers.
 * @param {HTMLElement} box Bereich für Meldungen im Dialog
 * @param {string} loss was verloren geht, in Worten (describeScoreLoss() in lib/notation.js)
 * @returns {Promise<boolean>} true bei "Trotzdem übernehmen", false bei "Abbrechen"
 */
function confirmLoss(box, loss) {
    box.innerHTML = `
        <div class="error-box">
            <p>Beim Umwandeln gehen Angaben verloren, die alphaTex nicht schreiben kann.
                ${escapeHtml(loss)} Die Originaldatei bleibt unter upload/ erhalten.
            </p>
            <div class="btn-row">
                <button class="btn btn-primary" type="button" data-loss="accept">Trotzdem übernehmen</button>
                <button class="btn" type="button" data-loss="cancel">Abbrechen</button>
            </div>
        </div>
    `;
    return new Promise(resolve => {
        box.addEventListener('click', function onClick(e) {
            const choice = /** @type {?HTMLElement} */ (/** @type {HTMLElement} */ (e.target).closest('[data-loss]'));
            if (!choice) return;
            box.removeEventListener('click', onClick);
            box.innerHTML = '';
            resolve(choice.dataset.loss === 'accept');
        });
    });
}

/**
 * Dialog "Song importieren" hinter "Neuer Song": Import einer Guitar-Pro-Datei als neuer Song (wie der Rezept-Import
 * im Kochbuch). "Manuell" legt den Song ohne GP-Datei im Formular an (wie "Manuell" im Import-Dialog der Videothek).
 * @param {(saved: Song) => void} onImported wird nach erfolgreichem Import aufgerufen
 * @returns {void}
 */
export function openImportForm(onImported) {
    openOverlay(`
        <h2>Song importieren</h2>
        <div id="formError"></div>
        <div class="form-field">
            <label for="gpInput">Guitar-Pro-Datei</label>
            <label class="dropzone" id="dropzone">
                <input type="file" id="gpInput" accept=".gp,.gpx,.gp5,.gp4,.gp3">
                <span id="dropzoneText">Datei hierherziehen oder tippen zum Auswählen</span>
            </label>
            <div class="hint">GP3 bis GP8, z. B. von
                <a href="https://www.ultimate-guitar.com/explore?type[]=Pro" target="_blank" rel="noopener">Ultimate Guitar</a>
                (Download unter "Tabs" vom Typ "Guitar Pro").
            </div>
        </div>
        ${formField('importUgInput', 'Quelle der Datei', '',
            'inputmode="url" placeholder="https://tabs.ultimate-guitar.com/tab/…"')}
        <div class="btn-row">
            <button class="btn btn-primary" id="importSubmitBtn" type="button">Importieren</button>
            <button class="btn" id="manualBtn" type="button" title="Ohne Guitar-Pro-Datei von Hand anlegen">Manuell</button>
            <button class="btn" id="cancelBtn" type="button">Abbrechen</button>
        </div>
    `);

    /** @type {?File} per Auswahl oder Drag & Drop */
    let file = null;
    bindDropzone(f => {
        file = f;
        byId('dropzoneText').textContent = f.name;
        byId('dropzone').classList.add('has-file');
    });

    byId('cancelBtn').addEventListener('click', closeOverlay);
    byId('manualBtn').addEventListener('click', () => {
        closeOverlay();
        openSongForm(null, onImported);
    });
    byId('importSubmitBtn').addEventListener('click', async () => {
        const errorBox = byId('formError');
        errorBox.innerHTML = '';
        if (!file) {
            errorBox.innerHTML = '<div class="error-box">Bitte eine Datei wählen.</div>';
            return;
        }

        const btn = byId('importSubmitBtn');
        btn.disabled = true;
        btn.textContent = 'Importiert …';
        try {
            const {readGpFile, describeScoreLoss} = await import('../lib/notation.js');
            const {meta, tex, loss, changes, lyrics} = await readGpFile(file);
            if (loss && !await confirmLoss(errorBox, describeScoreLoss(loss))) {
                btn.disabled = false;
                btn.textContent = 'Importieren';
                return;
            }
            if (!meta.title) {
                Object.assign(meta, metaFromFileName(file.name), meta.artist ? {artist: meta.artist} : {});
            }
            // Die Quelle der Datei (z. B. die Seite des Tabs bei Ultimate Guitar) hält der Server beim Upload fest.
            const saved = await importSong({...meta, gpSource: byId('importUgInput').value.trim()}, tex, file);
            // Konfliktlöser (conflicts.js): Liedtext, der nicht in die Textspur passte, kommt als Chord-Datei in den
            // Upload-Ordner (übernehmen mit "Chord-Datei importieren"); die Änderungen nur in der Konsole.
            for (const {name, text} of lyrics) {
                await addUpload(saved.slug, {
                    file: new File([text], name, {type: 'text/plain;charset=utf-8'}),
                    description: 'Liedtext einer anderen Spur, beim Import nicht übernommen'
                });
            }
            if (changes.length) console.info(`Import ${saved.slug}:`, changes.map(c => (c.critical ? '⚠ ' : '') + c.text));
            storeSong(saved);
            closeOverlay();
            onImported(saved);
        } catch (err) {
            errorBox.innerHTML = `<div class="error-box">${escapeHtml(err.message)}</div>`;
            btn.disabled = false;
            btn.textContent = 'Importieren';
        }
    });
}
