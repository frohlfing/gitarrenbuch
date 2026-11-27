/**
 * Zugriff auf die API (api/*.php): Songs, Noten, Leadsheet, Patterns, Audio, Cover, Uploads, dazu das Token für
 * schreibende Aufrufe. Außerdem die Marken der Übersichtsseite (Einstufung, zuletzt gespielt).
 * Lesen geht ohne Token, Schreiben mit X-API-Token aus dem localStorage (beim ersten Schreibzugriff per prompt()
 * abgefragt, bei Ablehnung durch den Server vergessen).
 */

import {parseChord} from './chordtheory.js';

/** @typedef {import('./chords.js').ChordCatalog} ChordCatalog */
/** @typedef {import('../../../types/alphatab').model.Score} Score */

/**
 * Eine Datei im Songordner: score (score.atex, Noten mit Text, Akkorden und Sync-Punkten), audio (audio.mp3) oder
 * cover (cover.jpg). Die Angaben für das Leadsheet stehen in score.json (beim Song als Feld leadsheet).
 * @typedef {'score'|'audio'|'cover'} SongFile
 */

/**
 * Ein Song, wie ihn die API liefert (song.json plus files).
 * @typedef {Object} Song
 * @property {string} slug Ordnername, aus Interpret + Titel gebildet
 * @property {string} title Titel
 * @property {?string} artist Interpret
 * @property {string[]} tags Genres (in der Oberfläche "Genre", mehrere je Song möglich), z. B. ["Rock & Pop"]
 * @property {?string} subtitle Untertitel (wie die folgenden Felder beim Import aus der GP-Datei, vorerst ungenutzt)
 * @property {?string} album Album
 * @property {?string} words Text von
 * @property {?string} music Musik von
 * @property {?string} copyright Copyright
 * @property {?string} tab Tab-Autor
 * @property {?string} instructions Anweisungen
 * @property {?string} notes Notizen, mehrzeilig (beim Import die Beschreibung aus der GP-Datei)
 * @property {{youtube?: string}} sources Herkunft des Rohmaterials (URLs)
 * @property {?number} youtubeSeconds Länge des YouTube-Clips aus sources.youtube in Sekunden; null, wenn unbekannt
 * @property {Leadsheet} [leadsheet] Angaben für das Leadsheet (gespeichert über api/leadsheet.php, siehe dort)
 * @property {boolean} [favorite] Favorit (fehlt, wenn nicht; gesetzt im Formular "Stammdaten")
 * @property {'can'|'practice'|'cannot'} [level] Einstufung: kann ich, übe ich gerade, kann ich nicht (fehlt ohne)
 * @property {string} created Anlagezeitpunkt (ISO 8601)
 * @property {string} updated Änderungszeitpunkt (ISO 8601)
 * @property {SongFile[]} files vorhandene Dateien (berechnet die API bei jedem Lesen), z. B. ["score", "cover"]
 * @property {string[]} tracks Namen der Spuren aus der Partitur (berechnet die API bei jedem Lesen), z. B. ["Guitar"]
 * @property {{reason: string, tracks: string[], audio?: boolean}} [wip] Baustelle (Stammdaten): Grund, betroffene
 *   Spuren und ob die Audiospur dazugehört; fehlt ohne. Wirkung: 🚧 an der Kachel (Tooltip: der Grund) und am Spurnamen
 *   (Editor, Player, Mixer), keine Patterns und Tab-Stellen aus diesen Spuren fürs Leadsheet, Filter "Mit Baustelle"
 *   in der Bibliothek. Benennt der Editor eine dieser Spuren um oder löscht sie, trägt er das beim Speichern nach
 *   (Sheet.wip).
 * @property {{show: boolean, mute: boolean}[]} [trackDefaults] Vorgaben je Spur (in der Reihenfolge der Spuren), ob sie
 *   in den Noten angezeigt und gehört wird; gesetzt im Dialog "Spuren" des Editors. Was ein Gerät im Mixer einstellt,
 *   hat dort Vorrang. Fehlt, wenn nie gesetzt.
 */

/** Schlüssel des API-Tokens im localStorage. */
const TOKEN_KEY = 'gitarrenbuch_api_token';

/** Basis-URL der API, relativ zu diesem Modul (funktioniert so auch aus dev/ heraus). */
export const API_URL = new URL('../../api/', import.meta.url).href;

/**
 * Lädt alle Songs.
 * @returns {Promise<Song[]>} alphabetisch nach Titel sortiert
 */
