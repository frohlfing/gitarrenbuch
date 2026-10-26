/**
 * Einstieg des Frontends: Routing zwischen Liederliste (#/) und Liedansicht (#/song/<slug>).
 * Die eigentliche Arbeit steckt in den ES-Modulen unter js/.
 */

import {escapeHtml} from './js/api.js';
import {deleteSongUI, findSong, initLibrary, openCoverForm, openImportForm, openSongForm, songMeta} from './js/library.js';
import {Player} from './js/player.js';

/** @typedef {import('./js/api.js').Song} Song */

/** Bereich der Liederliste. */
const libraryView = document.getElementById('libraryView');
/** Bereich der Liedansicht. */
const songView = document.getElementById('songView');
/** Button „+ Neues Lied“. */
const newSongBtn = document.getElementById('newSongBtn');

/**
 * Player der geöffneten Liedansicht, null in der Liste.
 * @type {?Player}
 */
let player = null;

/**
 * Hash der Liedansicht.
 * @param {string} slug Slug des Lieds
 * @returns {string} z. B. "#/song/bob-marley-three-little-birds"
 */
function songHash(slug){
  return `#/song/${encodeURIComponent(slug)}`;
}

/**
 * Zeigt die Liederliste und beendet einen laufenden Player.
 * @returns {void}
 */
function showLibrary(){
  player?.destroy();
  player = null;
  songView.hidden = true;
  songView.innerHTML = '';
  libraryView.hidden = false;
  document.title = 'Gitarrenbuch';
}

/**
 * Zeigt die Liedansicht mit Kopfzeile, Menü und Noten.
 * @param {Song} song Lied
 * @returns {void}
 */
function showSong(song){
  player?.destroy();
  player = null;
  libraryView.hidden = true;
  songView.hidden = false;
  document.title = `${song.title} – Gitarrenbuch`;
  window.scrollTo(0, 0);

  const meta = songMeta(song);
  songView.innerHTML = `
    <div class="songbar">
      <a class="btn btn-icon" href="#/" aria-label="Zur Liederliste">&larr;</a>
      <div class="songbar-titles">
        <h2>${escapeHtml(song.title)}</h2>
        <div class="songbar-meta">${escapeHtml([song.artist, meta].filter(Boolean).join(' · '))}</div>
      </div>
      <div class="songbar-menu">
        <button class="btn btn-icon" id="menuBtn" type="button" aria-label="Menü" aria-expanded="false">&#8942;</button>
        <div class="menu" id="menu" hidden>
          <button type="button" id="editBtn">Bearbeiten</button>
          <button type="button" id="coverBtn">Cover ändern</button>
          <button type="button" id="deleteBtn" class="danger">Löschen</button>
        </div>
      </div>
    </div>
    <div id="playerRoot"></div>
  `;

  const menu = document.getElementById('menu');
  const menuBtn = document.getElementById('menuBtn');
  const setMenu = open => { menu.hidden = !open; menuBtn.setAttribute('aria-expanded', String(open)); };
  menuBtn.addEventListener('click', () => setMenu(menu.hidden));
  // Cover-Änderungen landen nur in SONGS, nicht in song: Formulare deshalb mit dem aktuellen Stand öffnen.
  const current = () => findSong(song.slug) ?? song;

  document.getElementById('editBtn').addEventListener('click', () => {
    setMenu(false);
    openSongForm(current(), saved => {
      // Rename ändert den Slug: Hash anpassen, sonst neu zeichnen.
      if(saved.slug !== song.slug) location.replace(songHash(saved.slug));
      else showSong(saved);
    });
  });
  document.getElementById('coverBtn').addEventListener('click', () => {
    setMenu(false);
    openCoverForm(current(), () => {});
  });
  document.getElementById('deleteBtn').addEventListener('click', async () => {
    setMenu(false);
    if(await deleteSongUI(song)) location.hash = '#/';
  });

  const root = document.getElementById('playerRoot');
  if(!song.files.score){
    root.innerHTML = `<p class="empty">Keine Noten vorhanden. Noten kommen über „Importieren“ in der Liederliste.</p>`;
    return;
  }
  player = new Player(root);
  player.load(song.slug).catch(err => {
    root.innerHTML = `<p class="empty">${escapeHtml(err.message)}</p>`;
  });
}

/**
 * Zeigt je nach Hash die Liste (#/) oder ein Lied (#/song/<slug>); unbekannte Lieder führen zur Liste.
 * @returns {void}
 */
function route(){
  const m = location.hash.match(/^#\/song\/([^/]+)$/);
  if(!m){
    showLibrary();
    return;
  }
  const song = findSong(decodeURIComponent(m[1]));
  if(song) showSong(song);
  else location.replace('#/');
}

/**
 * Öffnet ein gerade angelegtes oder importiertes Lied.
 * @param {Song} saved Lied
 * @returns {void}
 */
const openSaved = saved => { location.hash = songHash(saved.slug); };
newSongBtn.addEventListener('click', () => openSongForm(null, openSaved));
document.getElementById('importBtn').addEventListener('click', () => openImportForm(openSaved));
window.addEventListener('hashchange', route);
// Klick außerhalb schließt das Menü der Liedansicht.
document.addEventListener('click', e => {
  const target = /** @type {Element} */ (e.target);
  if(target.closest('.songbar-menu')) return;
  document.getElementById('menu')?.setAttribute('hidden', '');
  document.getElementById('menuBtn')?.setAttribute('aria-expanded', 'false');
});

try {
  await initLibrary();
  route();
} catch(err){
  console.error(err);
  document.getElementById('subCount').textContent = 'Lieder konnten nicht geladen werden.';
}
