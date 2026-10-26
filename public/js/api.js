/**
 * Zugriff auf die JSON-API unter api/: Lesen ohne Token, Schreiben mit X-API-Token aus dem localStorage
 * (beim ersten Schreibzugriff per prompt() abgefragt, bei Ablehnung durch den Server vergessen).
 */

/**
 * Welche Dateien im Liedordner vorhanden sind (berechnet die API bei jedem Lesen).
 * @typedef {Object} SongFiles
 * @property {boolean} score Noten (score.gp)
 * @property {boolean} lyrics Text mit Akkorden (song.cho)
 * @property {boolean} audio Audiospur (audio.mp3)
 * @property {boolean} sync Sync-Punkte zwischen Noten und Audio (sync.json)
 * @property {boolean} leadsheet Leadsheet (leadsheet.json)
 * @property {boolean} cover Albumcover (cover.jpg)
 */

/**
 * Ein Lied, wie es die API liefert (song.json plus files).
 * @typedef {Object} Song
 * @property {string} slug Ordnername, aus Interpret + Titel gebildet
 * @property {string} title Titel
 * @property {?string} artist Interpret
 * @property {?string} key Tonart, z. B. "A" oder "Em"
 * @property {?number} capo Bund des Kapodasters
 * @property {?string} tuning Stimmung, z. B. "E A D G B E"
 * @property {?number} tempo Tempo in BPM
 * @property {?('strumming'|'fingerpicking')} technique Spieltechnik
 * @property {string[]} tags Schlagwörter
 * @property {{ultimateGuitar?: string, youtube?: string}} sources Herkunft des Rohmaterials (URLs)
 * @property {string} created Anlagezeitpunkt (ISO 8601)
 * @property {string} updated Änderungszeitpunkt (ISO 8601)
 * @property {SongFiles} files vorhandene Dateien
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
 * URL der Arbeitsversion score.gp (data/ liegt außerhalb des Document Root, deshalb über die API).
 * @param {string} slug Slug des Lieds
 * @returns {string} URL von api/score.php
 */
export function scoreUrl(slug){
  return `${API_URL}score.php?slug=${encodeURIComponent(slug)}`;
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
 * Importiert eine GP-Datei als neues Lied.
 * @param {File} file Guitar-Pro-Datei
 * @param {Object} meta im Browser aus der Datei gelesene Angaben (Felder wie bei POST api/songs.php)
 * @returns {Promise<Song>} das neue Lied
 */
export function importGpFile(file, meta){
  const fd = new FormData();
  fd.append('file', file);
  fd.append('meta', JSON.stringify(meta));
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
 * @param {Song} song Lied mit files.cover
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