export async function loadSongs() {
    const res = await fetch(API_URL + 'songs.php');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    /** @type {{songs: Song[]}} */
    const data = await res.json();
    return data.songs;
}

/**
 * Akkord-Katalog mit der Nutzung der Griffe: Akkordname (klein) → Griff → Zahl der Schläge in allen Songs, der
 * häufigste Griff zuerst (die Reihenfolge der Schlüssel ist die des Servers).
 * @typedef {Object<string, Map<string, number>>} ChordUsage
 */

/**
 * Ladevorgang des Akkord-Katalogs, null bis zum ersten Aufruf und nach jeder Änderung über apiWrite() (die Noten können
 * sich geändert haben).
 * @type {?Promise<ChordUsage>}
 */
let chordUsagePromise = null;

/**
 * Lädt den Akkord-Katalog samt Nutzung einmal und hält ihn, bis etwas gespeichert wird. Namen, die die Regeln der
 * Akkordtheorie nicht kennen (parseChord() in chordtheory.js), erscheinen nicht.
 * @returns {Promise<ChordUsage>}
 */
function loadChordData() {
    chordUsagePromise ??= fetch(API_URL + 'chords.php').then(res => {
        if (!res.ok) throw new Error(`Akkord-Katalog konnte nicht geladen werden (HTTP ${res.status}).`);
        return /** @type {Promise<Object<string, [string, number][]>>} */ (res.json());
    }).then(data => {
        /** @type {ChordUsage} */
        const known = {};
        for (const [name, pairs] of Object.entries(data)) {
            if (parseChord(name) !== null) known[name] = new Map(pairs);
        }
        return known;
    });
    // Bei einem Fehler beim nächsten Aufruf neu versuchen.
    void chordUsagePromise.catch(() => {
        chordUsagePromise = null;
    });
    return chordUsagePromise;
}

/**
 * Lädt den Akkord-Katalog (aus den Noten aller Songs gezählt, siehe api/chords.php).
 * @returns {Promise<ChordCatalog>} Akkordname (klein) → Griffe, Standardgriff (der häufigste) zuerst
 */
export async function loadChordCatalog() {
    /** @type {ChordCatalog} */
    const catalog = {};
    for (const [name, grips] of Object.entries(await loadChordData())) catalog[name] = [...grips.keys()];
    return catalog;
}

/**
 * Wie loadChordCatalog(), aber ohne Fehler: Kann der Katalog nicht geladen werden, ist er leer.
 * @returns {Promise<ChordCatalog>} Katalog bzw. ein leerer
 */
export async function loadChordCatalogOrEmpty() {
    /** @type {ChordCatalog} */
    const none = {};
    return loadChordCatalog().catch(() => none);
}

/**
 * Wie oft die Griffe des Akkord-Katalogs in den Songs vorkommen (dieselbe Anfrage wie loadChordCatalog()).
 * @returns {Promise<ChordUsage>} was kein Song nutzt, fehlt
 * @throws {Error} wenn der Server nicht antwortet
 */
export function loadChordUsage() {
    return loadChordData();
}

/**
 * Lädt die Noten eines Songs (score.atex; data/ liegt außerhalb des Document Root, deshalb über die API).
 * @param {string} slug Slug des Songs
 * @returns {Promise<string>} alphaTex
 */
export async function loadScoreText(slug) {
    const res = await fetch(`${API_URL}score.php?slug=${encodeURIComponent(slug)}`);
    if (!res.ok) {
        throw new Error(res.status === 404
            ? 'Keine Noten vorhanden.'
            : `Noten konnten nicht geladen werden (HTTP ${res.status}).`);
    }
    return res.text();
}

/**
 * @typedef {{id: string, time: string, size: number, note: string, current: boolean}} ScoreVersion Fassung der Noten
 *   im Verlauf (siehe list_score_history() in api/lib/file_store.php): id zum Laden, time "2026-10-31 22:42:55"
 *   (gespeichert), size in Bytes, note: was sich beim Speichern geändert hat (leer ohne Notiz), current: die aktuelle
 *   Fassung (weder zu laden noch zu löschen)
 */

/**
 * Listet den Verlauf der Noten eines Songs.
 * @param {string} slug Slug des Songs
 * @returns {Promise<ScoreVersion[]>} die aktuelle Fassung zuerst, dann die früheren, die neueste zuerst
 */
export async function loadScoreHistory(slug) {
    const res = await fetch(`${API_URL}score.php?slug=${encodeURIComponent(slug)}&history=1`);
    if (!res.ok) throw new Error(`Der Verlauf konnte nicht geladen werden (HTTP ${res.status}).`);
    return /** @type {Promise<ScoreVersion[]>} */ (res.json());
}

