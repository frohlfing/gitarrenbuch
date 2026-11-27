/**
 * Dialog "Stammdaten" (Player, Menü ⋮) bzw. "Neuer Song" (Übersichtsseite): Titel, Interpret, Genre, Einstufung,
 * Baustelle, Notizen; beim Bearbeiten auch Cover und "Song löschen".
 */

import {byId, formField} from '../ui/form.js';
import {API_URL, apiWrite, coverUrl, importSong, LEVELS, WIP_MARK} from '../lib/api.js';
import {removeSong, SONGS, storeSong} from '../lib/songs.js';
import {knownTags, placeholderHue} from '../pages/overview.js';
import {closeOverlay, openOverlay} from '../ui/overlay.js';
import {escapeHtml} from '../lib/format.js';
import {openCoverForm} from './cover.js';

/** @typedef {import('../lib/api.js').Song} Song */

/**
 * Inhalt des Cover-Felds im Formular: das Cover oder ein Platzhalter in der Farbe der Kachel.
 * @param {Song} s Song
 * @returns {string} HTML
 */
function coverPickHtml(s) {
    return s.files.includes('cover')
        ? `<img src="${escapeHtml(coverUrl(s))}" alt="">`
        : `<span class="cover-empty" style="--h:${placeholderHue(s.slug)}">Cover wählen</span>`;
}

/**
 * Verdrahtet die Knöpfe der vorhandenen Genres unter dem Feld "Genre" (gespeichert als `tags`): Ein Klick nimmt das
 * Genre in die Liste im Textfeld auf oder entfernt es; Tippen im Textfeld hält die Knöpfe auf dem gleichen Stand.
 * @returns {void}
 */
function bindGenrePicks() {
    const input = byId('tagsInput');
    const picks = byId('genrePicks');
    const current = () => input.value.split(',').map(t => t.trim()).filter(Boolean);
    const sync = () => {
        const chosen = current();
        picks.querySelectorAll('[data-genre]').forEach(b => b.classList.toggle('on', chosen.includes(b.dataset.genre)));
    };
    picks.addEventListener('click', e => {
        const genre = (/** @type {HTMLElement} */ (e.target)).closest('[data-genre]')?.dataset.genre;
        if (!genre) return;
        const chosen = current();
        input.value = (chosen.includes(genre) ? chosen.filter(t => t !== genre) : [...chosen, genre]).join(', ');
        sync();
    });
    input.addEventListener('input', sync);
}

/**
 * Formular "Stammdaten" bzw. "Neuer Song". Beim Anlegen erzeugt der Browser Noten mit leeren Takten (createScore()),
 * denn jeder Song hat Noten; Tonart, Capo, Tempo und Tuning stehen danach nur in den Noten.
 * @param {?Song} song zu bearbeitender Song, null zum Anlegen
 * @param {(saved: Song) => void} onSaved wird nach erfolgreichem Speichern aufgerufen
 * @param {?function(): void} [onDeleted] wird nach "Song löschen" aufgerufen; ohne gibt es den Knopf nicht
 * @returns {void}
 */
