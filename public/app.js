/**
 * Einstieg des Frontends: Routing zwischen Übersichtsseite (#/) und Playerseite (#/song/<slug>); Akkorde, Patterns und
 * Griffbrett öffnen aus dem Menü der Übersichtsseite als Dialog. Die eigentliche Arbeit steckt in den ES-Modulen unter
 * js/.
 */

import {coverUrl, loadAudio, loadLeadsheet, loadScoreText} from './js/lib/api.js';
import {escapeHtml} from './js/lib/format.js';
import {svgIcon} from './js/ui/icons.js';
import {findSong, storeSong} from './js/lib/songs.js';
import {initOverlay} from './js/ui/overlay.js';
import {initOverview} from './js/pages/overview.js';
// Player, Noten (notation.js, alphaTab) und Leadsheet lädt erst, wer sie braucht (import()): Die Übersichtsseite kommt
// ohne sie aus und steht so schneller da. Ein Modul lädt der Browser je Seitenaufruf nur einmal.

/** @typedef {import('./js/lib/api.js').Song} Song */
/** @typedef {import('./js/lib/notation.js').ScoreInfo} ScoreInfo */
/** @typedef {import('./js/pages/player.js').Player} Player */

/** Bereich der Übersichtsseite. */
const overviewView = document.getElementById('overviewView');

/** Bereich der Playerseite. */
const songView = document.getElementById('songView');

/** Button „+ Neuer Song“: öffnet den Import-Dialog (dort auch „Manuell“). */
const newSongBtn = document.getElementById('newSongBtn');

/**
 * Player der geöffneten Playerseite, null in der Liste.
 * @type {?Player}
 */
let player = null;

/**
 * Bearbeitungsseite der Playerseite, null, wenn er aus ist.
 * @type {?import('./js/pages/editor.js').NoteEditor}
 */
let noteEditor = null;

/** Ob der Editor gerade geladen wird (openNoteEditor()), damit ein zweiter Klick ihn nicht doppelt öffnet. */
let editorLoading = false;

/**
 * Lädt ein Stylesheet aus css/ nach (einmal je Seitenaufruf), mit dem Versionszähler aus index.html. Fertig ist es,
 * wenn der Browser es geladen hat; so erscheint nichts kurz ohne seine Stile.
 * @param {string} name Name ohne Endung, z. B. "editor"
 * @returns {Promise<void>}
 */
function loadStylesheet(name) {
    const href = `css/${name}.css?v=${encodeURIComponent(typeof VERSION === 'string' ? VERSION : '')}`;
    if (document.querySelector(`link[data-stylesheet="${name}"]`)) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.dataset.stylesheet = name;
        link.onload = () => resolve();
        link.onerror = () => reject(new Error(`Stylesheet ${name} nicht geladen`));
        document.head.append(link);
    });
}

/** Hash der Übersichtsseite (die Seiten sind Hash-Pfade, keine Sprungmarken). */
const OVERVIEW_HASH = '#/';

/**
 * Hash der Playerseite.
 * @param {string} slug Slug des Songs
 * @returns {string} z. B. "#/song/bob-marley-three-little-birds"
 */
function songHash(slug) {
    return `#/song/${encodeURIComponent(slug)}`;
}

/**
 * Zeigt die Übersichtsseite und beendet einen laufenden Player.
 * @returns {void}
 */
function showOverview() {
    songRequest++;
    leaveSong();
    overviewView.hidden = false;
    document.title = 'Gitarrenbuch';
}

/**
 * Beendet die Playerseite (Player, Bearbeitungsseite) und leert sie.
 * @returns {void}
 */
function leaveSong() {
    closeNoteEditor();
    player?.destroy();
    player = null;
    songView.hidden = true;
    songView.classList.remove('is-playing');
    songView.innerHTML = '';
}

/**
 * Lädt eine vollständige Guitar-Pro-Datei des Songs herunter (Noten, Angaben, Audiospur mit Sync-Punkten).
 * @param {Song} song Song
 * @returns {Promise<void>}
 */
async function downloadGpFile(song) {
    // Nacheinander statt mit Promise.all: Dort verliert die IDE die Typen der einzelnen Ergebnisse.
    const tex = await loadScoreText(song.slug);
    const audio = song.files.includes('audio') ? await loadAudio(song.slug) : null;
    const {exportGpFile} = await import('./js/lib/notation.js');
    downloadFile(await exportGpFile(song, tex, audio));
}

/**
 * Druckt das Leadsheet des Songs. Auf der Bearbeitungsseite der Stand im Editor (auch ungespeichert), sonst der
 * gespeicherte.
 * @param {Song} song Song
 * @returns {Promise<void>}
 */
