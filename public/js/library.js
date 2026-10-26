/**
 * Liederliste mit Suche, Tag-Filter und Sortierung sowie das Formular zum Anlegen und Bearbeiten eines Lieds
 * (Overlay wie beim Kochbuch) sowie der Import einer GP-Datei als neues Lied. Titel, Interpret usw. liest dabei
 * alphaTab im Browser aus der Datei.
 */

import {
  API_URL, apiWrite, coverUrl, deleteCover, escapeHtml, importGpFile, loadSongs, searchCovers, setCover, uploadCover,
} from './api.js';
import {readGpMetadata} from './player.js';

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

/** Schlüssel im `localStorage` für den Suchbegriff, Tag-Filter und Sortierung der Liste. */
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
 * Kurzinfo unter dem Titel: Tonart, Capo, abweichende Stimmung, Tempo.
 * @param {Song} s Lied
 * @returns {string} Angaben, mit " · " getrennt (leer, wenn keine vorhanden)
 */
export function songMeta(s){
  return [
    s.key && `Tonart ${s.key}`,
    s.capo ? `Capo ${s.capo}` : null,
    s.tuning && s.tuning !== 'E A D G B E' ? s.tuning : null,
    s.tempo && `${s.tempo} BPM`,
  ].filter(Boolean).join(' · ');
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
  const badges = [
    s.files.score && '<span class="badge">Noten</span>',
    s.files.audio && '<span class="badge">Audio</span>',
    s.files.lyrics && '<span class="badge">Text</span>',
  ].filter(Boolean).join('');
  const thumb = s.files.cover
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
 * Alle verwendeten Tags.
 * @returns {string[]} alphabetisch, ohne Duplikate
 */
function knownTags(){
  return [...new Set(SONGS.flatMap(s => s.tags))].sort((a, b) => a.localeCompare(b, 'de'));
}

/**
 * Baut die Tag-Filter-Optionen neu auf und behält die Auswahl bei, falls es den Tag noch gibt.
 * @returns {void}
 */
function refreshTagFilter(){
  const tags = knownTags();
  const current = tagSel.value;
  tagSel.innerHTML = '<option value="">Alle Tags</option>' + tags.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
  tagSel.value = tags.includes(current) ? current : '';
}

/**
 * Aktualisiert Tag-Filter, Anzahl im Kopfbereich und Liste.
 * @returns {void}
 */
function refreshLibrary(){
  refreshTagFilter();
  subCount.textContent = `${SONGS.length} ${SONGS.length === 1 ? 'Lied' : 'Lieder'}`;
  renderList();
}

/**
 * Zeichnet die Liste nach Suchbegriff, Tag-Filter und Sortierung.
 * @returns {void}
 */
function renderList(){
  const q = searchInput.value.trim().toLowerCase();
  const tag = tagSel.value;
  let items = SONGS.slice();

  if(tag){
    items = items.filter(s => s.tags.includes(tag));
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

  resultCount.textContent = `${items.length} von ${SONGS.length} Liedern`;
  list.innerHTML = items.length
    ? items.map(cardHtml).join('')
    : `<p class="empty">${SONGS.length ? 'Keine Lieder gefunden.' : 'Noch keine Lieder. Leg mit „+ Neues Lied“ das erste an.'}</p>`;
}

/**
 * Merkt sich Suchbegriff, Tag-Filter und Sortierung im localStorage.
 * @returns {void}
 */
function saveViewState(){
  localStorage.setItem(VIEW_STATE_KEY, JSON.stringify({search: searchInput.value, tag: tagSel.value, sort: sortSel.value}));
}

/**
 * Liest den gemerkten Zustand der Liste.
 * @returns {{search?: string, tag?: string, sort?: string}} leer, wenn nichts (Gültiges) gespeichert ist
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
  return s.files.cover
    ? `<img src="${escapeHtml(coverUrl(s))}" alt="">`
    : `<span class="cover-empty" style="--h:${placeholderHue(s.slug)}">Cover wählen</span>`;
}

/**
 * Formular zum Anlegen oder Bearbeiten eines Lieds. Beim Bearbeiten steht das Cover neben Titel und Interpret;
 * ein Klick darauf öffnet den Cover-Dialog über dem Formular (Eingaben bleiben erhalten).
 * @param {?Song} song zu bearbeitendes Lied, null zum Anlegen
 * @param {(saved: Song) => void} onSaved wird nach erfolgreichem Speichern aufgerufen
 * @returns {void}
 */
export function openSongForm(song, onSaved){
  const isEdit = song !== null;
  const s = song ?? /** @type {Song} */ ({tags: [], sources: {}});
  formIsOpen = true;

  const nameFields = `
    ${field('titleInput', 'Titel', s.title)}
    ${field('artistInput', 'Interpret', s.artist, 'list="artistList" autocomplete="off"')}`;
  openOverlay(`
    <h2>${isEdit ? 'Song bearbeiten' : 'Neues Lied'}</h2>
    <div id="formError"></div>
    ${isEdit ? `<div class="form-head">
      <button class="cover-pick" id="coverPick" type="button" title="Cover ändern">${coverPickHtml(s)}</button>
      <div>${nameFields}</div>
    </div>` : nameFields}
    <datalist id="artistList">${[...new Set(SONGS.map(x => x.artist).filter(Boolean))].map(a => `<option value="${escapeHtml(a)}">`).join('')}</datalist>
    <div class="form-grid">
      ${field('keyInput', 'Tonart', s.key, 'placeholder="z. B. G oder Am"')}
      ${field('capoInput', 'Capo', s.capo || '', 'inputmode="numeric" placeholder="0"')}
      ${field('tempoInput', 'Tempo (BPM)', s.tempo, 'inputmode="numeric"')}
      <div class="form-field">
        <label for="techniqueInput">Spieltechnik</label>
        <select id="techniqueInput">
          <option value="">–</option>
          <option value="strumming"${s.technique === 'strumming' ? ' selected' : ''}>Strumming</option>
          <option value="fingerpicking"${s.technique === 'fingerpicking' ? ' selected' : ''}>Fingerpicking</option>
        </select>
      </div>
    </div>
    ${field('tuningInput', 'Stimmung', s.tuning, 'placeholder="E A D G B E"')}
    ${field('tagsInput', 'Tags', s.tags.join(', '), 'placeholder="z. B. 70er, Lagerfeuer"')}
    ${field('youtubeInput', 'YouTube-URL', s.sources.youtube, 'inputmode="url"')}
    ${field('ugInput', 'Ultimate-Guitar-URL', s.sources.ultimateGuitar, 'inputmode="url"')}
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

  byId('saveBtn').addEventListener('click', async () => {
    const errorBox = byId('formError');
    errorBox.innerHTML = '';
    const payload = {
      title: byId('titleInput').value.trim(),
      artist: byId('artistInput').value.trim(),
      key: byId('keyInput').value.trim(),
      capo: byId('capoInput').value.trim(),
      tempo: byId('tempoInput').value.trim(),
      technique: byId('techniqueInput').value,
      tuning: byId('tuningInput').value.trim(),
      tags: byId('tagsInput').value.split(',').map(t => t.trim()).filter(Boolean),
      sources: {youtube: byId('youtubeInput').value.trim(), ultimateGuitar: byId('ugInput').value.trim()},
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
      const url = isEdit ? `${API_URL}songs.php?slug=${encodeURIComponent(s.slug)}` : API_URL + 'songs.php';
      saved = await apiWrite(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload),
      });
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
 * Formular zum Import einer Guitar-Pro-Datei als neues Lied (wie der Rezept-Import im Kochbuch).
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
    <div class="btn-row">
      <button class="btn btn-primary" id="importSubmitBtn" type="button">Importieren</button>
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
      const meta = await readGpMetadata(file).catch(() => {
        throw new Error('Die Datei konnte nicht als Guitar-Pro-Datei gelesen werden.');
      });
      if(!meta.title){
        Object.assign(meta, metaFromFileName(file.name), meta.artist ? {artist: meta.artist} : {});
      }
      const saved = await importGpFile(file, meta);
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

/** Kantenlänge, auf den eigenen Cover vor dem Hochladen höchstens verkleinert werden (wie bei Deezer/iTunes). */
const COVER_MAX_SIZE = 500;

/**
 * Wandelt ein beliebiges Bild im Browser in ein JPEG um und verkleinert es auf höchstens COVER_MAX_SIZE.
 * So braucht der Server zum Speichern kein GD.
 * @param {File} file Bilddatei (JPEG, PNG, WebP, …)
 * @returns {Promise<Blob>} JPEG
 */
async function toCoverJpeg(file){
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('Die Datei ist kein lesbares Bild.');
  });
  const scale = Math.min(1, COVER_MAX_SIZE / Math.max(bitmap.width, bitmap.height));
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
export function openCoverForm(song, onSaved, query = song){
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
    </div>
    <div class="btn-row">
      ${song.files.cover ? '<button class="btn btn-danger" id="coverDeleteBtn" type="button">Cover entfernen</button>' : ''}
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

  byId('coverSearchBtn').addEventListener('click', () => void search());
  for(const id of ['coverArtist', 'coverTitle']){
    byId(id).addEventListener('keydown', e => { if(e.key === 'Enter') void search(); });
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

  SONGS = await loadSongs();
  refreshTagFilter();

  // Suchbegriff/Filter/Sortierung vom letzten Besuch wiederherstellen (Tag nur, wenn es ihn noch gibt).
  const saved = loadViewState();
  if(saved.search) searchInput.value = saved.search;
  if(saved.sort && [...sortSel.options].some(o => o.value === saved.sort)) sortSel.value = saved.sort;
  if(saved.tag && [...tagSel.options].some(o => o.value === saved.tag)) tagSel.value = saved.tag;

  refreshLibrary();
}