/**
 * Lädt eine aufgehobene Fassung der Noten.
 * @param {string} slug Slug des Songs
 * @param {string} id Kennung aus loadScoreHistory()
 * @returns {Promise<string>} alphaTex
 */
export async function loadScoreVersion(slug, id) {
    const res = await fetch(`${API_URL}score.php?slug=${encodeURIComponent(slug)}&version=${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(`Die Fassung konnte nicht geladen werden (HTTP ${res.status}).`);
    return res.text();
}

/**
 * Löscht einen Stand aus dem Verlauf (Noten und Angaben für das Leadsheet).
 * @param {string} slug Slug des Songs
 * @param {string} id Kennung aus loadScoreHistory()
 * @returns {Promise<ScoreVersion[]>} die übrigen Stände, die neueste zuerst
 */
export function deleteScoreVersion(slug, id) {
    return apiWrite(`${API_URL}score.php?slug=${encodeURIComponent(slug)}&version=${encodeURIComponent(id)}`,
        {method: 'DELETE'});
}

/**
 * Notiz für den Verlauf als Teil der Adresse.
 * @param {string} note Notiz, leer = keine
 * @returns {string} "&note=…" oder leer
 */
function noteParam(note) {
    return note ? `&note=${encodeURIComponent(note)}` : '';
}

/**
 * Ersetzt die Noten eines Songs (score.atex), z. B. aus dem Sync-Editor.
 * @param {string} slug Slug des Songs
 * @param {string} tex Noten als alphaTex
 * @param {string} [note] was sich geändert hat (steht im Verlauf beim aufgehobenen Stand)
 * @returns {Promise<Song>} der aktualisierte Song (der bisherige Stand kommt in den Verlauf)
 */
export function saveScore(slug, tex, note = '') {
    return apiWrite(`${API_URL}score.php?slug=${encodeURIComponent(slug)}${noteParam(note)}`, {
        method: 'PUT',
        headers: {'Content-Type': 'text/plain; charset=utf-8'},
        body: tex,
    });
}

/**
 * Angaben für das Leadsheet (score.json): Patterns, Tab-Stellen, Griffbilder, Links, Spielweise (siehe
 * js/lib/sheetmodel.js und api/leadsheet.php).
 * @typedef {import('./sheetmodel.js').Sheet} Leadsheet
 */

/**
 * Lädt die Angaben für das Leadsheet eines Songs.
 * @param {string} slug Slug des Songs
 * @param {string} [version] Kennung eines Stands aus dem Verlauf (loadScoreHistory()); ohne den jetzigen
 * @returns {Promise<Leadsheet>} ohne Datei {patterns: [], tabs: []}
 */
export async function loadLeadsheet(slug, version = '') {
    const res = await fetch(`${API_URL}leadsheet.php?slug=${encodeURIComponent(slug)}`
        + (version ? `&version=${encodeURIComponent(version)}` : ''));
    if (!res.ok) throw new Error(`Angaben für das Leadsheet konnten nicht geladen werden (HTTP ${res.status}).`);
    return res.json();
}

/**
 * Ersetzt die Angaben für das Leadsheet eines Songs (score.json; ohne Einträge fällt sie weg).
 * @param {string} slug Slug des Songs
 * @param {Leadsheet} leadsheet Inhalt
 * @param {boolean} [keep] ob der bisherige Stand in den Verlauf kommt (false, wenn im selben Speichern schon die Noten
 *   gesichert wurden)
 * @param {string} [note] was sich geändert hat (steht im Verlauf beim aufgehobenen Stand, nur mit keep)
 * @returns {Promise<Song>} der aktualisierte Song
 */
export function saveLeadsheet(slug, leadsheet, keep = true, note = '') {
    return apiWrite(`${API_URL}leadsheet.php?slug=${encodeURIComponent(slug)}${keep ? noteParam(note) : '&keep=0'}`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(leadsheet),
    });
}

/**
 * Lädt den Pattern-Katalog (data/patterns.json, siehe js/lib/patterns.js) samt Verwendung.
 * @returns {Promise<{patterns: import('./patterns.js').Pattern[], usage: Object<string, number>}>} usage: Zahl der
 *   Songs je Pattern
 */
export async function loadPatterns() {
    const res = await fetch(API_URL + 'patterns.php');
    if (!res.ok) throw new Error(`Pattern-Katalog konnte nicht geladen werden (HTTP ${res.status}).`);
    return res.json();
}

/**
 * Ersetzt den Pattern-Katalog.
 * @param {import('./patterns.js').Pattern[]} patterns alle Patterns
 * @returns {Promise<{patterns: import('./patterns.js').Pattern[], usage: Object<string, number>}>}
 */
export function savePatterns(patterns) {
    return apiWrite(API_URL + 'patterns.php', {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({patterns}),
    });
}

/**
 * Lädt die Audiospur eines Songs (audio.mp3).
 * @param {string} slug Slug des Songs
 * @returns {Promise<Uint8Array>} MP3
 */
export async function loadAudio(slug) {
    const res = await fetch(audioUrl(slug));
    if (!res.ok) throw new Error(`Audiospur konnte nicht geladen werden (HTTP ${res.status}).`);
    return new Uint8Array(await res.arrayBuffer());
}

/**
 * URL der Audiospur eines Songs (audio.mp3).
 * @param {string} slug Slug des Songs
 * @returns {string} URL
 */
export function audioUrl(slug) {
    return `${API_URL}audio.php?slug=${encodeURIComponent(slug)}`;
}

/**
 * Titel und Länge eines YouTube-Videos.
 * @param {string} url YouTube-URL
 * @returns {Promise<{id: string, title: string, seconds: number}>} Angaben zum Video
 * @throws {Error} wenn die URL kein YouTube-Video ist oder das Video nicht verfügbar ist
 */
export async function loadYoutubeInfo(url) {
    const res = await fetch(`${API_URL}youtube.php?${new URLSearchParams({url})}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    return data;
}

/**
 * Liest das gespeicherte API-Token.
 * @returns {string} Token oder '', wenn keins gespeichert ist
 */
function getStoredToken() {
    return localStorage.getItem(TOKEN_KEY) || '';
}

/**
 * Löscht das gespeicherte API-Token.
 * @returns {void}
 */
function forgetToken() {
    localStorage.removeItem(TOKEN_KEY);
}

/**
 * Holt das gespeicherte API-Token oder fragt es einmalig per prompt() ab und merkt es sich in localStorage.
 * @returns {string} Token oder '', wenn die Eingabe abgebrochen wurde
 */
function requireToken() {
    let token = getStoredToken();
    if (!token) {
        token = (window.prompt('API-Token für Änderungen eingeben:') || '').trim();
        if (token) localStorage.setItem(TOKEN_KEY, token);
    }
    return token;
}

/**
 * fetch()-Wrapper für schreibende API-Aufrufe: hängt das Token an, wirft bei
 * 401 (und vergisst dann das falsche Token) bzw. anderen Fehlerstatus mit der
 * Server-Fehlermeldung als Error.
 * @param {string} url Endpunkt
 * @param {RequestInit} [options] fetch()-Optionen, die Header werden ergänzt
 * @returns {Promise<*>} dekodierter JSON-Body der Antwort
 */
export async function apiWrite(url, options) {
    const token = requireToken();
    if (!token) {
        throw new Error('Ohne Token sind keine Änderungen möglich.');
    }
    options = options || {};
    options.headers = Object.assign({}, options.headers, {'X-API-Token': token});

    const res = await fetch(url, options);
    if (res.status === 401) {
        forgetToken();
        throw new Error('Token wurde vom Server abgelehnt. Bitte erneut versuchen.');
    }
    const body = await res.json().catch(() => ({}));
    // Gespeicherte Noten, ein neuer oder gelöschter Song ändern den Akkord-Katalog.
    chordUsagePromise = null;
    if (!res.ok) {
        const msg = body.details ? body.details.join('; ') : (body.error || `HTTP ${res.status}`);
        throw new Error(msg);
    }
    return body;
}

/**
 * Legt einen neuen Song mit Noten an: aus einer importierten GP-Datei oder mit dem Gerüst aus dem Formular.
 * @param {Object} meta Angaben aus der Datei bzw. dem Formular (Felder wie bei PUT api/songs.php, dazu gpSource: die
 *   Quelle der GP-Datei)
 * @param {string} tex Noten als alphaTex (siehe readGpFile() bzw. createScore() in notation.js)
 * @param {?File} [file] Original-GP-Datei; der Server legt sie unter data/songs/<slug>/upload/ ab und löst die
 *   Audiospur heraus
 * @returns {Promise<Song>} der neue Song
 */
export function importSong(meta, tex, file = null) {
    const fd = new FormData();
    fd.append('meta', JSON.stringify(meta));
    fd.append('score', tex);
    if (file) fd.append('file', file);
    return apiWrite(API_URL + 'import.php', {method: 'POST', body: fd});
}

/**
 * Ein Treffer der Cover-Suche.
 * @typedef {Object} CoverHit
 * @property {('deezer'|'itunes')} source Quelle
 * @property {string} artist Interpret laut Quelle
 * @property {string} title Titel laut Quelle
 * @property {string} album Album, aus dem das Cover stammt
 * @property {string} url Cover in voller Größe (500 px)
 * @property {string} preview Vorschaubild (250 px)
 */

/**
 * URL des Covers. Das Änderungsdatum hängt als Parameter dran, damit ein neues Cover sofort erscheint.
 * @param {Song} song Song mit Cover (files enthält "cover")
 * @returns {string} URL von api/cover.php
 */
export function coverUrl(song) {
    return `${API_URL}cover.php?slug=${encodeURIComponent(song.slug)}&v=${encodeURIComponent(song.updated)}`;
}

/**
 * Sucht Cover bei Deezer und iTunes.
 * @param {string} artist Interpret (darf leer sein)
 * @param {string} title Titel
 * @returns {Promise<CoverHit[]>} Treffer, Deezer zuerst
 */
export async function searchCovers(artist, title) {
    const res = await fetch(`${API_URL}cover.php?${new URLSearchParams({artist, title})}`);
    if (!res.ok) throw new Error(`Cover-Suche fehlgeschlagen (HTTP ${res.status})`);

    /** @type {{results: CoverHit[]}} */
    const data = await res.json();
    return data.results;
}

/**
 * Übernimmt ein Cover aus der Suche.
 * @param {string} slug Slug des Songs
 * @param {string} url Bild-URL aus searchCovers()
 * @returns {Promise<Song>} der aktualisierte Song
 */
export function setCover(slug, url) {
    return apiWrite(`${API_URL}cover.php?slug=${encodeURIComponent(slug)}`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({url}),
    });
}

