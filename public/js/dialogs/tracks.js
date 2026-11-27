/**
 * Dialog "Spuren" der Bearbeitungsseite: je Spur Zeigen, Hören, Name, Akkorde und Text, Instrument und Knöpfe.
 */

import {closeOverlay} from '../ui/overlay.js';
import {escapeHtml} from '../lib/format.js';
import {eyeIcon, speakerIcon} from '../pages/player.js';
import {instrumentSelect, todoButton} from '../pages/editor.js';
import {svgIcon} from '../ui/icons.js';
import {TRACK_NAMES, trackName} from '../lib/notation.js';
import {knownTracks} from '../pages/overview.js';

/** @typedef {import('../pages/editor.js').NoteEditor} NoteEditor */

/**
 * Dialog "Spuren": je Spur Zeigen, Hören, Name, Akkorde und Text, Instrument und Knöpfe (renderTracks()).
 * @param {NoteEditor} editor Bearbeitungsseite
 * @returns {void}
 */
export function openTracksDialog(editor) {
    const box = editor.openEditDialog('Spuren', 'etracks-dialog', `
        <div class="etrack-list"></div>
        <div class="struct-actions etrack-close"><button class="btn" type="button" data-close-dialog>Schließen</button></div>
    `);
    box.querySelector('[data-close-dialog]').addEventListener('click', closeOverlay);
    // Nach einem Dialog darüber (z. B. Spur importieren) steht die Liste so, wie die Noten jetzt sind.
    box.addEventListener('overlayshow', () => renderTracks(editor));
    renderTracks(editor);
}

/**
 * Zeichnet die Liste im Dialog "Spuren" neu, falls er offen ist (nicht, während in einem ihrer Felder geschrieben
 * wird).
 * @param {NoteEditor} editor Bearbeitungsseite
 * @returns {void}
 */
export function renderTracks(editor) {
    const list = document.querySelector('.dialog .etrack-list');
    if (!editor.score || !list || list.contains(document.activeElement) && document.activeElement.matches('input, select, textarea')) return;
    const shown = new Set(editor.trackIndexes);
    // Namensliste: die üblichen Namen, dazu alle aus der Bibliothek und dem Song (unübersetzt, siehe notation.js).
    const names = [...new Set([...TRACK_NAMES, ...knownTracks(), ...editor.score.tracks.map(t => t.name.trim())])]
        .filter(Boolean);
    const chordsAt = editor.contentTrack('chords');
    const lyricsAt = editor.contentTrack('lyrics');
    const last = editor.score.tracks.length - 1;
    list.innerHTML = `
        <datalist id="etrackNames">${names.map(n => `<option value="${escapeHtml(n)}">`).join('')}</datalist>
        <div class="etrack etrack-head"><span></span><span>Name</span>
            <span title="Spur, in der die Akkorde stehen">Akkorde</span>
            <span title="Spur, in der der Liedtext steht">Text</span>
            <span title="Klang der Spur">Instrument</span><span></span>
        </div>
        ${editor.score.tracks.map(track => {
            const i = track.index;
            return `
                <div class="etrack">
                    <span class="etrack-vis">
                        <button type="button" class="mix-icon" data-show-track="${i}" aria-pressed="${shown.has(i)}" aria-label="Spur ${i + 1} anzeigen" title="Spur in den Noten anzeigen">${eyeIcon(shown.has(i))}</button>
                        <button type="button" class="mix-icon" data-track-audible="${i}" aria-pressed="${!editor.player.trackMix(i).mute}" aria-label="Spur ${i + 1} hören" title="Spur hören (sonst stumm)">${speakerIcon(!editor.player.trackMix(i).mute)}</button>
                    </span>
                    <input type="text" data-track-field="name" data-track="${i}" list="etrackNames" value="${escapeHtml(track.name)}" placeholder="${escapeHtml(trackName(track))}" aria-label="Name der Spur ${i + 1}">
                    <input type="radio" name="etrackChords" data-content="chords" data-track="${i}" ${i === chordsAt ? ' checked' : ''} aria-label="Akkorde in Spur ${i + 1}" title="Akkorde in dieser Spur speichern">
                    <input type="radio" name="etrackLyrics" data-content="lyrics" data-track="${i}" ${i === lyricsAt ? ' checked' : ''} aria-label="Liedtext in Spur ${i + 1}" title="Liedtext in dieser Spur speichern">
                    ${instrumentSelect(track)}
                    <span class="etrack-buttons">
                        <button type="button" class="ebtn" data-cmd="trackUp" data-track="${i}" title="Spur nach oben"${i ? '' : ' disabled'}>↑</button>
                        <button type="button" class="ebtn" data-cmd="trackDown" data-track="${i}" title="Spur nach unten"${i < last ? '' : ' disabled'}>↓</button>
                        <button type="button" class="ebtn" data-cmd="trackDuplicate" data-track="${i}" title="Spur duplizieren (ohne Akkorde und Text)">⧉</button>
                        <button type="button" class="ebtn" data-cmd="trackRhythm" data-track="${i}" title="Rhythmus ableiten (Strumming mit den Akkorden)">${svgIcon('slashNote')}</button>
                        <button type="button" class="ebtn" data-cmd="trackMelody" data-track="${i}" title="Melodie ableiten (höchste Töne mit Text)">${svgIcon('melodyNote')}</button>
                        <button type="button" class="ebtn ebtn-danger" data-cmd="trackDelete" data-track="${i}" title="Spur löschen"${last ? '' : ' disabled'}>×</button>
                    </span>
                </div>`;
                    }).join('')}
        <div class="etrack-foot">
            ${todoButton('Spur hinzufügen', 'Gitarrenspur hinzufügen (mit Tuning und Capo des Songs)', 'ebtn-text', 'addTrack')}
            ${todoButton('Spur aus Guitar-Pro-Datei importieren', 'Spur aus einer hochgeladenen Guitar-Pro-Datei übernehmen, '
                + 'z. B. die Melodie', 'ebtn-text', 'trackImport')}
        </div>
    `;
}
