/**
 * Zugriff auf die JSON-API unter api/: Lesen ohne Token, Schreiben mit X-API-Token aus dem localStorage
 * (beim ersten Schreibzugriff per prompt() abgefragt, bei Ablehnung durch den Server vergessen).
 */

/**
 * Eine Datei im Liedordner: score (score.atex, Noten mit Text, Akkorden und Sync-Punkten), audio (audio.mp3),
 * leadsheet (leadsheet.json) oder cover (cover.jpg).
 * @typedef {'score'|'audio'|'leadsheet'|'cover'} SongFile
 */

/**
 * Ein Lied, wie es die API liefert (song.json plus files).
 * @typedef {Object} Song
 * @property {string} slug Ordnername, aus Interpret + Titel gebildet
 * @property {string} title Titel
 * @property {?string} artist Interpret
 * @property {?('strumming'|'fingerpicking')} technique Spieltechnik
 * @property {string[]} tags Genres (in der Oberfläche "Genre", mehrere je Song möglich), z. B. ["Rock & Pop"]
 * @property {?string} subtitle Untertitel (wie die folgenden Felder beim Import aus der GP-Datei, vorerst ungenutzt)
 * @property {?string} album Album
 * @property {?string} words Text von
 * @property {?string} music Musik von
 * @property {?string} copyright Copyright
 * @property {?string} tab Tab-Autor
 * @property {?string} instructions Anweisungen
 * @property {?string} notes Notizen, mehrzeilig (beim Import die Beschreibung aus der GP-Datei)
 * @property {{ultimateGuitar?: string, youtube?: string}} sources Herkunft des Rohmaterials (URLs)
 * @property {?number} youtubeSeconds Länge des YouTube-Clips aus sources.youtube in Sekunden; null, wenn unbekannt
 * @property {string} created Anlagezeitpunkt (ISO 8601)
 * @property {string} updated Änderungszeitpunkt (ISO 8601)
 * @property {SongFile[]} files vorhandene Dateien (berechnet die API bei jedem Lesen), z. B. ["score", "cover"]
 * @property {string[]} tracks Namen der Spuren aus der Partitur (berechnet die API bei jedem Lesen), z. B. ["Guitar"]
 */

/** Schlüssel des API-Tokens im localStorage. */
const TOKEN_KEY = 'gitarrenbuch_api_token';

/** Basis-URL der API, relativ zu diesem Modul (funktioniert so auch aus dev/ heraus). */
export const API_URL = new URL('../api/', import.meta.url).href;

/**
 * Maskiert Text für die Ausgabe in HTML.
 * @param {*} str beliebiger Wert, null/undefined ergibt ''
 * @returns {string} HTML-sicherer Text
 */
