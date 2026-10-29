/**
 * Einstieg des Frontends: Routing zwischen Liederliste (#/), Liedansicht (#/song/<slug>) und Griffbildern
 * (#/akkorde). Die eigentliche Arbeit steckt in den ES-Modulen unter js/.
 */

import {escapeHtml, loadAudio, loadChordLibrary, loadScoreText} from './js/api.js';
import {chordDiagramSvg} from './js/svg.js';
import {deleteSongUI, findSong, initLibrary, openImportForm, openSongForm} from './js/library.js';
import {Player} from './js/player.js';
import {describeScoreInfo, exportGpFile} from './js/score.js';
import {SyncEditor} from './js/sync-editor.js';

/** @typedef {import('./js/api.js').Song} Song */
/** @typedef {import('./js/score.js').ScoreInfo} ScoreInfo */

/** Bereich der Liederliste. */
const libraryView = document.getElementById('libraryView');
/** Bereich der Liedansicht. */
const songView = document.getElementById('songView');
/** Bereich der Griffbilder (Akkordbibliothek). */
const chordView = document.getElementById('chordView');
/** Button „+ Neuer Song“: öffnet den Import-Dialog (dort auch „Manuell“). */
const newSongBtn = document.getElementById('newSongBtn');

/**
 * Player der geöffneten Liedansicht, null in der Liste.
 * @type {?Player}
 */
let player = null;

/**
 * Sync-Editor der Liedansicht, null wenn er geschlossen ist.
 * @type {?SyncEditor}
 */
let syncEditor = null;

/**
 * Beobachtet die Höhe des Sync-Editors, null wenn er geschlossen ist.
 * @type {?ResizeObserver}
 */
let syncResize = null;

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
  leaveSong();
  chordView.hidden = true;
  libraryView.hidden = false;
  document.title = 'Gitarrenbuch';
}

/**
 * Beendet die Liedansicht (Player, Sync-Editor) und leert sie.
 * @returns {void}
 */
function leaveSong(){
  closeSyncEditor();
  player?.destroy();
  player = null;
  songView.hidden = true;
  songView.innerHTML = '';
}

/**
 * Akkordname zum Anzeigen: Die Bibliothek schreibt klein ("f#m", "d/f#").
 * @param {string} key Schlüssel der Bibliothek
 * @returns {string} z. B. "F#m", "D/F#"
 */
function chordDisplayName(key){
  return key.replace(/^[a-h]|\/[a-h]/g, s => s.toUpperCase());
}

/**
 * Zeigt alle Griffbilder der Akkordbibliothek, je Akkord der Standardgriff zuerst; zum Ausdrucken gedacht.
 * @returns {Promise<void>}
 */
