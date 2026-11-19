/**
 * Einstieg des Frontends: Routing zwischen Liederliste (#/) und Liedansicht (#/song/<slug>); Akkorde, Patterns und
 * Griffbrett öffnen aus dem Menü der Liederliste als Dialog. Die eigentliche Arbeit steckt in den ES-Modulen unter js/.
 */

import {
  chordDiagramSvg, coverUrl, escapeHtml, fretboardSvg, loadAudio, loadChordLibrary, loadPatterns,
  loadScoreText, NOTE_LABELS, structureOf, STRUCTURES,
} from './js/base.js';
import {NoteEditor} from './js/editor.js';
import {
  closeOverlay, findSong, initLibrary, openImportForm, openOverlay, openSongForm, storeSong,
} from './js/library.js';
import {describeScoreInfo, exportGpFile} from './js/notation.js';
import {Player, SCALES} from './js/playback.js';
import {patternGridHtml, TECHNIQUES} from './js/sheet.js';
import {exportChordProFile} from './js/textview.js';

/** @typedef {import('./js/base.js').Song} Song */
/** @typedef {import('./js/notation.js').ScoreInfo} ScoreInfo */

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
 * Bearbeitungsmodus der Liedansicht, null, wenn er aus ist.
 * @type {?NoteEditor}
 */
let noteEditor = null;

/** Hash der Liederliste (die Seiten sind Hash-Pfade, keine Sprungmarken). */
const LIST_HASH = '#/';
/** Hash der Seite mit den Griffbildern. */
/** Hash der Seite mit dem Griffbrett. */

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
  libraryView.hidden = false;
  document.title = 'Gitarrenbuch';
}

/**
 * Beendet die Liedansicht (Player, Bearbeitungsmodus) und leert sie.
 * @returns {void}
 */
function leaveSong(){
  closeNoteEditor();
  player?.destroy();
  player = null;
  songView.hidden = true;
  songView.classList.remove('is-playing');
  songView.innerHTML = '';
}

/**
 * Akkordname zum Anzeigen: Der Katalog schreibt klein ("f#m", "d/f#").
 * @param {string} key Schlüssel des Katalogs
 * @returns {string} z. B. "F#m", "D/F#"
 */
function chordDisplayName(key){
  return key.replace(/^[a-h]|\/[a-h]/g, s => s.toUpperCase());
}

/**
 * Zeigt alle Griffbilder des Akkordkatalogs, je Akkord der häufigste Griff zuerst; zum Ausdrucken gedacht.
 * @returns {Promise<void>}
 */