export function openSongForm(song, onSaved, onDeleted = null) {
    const isEdit = song !== null;
    const s = song ?? /** @type {Song} */ ({tags: [], sources: {}});

    const nameFields = `
    ${formField('titleInput', 'Titel', s.title)}
    ${formField('artistInput', 'Interpret', s.artist, 'list="artistList" autocomplete="off"')}`;
    openOverlay(`
    <h2>${isEdit ? 'Stammdaten' : 'Neuer Song'}</h2>
    <div id="formError"></div>
    ${isEdit ? `<div class="form-head">
      <button class="cover-pick" id="coverPick" type="button" title="Cover ändern">${coverPickHtml(s)}</button>
      <div>${nameFields}</div>
    </div>` : nameFields}
    <datalist id="artistList">${[...new Set(SONGS.map(x => x.artist).filter(Boolean))].map(a => `<option value="${escapeHtml(a)}">`).join('')}</datalist>
    <div class="form-grid">
      ${isEdit ? '' : `
        ${formField('keyInput', 'Tonart', '', 'placeholder="z. B. G oder Am"')}
        ${formField('capoInput', 'Capo', '', 'inputmode="numeric" placeholder="0"')}
        ${formField('tempoInput', 'Tempo (BPM)', '', 'inputmode="numeric" placeholder="120"')}`}
    </div>
    ${isEdit ? '' : `<div class="form-field">
      <label for="tuningInput">Tuning</label>
      <input type="text" id="tuningInput" placeholder="E A D G B E">
      <div class="hint">Tonart, Capo, Tempo und Tuning gehen in die Noten und werden dort später geändert.</div>
    </div>`}
    <div class="form-field">
      <label for="tagsInput">Genre</label>
      <input type="text" id="tagsInput" value="${escapeHtml(s.tags.join(', '))}"
        placeholder="z. B. Rock &amp; Pop, Weihnachtslied">
      <div class="genre-picks" id="genrePicks">${knownTags().map(t => `<button class="tag-pick${
        s.tags.includes(t) ? ' on' : ''}" type="button" data-genre="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join('')}</div>
      <div class="hint">Mehrere durch Komma trennen, vorhandene per Klick an- und abwählen.</div>
    </div>
    ${isEdit ? ratingHtml(s) : ''}
    ${isEdit ? wipHtml(s) : ''}
    <div class="form-field">
      <label for="notesInput">Notizen</label>
      <textarea id="notesInput" rows="6">${escapeHtml(s.notes ?? '')}</textarea>
    </div>
    <div class="btn-row">
      <button class="btn btn-primary" id="saveBtn" type="button">Speichern</button>
      <button class="btn" id="cancelBtn" type="button">Abbrechen</button>
      ${isEdit && onDeleted ? '<button class="btn btn-danger btn-row-end" id="deleteBtn" type="button">Song löschen …</button>'
        : ''}
    </div>
  `);

    byId('cancelBtn').addEventListener('click', closeOverlay);
    // Das Cover wird im Dialog sofort gespeichert, unabhängig vom Speichern des Formulars.
    byId('coverPick')?.addEventListener('click', () => openCoverForm(s, saved => {
        s.files = saved.files;
        s.updated = saved.updated;
        byId('coverPick').innerHTML = coverPickHtml(s);
    }, {artist: byId('artistInput').value.trim(), title: byId('titleInput').value.trim() || s.title}));
    byId('deleteBtn')?.addEventListener('click', async () => {
        if (!await deleteSongUI(s)) return;
        closeOverlay();
        onDeleted();
    });

    bindGenrePicks();
    bindRating();
    byId('wipInput')?.addEventListener('change', e => {
        byId('wipFields').hidden = !(/** @type {HTMLInputElement} */ (e.target).checked);
    });

    byId('saveBtn').addEventListener('click', async () => {
        const errorBox = byId('formError');
        errorBox.innerHTML = '';
        const payload = {
            title: byId('titleInput').value.trim(),
            artist: byId('artistInput').value.trim(),
            tags: byId('tagsInput').value.split(',').map(t => t.trim()).filter(Boolean),
            // Die Quelle ändert sich hier nicht (YouTube: Panel "Audio").
            sources: {youtube: s.sources.youtube ?? ''},
            notes: byId('notesInput').value.trim(),
            // Einstufung und Favoriten gibt es nur am vorhandenen Song (Bearbeitungsseite).
            ...(isEdit ? {
                level: document.querySelector('#ratingLine [data-level][aria-pressed="true"]')?.dataset.level ?? null,
                favorite: byId('favoriteInput').getAttribute('aria-pressed') === 'true',
                wip: /** @type {HTMLInputElement} */ (byId('wipInput')).checked ? {
                    reason: /** @type {HTMLInputElement} */ (byId('wipReason')).value.trim(),
                    tracks: [...document.querySelectorAll('#wipFields [data-wip-track]:checked')]
                        .map(b => /** @type {HTMLInputElement} */ (b).value),
                    audio: /** @type {HTMLInputElement} */ (byId('wipAudio')).checked,
                } : null,
            } : {}),
        };
        if (!payload.title) {
            errorBox.innerHTML = '<div class="error-box">Titel ist erforderlich.</div>';
            return;
        }
        // Tempi sind ganzzahlig (roundTempo() in notation.js).
        const tempo = isEdit ? '' : byId('tempoInput').value.trim();
        if (tempo && !/^\d+$/.test(tempo)) {
            errorBox.innerHTML = '<div class="error-box">Tempo als ganze Zahl angeben, z. B. 120.</div>';
            return;
        }

        const saveBtn = byId('saveBtn');
        saveBtn.disabled = true;
        saveBtn.textContent = 'Speichert …';

        /** @type {Song} */
        let saved;
        try {
            // Jeder Song hat Noten: Ein neuer Song bekommt ein Gerüst und läuft dann wie ein Import.
            saved = isEdit
                ? await apiWrite(`${API_URL}songs.php?slug=${encodeURIComponent(s.slug)}`, {
                    method: 'PUT',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(payload),
                })
                : await importSong(payload, await (await import('../lib/notation.js')).createScore({
                    key: byId('keyInput').value,
                    capo: byId('capoInput').value,
                    tempo: byId('tempoInput').value,
                    tuning: byId('tuningInput').value,
                }));
        } catch (err) {
            errorBox.innerHTML = `<div class="error-box">${escapeHtml(err.message)}</div>`;
            saveBtn.disabled = false;
            saveBtn.textContent = 'Speichern';
            return;
        }

        storeSong(saved, isEdit ? s.slug : saved.slug);
        closeOverlay();
        onSaved(saved);
    });
}

/**
 * Schalter "Baustelle" der Stammdaten; eingeschaltet mit Grund, den betroffenen Spuren und der Audiospur (alles
 * optional).
 * @param {Song} s Song
 * @returns {string} HTML
 */
function wipHtml(s) {
    const tracks = s.tracks ?? [];
    return `
        <div class="form-field">
            <label class="wip-switch"><input type="checkbox" role="switch" class="switch" id="wipInput"${s.wip ? ' checked' : ''}>
                Baustelle ${WIP_MARK}
            </label>
            <div id="wipFields"${s.wip ? '' : ' hidden'}>
                <input type="text" id="wipReason" maxlength="500" value="${escapeHtml(s.wip?.reason ?? '')}" placeholder="Grund, z. B. Melodie fehlt noch" aria-label="Grund der Baustelle">
                <div class="wip-tracks">${tracks.map(name => `<label>
                    <input type="checkbox" data-wip-track value="${escapeHtml(name)}"${s.wip?.tracks.includes(name) ? ' checked' : ''}> ${escapeHtml(name)}</label>`)
                        .join('')}<label><input type="checkbox" id="wipAudio"${s.wip?.audio ? ' checked' : ''}> Audio</label></div>
            </div>
        </div>
    `;
}

/** Pfade der Symbole für die Einstufung (Material Symbols, Apache 2.0; viewBox 0 -960 960 960): Daumen runter, Hand, Daumen hoch, Herz. */
const RATING_ICONS = {
    cannot: 'M120-320q-32 0-56-24t-24-56v-80q0-7 1.5-15t4.5-15l120-282q9-20 30-34t44-14h320q33 0 56.5 23.5T640-760v407q0 16-6.5 30.5T616-297L399-81q-15 14-35.5 17T324-71q-19-10-27.5-28t-3.5-37l45-184H120Zm680-520q33 0 56.5 23.5T880-760v360q0 33-23.5 56.5T800-320q-33 0-56.5-23.5T720-400v-360q0-33 23.5-56.5T800-840Z',
    practice: 'M80-400q-33 0-56.5-23.5T0-480v-240q0-12 5-23t13-19l126-126q9-9 20-13.5t22-4.5q26 0 45 20t14 51l-13 75h208q17 0 28.5 11.5T480-720v50q0 6-1 11.5t-3 10.5l-90 212q-7 17-22.5 26.5T330-400H80Zm440 200q-17 0-28.5-11.5T480-240v-50q0-6 1-11.5t3-10.5l90-212q8-17 23-26.5t33-9.5h250q33 0 56.5 23.5T960-480v240q0 12-4.5 22.5T942-198L816-72q-9 9-20 13.5T774-54q-26 0-45-20t-14-51l13-75H520Z',
    can: 'M840-640q32 0 56 24t24 56v80q0 7-1.5 15t-4.5 15L794-168q-9 20-30 34t-44 14H400q-33 0-56.5-23.5T320-200v-407q0-16 6.5-30.5T344-663l217-216q15-14 35.5-17t39.5 7q19 10 27.5 28t3.5 37l-45 184h218ZM160-120q-33 0-56.5-23.5T80-200v-360q0-33 23.5-56.5T160-640q33 0 56.5 23.5T240-560v360q0 33-23.5 56.5T160-120Z',
    favorite: 'M451.5-152q-14.5-5-25.5-16l-69-63q-106-97-191.5-192.5T80-634q0-94 63-157t157-63q53 0 100 22.5t80 61.5q33-39 80-61.5T660-854q94 0 157 63t63 157q0 115-85 211T602-230l-68 62q-11 11-25.5 16t-28.5 5q-14 0-28.5-5Z',
};

/**
 * Einstufung und Favorit als Knöpfe mit Symbolen: Daumen runter (Kann ich nicht), Hand (Übe ich gerade), Daumen hoch
 * (Kann ich) und das Herz für den Favoriten. Die Einstufungen schließen sich aus, ein zweiter Klick nimmt sie zurück
 * (bindRating()).
 * @param {Song} s Song
 * @returns {string} HTML
 */
function ratingHtml(s) {
    const icon = path => `<svg class="rate-icon" viewBox="0 -960 960 960" aria-hidden="true"><path d="${path}"/></svg>`;
    const levels = ['cannot', 'practice', 'can'].map(value => {
        const level = LEVELS.find(l => l.value === value);
        return `<button class="rate-btn" type="button" data-level="${value}" aria-pressed="${s.level === value}" title="${level.label}" aria-label="${level.label}">${icon(RATING_ICONS[value])}</button>`;
    }).join('');
    return `
        <div class="form-field">
            <span class="label">Wie gut kann ich den Song?</span>
            <div class="rating-line" id="ratingLine">${levels}
                <button class="rate-btn rate-fav" type="button" id="favoriteInput" aria-pressed="${!!s.favorite}" title="Favorit" aria-label="Favorit">${icon(RATING_ICONS.favorite)}</button>
            </div>
        </div>
    `;
}

/**
 * Verdrahtet die Knöpfe von ratingHtml(): Eine Einstufung gilt allein, ein Klick auf die gewählte hebt sie auf; das
 * Herz schaltet für sich um.
 * @returns {void}
 */
function bindRating() {
    const line = byId('ratingLine');
    if (!line) return;
    line.addEventListener('click', e => {
        const button = /** @type {?HTMLElement} */ (/** @type {HTMLElement} */ (e.target).closest('.rate-btn'));
        if (!button) return;
        const on = button.getAttribute('aria-pressed') !== 'true';
        if (button.dataset.level) {
            line.querySelectorAll('[data-level]').forEach(b => b.setAttribute('aria-pressed', 'false'));
        }
        button.setAttribute('aria-pressed', String(on));
    });
}

/**
 * Fragt nach und löscht den Song.
 * @param {Song} song zu löschender Song
 * @returns {Promise<boolean>} true, wenn gelöscht
 */
async function deleteSongUI(song) {
    if (!window.confirm(`„${song.title}“ samt aller Dateien wirklich unwiderruflich löschen?`)) return false;
    try {
        await apiWrite(`${API_URL}songs.php?slug=${encodeURIComponent(song.slug)}`, {method: 'DELETE'});
        removeSong(song.slug);
        return true;
    } catch (err) {
        alert('Löschen fehlgeschlagen: ' + err.message);
        return false;
    }
}