async function showChordLibrary(){
  leaveSong();
  libraryView.hidden = true;
  chordView.hidden = false;
  document.title = 'Griffbilder – Gitarrenbuch';
  window.scrollTo(0, 0);
  chordView.innerHTML = `
    <div class="songbar">
      <a class="btn btn-icon" href="#/" aria-label="Zur Songliste">&larr;</a>
      <div class="songbar-titles">
        <h2>Griffbilder</h2>
        <div class="songbar-meta">Alle Akkorde aus den Songs nach Grundton, Standardgriff zuerst</div>
      </div>
      <button class="btn" type="button" id="toggleChords">Alle zuklappen</button>
      <button class="btn" type="button" id="printChords">Drucken</button>
    </div>
    <div class="chord-sheet" id="chordSheet"><p class="empty">wird geladen &hellip;</p></div>
  `;
  document.getElementById('printChords').addEventListener('click', () => window.print());
  const sheet = document.getElementById('chordSheet');
  const toggle = document.getElementById('toggleChords');
  const groupsOf = () => [...sheet.querySelectorAll('details.chord-root')];
  // Ist noch eine Gruppe offen, klappt der Button alle zu, sonst alle auf.
  const updateToggle = () => {
    toggle.textContent = groupsOf().some(d => d.open) ? 'Alle zuklappen' : 'Alle aufklappen';
  };
  toggle.addEventListener('click', () => {
    const open = !groupsOf().some(d => d.open);
    for(const group of groupsOf()) group.open = open;
    updateToggle();
  });
  // "toggle" steigt nicht auf, deshalb in der Capture-Phase.
  sheet.addEventListener('toggle', updateToggle, true);
  try {
    const library = await loadChordLibrary();
    // Nach Grundton gruppieren; die Bibliothek ist schon nach Grundton sortiert.
    /** @type {Map<string, string>} */
    const groups = new Map();
    for(const [key, grips] of Object.entries(library)){
      const name = chordDisplayName(key);
      const root = name.match(/^[A-H][#b]?/)?.[0] ?? name;
      groups.set(root, (groups.get(root) ?? '') + `
        <section class="chord-group">
          ${grips.map(grip => `
            <figure>
              ${chordDiagramSvg(name, grip)}
              <figcaption>${escapeHtml(grip)}</figcaption>
            </figure>`).join('')}
        </section>`);
    }
    sheet.innerHTML = [...groups].map(([root, html]) => `
      <details class="chord-root" open>
        <summary>${escapeHtml(root)}</summary>
        <div class="chord-root-list">${html}</div>
      </details>`).join('');
  } catch(err){
    sheet.innerHTML = `<p class="empty">${escapeHtml(err.message)}</p>`;
  }
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
  leaveSong();
  chordView.hidden = true;
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
          <button type="button" id="syncBtn"${song.files.includes('score') && song.files.includes('audio') ? '' : ' hidden'}
            title="Sync-Punkte an der Audiospur ausrichten">Sync-Editor</button>
          <button type="button" id="exportBtn"${song.files.includes('score') ? '' : ' hidden'}
            title="Als Guitar-Pro-Datei (.gp) mit Audiospur und Sync-Punkten">Exportieren</button>
          <button type="button" id="deleteBtn" class="danger">Löschen</button>
        </div>
      </div>
    </div>
    <div id="playerRoot"></div>
    <div id="syncRoot"></div>
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
  document.getElementById('syncBtn').addEventListener('click', () => {
    setMenu(false);
    void openSyncEditor(current(), songPlayer, showMeta);
  });
  songPlayer.load(song).then(info => {
    showMeta(info);
    // Ob die Sync-Punkte in die Audiospur passen, steht erst fest, wenn sie geladen ist.
    void songPlayer.audioDuration.then(seconds => { if(seconds) showMeta(info, seconds); });
  }).catch(err => {
    root.innerHTML = `<p class="empty">${escapeHtml(err.message)}</p>`;
  });
}

/**
 * Öffnet den Sync-Editor unter den Noten, sobald die Audiospur geladen ist.
 * @param {Song} song Lied
 * @param {Player} songPlayer Player der Liedansicht
 * @param {function(ScoreInfo, ?number): void} showMeta zeichnet die Kopfzeile neu (Eckdaten, Länge der Audiospur)
 * @returns {Promise<void>}
 */
async function openSyncEditor(song, songPlayer, showMeta){
  if(syncEditor) return;
  const seconds = await songPlayer.audioDuration;
  if(!seconds || !songPlayer.mixer || songPlayer !== player){
    if(songPlayer === player) alert('Die Audiospur konnte nicht geladen werden.');
    return;
  }
  const root = document.getElementById('syncRoot');
  const editor = syncEditor = new SyncEditor(root, songPlayer, song, {
    onChange: info => showMeta(info, seconds),
    onClose: () => closeSyncEditor(),
  });
  songView.classList.add('syncing');
  // Platz für den Editor über der Transportleiste freihalten (Höhe hängt vom Umbruch der Werkzeugleiste ab).
  syncResize = new ResizeObserver(() => {
    songView.style.setProperty('--sync-h', `${root.firstElementChild?.offsetHeight ?? 0}px`);
  });
  syncResize.observe(root.firstElementChild);
  try {
    await editor.open();
  } catch(err){
    closeSyncEditor();
    alert('Sync-Editor: ' + err.message);
  }
}

/**
 * Schließt den Sync-Editor ohne Rückfrage (beim Verlassen der Liedansicht; "Schließen" im Editor fragt selbst).
 * @returns {void}
 */
function closeSyncEditor(){
  syncResize?.disconnect();
  syncResize = null;
  syncEditor?.destroy();
  syncEditor = null;
  songView.classList.remove('syncing');
  songView.style.removeProperty('--sync-h');
}

/**
 * Zeigt je nach Hash die Liste (#/), ein Lied (#/song/<slug>) oder die Griffbilder (#/akkorde); unbekannte Lieder
 * führen zur Liste.
 * @returns {void}
 */
function route(){
  if(location.hash === '#/akkorde'){
    void showChordLibrary();
    return;
  }
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
// Zugeklappte Gruppen der Griffbilder für den Druck öffnen (auch bei Strg+P) und danach wieder schließen.
window.addEventListener('beforeprint', () => {
  for(const group of chordView.querySelectorAll('details.chord-root:not([open])')){
    group.dataset.printOpened = '';
    group.open = true;
  }
});
window.addEventListener('afterprint', () => {
  for(const group of chordView.querySelectorAll('details[data-print-opened]')){
    delete group.dataset.printOpened;
    group.open = false;
  }
});
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