export function escapeHtml(str){
  return String(str ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/**
 * Lädt alle Lieder.
 * @returns {Promise<Song[]>} alphabetisch nach Titel sortiert
 */
export async function loadSongs(){
  const res = await fetch(API_URL + 'songs.php');
  if(!res.ok) throw new Error(`HTTP ${res.status}`);
  /** @type {{songs: Song[]}} */
  const data = await res.json();
  return data.songs;
}

/**
 * Ladevorgang der Akkordbibliothek, null bis zum ersten Aufruf von loadChordLibrary().
 * @type {?Promise<import('./chords.js').ChordLibrary>}
 */
let chordLibraryPromise = null;

/**
 * Lädt die Akkordbibliothek (data/chords.json) einmal je Seitenaufruf.
 * @returns {Promise<import('./chords.js').ChordLibrary>} Akkordname (klein) → Griffe, Standardgriff zuerst
 */
export function loadChordLibrary(){
  chordLibraryPromise ??= fetch(API_URL + 'chords.php').then(res => {
    if(!res.ok) throw new Error(`Akkordbibliothek konnte nicht geladen werden (HTTP ${res.status}).`);
    return res.json();
  });
  // Bei einem Fehler beim nächsten Aufruf neu versuchen.
  void chordLibraryPromise.catch(() => { chordLibraryPromise = null; });
  return chordLibraryPromise;
}

/**
 * Lädt die Noten eines Lieds (score.atex; data/ liegt außerhalb des Document Root, deshalb über die API).
 * @param {string} slug Slug des Lieds
 * @returns {Promise<string>} alphaTex
 */
export async function loadScoreText(slug){
  const res = await fetch(`${API_URL}score.php?slug=${encodeURIComponent(slug)}`);
  if(!res.ok){
    throw new Error(res.status === 404
      ? 'Keine Noten vorhanden.'
      : `Noten konnten nicht geladen werden (HTTP ${res.status}).`);
  }
  return res.text();
}

/**
 * Ersetzt die Noten eines Lieds (score.atex), z. B. aus dem Sync-Editor.
 * @param {string} slug Slug des Lieds
 * @param {string} tex Noten als alphaTex
 * @returns {Promise<Song>} das aktualisierte Lied
 */
export function saveScore(slug, tex){
  return apiWrite(`${API_URL}score.php?slug=${encodeURIComponent(slug)}`, {
    method: 'PUT',
    headers: {'Content-Type': 'text/plain; charset=utf-8'},
    body: tex,
  });
}

/**
 * Lädt die Audiospur eines Lieds (audio.mp3).
 * @param {string} slug Slug des Lieds
 * @returns {Promise<Uint8Array>} MP3
 */
export async function loadAudio(slug){
  const res = await fetch(audioUrl(slug));
  if(!res.ok) throw new Error(`Audiospur konnte nicht geladen werden (HTTP ${res.status}).`);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * URL der Audiospur eines Lieds (audio.mp3).
 * @param {string} slug Slug des Lieds
 * @returns {string} URL
 */
export function audioUrl(slug){
  return `${API_URL}audio.php?slug=${encodeURIComponent(slug)}`;
}

/**
 * Titel und Länge eines YouTube-Videos.
 * @param {string} url YouTube-URL
 * @returns {Promise<{id: string, title: string, seconds: number}>} Angaben zum Video
 * @throws {Error} wenn die URL kein YouTube-Video ist oder das Video nicht verfügbar ist
 */
export async function loadYoutubeInfo(url){
  const res = await fetch(`${API_URL}youtube.php?${new URLSearchParams({url})}`);
  const data = await res.json().catch(() => ({}));
  if(!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

/**
 * Liest das gespeicherte API-Token.
 * @returns {string} Token oder '', wenn keins gespeichert ist
 */
function getStoredToken(){
  return localStorage.getItem(TOKEN_KEY) || '';
}

/**
 * Löscht das gespeicherte API-Token.
 * @returns {void}
 */
function forgetToken(){
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * Holt das gespeicherte API-Token oder fragt es einmalig per prompt() ab und merkt es sich in localStorage.
 * @returns {string} Token oder '', wenn die Eingabe abgebrochen wurde
 */
function requireToken(){
  let token = getStoredToken();
  if(!token){
    token = (window.prompt('API-Token für Änderungen eingeben:') || '').trim();
    if(token) localStorage.setItem(TOKEN_KEY, token);
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
export async function apiWrite(url, options){
  const token = requireToken();
  if(!token){
    throw new Error('Ohne Token sind keine Änderungen möglich.');
  }
  options = options || {};
  options.headers = Object.assign({}, options.headers, {'X-API-Token': token});

  const res = await fetch(url, options);
  if(res.status === 401){
    forgetToken();
    throw new Error('Token wurde vom Server abgelehnt. Bitte erneut versuchen.');
  }
  const body = await res.json().catch(() => ({}));
  if(!res.ok){
    const msg = body.details ? body.details.join('; ') : (body.error || `HTTP ${res.status}`);
    throw new Error(msg);
  }
  return body;
}

/**
 * Legt ein neues Lied mit Noten an: aus einer importierten GP-Datei oder mit dem Gerüst aus dem Formular.
 * @param {Object} meta Angaben aus der Datei bzw. dem Formular (Felder wie bei PUT api/songs.php)
 * @param {string} tex Noten als alphaTex (siehe readGpFile() bzw. createScore() in score.js)
 * @param {?File} [file] Original-GP-Datei; der Server legt sie unter orig/ ab und löst die Audiospur heraus
 * @returns {Promise<Song>} das neue Lied
 */
export function importSong(meta, tex, file = null){
  const fd = new FormData();
  fd.append('meta', JSON.stringify(meta));
  fd.append('score', tex);
  if(file) fd.append('file', file);
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
 * @param {Song} song Lied mit Cover (files enthält "cover")
 * @returns {string} URL von api/cover.php
 */
export function coverUrl(song){
  return `${API_URL}cover.php?slug=${encodeURIComponent(song.slug)}&v=${encodeURIComponent(song.updated)}`;
}

/**
 * Sucht Cover bei Deezer und iTunes.
 * @param {string} artist Interpret (darf leer sein)
 * @param {string} title Titel
 * @returns {Promise<CoverHit[]>} Treffer, Deezer zuerst
 */
export async function searchCovers(artist, title){
  const res = await fetch(`${API_URL}cover.php?${new URLSearchParams({artist, title})}`);
  if(!res.ok) throw new Error(`Cover-Suche fehlgeschlagen (HTTP ${res.status})`);
  /** @type {{results: CoverHit[]}} */
  const data = await res.json();
  return data.results;
}

/**
 * Übernimmt ein Cover aus der Suche.
 * @param {string} slug Slug des Lieds
 * @param {string} url Bild-URL aus searchCovers()
 * @returns {Promise<Song>} das aktualisierte Lied
 */
export function setCover(slug, url){
  return apiWrite(`${API_URL}cover.php?slug=${encodeURIComponent(slug)}`, {
    method: 'PUT',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({url}),
  });
}

/**
 * Lädt ein eigenes Cover hoch.
 * @param {string} slug Slug des Lieds
 * @param {Blob} jpeg Bild im JPEG-Format (siehe toCoverJpeg() in library.js)
 * @returns {Promise<Song>} das aktualisierte Lied
 */
export function uploadCover(slug, jpeg){
  const fd = new FormData();
  fd.append('file', jpeg, 'cover.jpg');
  return apiWrite(`${API_URL}cover.php?slug=${encodeURIComponent(slug)}`, {method: 'POST', body: fd});
}

/**
 * Entfernt das Cover.
 * @param {string} slug Slug des Lieds
 * @returns {Promise<Song>} das aktualisierte Lied
 */
export function deleteCover(slug){
  return apiWrite(`${API_URL}cover.php?slug=${encodeURIComponent(slug)}`, {method: 'DELETE'});
}

/**
 * Lädt eine Akkorddatei (ChordPro oder Text) hoch. Sie landet als Rohmaterial unter orig/ und wird mit dem Editor
 * (geplant) in die Noten eingearbeitet.
 * @param {string} slug Slug des Lieds
 * @param {File} file .cho, .chopro, .crd, .pro oder .txt
 * @returns {Promise<Song>} das aktualisierte Lied
 */
export function uploadChordFile(slug, file){
  const fd = new FormData();
  fd.append('file', file);
  return apiWrite(`${API_URL}lyrics.php?slug=${encodeURIComponent(slug)}`, {method: 'POST', body: fd});
}
