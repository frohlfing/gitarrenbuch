/**
 * Bestand aller Songs (SONGS) im Browser: laden, nach dem Speichern aktualisieren, Stammdaten ändern. Wer
 * neu zeichnen muss, meldet sich mit onSongsChanged() (die Übersichtsseite).
 */

import {API_URL, apiWrite} from './api.js';

/** @typedef {import('./api.js').Song} Song */

/**
 * Alle geladenen Songs (Stand des Servers, nach jeder Änderung aktualisiert).
 * @type {Song[]}
 */
export let SONGS = [];

/**
 * Ersetzt den ganzen Bestand (nach dem Laden vom Server).
 * @param {Song[]} songs alle Songs
 * @returns {void}
 */
export function setSongs(songs) {
    SONGS = songs;
}

/**
 * Wird nach jeder Änderung an SONGS aufgerufen; die Übersichtsseite zeichnet sich damit neu (initOverview()).
 * @type {function(): void}
 */
let songsChanged = () => {
};

/**
 * Meldet, wer nach jeder Änderung an SONGS neu zeichnen will (es gibt einen: die Übersichtsseite).
 * @param {function(): void} fn Rückruf
 * @returns {void}
 */
export function onSongsChanged(fn) {
    songsChanged = fn;
}

/**
 * Ersetzt bzw. ergänzt einen Song in SONGS (nach Anlegen, Bearbeiten, Import) und meldet die Änderung
 * (onSongsChanged()).
 * @param {Song} song gespeicherter Song
 * @param {string} [oldSlug] Slug vor einem Rename
 * @returns {void}
 */
export function storeSong(song, oldSlug = song.slug) {
    SONGS = SONGS.filter(s => s.slug !== oldSlug && s.slug !== song.slug);
    SONGS.push(song);
    songsChanged();
}

/**
 * Entfernt einen Song aus SONGS und meldet die Änderung (onSongsChanged()).
 * @param {string} slug Slug des Songs
 * @returns {void}
 */
export function removeSong(slug) {
    SONGS = SONGS.filter(s => s.slug !== slug);
    songsChanged();
}

/**
 * Sucht einen Song in SONGS.
 * @param {string} slug Slug des Songs
 * @returns {?Song} der Song oder null
 */
export function findSong(slug) {
    return SONGS.find(s => s.slug === slug) ?? null;
}

/**
 * Ändert einzelne Angaben eines Songs und lässt die übrigen, wie sie sind (der Server ersetzt sonst alle Felder, die
 * der Request nennt). Der Stand kommt aus der Liste, ein im Dialog "Stammdaten" geänderter Song gilt also schon.
 * @param {string} slug Slug des Songs
 * @param {Object<string, *>} changes zu ändernde Felder der API (z. B. sources, youtubeSeconds, trackDefaults)
 * @returns {Promise<Song>} der gespeicherte Song (auch schon in der Liste)
 */
export async function saveSongFields(slug, changes) {
    const s = findSong(slug);
    if (!s) throw new Error('Song nicht gefunden.');
    const saved = await apiWrite(`${API_URL}songs.php?slug=${encodeURIComponent(slug)}`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            title: s.title,
            artist: s.artist ?? '',
            tags: s.tags,
            notes: s.notes ?? '',
            sources: {youtube: s.sources.youtube ?? ''},
            level: s.level ?? null,
            favorite: !!s.favorite,
            ...changes,
        }),
    });
    storeSong(saved, slug);
    return saved;
}
