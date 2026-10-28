/**
 * Liederliste mit Suche, Tag-Filter und Sortierung sowie das Formular zum Anlegen und Bearbeiten eines Lieds
 * (Overlay wie beim Kochbuch) sowie der Import einer GP-Datei als neues Lied. alphaTab liest die Datei dabei im
 * Browser und wandelt die Noten in alphaTex um (siehe readGpFile() in score.js).
 */

import {
  API_URL, apiWrite, audioUrl, coverUrl, deleteCover, escapeHtml, importSong, loadScoreText, loadSongs,
  loadYoutubeInfo, searchCovers, setCover, uploadChordFile, uploadCover,
} from './api.js';
import {formatTime} from './player.js';
import {createScore, loadAlphaTab, parseScore, readGpFile, scoreDuration} from './score.js';

/** @typedef {import('./api.js').Song} Song */

/**
 * Alle geladenen Lieder (Stand des Servers, nach jeder Änderung aktualisiert).
 * @type {Song[]}
 */
export let SONGS = [];

const list = document.getElementById('songList');
const overlay = document.getElementById('overlay');
const sheet = document.getElementById('sheet');
const searchInput = document.getElementById('search');
const sortSel = document.getElementById('sortSel');
const tagSel = document.getElementById('tagSel');
const trackSel = document.getElementById('trackSel');
const resultCount = document.getElementById('resultCount');
const subCount = document.getElementById('subCount');

/**
 * Kurzform für document.getElementById(), typisiert als Eingabefeld.
 * @param {string} id ID des Elements
 * @returns {?HTMLInputElement} das Element oder null
 */
function byId(id){
  return /** @type {?HTMLInputElement} */ (document.getElementById(id));
}

/** Schlüssel im `localStorage` für den Suchbegriff, den Genre- (Tags) und Spur-Filter und die Sortierung der Liste. */
const VIEW_STATE_KEY = 'gitarrenbuch_view_state';

// `true`, während ein Formular offen ist (ungespeicherte Eingaben sind möglich). Dann schließen nur
// die expliziten Buttons das Overlay, nicht ein Klick daneben oder Escape.
let formIsOpen = false;

/**
 * Ersetzt bzw. ergänzt ein Lied in SONGS (nach Anlegen, Bearbeiten, Import) und zeichnet die Liste neu.
 * @param {Song} song gespeichertes Lied
 * @param {string} [oldSlug] Slug vor einem Rename
 * @returns {void}
 */
export function storeSong(song, oldSlug = song.slug){
  SONGS = SONGS.filter(s => s.slug !== oldSlug && s.slug !== song.slug);
  SONGS.push(song);
  refreshLibrary();
}

/**
 * Entfernt ein Lied aus SONGS und zeichnet die Liste neu.
 * @param {string} slug Slug des Lieds
 * @returns {void}
 */
export function removeSong(slug){
  SONGS = SONGS.filter(s => s.slug !== slug);
  refreshLibrary();
}

/**
 * Sucht ein Lied in SONGS.
 * @param {string} slug Slug des Lieds
 * @returns {?Song} das Lied oder null
 */
export function findSong(slug){
  return SONGS.find(s => s.slug === slug) ?? null;
}

/**
 * Farbton des Platzhalters, aus dem Slug berechnet, damit jedes Lied immer dieselbe Farbe hat.
 * @param {string} slug Slug des Lieds
 * @returns {number} Farbton 0–359
 */
