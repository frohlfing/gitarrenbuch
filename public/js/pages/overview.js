/**
 * Übersichtsseite: Kachelraster mit Suche, Filtern und Sortierung.
 */

import {LEVELS, WIP_MARK, coverUrl, loadSongs, playedTimes} from '../lib/api.js';
import {SONGS, onSongsChanged, setSongs} from '../lib/songs.js';
import {escapeHtml} from '../lib/format.js';
const list = document.getElementById('songList');
const searchInput = document.getElementById('search');
const sortSel = document.getElementById('sortSel');
const tagSel = document.getElementById('tagSel');
const trackSel = document.getElementById('trackSel');
const pickSel = /** @type {HTMLSelectElement} */ (document.getElementById('pickSel'));
const resultCount = document.getElementById('resultCount');
const subCount = document.getElementById('subCount');

/** Schlüssel im `localStorage` für den Suchbegriff, den Genre- (Tags) und Spur-Filter und die Sortierung der Liste. */
const VIEW_STATE_KEY = 'gitarrenbuch_view_state';

/**
 * Farbton des Platzhalters, aus dem Slug berechnet, damit jeder Song immer dieselbe Farbe hat.
 * @param {string} slug Slug des Songs
 * @returns {number} Farbton 0–359
 */
export function placeholderHue(slug) {
    let h = 0;
    for (const c of slug) h = (h * 31 + c.charCodeAt(0)) % 360;
    return h;
}

/**
 * HTML einer Kachel der Übersichtsseite. Ohne Cover zeigt sie einen farbigen Platzhalter mit dem Anfangsbuchstaben.
 * @param {Song} s Song
 * @returns {string} HTML
 */
