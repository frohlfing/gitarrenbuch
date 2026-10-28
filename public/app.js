/**
 * Einstieg des Frontends: Routing zwischen Liederliste (#/) und Liedansicht (#/song/<slug>).
 * Die eigentliche Arbeit steckt in den ES-Modulen unter js/.
 */

import {escapeHtml, loadAudio, loadScoreText} from './js/api.js';
import {deleteSongUI, findSong, initLibrary, openImportForm, openSongForm} from './js/library.js';
import {Player} from './js/player.js';
import {describeScoreInfo, exportGpFile} from './js/score.js';

/** @typedef {import('./js/api.js').Song} Song */

/** Bereich der Liederliste. */
const libraryView = document.getElementById('libraryView');
/** Bereich der Liedansicht. */
const songView = document.getElementById('songView');
/** Button „+ Neuer Song“: öffnet den Import-Dialog (dort auch „Manuell“). */
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
 * Lädt eine vollständige Guitar-Pro-Datei des Lieds herunter (Noten, Angaben, Audiospur mit Sync-Punkten).
 * @param {Song} song Lied
 * @returns {Promise<void>}
 */
async function downloadGpFile(song){
  // Nacheinander statt mit Promise.all: Dort verliert die IDE die Typen der einzelnen Ergebnisse.
  const tex = await loadScoreText(song.slug);
  const audio = song.files.includes('audio') ? await loadAudio(song.slug) : null;
  const file = await exportGpFile(song, tex, audio);
  const link = document.createElement('a');
  link.href = URL.createObjectURL(file);
  link.download = file.name;
  link.click();
  URL.revokeObjectURL(link.href);
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

  songView.innerHTML = `
    <div class="songbar">
      <a class="btn btn-icon" href="#/" aria-label="Zur Songliste">&larr;</a>
      <div class="songbar-titles">
        <h2>${escapeHtml(song.title)}</h2>
        <div class="songbar-meta" id="songMeta">${escapeHtml(song.artist ?? '')}</div>
      </div>
      <div class="songbar-menu">
        <button class="btn btn-icon" id="menuBtn" type="button" aria-label="Menü" aria-expanded="false">&#8942;</button>
        <div class="menu" id="menu" hidden>
          <button type="button" id="editBtn">Bearbeiten</button>
          <button type="button" id="exportBtn"${song.files.includes('score') ? '' : ' hidden'}
            title="Als Guitar-Pro-Datei (.gp) mit Audiospur und Sync-Punkten">Exportieren</button>
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
  // Ein im Formular geändertes Cover landet nur in SONGS, nicht in song: deshalb mit dem aktuellen Stand öffnen.
  const current = () => findSong(song.slug) ?? song;

  document.getElementById('editBtn').addEventListener('click', () => {
    setMenu(false);
    openSongForm(current(), saved => {
      // Rename ändert den Slug: Hash anpassen, sonst neu zeichnen.
      if(saved.slug !== song.slug) location.replace(songHash(saved.slug));
      else showSong(saved);
    });
  });
  document.getElementById('exportBtn').addEventListener('click', () => {
    setMenu(false);
    downloadGpFile(current()).catch(err => alert('Export fehlgeschlagen: ' + err.message));
  });
  document.getElementById('deleteBtn').addEventListener('click', async () => {
    setMenu(false);
    if(await deleteSongUI(song)) location.hash = '#/';
  });

  const root = document.getElementById('playerRoot');
  if(!song.files.includes('score')){
    root.innerHTML = `<p class="empty">Keine Noten vorhanden. Noten kommen über „+ Neuer Song“ in der Songliste.</p>`;
    return;
  }
  player = new Player(root);
  // Tonart, Capo usw. stehen nur in den Noten und kommen deshalb erst nach dem Laden in die Kopfzeile.
  // Element vorher merken: Ist bis dahin schon ein anderes Lied offen, trifft die Antwort nur das alte, entfernte.
  const metaEl = document.getElementById('songMeta');
  const showMeta = (info, audioSeconds = null) => {
    metaEl.innerHTML = [escapeHtml(song.artist ?? ''), describeScoreInfo(info, audioSeconds)]
      .filter(Boolean).join(' · ');
  };
  const songPlayer = player;
  songPlayer.load(song).then(info => {
    showMeta(info);
    // Ob die Sync-Punkte in die Audiospur passen, steht erst fest, wenn sie geladen ist.
    void songPlayer.audioDuration.then(seconds => { if(seconds) showMeta(info, seconds); });
  }).catch(err => {
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
newSongBtn.addEventListener('click', () => openImportForm(openSaved));
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
  document.getElementById('subCount').textContent = 'Songs konnten nicht geladen werden.';
}