function placeholderHue(slug){
  let h = 0;
  for(const c of slug) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

/**
 * HTML einer Kachel der Liederliste. Ohne Cover zeigt sie einen farbigen Platzhalter mit dem Anfangsbuchstaben.
 * @param {Song} s Lied
 * @returns {string} HTML
 */
function cardHtml(s){
  // Noten hat jeder Song; markiert wird nur, was fehlt.
  const badges = s.files.includes('audio') ? '' : '<span class="badge missing" title="Keine Audiospur">Audio</span>';
  const thumb = s.files.includes('cover')
    ? `<div class="thumb"><img src="${escapeHtml(coverUrl(s))}" alt="" loading="lazy">`
    : `<div class="thumb placeholder" style="--h:${placeholderHue(s.slug)}">
        <span class="initial" aria-hidden="true">${escapeHtml(s.title.charAt(0).toUpperCase())}</span>`;
  return `<a class="card" href="#/song/${encodeURIComponent(s.slug)}">
    ${thumb}
      ${badges ? `<div class="badges">${badges}</div>` : ''}
    </div>
    <div class="body">
      <h3>${escapeHtml(s.title)}</h3>
      <div class="meta">${escapeHtml(s.artist || '')}</div>
      ${s.tags.length ? `<div class="tags">${s.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
    </div>
  </a>`;
}

/**
 * Alle verwendeten Tags (in der Oberfläche "Genre").
 * @returns {string[]} alphabetisch, ohne Duplikate
 */
function knownTags(){
  return [...new Set(SONGS.flatMap(s => s.tags))].sort((a, b) => a.localeCompare(b, 'de'));
}

/**
 * Baut die Optionen des Genre-Filters (Tags) neu auf und behält die Auswahl bei, falls es das Genre noch gibt.
 * @returns {void}
 */
function refreshTagFilter(){
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
 * Alle Spurnamen aus den Partituren.
 * @returns {string[]} alphabetisch, ohne Duplikate
 */
function knownTracks(){
  return [...new Set(SONGS.flatMap(s => s.tracks))].sort((a, b) => a.localeCompare(b, 'de'));
}

/**
 * Baut die Optionen des Spur-Filters neu auf: alle Spurnamen, nach einer Trennlinie "Mit Audio" und "Ohne Audio".
 * Behält die Auswahl bei, falls es sie noch gibt.
 * @returns {void}
 */
function refreshTrackFilter(){
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
function hasTrack(s, track){
  if(track === WITH_AUDIO) return s.files.includes('audio');
  if(track === WITHOUT_AUDIO) return !s.files.includes('audio');
  return s.tracks.includes(track);
}

/**
 * Aktualisiert Genre- und Spur-Filter, Anzahl im Kopfbereich und Liste.
 * @returns {void}
 */
function refreshLibrary(){
  refreshTagFilter();
  refreshTrackFilter();
  subCount.textContent = `${SONGS.length} ${SONGS.length === 1 ? 'Song' : 'Songs'}`;
  renderList();
}

/**
 * Zeichnet die Liste nach Suchbegriff, Genre- und Spur-Filter und Sortierung.
 * @returns {void}
 */
function renderList(){
  const q = searchInput.value.trim().toLowerCase();
  const tag = tagSel.value;
  const track = trackSel.value;
  let items = SONGS.slice();

  if(tag){
    items = items.filter(s => s.tags.includes(tag));
  }
  if(track){
    items = items.filter(s => hasTrack(s, track));
  }
  if(q){
    items = items.filter(s =>
      s.title.toLowerCase().includes(q)
      || (s.artist || '').toLowerCase().includes(q)
      || s.tags.some(t => t.toLowerCase().includes(q))
    );
  }

  const byTitle = (a, b) => a.title.localeCompare(b.title, 'de');
  switch(sortSel.value){
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
function saveViewState(){
  localStorage.setItem(VIEW_STATE_KEY, JSON.stringify({
    search: searchInput.value, tag: tagSel.value, track: trackSel.value, sort: sortSel.value,
  }));
}

/**
 * Liest den gemerkten Zustand der Liste.
 * @returns {{search?: string, tag?: string, track?: string, sort?: string}} leer, wenn nichts (Gültiges) gespeichert
 *   ist
 */
function loadViewState(){
  try {
    return JSON.parse(localStorage.getItem(VIEW_STATE_KEY) || '{}');
  } catch(err){
    return {};
  }
}

/**
 * Öffnet das Overlay mit Schließen-Button und dem übergebenen Inhalt.
 * @param {string} html Inhalt des Sheets
 * @returns {void}
 */
export function openOverlay(html){
  sheet.innerHTML = `<button class="close" id="closeBtn" type="button" aria-label="Schließen">&times;</button>${html}`;
  overlay.classList.add('open');
  document.getElementById('closeBtn').addEventListener('click', closeOverlay);
}

/**
 * Dialoge, die ein darübergelegter Dialog (z. B. das Cover aus dem Formular heraus) vorübergehend verdrängt hat.
 * Gemerkt werden die Elemente selbst, damit Eingaben und Listener erhalten bleiben.
 * @type {{nodes: Node[], formIsOpen: boolean, drag: Array<?function>}[]}
 */
const sheetStack = [];

/**
 * Legt einen Dialog über den gerade offenen. closeOverlay() schließt dann nur ihn und zeigt den vorigen wieder.
 * @param {string} html Inhalt des Sheets
 * @returns {void}
 */
function openStackedOverlay(html){
  sheetStack.push({
    nodes: [...sheet.childNodes],
    formIsOpen,
    drag: [overlay.ondragover, overlay.ondragleave, overlay.ondrop],
  });
  formIsOpen = false;
  overlay.ondragover = overlay.ondragleave = overlay.ondrop = null;
  openOverlay(html);
}

/**
 * Schließt den obersten Dialog. Lag darunter ein verdrängter Dialog, erscheint dieser wieder; sonst wird das
 * Overlay geschlossen, geleert und die Drag-&-Drop-Handler werden entfernt.
 * @returns {void}
 */
export function closeOverlay(){
  const previous = sheetStack.pop();
  if(previous){
    sheet.replaceChildren(...previous.nodes);
    formIsOpen = previous.formIsOpen;
    [overlay.ondragover, overlay.ondragleave, overlay.ondrop] = previous.drag;
    return;
  }
  formIsOpen = false;
  overlay.ondragover = overlay.ondragleave = overlay.ondrop = null;
  overlay.classList.remove('open');
  sheet.innerHTML = '';
}

/**
 * HTML eines einzeiligen Formularfelds mit Label.
 * @param {string} id ID des Eingabefelds
 * @param {string} label Beschriftung (HTML)
 * @param {*} value Vorbelegung, null/undefined ergibt ''
 * @param {string} [attrs] zusätzliche Attribute des input-Elements
 * @returns {string} HTML
 */
function field(id, label, value, attrs = ''){
  return `<div class="form-field">
    <label for="${id}">${label}</label>
    <input type="text" id="${id}" value="${escapeHtml(value ?? '')}" ${attrs}>
  </div>`;
}

/**
 * Inhalt des Cover-Felds im Formular: das Cover oder ein Platzhalter in der Farbe der Kachel.
 * @param {Song} s Lied
 * @returns {string} HTML
 */
function coverPickHtml(s){
  return s.files.includes('cover')
    ? `<img src="${escapeHtml(coverUrl(s))}" alt="">`
    : `<span class="cover-empty" style="--h:${placeholderHue(s.slug)}">Cover wählen</span>`;
}

/**
 * Verdrahtet das Feld "Akkorddatei" im Formular "Song bearbeiten": Hochladen per Auswahl oder Drag & Drop. Die Datei
 * wird sofort gespeichert (wie das Cover), unabhängig vom Formular.
 * @param {Song} s Lied des Formulars; updated wird nach dem Hochladen nachgeführt
 * @returns {void}
 */
function bindChordFileField(s){
  const hint = byId('chordFileHint');
  const field = byId('dropzone').closest('.form-field');
  bindDropzone(async file => {
    field.classList.add('busy');
    try {
      const saved = await uploadChordFile(s.slug, file);
      s.updated = saved.updated;
      storeSong(saved);
      hint.textContent = `${file.name} ist abgelegt und wird mit dem Editor in die Noten übernommen.`;
    } catch(err){
      hint.textContent = err.message;
    } finally {
      field.classList.remove('busy');
    }
  });
}

/**
 * Verdrahtet die Knöpfe der vorhandenen Genres unter dem Feld "Genre" (gespeichert als tags): Ein Klick nimmt das
 * Genre in die Liste im Textfeld auf oder entfernt es; Tippen im Textfeld hält die Knöpfe auf dem gleichen Stand.
 * @returns {void}
 */
function bindGenrePicks(){
  const input = byId('tagsInput');
  const picks = byId('genrePicks');
  const current = () => input.value.split(',').map(t => t.trim()).filter(Boolean);
  const sync = () => {
    const chosen = current();
    picks.querySelectorAll('[data-genre]').forEach(b => b.classList.toggle('on', chosen.includes(b.dataset.genre)));
  };
  picks.addEventListener('click', e => {
    const genre = /** @type {HTMLElement} */ (e.target).closest('[data-genre]')?.dataset.genre;
    if(!genre) return;
    const chosen = current();
    input.value = (chosen.includes(genre) ? chosen.filter(t => t !== genre) : [...chosen, genre]).join(', ');
    sync();
  });
  input.addEventListener('input', sync);
}

/** Wartezeit nach der letzten Eingabe in die YouTube-URL, bevor die Länge des Clips abgefragt wird. */
const YOUTUBE_LOOKUP_DELAY_MS = 500;

/**
 * Erkennt YouTube-URLs (watch?v=…, youtu.be/…, shorts/…, embed/…, live/…); Gruppe 1 ist die Video-ID.
 * Gleiches Muster wie youtube_id() in api/lib/youtube.php.
 */
const YOUTUBE_URL = new RegExp('^https?://(?:(?:www\\.|m\\.|music\\.)?youtube\\.com/(?:watch\\?(?:.*&)?v=|shorts/|embed/'
  + '|live/)|youtu\\.be/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])');

/**
 * Kurzform einer YouTube-URL ohne Playlist, Startzeit und andere Parameter (wie youtube_watch_url() in
 * api/lib/youtube.php; der Server kürzt beim Speichern noch einmal).
 * @param {string} url eingegebene URL
 * @returns {string} "https://www.youtube.com/watch?v=<ID>"; andere Eingaben unverändert
 */
function youtubeWatchUrl(url){
  const m = url.trim().match(YOUTUBE_URL);
  return m ? `https://www.youtube.com/watch?v=${m[1]}` : url;
}

/**
 * Verdrahtet die YouTube-Quelle im Formular: Link zur YouTube-Suche nach Interpret und Titel (wie die Trailersuche
 * der Videothek; die gefundene URL trägt man selbst ein) und die Länge des Clips neben dem Feld. Gespeichert wird die
 * Länge in song.json (youtubeSeconds); YouTube wird nur gefragt, wenn sich die URL ändert oder die Länge noch fehlt.
 * Darunter steht, wenn nötig, dass bin/audio.php die Audiospur einbinden muss (siehe updateAudioHint()).
 * @param {Song} s Lied des Formulars
 * @returns {() => ?number} liefert die Länge des Clips in Sekunden zum Speichern; null ohne URL oder solange sie
 *   unbekannt ist
 */
function bindYoutubeField(s){
  const search = /** @type {HTMLAnchorElement} */ (/** @type {*} */ (byId('youtubeSearch')));
  const updateSearch = () => {
    const words = [byId('artistInput').value.trim(), byId('titleInput').value.trim()];
    search.href = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(words.filter(Boolean).join(' '));
  };
  updateSearch();
  ['artistInput', 'titleInput'].forEach(id => byId(id).addEventListener('input', updateSearch));

  const input = byId('youtubeInput');
  const clipLength = byId('youtubeLength');
  /** Länge des Clips in Sekunden, null ohne URL oder solange sie unbekannt ist. */
  let seconds = s.sources.youtube ? (s.youtubeSeconds ?? null) : null;
  /** Zähler der Abfragen; eine Antwort zählt nur, wenn danach keine neue gestartet wurde. */
  let lookup = 0;
  const updateClipLength = async () => {
    const url = input.value.trim();
    const current = ++lookup;
    seconds = null;
    clipLength.textContent = url ? 'Clip …' : '';
    clipLength.title = '';
    if(!url) return;
    try {
      const info = await loadYoutubeInfo(url);
      if(current !== lookup) return;
      seconds = info.seconds;
      clipLength.textContent = `Clip ${formatTime(seconds * 1000)}`;
      clipLength.title = info.title;
    } catch(err){
      if(current !== lookup) return;
      clipLength.textContent = 'Clip ?';
      clipLength.title = err.message;
    }
  };
  if(seconds !== null) clipLength.textContent = `Clip ${formatTime(seconds * 1000)}`;
  else if(input.value.trim()) void updateClipLength();
  /** @type {?number} */
  let timer = null;
  input.addEventListener('input', () => {
    // Kopierte Links enthalten oft Playlist und Startzeit (&list=…&start_radio=1); nur die Video-ID bleibt.
    const short = youtubeWatchUrl(input.value);
    if(short !== input.value) input.value = short;
    updateAudioHint(s, short);
    clearTimeout(timer);
    timer = setTimeout(() => void updateClipLength(), YOUTUBE_LOOKUP_DELAY_MS);
  });
  updateAudioHint(s, input.value);
  return () => seconds;
}

/**
 * Hinweis unter dem YouTube-Feld: Die Audiospur holt bin/audio.php. Bei einem anderen Clip verschiebt der Server die
 * bisherige audio.mp3 beim Speichern (siehe update_song() in api/lib/crud.php).
 * @param {Song} s Lied des Formulars
 * @param {string} url eingegebene YouTube-URL
 * @returns {void}
 */
function updateAudioHint(s, url){
  const hint = byId('audioHint');
  const hasAudio = s.files?.includes('audio') ?? false;
  const changed = youtubeWatchUrl(url.trim()) !== youtubeWatchUrl((s.sources.youtube ?? '').trim());
  hint.textContent = !url.trim() ? ''
    : hasAudio && changed
      ? 'Anderer Clip: Beim Speichern wird die bisherige Audiospur entfernt. Danach bin/audio.php ausführen, um '
        + 'die neue einzubinden, und die Sync-Punkte prüfen.'
      : !hasAudio ? 'Noch keine Audiospur: bin/audio.php ausführen, um sie einzubinden.' : '';
  hint.hidden = !hint.textContent;
}

/**
 * Zeigt neben den Quellen die Längen der Noten (im eigenen Tempo) und der vorhandenen MP3, damit man sieht, ob der
 * YouTube-Clip zu den Noten passt. Beides wird bei jedem Öffnen aus den eigenen Dateien gemessen.
 * @param {Song} s Lied des Formulars (nur beim Bearbeiten; ein neues Lied hat weder Noten noch MP3)
 * @returns {void}
 */
function showFileLengths(s){
  const scoreLength = byId('scoreLength');
  scoreLength.textContent = 'Noten …';
  // Nacheinander statt mit Promise.all: Dort verliert die IDE die Typen der einzelnen Ergebnisse.
  void (async () => {
    const alphaTab = await loadAlphaTab();
    const tex = await loadScoreText(s.slug);
    scoreLength.textContent = `Noten ${formatTime(scoreDuration(alphaTab, parseScore(alphaTab, tex)))}`;
  })()
    .catch(err => {
      scoreLength.textContent = 'Noten ?';
      scoreLength.title = err.message;
    });

  if(!s.files.includes('audio')) return;
  // Nur die Metadaten der MP3 laden; danach die Verbindung wieder freigeben.
  const audioLength = byId('audioLength');
  const audio = new Audio();
  audio.preload = 'metadata';
  audio.addEventListener('loadedmetadata', () => {
    audioLength.textContent = `MP3 ${formatTime(audio.duration * 1000)}`;
    audio.removeAttribute('src');
    audio.load();
  }, {once: true});
  audio.addEventListener('error', () => {
    if(audio.getAttribute('src')) audioLength.textContent = 'MP3 ?';
  }, {once: true});
  audio.src = audioUrl(s.slug);
}

/**
 * Formular zum Anlegen oder Bearbeiten eines Lieds. Beim Anlegen erzeugt der Browser Noten mit leeren Takten
 * (siehe createScore() in score.js), denn jeder Song hat Noten; Tonart, Capo, Tempo und Stimmung gehen nur dort hinein
 * und werden später im Editor geändert. Beim Bearbeiten steht das Cover neben Titel und Interpret; ein Klick darauf
 * öffnet den Cover-Dialog über dem Formular (Eingaben bleiben erhalten).
 * @param {?Song} song zu bearbeitendes Lied, null zum Anlegen
 * @param {(saved: Song) => void} onSaved wird nach erfolgreichem Speichern aufgerufen
 * @param {{ultimateGuitar?: string}} [sources] Vorbelegung der Quellen beim Anlegen (z. B. aus dem Import-Dialog)
 * @returns {void}
 */
export function openSongForm(song, onSaved, sources = {}){
  const isEdit = song !== null;
  const s = song ?? /** @type {Song} */ ({tags: [], sources: {...sources}});
  formIsOpen = true;

  const nameFields = `
    ${field('titleInput', 'Titel', s.title)}
    ${field('artistInput', 'Interpret', s.artist, 'list="artistList" autocomplete="off"')}`;
  openOverlay(`
    <h2>${isEdit ? 'Song bearbeiten' : 'Neuer Song'}</h2>
    <div id="formError"></div>
    ${isEdit ? `<div class="form-head">
      <button class="cover-pick" id="coverPick" type="button" title="Cover ändern">${coverPickHtml(s)}</button>
      <div>${nameFields}</div>
    </div>` : nameFields}
    <datalist id="artistList">${[...new Set(SONGS.map(x => x.artist).filter(Boolean))].map(a => `<option value="${escapeHtml(a)}">`).join('')}</datalist>
    <div class="form-grid">
      ${isEdit ? '' : `
        ${field('keyInput', 'Tonart', '', 'placeholder="z. B. G oder Am"')}
        ${field('capoInput', 'Capo', '', 'inputmode="numeric" placeholder="0"')}
        ${field('tempoInput', 'Tempo (BPM)', '', 'inputmode="numeric" placeholder="120"')}`}
      <div class="form-field">
        <label for="techniqueInput">Spieltechnik</label>
        <select id="techniqueInput">
          <option value="">–</option>
          <option value="strumming"${s.technique === 'strumming' ? ' selected' : ''}>Strumming</option>
          <option value="fingerpicking"${s.technique === 'fingerpicking' ? ' selected' : ''}>Fingerpicking</option>
        </select>
      </div>
    </div>
    ${isEdit ? '' : `<div class="form-field">
      <label for="tuningInput">Stimmung</label>
      <input type="text" id="tuningInput" placeholder="E A D G B E">
      <div class="hint">Tonart, Capo, Tempo und Stimmung gehen in die Noten und werden dort später geändert.</div>
    </div>`}
    <div class="form-field">
      <label for="tagsInput">Genre</label>
      <input type="text" id="tagsInput" value="${escapeHtml(s.tags.join(', '))}"
        placeholder="z. B. Rock &amp; Pop, Weihnachtslied">
      <div class="genre-picks" id="genrePicks">${knownTags().map(t => `<button class="tag-pick${
        s.tags.includes(t) ? ' on' : ''}" type="button" data-genre="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join('')}</div>
      <div class="hint">Mehrere durch Komma trennen, vorhandene per Klick an- und abwählen.</div>
    </div>
    ${field('ugInput', `Quelle für Guitar-Pro-Datei${isEdit ? '<span class="lengths" id="scoreLength"></span>' : ''}`,
    s.sources.ultimateGuitar, 'inputmode="url"')}
    <div class="form-field">
      <label for="youtubeInput">Quelle für Audio-Datei (YouTube-URL)<span class="lengths"><span
        id="youtubeLength"></span><span id="audioLength"></span></span></label>
      <input type="text" id="youtubeInput" value="${escapeHtml(s.sources.youtube ?? '')}" inputmode="url"
        placeholder="https://www.youtube.com/watch?v=…">
      <a class="field-link" id="youtubeSearch" href="#" target="_blank" rel="noopener">Auf YouTube suchen</a>
      <div class="hint" id="audioHint" hidden></div>
    </div>
    <div class="form-field">
      <label for="notesInput">Notizen</label>
      <textarea id="notesInput" rows="6">${escapeHtml(s.notes ?? '')}</textarea>
    </div>
    ${isEdit ? `<div class="form-field">
      <span class="label">Akkorddatei</span>
      <label class="dropzone" id="dropzone">
        <input type="file" id="chordFileInput" accept=".cho,.chopro,.crd,.pro,.txt">
        <span>ChordPro- oder Textdatei hierher ziehen oder tippen zum Auswählen</span>
      </label>
      <div class="hint" id="chordFileHint">Text und Akkorde stehen in den Noten. Eine Akkorddatei wird abgelegt und
        mit dem Editor eingearbeitet; vorhandener Text hat dabei Vorrang.</div>
    </div>` : ''}
    <div class="btn-row">
      <button class="btn btn-primary" id="saveBtn" type="button">Speichern</button>
      <button class="btn" id="cancelBtn" type="button">Abbrechen</button>
    </div>
  `);

  byId('cancelBtn').addEventListener('click', closeOverlay);
  // Das Cover wird im Dialog sofort gespeichert, unabhängig vom Speichern des Formulars.
  byId('coverPick')?.addEventListener('click', () => openCoverForm(s, saved => {
    s.files = saved.files;
    s.updated = saved.updated;
    byId('coverPick').innerHTML = coverPickHtml(s);
  }, {artist: byId('artistInput').value.trim(), title: byId('titleInput').value.trim() || s.title}));

  if(isEdit) bindChordFileField(s);
  const clipSeconds = bindYoutubeField(s);
  bindGenrePicks();
  if(isEdit) showFileLengths(s);

  byId('saveBtn').addEventListener('click', async () => {
    const errorBox = byId('formError');
    errorBox.innerHTML = '';
    const payload = {
      title: byId('titleInput').value.trim(),
      artist: byId('artistInput').value.trim(),
      technique: byId('techniqueInput').value,
      tags: byId('tagsInput').value.split(',').map(t => t.trim()).filter(Boolean),
      sources: {
        youtube: youtubeWatchUrl(byId('youtubeInput').value).trim(),
        ultimateGuitar: byId('ugInput').value.trim(),
      },
      youtubeSeconds: clipSeconds(),
      notes: byId('notesInput').value.trim(),
    };
    if(!payload.title){
      errorBox.innerHTML = '<div class="error-box">Titel ist erforderlich.</div>';
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
        : await importSong(payload, await createScore({
          key: byId('keyInput').value,
          capo: byId('capoInput').value,
          tempo: byId('tempoInput').value,
          tuning: byId('tuningInput').value,
        }));
    } catch(err){
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
 * "Interpret - Titel" aus dem Dateinamen, falls die GP-Datei selbst keinen Titel enthält.
 * @param {string} fileName Dateiname, z. B. "Bob Marley - Three Little Birds.gp"
 * @returns {{artist: string, title: string}} ohne " - " ist alles Titel
 */
function metaFromFileName(fileName){
  const base = fileName.replace(/\.[^.]+$/, '').trim();
  const m = base.match(/^(.+?)\s+-\s+(.+)$/);
  return m ? {artist: m[1].trim(), title: m[2].trim()} : {artist: '', title: base};
}

/**
 * Verdrahtet die Ablagefläche #dropzone im offenen Overlay: Auswahl über das Dateifeld darin oder Drag & Drop.
 * Abgelegt werden darf überall im Dialog. Ohne preventDefault() würde der Browser die Datei selbst öffnen.
 * closeOverlay() entfernt die Handler wieder.
 * @param {(file: File) => void} onFile wird mit der gewählten bzw. abgelegten Datei aufgerufen
 * @returns {void}
 */
function bindDropzone(onFile){
  const dropzone = document.getElementById('dropzone');
  const input = /** @type {HTMLInputElement} */ (dropzone.querySelector('input[type="file"]'));
  input.addEventListener('change', () => {
    if(input.files[0]) onFile(input.files[0]);
  });
  overlay.ondragover = e => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  };
  overlay.ondragleave = e => {
    if(!overlay.contains(/** @type {Node} */ (e.relatedTarget))) dropzone.classList.remove('dragover');
  };
  overlay.ondrop = e => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    const dropped = e.dataTransfer?.files[0];
    if(dropped) onFile(dropped);
  };
}

/**
 * Dialog "Song importieren" hinter "+ Neuer Song": Import einer Guitar-Pro-Datei als neuer Song (wie der Rezept-Import
 * im Kochbuch). "Manuell" legt den Song ohne GP-Datei im Formular an (wie "Manuell" im Import-Dialog der Videothek).
 * @param {(saved: Song) => void} onImported wird nach erfolgreichem Import aufgerufen
 * @returns {void}
 */
export function openImportForm(onImported){
  formIsOpen = true;
  openOverlay(`
    <h2>Song importieren</h2>
    <div id="formError"></div>
    <div class="form-field">
      <label for="gpInput">Guitar-Pro-Datei</label>
      <label class="dropzone" id="dropzone">
        <input type="file" id="gpInput" accept=".gp,.gpx,.gp5,.gp4,.gp3">
        <span id="dropzoneText">Datei hierherziehen oder tippen zum Auswählen</span>
      </label>
      <div class="hint">GP3 bis GP8, z. B. von
        <a href="https://www.ultimate-guitar.com/explore?type[]=Pro" target="_blank" rel="noopener">Ultimate Guitar</a>
        (Download unter "Tabs" vom Typ "Guitar Pro").</div>
    </div>
    ${field('importUgInput', 'Quelle', '',
    'inputmode="url" placeholder="https://tabs.ultimate-guitar.com/tab/…"')}
    <div class="btn-row">
      <button class="btn btn-primary" id="importSubmitBtn" type="button">Importieren</button>
      <button class="btn" id="manualBtn" type="button" title="Ohne Guitar-Pro-Datei von Hand anlegen">Manuell</button>
      <button class="btn" id="cancelBtn" type="button">Abbrechen</button>
    </div>
  `);

  /** @type {?File} per Auswahl oder Drag & Drop */
  let file = null;
  bindDropzone(f => {
    file = f;
    byId('dropzoneText').textContent = f.name;
    byId('dropzone').classList.add('has-file');
  });

  byId('cancelBtn').addEventListener('click', closeOverlay);
  byId('manualBtn').addEventListener('click', () => {
    // Eine schon eingetragene Quelle geht ins Formular mit.
    const ultimateGuitar = byId('importUgInput').value.trim();
    closeOverlay();
    openSongForm(null, onImported, ultimateGuitar ? {ultimateGuitar} : {});
  });
  byId('importSubmitBtn').addEventListener('click', async () => {
    const errorBox = byId('formError');
    errorBox.innerHTML = '';
    if(!file){
      errorBox.innerHTML = '<div class="error-box">Bitte eine Datei wählen.</div>';
      return;
    }

    const btn = byId('importSubmitBtn');
    btn.disabled = true;
    btn.textContent = 'Importiert …';
    try {
      const {meta, tex} = await readGpFile(file);
      if(!meta.title){
        Object.assign(meta, metaFromFileName(file.name), meta.artist ? {artist: meta.artist} : {});
      }
      // Die Quelle (z. B. die Seite des Tabs bei Ultimate Guitar) gleich mitspeichern.
      const ultimateGuitar = byId('importUgInput').value.trim();
      const saved = await importSong({...meta, sources: ultimateGuitar ? {ultimateGuitar} : {}}, tex, file);
      storeSong(saved);
      closeOverlay();
      onImported(saved);
    } catch(err){
      errorBox.innerHTML = `<div class="error-box">${escapeHtml(err.message)}</div>`;
      btn.disabled = false;
      btn.textContent = 'Importieren';
    }
  });
}

/**
 * Kantenlänge, auf die die kürzere Seite eigener Cover vor dem Hochladen höchstens verkleinert wird (wie bei
 * Deezer/iTunes). Der Server schneidet das Bild danach mittig auf COVER_MAX_SIZE × COVER_MAX_SIZE zu.
 */
const COVER_MAX_SIZE = 500;

/**
 * Wandelt ein beliebiges Bild im Browser in ein JPEG um und verkleinert es so, dass die kürzere Seite höchstens
 * COVER_MAX_SIZE misst (kleinere Uploads; das Quadrat schneidet der Server aus, siehe crop_cover() in
 * api/lib/cover.php).
 * @param {File} file Bilddatei (JPEG, PNG, WebP, …)
 * @returns {Promise<Blob>} JPEG
 */
async function toCoverJpeg(file){
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('Die Datei ist kein lesbares Bild.');
  });
  const scale = Math.min(1, COVER_MAX_SIZE / Math.min(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob(
    blob => blob ? resolve(blob) : reject(new Error('Bild konnte nicht umgewandelt werden.')),
    'image/jpeg',
    0.88
  ));
}

/**
 * Dialog zum Ändern des Covers: Treffer von Deezer und iTunes zur Auswahl, eigenes Bild hochladen, Cover entfernen.
 * Die Suche startet sofort mit Interpret und Titel des Lieds; beides lässt sich für eine neue Suche ändern.
 * @param {Song} song Lied
 * @param {(saved: Song) => void} onSaved wird nach jeder Änderung aufgerufen
 * @param {{artist: ?string, title: string}} [query] Vorbelegung der Suche, sonst Interpret und Titel des Lieds
 * @returns {void}
 */
function openCoverForm(song, onSaved, query = song){
  // Aus einem offenen Formular heraus über diesem öffnen, damit dessen Eingaben erhalten bleiben.
  const open = overlay.classList.contains('open') ? openStackedOverlay : openOverlay;
  open(`
    <h2>Cover</h2>
    <div id="formError"></div>
    <div class="form-grid">
      ${field('coverArtist', 'Interpret', query.artist)}
      ${field('coverTitle', 'Titel', query.title)}
    </div>
    <div class="btn-row"><button class="btn" id="coverSearchBtn" type="button">Suchen</button></div>
    <div class="cover-results" id="coverResults"></div>
    <div class="form-field">
      <label for="coverInput">Eigenes Bild</label>
      <label class="dropzone" id="dropzone">
        <input type="file" id="coverInput" accept="image/*">
        <span>Bild hierherziehen oder tippen zum Auswählen</span>
      </label>
      <a class="field-link" id="coverWebSearch" href="#" target="_blank" rel="noopener">Bilder bei DuckDuckGo suchen</a>
    </div>
    <div class="btn-row">
      ${song.files.includes('cover')
        ? '<button class="btn btn-danger" id="coverDeleteBtn" type="button">Cover entfernen</button>'
        : ''}
      <button class="btn" id="cancelBtn" type="button">Schließen</button>
    </div>
  `);

  const results = byId('coverResults');
  /**
   * Führt eine Änderung aus, übernimmt das Ergebnis und schließt den Dialog; Fehler erscheinen im Dialog.
   * @param {() => Promise<Song>} action API-Aufruf
   * @returns {Promise<void>}
   */
  const apply = async action => {
    byId('formError').innerHTML = '';
    sheet.classList.add('busy');
    try {
      const saved = await action();
      storeSong(saved);
      closeOverlay();
      onSaved(saved);
    } catch(err){
      byId('formError').innerHTML = `<div class="error-box">${escapeHtml(err.message)}</div>`;
    } finally {
      sheet.classList.remove('busy');
    }
  };
  /**
   * Sucht mit den Werten aus den Feldern und zeigt die Treffer.
   * @returns {Promise<void>}
   */
  const search = async () => {
    const title = byId('coverTitle').value.trim();
    if(!title) return;
    results.innerHTML = '<p class="hint">Suche läuft &hellip;</p>';
    try {
      const hits = await searchCovers(byId('coverArtist').value.trim(), title);
      results.innerHTML = hits.length
        ? hits.map((h, i) => `<button class="cover-hit" type="button" data-hit="${i}" title="${escapeHtml(`${h.artist} – ${h.album}`)}">
            <img src="${escapeHtml(h.preview)}" alt="" loading="lazy">
            <span>${escapeHtml(h.album)}</span>
            <small>${h.source === 'deezer' ? 'Deezer' : 'iTunes'}</small>
          </button>`).join('')
        : '<p class="hint">Keine Treffer.</p>';
      results.onclick = e => {
        const btn = /** @type {HTMLElement} */ (e.target).closest('[data-hit]');
        if(btn) void apply(() => setCover(song.slug, hits[Number(btn.dataset.hit)].url));
      };
    } catch(err){
      results.innerHTML = `<p class="hint">${escapeHtml(err.message)}</p>`;
    }
  };

  // Weitere Bilder: DuckDuckGo-Bildersuche nach Interpret und Titel; das gefundene Bild lädt man als eigenes Bild hoch.
  const webSearch = /** @type {HTMLAnchorElement} */ (/** @type {*} */ (byId('coverWebSearch')));
  const updateWebSearch = () => {
    const words = [byId('coverArtist').value.trim(), byId('coverTitle').value.trim()].filter(Boolean).join(' ');
    webSearch.href = `https://duckduckgo.com/?${new URLSearchParams({q: words, ia: 'images', iax: 'images'})}`;
  };
  updateWebSearch();

  byId('coverSearchBtn').addEventListener('click', () => void search());
  for(const id of ['coverArtist', 'coverTitle']){
    byId(id).addEventListener('keydown', e => { if(e.key === 'Enter') void search(); });
    byId(id).addEventListener('input', updateWebSearch);
  }
  bindDropzone(file => void apply(async () => uploadCover(song.slug, await toCoverJpeg(file))));
  byId('coverDeleteBtn')?.addEventListener('click', () => void apply(() => deleteCover(song.slug)));
  byId('cancelBtn').addEventListener('click', closeOverlay);
  void search();
}