/**
 * Lädt ein eigenes Cover hoch.
 * @param {string} slug Slug des Songs
 * @param {Blob} jpeg Bild im JPEG-Format (siehe toCoverJpeg() in overview.js)
 * @returns {Promise<Song>} der aktualisierte Song
 */
export function uploadCover(slug, jpeg) {
    const fd = new FormData();
    fd.append('file', jpeg, 'cover.jpg');
    return apiWrite(`${API_URL}cover.php?slug=${encodeURIComponent(slug)}`, {method: 'POST', body: fd});
}

/**
 * Entfernt das Cover.
 * @param {string} slug Slug des Songs
 * @returns {Promise<Song>} der aktualisierte Song
 */
export function deleteCover(slug) {
    return apiWrite(`${API_URL}cover.php?slug=${encodeURIComponent(slug)}`, {method: 'DELETE'});
}

/**
 * Eine hochgeladene Datei eines Songs (data/songs/<slug>/upload/, siehe api/uploads.php).
 * @typedef {Object} Upload
 * @property {string} file Dateiname
 * @property {number} size Größe in Bytes
 * @property {string} source Quelle, meist eine URL ("" ohne Angabe)
 * @property {string} description Beschreibung ("" ohne Angabe)
 * @property {string} added Datum der Aufnahme (ISO 8601)
 */