async function printLeadsheetOf(song) {
    const head = {title: song.title, artist: song.artist};
    // Beide Module laden gleichzeitig; erst danach wird gewartet.
    const loadingNotation = import('./js/lib/notation.js');
    const loadingSheetView = import('./js/ui/sheetview.js');
    const {loadAlphaTab} = await loadingNotation;
    const {printSongLeadsheet} = await loadingSheetView;
    const alphaTab = await loadAlphaTab();
    if (noteEditor?.score) {
        await printSongLeadsheet(alphaTab, noteEditor.tex, noteEditor.sheet, head);
        return;
    }
    // Nacheinander statt mit Promise.all: Dort verliert die IDE die Typen der einzelnen Ergebnisse.
    const tex = await loadScoreText(song.slug);
    const sheet = await loadLeadsheet(song.slug);
    await printSongLeadsheet(alphaTab, tex, sheet, head);
}

/**
 * Bietet eine im Browser erzeugte Datei zum Download an.
 * @param {File} file Datei
 * @returns {void}
 */
function downloadFile(file) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(file);
    link.download = file.name;
    link.click();
    URL.revokeObjectURL(link.href);
}

/** Zählt die Aufrufe von showSong(): Ist während des Ladens ein anderer Song (oder die Liste) dran, bricht er ab. */
let songRequest = 0;

/**
 * Zeigt die Playerseite mit Kopfzeile, Menü und Noten. Player und Notenfunktionen werden dafür erst hier geladen.
 * @param {Song} song Song
 * @returns {Promise<void>}
 */