async function showChordLibrary(){
  openOverlay(`
    <h2>Akkorde</h2>
    <p class="ov-meta">Die Akkorde der Songs nach Grundton, häufigster Griff zuerst</p>
    <div class="ov-tools">
        <button class="btn" type="button" id="toggleChords">Alle zuklappen</button>
        <button class="btn" type="button" id="printChords">Drucken</button>
    </div>
    <div class="chord-sheet" id="chordSheet"><p class="empty">wird geladen &hellip;</p></div>
  `, false, false, true);
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
    // Nach Grundton gruppieren; der Katalog ist schon nach Grundton sortiert.
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
      </details>`).join('') || '<p class="empty">Noch keine Akkorde: Sie erscheinen, sobald ein Song Noten mit Akkorden hat.</p>';
  } catch(err){
    sheet.innerHTML = `<p class="empty">${escapeHtml(err.message)}</p>`;
  }
}

/**
 * Zeigt den Pattern-Katalog (Strumming und Picking Patterns) zum Ansehen und Drucken, analog zu den Griffbildern.
 * @returns {Promise<void>}
 */
async function showPatternLibrary(){
  openOverlay(`
    <h2>Patterns</h2>
    <p class="ov-meta">Strumming und Picking Patterns</p>
    <div class="ov-tools">
      <div class="controls pattern-filter" id="patternFilter" hidden>
        <select id="patTsSel" aria-label="Nach Taktart filtern"><option value="">Alle Taktarten</option></select>
        <select id="patGenreSel" aria-label="Nach Genre filtern"><option value="">Alle Genres</option></select>
      </div>
      <button class="btn" type="button" id="toggleChords">Alle zuklappen</button>
      <button class="btn" type="button" id="printChords">Drucken</button>
    </div>
    <div class="chord-sheet" id="chordSheet"><p class="empty">wird geladen &hellip;</p></div>
  `, false, false, true);
  document.getElementById('printChords').addEventListener('click', () => window.print());
  const sheet = document.getElementById('chordSheet');
  const toggle = document.getElementById('toggleChords');
  const groupsOf = () => [...sheet.querySelectorAll('details.chord-root')];
  const updateToggle = () => {
    toggle.textContent = groupsOf().some(d => d.open) ? 'Alle zuklappen' : 'Alle aufklappen';
  };
  toggle.addEventListener('click', () => {
    const open = !groupsOf().some(d => d.open);
    for(const group of groupsOf()) group.open = open;
    updateToggle();
  });
  sheet.addEventListener('toggle', updateToggle, true);
  try {
    const {patterns: catalog, usage, genres: genresOf = {}} = await loadPatterns();
    // Genre eines Patterns = Genre der Songs, die es verwenden; ungenutzte Patterns haben keines.
    const patterns = catalog.map(p => ({...p, genres: genresOf[p.id] ?? []}));
    // Filter: "Filter für Taktart und Genre"): nur Werte, die es im Katalog gibt.
    const fill = (select, values, all) => {
      select.innerHTML = `<option value="">${all}</option>` + values.map(v =>
        `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    };
    const tsSel = /** @type {HTMLSelectElement} */ (document.getElementById('patTsSel'));
    const genreSel = /** @type {HTMLSelectElement} */ (document.getElementById('patGenreSel'));
    fill(tsSel, [...new Set(patterns.map(p => p.timeSignature))].sort((a, b) => a.localeCompare(b, 'de', {numeric: true})),
      'Alle Taktarten');
    const genres = [...new Set(patterns.flatMap(p => p.genres ?? []))].sort((a, b) => a.localeCompare(b, 'de'));
    fill(genreSel, genres, 'Alle Genres');
    genreSel.hidden = !genres.length;
    document.getElementById('patternFilter').hidden = false;
    const draw = () => {
      const shown = patterns.filter(p => (!tsSel.value || p.timeSignature === tsSel.value)
        && (!genreSel.value || (p.genres ?? []).includes(genreSel.value)));
      sheet.innerHTML = Object.entries(TECHNIQUES).map(([technique, label]) => {
        const group = shown.filter(p => p.technique === technique)
          .sort((a, b) => a.timeSignature.localeCompare(b.timeSignature) || a.name.localeCompare(b.name));
        if(!group.length) return '';
        // Je Taktart und je Bauart eine Zeile, damit Patterns mit einer Zeile mehr (zweiter Bass beim Picking Pattern)
        // nicht neben Patterns ohne stehen; in der Zeile gleich hohe Karten, das Raster unten, sodass Titel und
        // Zählzeiten auf einer Höhe liegen. Strumming Patterns halten immer Platz für die Betonung frei.
        /** @type {Map<string, import('./js/sheet.js').Pattern[]>} */
        const byRow = new Map();
        for(const p of group){
          const key = `${p.timeSignature}|${technique === 'picking' && /q/i.test(p.steps ?? '')}`;
          byRow.set(key, [...(byRow.get(key) ?? []), p]);
        }
        return `
          <details class="chord-root" open>
            <summary>${escapeHtml(label)}s</summary>
            ${[...byRow.values()].map(row => `<div class="chord-root-list pattern-list">${row.map(p => `
              <section class="chord-group pattern-card">
                <!-- Das Raster steht nur dabei, wenn es nicht der Normalfall (Achtel) ist. -->
                <h3>${escapeHtml(p.name)}</h3>
                <div class="pattern-meta">${escapeHtml(p.timeSignature)}${p.grid === 16 ? ' · Sechzehntel' : ''}${
                  usage[p.id] ? ` · ${usage[p.id]} Song${usage[p.id] === 1 ? '' : 's'}` : ''}</div>
                ${p.genres?.length ? `<div class="pattern-meta">${escapeHtml(p.genres.join(', '))}</div>` : ''}
                ${patternGridHtml(p, false, true)}
              </section>`).join('')}</div>`).join('')}
          </details>`;
      }).join('') || `<p class="empty">${patterns.length ? 'Kein Pattern passt zu diesem Filter.' : 'Der Katalog ist noch leer.'}</p>`;
      updateToggle();
    };
    tsSel.addEventListener('change', draw);
    genreSel.addEventListener('change', draw);
    draw();
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
  downloadFile(await exportGpFile(song, tex, audio));
}

