/**
 * Dialoge zum Speichern auf der Bearbeitungsseite: "Speichern" mit Änderungsnotiz (Strg+S), "Änderungen
 * speichern?" beim Beenden, "Speichern nicht möglich" bei Takten mit falscher Länge.
 */

import {closeOverlay, openOverlay} from '../ui/overlay.js';
import {escapeHtml} from '../lib/format.js';

/** @typedef {import('../pages/editor.js').NoteEditor} NoteEditor */

/** Höchstlänge der Notiz beim Speichern (wie NOTE_MAX in api/lib/file_store.php). */
const NOTE_MAX = 200;

/** Schlüssel im Browser für die letzten Änderungsnotizen: {slug: Notiz}. */
const NOTES_KEY = 'gitarrenbuch_editor_notes';

/**
 * Feld für die Änderungsnotiz (Dialoge "Speichern" und "Änderungen speichern?"), vorbelegt mit der letzten Notiz.
 * @param {string} slug Slug des Songs
 * @returns {string} HTML
 */
function noteFieldHtml(slug) {
    return `
        <div class="form-field">
            <input type="text" id="saveNote" maxlength="${NOTE_MAX}" autocomplete="off" placeholder="Änderungsnotiz" aria-label="Änderungsnotiz" value="${escapeHtml(lastNote(slug))}">
        </div>
    `;
}

/**
 * Letzte Änderungsnotiz eines Songs (gemerkt bei Speichern und Verwerfen, keepLastNote()).
 * @param {string} slug Slug des Songs
 * @returns {string} leer ohne Notiz
 */
function lastNote(slug) {
    try {
        return String(JSON.parse(localStorage.getItem(NOTES_KEY) ?? '{}')?.[slug] ?? '');
    } catch (err) {
        return '';
    }
}

/**
 * Merkt sich die Änderungsnotiz eines Songs (überschreibt die vorige); leer vergisst sie.
 * @param {string} slug Slug des Songs
 * @param {string} note Notiz
 * @returns {void}
 */
function keepLastNote(slug, note) {
    try {
        const notes = JSON.parse(localStorage.getItem(NOTES_KEY) ?? '{}') ?? {};
        if (note) notes[slug] = note;
        else delete notes[slug];
        localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
    } catch (err) {
        // Ohne Speicher im Browser bleibt die Notiz nur bis zum Schließen des Dialogs.
    }
}

/**
 * Notiz aus dem Feld noteFieldHtml().
 * @returns {string} ohne Leerraum am Rand, leer ohne Feld
 */
function noteValue() {
    return (/** @type {?HTMLInputElement} */ (document.getElementById('saveNote')))?.value.trim() ?? '';
}

/**
 * Bindet das Feld noteFieldHtml() an: Enter speichert (wie der Knopf).
 * @param {function(): void} save Speichern
 * @returns {void}
 */
function bindNoteField(save) {
    const input = document.getElementById('saveNote');
    input?.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        save();
    });
}

/**
 * Speichern aus der Leiste (Strg+S): Legt es einen Stand in den Verlauf, fragt erst ein Dialog, was sich geändert hat
 * (optional, steht dann im Verlauf).
 * @param {NoteEditor} editor Bearbeitungsseite
 * @returns {void}
 */
export function askSave(editor) {
    if (!editor.dirty || !editor.keepsHistory()) {
        void editor.save();
        return;
    }
    openOverlay(`
        <h2>Speichern</h2>
        ${noteFieldHtml(editor.player.slug)}
        <div class="struct-actions">
            <button class="btn btn-primary" type="button" id="saveOk">Speichern</button>
            <button class="btn" type="button" id="saveCancel">Abbrechen</button>
        </div>
    `, true);
    const ok = () => {
        const note = noteValue();
        keepLastNote(editor.player.slug, note);
        closeOverlay();
        void editor.save(note);
    };
    document.getElementById('saveOk').addEventListener('click', ok);
    document.getElementById('saveCancel').addEventListener('click', closeOverlay);
    bindNoteField(ok);
    document.getElementById('saveNote').focus();
}

/**
 * X-Button verlässt die Bearbeitungsseite; bei ungespeicherten Änderungen fragt ein Dialog, ob sie gespeichert werden.
 * @param {NoteEditor} editor Bearbeitungsseite
 * @returns {void}
 */
export function finish(editor) {
    if (!editor.dirty) {
        editor.onClose(editor.saved);
        return;
    }
    openOverlay(`
        <h2>Änderungen speichern?</h2>
        <p>Möchtest du die Änderungen speichern?</p>
        ${editor.keepsHistory() ? noteFieldHtml(editor.player.slug) : ''}
        <div class="struct-actions">
            <button class="btn btn-primary" type="button" id="finishSave">Ja, speichern</button>
            <button class="btn" type="button" id="finishDiscard">Nein, verwerfen</button>
        </div>
    `, true);
    const slug = editor.player.slug;
    document.getElementById('finishDiscard').addEventListener('click', () => {
        if (editor.keepsHistory()) keepLastNote(slug, noteValue());
        closeOverlay();
        editor.onClose(editor.saved);
    });
    const finishSave = async () => {
        const note = noteValue();
        if (editor.keepsHistory()) keepLastNote(slug, note);
        closeOverlay();
        await editor.save(note);
        // Misslang das Speichern (Meldung unten), bleibt die Bearbeitungsseite offen.
        if (!editor.dirty) editor.onClose(editor.saved);
    };
    document.getElementById('finishSave').addEventListener('click', () => void finishSave());
    bindNoteField(() => void finishSave());
}

/**
 * Dialog statt Speichern: Takte, deren Länge nicht zur Taktart passt, werden so nicht gespeichert. Genannt wird der
 * erste dieser Takte, mit einem Knopf dorthin.
 * @param {NoteEditor} editor Bearbeitungsseite
 * @param {import('../lib/notation.js').BarLengthProblem[]} problems Takte mit falscher Länge (barLengthProblems())
 * @returns {void}
 */
export function refuseSave(editor, problems) {
    const bars = [...new Set(problems.map(p => p.bar.index))].sort((a, b) => a - b);
    const first = problems.find(p => p.bar.index === bars[0]);
    openOverlay(`
        <h2>Speichern nicht möglich</h2>
        <p>In Takt ${bars[0] + 1} passt die Länge nicht zur Taktart (${escapeHtml(first.text)}).</p>
        <div class="struct-actions">
            <button class="btn" type="button" id="refuseGo">Zu Takt ${bars[0] + 1}</button>
            <button class="btn btn-primary" type="button" id="refuseCancel">Abbrechen</button>
        </div>
    `, true);
    document.getElementById('refuseCancel').addEventListener('click', closeOverlay);
    document.getElementById('refuseGo').addEventListener('click', () => {
        closeOverlay();
        const track = first.bar.staff.track.index;
        editor.moveTo(editor.trackIndexes.includes(track) ? {track, bar: bars[0], beat: 0} : {bar: bars[0], beat: 0});
    });
}