async function showSong(song) {
    const request = ++songRequest;
    leaveSong();
    overviewView.hidden = true;
    songView.hidden = false;
    document.title = `${song.title} – Gitarrenbuch`;
    window.scrollTo(0, 0);

    // Lage der Bedienelemente:
    // - Kopf: Cover, daneben Titel, Interpret und eine Zeile Eckdaten, jede mit "…" gekürzt, wenn sie nicht passt.
    // - Streifen mit aktuellem Akkord, Griffbild und Patterns (füllt der Player): bleibt beim Scrollen stehen. Am PC
    //   steht er rechts neben dem Kopf, und die ganze Zeile bleibt stehen (.songtop, css/player.css).
    // - Schließen (zur Übersichtsseite): schwebt oben rechts, unauffällig halbtransparent, immer erreichbar.
    // - Alles andere liegt unten in der Abspielleiste, auch das Menü (der Player stellt den Platz, el.menuWrap).
    // - .songbar ist der Platz für die Werkzeugleiste der Bearbeitungsseite (editor.js).
    songView.innerHTML = `
        <div class="songtop">
            <div class="songhead">
                ${song.files.includes('cover') ? `<img class="songhead-cover" src="${escapeHtml(coverUrl(song))}" alt="">` : ''}
                <div class="songhead-text">
                    <h2 title="${escapeHtml(song.title)}">${escapeHtml(song.title)}</h2>
                    <div class="songhead-artist">${escapeHtml(song.artist ?? '')}</div>
                    <div class="songhead-info"><span id="songMeta"></span></div>
                </div>
            </div>
            <div class="songstrip" id="songStrip" hidden></div>
        </div>
        <button class="song-edit" id="songEditBtn" type="button" aria-label="Bearbeiten" title="Bearbeiten: Noten, Text, Akkorde, Spuren, Leadsheet, Audio">${svgIcon('edit')}</button>
        <a class="song-close" href="${OVERVIEW_HASH}" aria-label="Zur Übersichtsseite" title="Zur Übersichtsseite">&#10005;</a>
        <div class="songbar"></div>
        <div id="playerRoot"></div>
    `;
    // Menü: Knopf und Liste; der Player setzt beides in die Abspielleiste.
    const menuWrap = document.createElement('div');
    menuWrap.className = 'songbar-menu';
    menuWrap.innerHTML = `
        <button class="tbtn" id="menuBtn" type="button" aria-label="Menü" aria-expanded="false">&#8942;</button>
        <div class="menu" id="menu" hidden>
            <button type="button" id="songDataBtn">Stammdaten</button>
            <button type="button" id="displayBtn">Darstellung</button>
            <button type="button" id="exportBtn" title="Notation mit Audiospur als Guitar-Pro-Datei (.gp)">GP-Export</button>
            <button type="button" id="leadsheetPrintBtn" title="Das Leadsheet drucken (auch als PDF)">Leadsheet drucken</button>
        </div>
    `;
    songView.querySelector('.songhead').append(menuWrap);

    const menu = document.getElementById('menu');
    const menuBtn = document.getElementById('menuBtn');
    const setMenu = open => {
        menu.hidden = !open;
        menuBtn.setAttribute('aria-expanded', String(open));
    };
    menuBtn.addEventListener('click', () => setMenu(menu.hidden));
    // Ein im Formular geändertes Cover landet nur in SONGS, nicht in song: deshalb mit dem aktuellen Stand öffnen.
    const current = () => findSong(song.slug) ?? song;

    /**
     * Dialog "Stammdaten" aus dem Menü, darin auch "Song löschen". Ändert sich der Slug (Titel oder Interpret), gilt ab
     * sofort der neue: für den Player (Speichern der Noten) und in der Adresszeile. Auf der Bearbeitungsseite bleibt
     * die Ansicht stehen (✕ zeigt den Song neu), sonst wird der Song gleich neu gezeigt.
     * @returns {Promise<void>}
     */
    const openSongData = async () => {
        const {openSongForm} = await import('./js/dialogs/songform.js');
        openSongForm(current(), saved => {
            if (saved.slug !== song.slug) {
                if (player) player.slug = saved.slug;
                history.replaceState(null, '', songHash(saved.slug));
            }
            song = saved;
            document.title = `${saved.title} – Gitarrenbuch`;
            if (noteEditor) songDataChanged = true;
            else void showSong(saved);
        }, () => {
            location.hash = OVERVIEW_HASH;
        });
    };

    /** Ob die Stammdaten auf der Bearbeitungsseite geändert wurden (dann zeigt ✕ den Song neu). */
    let songDataChanged = false;
    document.getElementById('exportBtn').addEventListener('click', () => {
        setMenu(false);
        downloadGpFile(current()).catch(err => alert('Export fehlgeschlagen: ' + err.message));
    });
    document.getElementById('leadsheetPrintBtn').addEventListener('click', () => {
        setMenu(false);
        printLeadsheetOf(current()).catch(err => alert('Drucken fehlgeschlagen: ' + err.message));
    });

    const root = document.getElementById('playerRoot');
    const loadingPlayer = import('./js/pages/player.js');
    const loadingNotation = import('./js/lib/notation.js');
    const {Player} = await loadingPlayer;
    const {describeScoreInfo} = await loadingNotation;
    if (request !== songRequest) return;
    player = new Player(root, document.getElementById('songStrip'));
    // Das Menü gehört in die Abspielleiste.
    player.el.menuWrap.replaceWith(menuWrap);
    // Tonart, Capo usw. stehen nur in den Noten und kommen deshalb erst nach dem Laden in die Kopfzeile. Das Element
    // wird vorab gemerkt: Ist bis dahin ein anderer Song offen, landet die späte Antwort im alten, entfernten Element.
    const metaEl = document.getElementById('songMeta');
    const showMeta = info => {
        metaEl.innerHTML = describeScoreInfo(info).join(' · ');
    };
    const songPlayer = player;
    document.getElementById('songDataBtn').addEventListener('click', () => {
        setMenu(false);
        void openSongData();
    });
    document.getElementById('displayBtn').addEventListener('click', () => {
        setMenu(false);
        void import('./js/dialogs/display.js').then(m => m.openDisplayDialog(songPlayer));
    });
    // Beim Öffnen gilt "Stammdaten gespeichert" als zurückgesetzt; ✕ zeigt den Song neu, wenn Noten oder Stammdaten
    // gespeichert wurden.
    // Auf die Bearbeitungsseite führt der Stift oben rechts neben ✕; auf der Bearbeitungsseite ist er ausgeblendet,
    // beendet wird mit dem ✕ der Werkzeugleiste. Unter 1080 px Breite fehlt er, zum Bearbeiten braucht es Platz
    // (css/player.css).
    document.getElementById('songEditBtn').addEventListener('click', () => {
        setMenu(false);
        if (noteEditor) return;
        songDataChanged = false;
        void openNoteEditor(songPlayer, () => songDataChanged);
    });
    songPlayer.load(song).then(info => {
        showMeta(info);
    }).catch(err => {
        root.innerHTML = `<p class="empty">${escapeHtml(err.message)}</p>`;
    });
}

/**
 * Schaltet die Playerseite auf die Bearbeitungsseite (Werkzeugleiste und Panels, siehe js/pages/editor.js). Verlassen
 * wird er mit ✕ (Bearbeiten beenden). Der Editor wird erst hier geladen (import()): Übersichtsseite und Player brauchen
 * ihn nicht, und auf schmalen Bildschirmen gibt es ihn gar nicht. Wechselt man während des Ladens den Song, öffnet er
 * nicht mehr.
 * @param {Player} songPlayer Player der Playerseite
 * @param {function(): boolean} songDataChanged ob die Stammdaten auf der Bearbeitungsseite gespeichert wurden
 * @returns {Promise<void>}
 */