/**
 * Lädt Text und Akkorde des Lieds als ChordPro-Datei (.cho) herunter.
 * @param {Song} song Lied
 * @returns {Promise<void>}
 */
async function downloadChordProFile(song){
  downloadFile(await exportChordProFile(song, await loadScoreText(song.slug)));
}

/**
 * Bietet eine im Browser erzeugte Datei zum Download an.
 * @param {File} file Datei
 * @returns {void}
 */
function downloadFile(file){
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
  libraryView.hidden = true;
  songView.hidden = false;
  document.title = `${song.title} – Gitarrenbuch`;
  window.scrollTo(0, 0);

  // Lage der Bedienelemente:
  // - Kopf: Cover, daneben Titel, Interpret und eine Zeile Eckdaten, jede mit "…" gekürzt, wenn sie nicht passt.
  //   Hinweise (Tempo, Sync-Punkte, Fehler in den Noten) stecken hinter einem Warnzeichen am Ende der Zeile.
  // - Streifen mit aktuellem Akkord, Griffbild und Patterns (füllt der Player): bleibt beim Scrollen stehen. Am PC
  //   steht er rechts neben dem Kopf, und die ganze Zeile bleibt stehen (.songtop, app.css).
  // - Schließen (zur Songliste): schwebt oben rechts, unauffällig halbtransparent, immer erreichbar.
  // - Alles andere liegt unten in der Abspielleiste, auch das Menü (der Player stellt den Platz, el.menuWrap).
  // - .songbar ist der Platz für die Werkzeugleiste des Bearbeitungsmodus (editor.js).
  const issues = (song.issues ?? []).map(i => `${i.label}: ${i.detail}`);
  songView.innerHTML = `
    <div class="songtop">
      <div class="songhead">
        ${song.files.includes('cover') ? `<img class="songhead-cover" src="${escapeHtml(coverUrl(song))}" alt="">` : ''}
        <div class="songhead-text">
          <h2 title="${escapeHtml(song.title)}">${escapeHtml(song.title)}</h2>
          <div class="songhead-artist">${escapeHtml(song.artist ?? '')}</div>
          <div class="songhead-info"><span id="songMeta"></span><button type="button" class="songhead-warn"
            id="songWarn" hidden aria-expanded="false" aria-label="Hinweise" title="Hinweise">&#9888;</button></div>
        </div>
      </div>
      <div class="songstrip" id="songStrip" hidden></div>
    </div>
    <div class="song-notes" id="songNotes" hidden></div>
    <a class="song-close" href="${LIST_HASH}" aria-label="Zur Songliste" title="Zur Songliste">&#10005;</a>
    <div class="songbar"></div>
    <div id="playerRoot"></div>
  `;
  // Menü: Knopf und Liste; der Player setzt beides in die Abspielleiste.
  const menuWrap = document.createElement('div');
  menuWrap.className = 'songbar-menu';
  menuWrap.innerHTML = `
    <button class="tbtn" id="menuBtn" type="button" aria-label="Menü" aria-expanded="false">&#8942;</button>
    <div class="menu" id="menu" hidden>
      <button type="button" id="noteEditBtn" title="Noten, Text, Akkorde, Spuren, Leadsheet, Audio">Bearbeiten</button>
      <button type="button" id="songDataBtn">Stammdaten</button>
      <button type="button" id="displayBtn">Darstellung</button>
      <button type="button" id="exportBtn" title="Notation mit Audiospur als Guitar-Pro-Datei (.gp)">GP-Export</button>
      <button type="button" id="chordProBtn" title="Text und Akkorde als ChordPro-Datei (.cho)">CHO-Export</button>
    </div>`;
  songView.querySelector('.songhead').append(menuWrap);
  // Hinweise: Fehler in den Noten (vom Server) sofort, die aus dem Player (Tempo, Sync-Punkte) nach dem Laden.
  const warnBtn = document.getElementById('songWarn');
  const notesEl = document.getElementById('songNotes');
  const showWarnings = warnings => {
    const all = [...issues, ...warnings];
    warnBtn.hidden = !all.length;
    notesEl.innerHTML = all.map(w => `<div>&#9888; ${escapeHtml(w)}</div>`).join('');
    if(!all.length) notesEl.hidden = true;
  };
  warnBtn.addEventListener('click', () => {
    notesEl.hidden = !notesEl.hidden;
    warnBtn.setAttribute('aria-expanded', String(!notesEl.hidden));
  });
  showWarnings([]);

  const menu = document.getElementById('menu');
  const menuBtn = document.getElementById('menuBtn');
  const setMenu = open => { menu.hidden = !open; menuBtn.setAttribute('aria-expanded', String(open)); };
  menuBtn.addEventListener('click', () => setMenu(menu.hidden));
  // Ein im Formular geändertes Cover landet nur in SONGS, nicht in song: deshalb mit dem aktuellen Stand öffnen.
  const current = () => findSong(song.slug) ?? song;

  /**
   * Dialog "Stammdaten" aus dem Menü, darin auch "Song löschen". Ändert sich der Slug (Titel oder Interpret), gilt ab
   * sofort der neue: für den Player (Speichern der Noten) und in der Adresszeile. Im Bearbeitungsmodus bleibt die
   * Ansicht stehen (✕ zeigt den Song neu), sonst wird der Song gleich neu gezeigt.
   * @returns {void}
   */
  const openSongData = () => {
    openSongForm(current(), saved => {
      if(saved.slug !== song.slug){
        if(player) player.slug = saved.slug;
        history.replaceState(null, '', songHash(saved.slug));
      }
      song = saved;
      document.title = `${saved.title} – Gitarrenbuch`;
      if(noteEditor) songDataChanged = true;
      else showSong(saved);
    }, () => { location.hash = LIST_HASH; });
  };
  /** Ob die Stammdaten im Bearbeitungsmodus geändert wurden (dann zeigt ✕ den Song neu). */
  let songDataChanged = false;
  document.getElementById('exportBtn').addEventListener('click', () => {
    setMenu(false);
    downloadGpFile(current()).catch(err => alert('Export fehlgeschlagen: ' + err.message));
  });
  document.getElementById('chordProBtn').addEventListener('click', () => {
    setMenu(false);
    downloadChordProFile(current()).catch(err => alert('Export fehlgeschlagen: ' + err.message));
  });

  const root = document.getElementById('playerRoot');
  player = new Player(root, document.getElementById('songStrip'));
  // Das Menü gehört in die Abspielleiste.
  player.el.menuWrap.replaceWith(menuWrap);
  // Tonart, Capo usw. stehen nur in den Noten und kommen deshalb erst nach dem Laden in die Kopfzeile. Das Element
  // wird vorab gemerkt: Ist bis dahin ein anderes Lied offen, landet die späte Antwort im alten, entfernten Element.
  const metaEl = document.getElementById('songMeta');
  const showMeta = (info, audioSeconds = null) => {
    const {parts, warnings} = describeScoreInfo(info, audioSeconds);
    metaEl.innerHTML = parts.join(' · ');
    showWarnings(warnings);
  };
  const songPlayer = player;
  document.getElementById('songDataBtn').addEventListener('click', () => {
    setMenu(false);
    openSongData();
  });
  document.getElementById('displayBtn').addEventListener('click', () => {
    setMenu(false);
    openDisplayDialog(songPlayer);
  });
  // Beim Öffnen gilt "Stammdaten gespeichert" als zurückgesetzt; ✕ zeigt den Song neu, wenn Noten oder Stammdaten
  // gespeichert wurden.
  document.getElementById('noteEditBtn').addEventListener('click', () => {
    setMenu(false);
    if(noteEditor){
      noteEditor.finish();
      return;
    }
    songDataChanged = false;
    openNoteEditor(songPlayer, () => songDataChanged);
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
 * Dialog "Darstellung" aus dem Menü: Skalierung von Noten und Chords. Gilt für alle Songs und wird mit OK
 * übernommen.
 * @param {Player} songPlayer Player der Liedansicht
 * @returns {void}
 */
function openDisplayDialog(songPlayer){
  const {scale} = songPlayer.display;
  openOverlay(`
    <h2>Darstellung</h2>
    <div class="form-field">
      <label for="displayScale">Skalierung</label>
      <select id="displayScale">
        ${SCALES.map(s => `<option value="${s}"${s === scale ? ' selected' : ''}>${Math.round(s * 100)} %</option>`)
          .join('')}
      </select>
    </div>
    <button class="btn btn-primary" id="displayOk" type="button">OK</button>
  `, true);
  document.getElementById('displayOk').addEventListener('click', () => {
    songPlayer.setDisplay({
      scale: Number(/** @type {HTMLSelectElement} */ (document.getElementById('displayScale')).value),
    });
    closeOverlay();
  });
}

/**
 * Schaltet die Liedansicht in den Bearbeitungsmodus (Werkzeugleiste und Panels, siehe js/editor.js). Verlassen
 * wird er mit ✕ (Bearbeiten beenden).
 * @param {Player} songPlayer Player der Liedansicht
 * @param {function(): boolean} songDataChanged ob die Stammdaten im Modus gespeichert wurden
 * @returns {void}
 */
function openNoteEditor(songPlayer, songDataChanged){
  if(noteEditor || !songPlayer.api?.score) return;
  noteEditor = new NoteEditor(songView, songPlayer, {
    // Nach dem Speichern zeigt der Player wieder die Ansicht des Songs, dafür neu laden.
    onClose: saved => {
      closeNoteEditor();
      const song = saved || songDataChanged() ? findSong(songPlayer.slug) : null;
      if(song) showSong(song);
    },
    onSaved: saved => storeSong(saved),
  });
  noteEditor.open();
}

/**
 * Verlässt den Bearbeitungsmodus ohne Rückfrage (Rückfragen stellt NoteEditor.finish()).
 * @returns {void}
 */
function closeNoteEditor(){
  if(!noteEditor) return;
  noteEditor.destroy();
  noteEditor = null;
}

/**
 * Zeigt das Griffbrett bis zum 15. Bund. Kartenreiter für Ton, Akkord und Tonleiter, darunter Grundton und Art in
 * Auswahllisten; die Punkte tragen Notennamen oder Intervalle (umschaltbar), sind je Intervall eingefärbt und werden bei
 * Akkorden und Tonleitern durch Klammern zu Griffen bzw. Lagen zusammengefasst. Unter dem Griffbrett steht die Legende.
 * @returns {void}
 */
function showFretboard(){
  let root = 0;
  let group = STRUCTURES[1];
  let kind = group.items[0].id;
  let showIntervals = false;
  /** Index des umklammerten Griffs bzw. der Lage (-1: keiner). */
  let active = -1;
  openOverlay(`
    <h2>Griffbrett</h2>
    <p class="ov-meta">Standard-Tuning, bis zum 15. Bund</p>
    <div class="ov-tools">
        <button class="btn" type="button" id="printChords">Drucken</button>
    </div>
    <div class="chord-sheet">
      <div class="upl-tabs" role="tablist" id="fbTabs">${STRUCTURES.map(g =>
    `<button type="button" role="tab" data-group="${g.id}">${g.group}</button>`).join('')}</div>
      <div class="controls pattern-filter">
        <select id="fbRoot" aria-label="Grundton">${NOTE_LABELS.map((label, i) =>
    `<option value="${i}">${label}</option>`).join('')}</select>
        <select id="fbKind" aria-label="Art"></select>
        <span class="fb-mode" role="group" aria-label="Beschriftung">
          <button class="btn" type="button" data-mode="notes">Noten</button>
          <button class="btn" type="button" data-mode="intervals">Intervalle</button>
        </span>
      </div>
      <h3 class="fb-title" id="fbTitle"></h3>
      <div class="fb-scroll" id="fretboard"></div>
      <p class="fb-hint" id="fbHint"></p>
      <div class="fb-legend" id="fbLegend"></div>
    </div>`, false, false, true);
  const board = document.getElementById('fretboard');
  const kindSel = /** @type {HTMLSelectElement} */ (document.getElementById('fbKind'));
  const tabs = [...document.querySelectorAll('#fbTabs button')];
  const modes = [...document.querySelectorAll('.fb-mode button')];
  const hints = {
    chord: 'Ein Klick auf einen Grundton mit Ring umklammert einen Griff in Grundstellung: je Ton eine Saite, benachbarte '
      + 'Saiten, der tiefste Ton ist der Grundton, alles innerhalb von vier Bünden. Weitere Klicks zeigen die anderen Griffe '
      + 'ab diesem Ton, der letzte schaltet aus.',
    scale: 'Ein Klick auf einen Grundton mit Ring umklammert eine Lage: die Tonleiter vom Grundton an eine Oktave lang ohne '
      + 'Handwechsel (vier Bünde). Weitere Klicks zeigen die anderen Lagen ab diesem Ton, der letzte schaltet aus.',
  };
  const draw = () => {
    const view = structureOf(root, kind);
    document.getElementById('fbTitle').textContent = view.title;
    board.innerHTML = fretboardSvg(view.notes, root, {intervals: showIntervals, alt: view.alt, shapes: view.shapes, active});
    document.getElementById('fbHint').textContent = view.kind === 'note' ? ''
      : view.shapes.length ? hints[view.kind]
        : view.kind === 'chord' ? 'Für diesen Akkord gibt es keinen Griff in Grundstellung auf benachbarten Saiten innerhalb von vier Bünden.'
          : 'Für diese Tonleiter gibt es keine Lage mit einer Oktave ab dem Grundton innerhalb von vier Bünden.';
    document.getElementById('fbLegend').innerHTML = view.kind === 'note' ? '' : view.legend.map(i =>
      `<span class="fb-key"><i style="background:${i.color}"></i><b>${i.label}</b> ${escapeHtml(i.name)}</span>`).join('');
    for(const tab of tabs) tab.setAttribute('aria-selected', String(tab.dataset.group === group.id));
    for(const button of modes) button.setAttribute('aria-pressed', String((button.dataset.mode === 'intervals') === showIntervals));
  };
  const fillKinds = () => {
    kindSel.innerHTML = group.items.map(i => `<option value="${i.id}">${i.label}</option>`).join('');
    kindSel.value = kind;
    kindSel.hidden = group.id === 'note';
  };
  board.addEventListener('click', e => {
    const dot = /** @type {Element} */ (e.target).closest('.fb-pick');
    if(!dot) return;
    const list = dot.getAttribute('data-shapes').split(',').map(Number);
    const at = list.indexOf(active);
    active = at < 0 ? list[0] : at + 1 < list.length ? list[at + 1] : -1;
    draw();
  });
  for(const tab of tabs) tab.addEventListener('click', () => {
    active = -1;
    group = STRUCTURES.find(g => g.id === tab.dataset.group);
    kind = group.items[0].id;
    fillKinds();
    draw();
  });
  for(const button of modes) button.addEventListener('click', () => {
    showIntervals = button.dataset.mode === 'intervals';
    draw();
  });
  document.getElementById('fbRoot').addEventListener('change', e => { root = Number(e.target.value); active = -1; draw(); });
  kindSel.addEventListener('change', () => { kind = kindSel.value; active = -1; draw(); });
  document.getElementById('printChords').addEventListener('click', () => window.print());
  fillKinds();
  draw();
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
  else location.replace(LIST_HASH);
}

/**
 * Öffnet ein gerade angelegtes oder importiertes Lied.
 * @param {Song} saved Lied
 * @returns {void}
 */
const openSaved = saved => { location.hash = songHash(saved.slug); };
newSongBtn.addEventListener('click', () => openImportForm(openSaved));
// Menü ☰ der Liederliste: Akkorde, Patterns und Griffbrett öffnen als Dialog.
const libMenu = document.getElementById('libMenu');
const libMenuBtn = document.getElementById('libMenuBtn');
libMenuBtn.addEventListener('click', () => {
  libMenu.hidden = !libMenu.hidden;
  libMenuBtn.setAttribute('aria-expanded', String(!libMenu.hidden));
});
libMenu.addEventListener('click', e => {
  const open = {chords: showChordLibrary, patterns: showPatternLibrary, fretboard: showFretboard}[
    /** @type {HTMLElement} */ (e.target).closest('button')?.dataset.page];
  if(!open) return;
  libMenu.hidden = true;
  libMenuBtn.setAttribute('aria-expanded', 'false');
  void open();
});
document.addEventListener('click', e => {
  if(/** @type {Element} */ (e.target).closest('.lib-menu')) return;
  libMenu.hidden = true;
  libMenuBtn.setAttribute('aria-expanded', 'false');
});
// Zugeklappte Gruppen der Griffbilder für den Druck öffnen (auch bei Strg+P) und danach wieder schließen.
window.addEventListener('beforeprint', () => {
  for(const group of document.getElementById('sheet').querySelectorAll('details.chord-root:not([open])')){
    group.dataset.printOpened = '';
    group.open = true;
  }
});
window.addEventListener('afterprint', () => {
  for(const group of document.getElementById('sheet').querySelectorAll('details[data-print-opened]')){
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