/**
 * URL einer hochgeladenen Datei.
 * @param {string} slug Slug des Songs
 * @param {string} file Dateiname
 * @returns {string} URL von api/uploads.php
 */
export function uploadUrl(slug, file) {
    return `${API_URL}uploads.php?slug=${encodeURIComponent(slug)}&file=${encodeURIComponent(file)}`;
}

/**
 * Listet die hochgeladenen Dateien eines Songs, die ältesten zuerst.
 * @param {string} slug Slug des Songs
 * @returns {Promise<Upload[]>} Uploads
 * @throws {Error} wenn der Server nicht antwortet
 */
export async function listUploads(slug) {
    const res = await fetch(`${API_URL}uploads.php?slug=${encodeURIComponent(slug)}`);
    if (!res.ok) throw new Error(`Uploads nicht geladen (HTTP ${res.status})`);

    /** @type {{uploads: Upload[]}} */
    const body = await res.json();
    return body.uploads;
}

/**
 * Lädt eine hochgeladene Datei vom Server.
 * @param {string} slug Slug des Songs
 * @param {string} file Dateiname
 * @returns {Promise<File>} die Datei mit ihrem Namen
 * @throws {Error} wenn der Server nicht antwortet
 */
export async function fetchUpload(slug, file) {
    const res = await fetch(uploadUrl(slug, file));
    if (!res.ok) throw new Error(`${file} nicht geladen (HTTP ${res.status})`);
    return new File([await res.blob()], file);
}