async function openNoteEditor(songPlayer, songDataChanged) {
    if (noteEditor || editorLoading || !songPlayer.api?.score) return;
    editorLoading = true;
    let NoteEditor;
    try {
        const loadingEditor = import('./js/pages/editor.js');
        const loadingStyle = loadStylesheet('editor');
        ({NoteEditor} = await loadingEditor);
        await loadingStyle;
    } finally {
        editorLoading = false;
    }
    if (noteEditor || player !== songPlayer) return;
    noteEditor = new NoteEditor(songView, songPlayer, {
        // Nach dem Speichern zeigt der Player wieder die Ansicht des Songs, dafür neu laden.
        onClose: saved => {
            closeNoteEditor();
            const song = saved || songDataChanged() ? findSong(songPlayer.slug) : null;
            if (song) void showSong(song);
        },
        onSaved: saved => storeSong(saved),
    });
    noteEditor.open();
}

/**
 * Verlässt die Bearbeitungsseite ohne Rückfrage (Rückfragen stellt NoteEditor.finish()).
 * @returns {void}
 */
function closeNoteEditor() {
    if (!noteEditor) return;
    noteEditor.destroy();
    noteEditor = null;
}

/**
 * Zeigt je nach Hash die Liste (#/) oder einen Song (#/song/<slug>); unbekannte Songs führen zur Liste.
 * @returns {void}
 */
function route() {
    const m = location.hash.match(/^#\/song\/([^/]+)$/);
    if (!m) {
        showOverview();
        return;
    }
    const song = findSong(decodeURIComponent(m[1]));
    if (song) void showSong(song);
    else location.replace(OVERVIEW_HASH);
}

/**
 * Öffnet einen gerade angelegten oder importierten Song.
 * @param {Song} saved Song
 * @returns {void}
 */
const openSaved = saved => {
    location.hash = songHash(saved.slug);
};
newSongBtn.addEventListener('click', () => {
    void import('./js/dialogs/import.js').then(m => m.openImportForm(openSaved));
});
// Menü ☰ der Übersichtsseite: Akkorde, Patterns und Griffbrett öffnen als Dialog.
const overviewMenu = document.getElementById('overviewMenu');
const overviewMenuBtn = document.getElementById('overviewMenuBtn');
overviewMenuBtn.addEventListener('click', () => {
    overviewMenu.hidden = !overviewMenu.hidden;
    overviewMenuBtn.setAttribute('aria-expanded', String(!overviewMenu.hidden));
});
overviewMenu.addEventListener('click', e => {
    // Die Dialoge lädt erst ihr Menüeintrag (import()).
    const open = {
        chords: async () => (await import('./js/dialogs/chordcatalog.js')).showChordCatalog(),
        patterns: async () => (await import('./js/dialogs/patterncatalog.js')).showPatternCatalog(),
        fretboard: async () => (await import('./js/dialogs/fretboard.js')).showFretboard(),
    }[/** @type {HTMLElement} */ (e.target).closest('button')?.dataset.page];
    if (!open) return;
    overviewMenu.hidden = true;
    overviewMenuBtn.setAttribute('aria-expanded', 'false');
    void open();
});
document.addEventListener('click', e => {
    if (/** @type {Element} */ (e.target).closest('.overview-menu')) return;
    overviewMenu.hidden = true;
    overviewMenuBtn.setAttribute('aria-expanded', 'false');
});
// Zugeklappte Gruppen der Griffbilder für den Druck öffnen (auch bei Strg+P) und danach wieder schließen.
window.addEventListener('beforeprint', () => {
    for (const group of document.getElementById('dialog').querySelectorAll('details.chord-root:not([open])')) {
        group.dataset.printOpened = '';
        group.open = true;
    }
});
window.addEventListener('afterprint', () => {
    for (const group of document.getElementById('dialog').querySelectorAll('details[data-print-opened]')) {
        delete group.dataset.printOpened;
        group.open = false;
    }
});
window.addEventListener('hashchange', route);
// Klick außerhalb schließt das Menü der Playerseite.
document.addEventListener('click', e => {
    const target = /** @type {Element} */ (e.target);
    if (target.closest('.songbar-menu')) return;
    document.getElementById('menu')?.setAttribute('hidden', '');
    document.getElementById('menuBtn')?.setAttribute('aria-expanded', 'false');
});

try {
    initOverlay();
    await initOverview();
    route();
} catch (err) {
    console.error(err);
    document.getElementById('subCount').textContent = 'Songs konnten nicht geladen werden.';
}