/**
 * Fragt nach und löscht das Lied.
 * @param {Song} song zu löschendes Lied
 * @returns {Promise<boolean>} true, wenn gelöscht
 */
export async function deleteSongUI(song){
  if(!window.confirm(`„${song.title}“ samt aller Dateien wirklich unwiderruflich löschen?`)) return false;
  try {
    await apiWrite(`${API_URL}songs.php?slug=${encodeURIComponent(song.slug)}`, {method: 'DELETE'});
    removeSong(song.slug);
    return true;
  } catch(err){
    alert('Löschen fehlgeschlagen: ' + err.message);
    return false;
  }
}

/**
 * Lädt die Liederliste und verdrahtet Suche, Filter und Overlay.
 * @returns {Promise<void>}
 */
export async function initLibrary(){
  overlay.addEventListener('click', e => {
    if(e.target === overlay && !formIsOpen) closeOverlay();
  });
  document.addEventListener('keydown', e => {
    if(e.key === 'Escape' && !formIsOpen) closeOverlay();
  });
  const onFilterChange = () => {
    saveViewState();
    renderList();
  };
  searchInput.addEventListener('input', onFilterChange);
  sortSel.addEventListener('change', onFilterChange);
  tagSel.addEventListener('change', onFilterChange);
  trackSel.addEventListener('change', onFilterChange);

  SONGS = await loadSongs();
  refreshTagFilter();
  refreshTrackFilter();

  // Suchbegriff/Filter/Sortierung vom letzten Besuch wiederherstellen (Genre und Spur nur, wenn es sie noch gibt).
  const saved = loadViewState();
  if(saved.search) searchInput.value = saved.search;
  if(saved.sort && [...sortSel.options].some(o => o.value === saved.sort)) sortSel.value = saved.sort;
  if(saved.tag && [...tagSel.options].some(o => o.value === saved.tag)) tagSel.value = saved.tag;
  if(saved.track && [...trackSel.options].some(o => !o.disabled && o.value === saved.track)) trackSel.value = saved.track;

  refreshLibrary();
}