/**
 * Legt eine Datei als Upload eines Songs ab: entweder die Datei selbst oder ein Direktlink, von dem der Server sie
 * lädt.
 * @param {string} slug Slug des Songs
 * @param {{file?: ?File, url?: string, source?: string, description?: string}} upload Datei oder Link (einer von
 *   beiden), Quelle (ohne Angabe gilt bei einem Link der Link) und Beschreibung
 * @returns {Promise<Upload>} der Upload
 */
export function addUpload(slug, {file = null, url = '', source = '', description = ''}) {
    const fd = new FormData();
    if (file) fd.append('file', file);
    if (url) fd.append('url', url);
    fd.append('source', source);
    fd.append('description', description);
    return apiWrite(`${API_URL}uploads.php?slug=${encodeURIComponent(slug)}`, {method: 'POST', body: fd});
}

/**
 * Ändert Quelle und Beschreibung eines Uploads.
 * @param {string} slug Slug des Songs
 * @param {string} file Dateiname
 * @param {{source: string, description: string}} info neue Angaben
 * @returns {Promise<Upload>} der Upload
 */
export function updateUpload(slug, file, info) {
    return apiWrite(`${API_URL}uploads.php?slug=${encodeURIComponent(slug)}&file=${encodeURIComponent(file)}`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(info),
    });
}

/**
 * Löscht einen Upload samt seinen Angaben.
 * @param {string} slug Slug des Songs
 * @param {string} file Dateiname
 * @returns {Promise<{uploads: Upload[]}>} die übrigen Uploads
 */
export function deleteUpload(slug, file) {
    return apiWrite(`${API_URL}uploads.php?slug=${encodeURIComponent(slug)}&file=${encodeURIComponent(file)}`,
        {method: 'DELETE'});
}


// --------------------------------------------------------------------------------------------------------------------
// Einstufung, Favorit, zuletzt gespielt
// --------------------------------------------------------------------------------------------------------------------
//
// - Einstufung: wie gut ich den Song spielen kann: "Kann ich", "Übe ich gerade", "Kann ich nicht" (Feld level in
//   song.json), dazu der Favorit (Feld favorite). Beides gehört zum Song und wird im Dialog "Stammdaten" gesetzt
//   (Menü ⋮ der Playerseite, dialogs/songform.js); die Übersichtsseite zeigt es auf der Kachel und filtert danach.
// - Zuletzt gespielt: je Gerät im localStorage (wann ein Song zuletzt abgespielt wurde); das ist keine Angabe zum
//   Song, sondern zur Nutzung, und soll ohne Token und ohne Schreiben auf dem Server gehen.
//
// --------------------------------------------------------------------------------------------------------------------

/** Zeichen einer Baustelle (song.json, Feld wip): hinter dem Spurnamen, auf der Kachel, in den Filtern. */
export const WIP_MARK = '🚧';

/** Einstufungen: Wert in song.json, Bezeichnung, Kurzform für die Kachel. */
export const LEVELS = [
    {value: 'can', label: 'Kann ich', short: 'kann ich'},
    {value: 'practice', label: 'Übe ich gerade', short: 'übe ich'},
    {value: 'cannot', label: 'Kann ich nicht', short: 'kann ich nicht'},
];

/** Schlüssel im localStorage: wann welcher Song zuletzt abgespielt wurde ({slug: Zeit in ms}). */
const PLAYED_KEY = 'gitarrenbuch_played';

/**
 * Wann die Songs zuletzt abgespielt wurden (auf diesem Gerät).
 * @returns {Object<string, number>} Slug → Zeit in ms; leer, wenn nichts (Gültiges) gespeichert ist
 */
export function playedTimes() {
    try {
        /** @type {?Object<string, number>} */
        const times = JSON.parse(localStorage.getItem(PLAYED_KEY) || '{}');
        return times ?? {};
    } catch (err) {
        return {};
    }
}

/**
 * Merkt sich, dass ein Song jetzt abgespielt wird.
 * @param {string} slug Song
 * @returns {void}
 */
export function markPlayed(slug) {
    const times = playedTimes();
    times[slug] = Date.now();
    localStorage.setItem(PLAYED_KEY, JSON.stringify(times));
}