function cardHtml(s) {
    // Noten hat jeder Song; markiert wird nur, was fehlt.
    const badges = (s.favorite ? '<span class="badge badge-fav" title="Favorit">★</span>' : '')
        + (hasWip(s) ? `<span class="badge badge-wip" title="${escapeHtml(s.wip.reason || 'Baustelle')}">${WIP_MARK}</span>`
            : '')
        + (s.files.includes('audio') ? '' : '<span class="badge missing" title="Keine Audiospur">Audio</span>');
    const level = LEVELS.find(l => l.value === s.level);
    const thumb = s.files.includes('cover')
        ? `<div class="thumb"><img src="${escapeHtml(coverUrl(s))}" alt="" loading="lazy">`
        : `
            <div class="thumb placeholder" style="--h:${placeholderHue(s.slug)}">
                <span class="initial" aria-hidden="true">${escapeHtml(s.title.charAt(0).toUpperCase())}</span>
        `;
    return `
        <a class="card" href="#/song/${encodeURIComponent(s.slug)}">
            ${thumb}
            ${badges ? `<div class="badges">${badges}</div>` : ''}
            </div>
            <div class="body">
                <h3>${escapeHtml(s.title)}</h3>
                <div class="meta">${escapeHtml(s.artist || '')}</div>
                ${s.tags.length || level ? `<div class="tags">${level ? `<span class="tag level-${level.value}">${level.short}</span>`
                    : ''}${s.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
            </div>
        </a>
    `;
}

/**
 * Alle verwendeten Tags (in der Oberfläche "Genre").
 * @returns {string[]} alphabetisch, ohne Duplikate
 */
export function knownTags() {
    return [...new Set(SONGS.flatMap(s => s.tags))].sort((a, b) => a.localeCompare(b, 'de'));
}

/**
 * Baut die Optionen des Genre-Filters (Tags) neu auf und behält die Auswahl bei, falls es das Genre noch gibt.
 * @returns {void}
 */
function refreshTagFilter() {
    const tags = knownTags();
    const current = tagSel.value;
    tagSel.innerHTML = '<option value="">Alle Genres</option>'
        + tags.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
    tagSel.value = tags.includes(current) ? current : '';
}

/** Wert im Spur-Filter für Songs mit Audiospur (Doppelpunkt davor, damit er keinem Spurnamen gleicht). */
const WITH_AUDIO = ':mit-audio';

/** Wert im Spur-Filter für Songs ohne Audiospur. */
const WITHOUT_AUDIO = ':ohne-audio';

/**
 * Alle Spurnamen aus den Partituren (auch für die Namensliste im Editor, Dialog "Spuren").
 * @returns {string[]} alphabetisch, ohne Duplikate
 */
export function knownTracks() {
    return [...new Set(SONGS.flatMap(s => s.tracks))].sort((a, b) => a.localeCompare(b, 'de'));
}

/**
 * Baut die Optionen des Spur-Filters neu auf: alle Spurnamen, nach einer Trennlinie "Mit Audio" und "Ohne Audio".
 * Behält die Auswahl bei, falls es sie noch gibt.
 * @returns {void}
 */
function refreshTrackFilter() {
    const current = trackSel.value;
    trackSel.innerHTML = '<option value="">Alle Spuren</option>'
        + knownTracks().map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('')
        + `<option disabled>──────────</option>`
        + `<option value="${WITH_AUDIO}">Mit Audio</option><option value="${WITHOUT_AUDIO}">Ohne Audio</option>`;
    trackSel.value = [...trackSel.options].some(o => !o.disabled && o.value === current) ? current : '';
}

/**
 * Prüft, ob ein Song zur Auswahl im Spur-Filter passt.
 * @param {Song} s Song
 * @param {string} track Spurname, WITH_AUDIO oder WITHOUT_AUDIO
 * @returns {boolean} true, wenn der Song die Spur hat bzw. (keine) Audiospur
 */
function hasTrack(s, track) {
    if (track === WITH_AUDIO) return s.files.includes('audio');
    if (track === WITHOUT_AUDIO) return !s.files.includes('audio');
    return s.tracks.includes(track);
}

/**
 * Werte im Filter "Auswahl" (pickSel): Favoriten, Songs mit Baustelle, Einstufung (dahinter der Wert bzw. NO_LEVEL).
 */
const PICK_FAVORITES = ':favoriten';
const PICK_WIP = ':baustelle';
const PICK_LEVEL = ':stufe:';

/** Songs ohne Einstufung. */
const NO_LEVEL = 'ohne';

/**
 * Ob ein Song eine Spur hat, an der noch gearbeitet wird (leadsheet.wip).
 * @param {Song} s Song
 * @returns {boolean}
 */
function hasWip(s) {
    return Boolean(s.wip);
}

/**
 * Baut den Filter "Auswahl" neu auf: Favoriten, Songs mit Baustelle und die Einstufungen, je mit der Zahl der Songs.
 * Behält die Auswahl bei.
 * @returns {void}
 */
function refreshPickFilter() {
    const current = pickSel.value;
    const count = test => SONGS.filter(test).length;
    pickSel.innerHTML = '<option value="">Alle Songs</option>'
        + `<option value="${PICK_FAVORITES}">★ Favoriten (${count(s => s.favorite)})</option>`
        + `<option value="${PICK_WIP}">${WIP_MARK} Mit Baustelle (${count(hasWip)})</option>`
        + LEVELS.map(l => `<option value="${PICK_LEVEL}${l.value}">${l.label} (${count(s => s.level === l.value)})</option>`)
            .join('')
        + `<option value="${PICK_LEVEL}${NO_LEVEL}">Ohne Einstufung (${count(s => !s.level)})</option>`;
    pickSel.value = [...pickSel.options].some(o => o.value === current) ? current : '';
}

/**
 * Aktualisiert die Filter (Genre, Spur, Auswahl), Anzahl im Kopfbereich und Liste.
 * @returns {void}
 */
function refreshOverview() {
    refreshTagFilter();
    refreshTrackFilter();
    refreshPickFilter();
    subCount.textContent = `${SONGS.length} ${SONGS.length === 1 ? 'Song' : 'Songs'}`;
    renderList();
}

/**
 * Zeichnet die Liste nach Suchbegriff, Genre- und Spur-Filter und Sortierung.
 * @returns {void}
 */
function renderList() {
    const q = searchInput.value.trim().toLowerCase();
    const tag = tagSel.value;
    const track = trackSel.value;
    let items = SONGS.slice();

    if (tag) {
        items = items.filter(s => s.tags.includes(tag));
    }
    if (track) {
        items = items.filter(s => hasTrack(s, track));
    }
    const pick = pickSel.value;
    if (pick === PICK_FAVORITES) items = items.filter(s => s.favorite);
    else if (pick === PICK_WIP) items = items.filter(hasWip);
    else if (pick.startsWith(PICK_LEVEL)) {
        const level = pick.slice(PICK_LEVEL.length);
        items = items.filter(s => level === NO_LEVEL ? !s.level : s.level === level);
    }
    if (q) {
        items = items.filter(s =>
            s.title.toLowerCase().includes(q)
            || (s.artist || '').toLowerCase().includes(q)
            || s.tags.some(t => t.toLowerCase().includes(q))
        );
    }

    const byTitle = (a, b) => a.title.localeCompare(b.title, 'de');
    const played = playedTimes();
    switch (sortSel.value) {
        case 'played-desc':
            // Nie gespielte ans Ende, nach Titel.
            items.sort((a, b) => (played[b.slug] ?? 0) - (played[a.slug] ?? 0) || byTitle(a, b));
            break;
        case 'artist':
            items.sort((a, b) => (a.artist || '￿').localeCompare(b.artist || '￿', 'de') || byTitle(a, b));
            break;
        case 'created-desc':
            items.sort((a, b) => b.created.localeCompare(a.created));
            break;
        case 'updated-desc':
            items.sort((a, b) => b.updated.localeCompare(a.updated));
            break;
        case 'title':
        default:
            items.sort(byTitle);
    }

    resultCount.textContent = `${items.length} von ${SONGS.length} Songs`;
    list.innerHTML = items.length
        ? items.map(cardHtml).join('')
        : `<p class="empty">${SONGS.length ? 'Keine Songs gefunden.' : 'Noch keine Songs. Leg mit „+ Neuer Song“ den ersten an.'}</p>`;
}

/**
 * Merkt sich Suchbegriff, Genre- und Spur-Filter und Sortierung im localStorage.
 * @returns {void}
 */
function saveViewState() {
    localStorage.setItem(VIEW_STATE_KEY, JSON.stringify({
        search: searchInput.value, tag: tagSel.value, track: trackSel.value, sort: sortSel.value, pick: pickSel.value,
    }));
}

/**
 * Liest den gemerkten Zustand der Liste.
 * @returns {{search?: string, tag?: string, track?: string, sort?: string, pick?: string}} leer, wenn nichts (Gültiges)
 *   gespeichert ist
 */
function loadViewState() {
    try {
        return JSON.parse(localStorage.getItem(VIEW_STATE_KEY) || '{}');
    } catch (err) {
        return {};
    }
}

/**
 * Lädt die Übersichtsseite und verdrahtet Suche und Filter.
 * @returns {Promise<void>}
 */
export async function initOverview() {
    const onFilterChange = () => {
        saveViewState();
        renderList();
    };
    searchInput.addEventListener('input', onFilterChange);
    sortSel.addEventListener('change', onFilterChange);
    tagSel.addEventListener('change', onFilterChange);
    trackSel.addEventListener('change', onFilterChange);
    pickSel.addEventListener('change', onFilterChange);

    setSongs(await loadSongs());
    onSongsChanged(refreshOverview);
    refreshTagFilter();
    refreshTrackFilter();
    refreshPickFilter();

    // Suchbegriff/Filter/Sortierung vom letzten Besuch wiederherstellen (Genre und Spur nur, wenn es sie noch gibt).
    const saved = loadViewState();
    if (saved.search) searchInput.value = saved.search;
    if (saved.sort && [...sortSel.options].some(o => o.value === saved.sort)) sortSel.value = saved.sort;
    if (saved.tag && [...tagSel.options].some(o => o.value === saved.tag)) tagSel.value = saved.tag;
    if (saved.track && [...trackSel.options].some(o => !o.disabled && o.value === saved.track)) trackSel.value = saved.track;
    if (saved.pick && [...pickSel.options].some(o => o.value === saved.pick)) pickSel.value = saved.pick;

    refreshOverview();
}
