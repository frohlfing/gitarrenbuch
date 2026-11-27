/**
 * Dialog "Verlauf": frühere Fassungen der Noten samt Leadsheet-Angaben laden oder löschen.
 */

import {closeOverlay, openOverlay} from '../ui/overlay.js';
import {deleteScoreVersion, loadLeadsheet, loadScoreHistory, loadScoreVersion} from '../lib/api.js';
import {escapeHtml} from '../lib/format.js';
import {parseScore} from '../lib/notation.js';
import {normalizeSheet} from '../lib/sheetmodel.js';
import {svgIcon} from '../ui/icons.js';

/** @typedef {import('../pages/editor.js').NoteEditor} NoteEditor */

/**
 * Dialog "Verlauf": oben die aktuelle Fassung, darunter die früheren samt den Angaben für das Leadsheet (siehe
 * keep_score_history() in api/lib/file_store.php), je mit Zeitpunkt und Notiz des Speicherns; die früheren mit
 * Knöpfen zum Laden und zum Löschen.
 * @param {NoteEditor} editor Bearbeitungsseite
 * @param {import('../lib/api.js').ScoreVersion[]} [known] schon geladene Liste (nach dem Löschen eines Stands)
 * @returns {Promise<void>}
 */
export async function openHistoryDialog(editor, known) {
    let versions = known;
    if (!versions) {
        try {
            versions = await loadScoreHistory(editor.player.slug);
        } catch (err) {
            editor.toast(err.message);
            return;
        }
    }
    const rows = versions.map(v => {
        const when = new Date(v.time.replace(' ', 'T')).toLocaleString('de-DE');
        const actions = v.current ? '<span class="history-current">Aktuelle Fassung</span>'
            : `
                <button type="button" class="btn btn-34" data-version="${escapeHtml(v.id)}">Laden</button>
                <button type="button" class="ebtn" data-delete="${escapeHtml(v.id)}" title="Diesen Stand löschen" aria-label="Diesen Stand löschen">${svgIcon('trash')}</button>
            `;
        return `
            <li><span>${escapeHtml(when)}</span><span class="history-size">${Math.round(v.size / 1024)} KB</span>
                ${actions}${v.note ? `
                <span class="history-note">${escapeHtml(v.note)}</span>` : ''}
            </li>
        `;
    }).join('');
    openOverlay(`
        <h2>Verlauf</h2>
        <p class="history-hint">Das Laden ist ein Bearbeitungsschritt. Mit Rückgängig (Strg+Z) kommt der jetzige Stand zurück.</p>
        ${rows ? `<ul class="history-list">${rows}</ul>` : ''}${versions.length > 1 ? ''
            : '<p class="empty">Es gibt noch keine früheren Stände.</p>'}
    `);
    for (const button of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.history-list [data-version]'))) {
        button.addEventListener('click', () => {
            closeOverlay();
            void loadVersion(editor, button.dataset.version);
        });
    }
    for (const button of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.history-list [data-delete]'))) {
        button.addEventListener('click', async () => {
            if (!confirm('Diesen Stand endgültig löschen?')) return;
            try {
                await openHistoryDialog(editor, await deleteScoreVersion(editor.player.slug, button.dataset.delete));
            } catch (err) {
                editor.toast(`Nicht gelöscht: ${err.message}`);
            }
        });
    }
}

/**
 * Lädt einen aufgehobenen Stand in den Editor, Noten samt Angaben für das Leadsheet (ein Schritt für "Rückgängig",
 * noch nicht gespeichert).
 * @param {NoteEditor} editor Bearbeitungsseite
 * @param {string} id Kennung des Stands (siehe loadScoreHistory())
 * @returns {Promise<void>}
 */
export async function loadVersion(editor, id) {
    try {
        const slug = editor.player.slug;
        const tex = await loadScoreVersion(slug, id);
        // Die Baustelle (song.json) gehört nicht zum Stand.
        const sheet = JSON.stringify({...normalizeSheet(await loadLeadsheet(slug, id)), wip: editor.sheet.wip});
        // Vorab lesen: Ein Stand, der sich nicht einlesen lässt, darf den Editor nicht zerlegen.
        parseScore(editor.alphaTab, tex, editor.player.api.settings);
        if (tex === editor.tex && sheet === editor.sheetJson()) {
            editor.toast('Dieser Stand ist der jetzige.');
            return;
        }
        editor.commitTex(tex, sheet, 'Fassung aus dem Verlauf geladen');
        editor.toast('Stand geladen (noch nicht gespeichert; Strg+Z macht es rückgängig).');
    } catch (err) {
        editor.toast(`Der Stand ließ sich nicht laden: ${err.message}`);
    }
}
