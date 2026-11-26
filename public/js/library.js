/**
 * Liederliste mit Suche, Tag-Filter und Sortierung sowie das Formular zum Anlegen und Bearbeiten eines Lieds (Overlay
 * wie beim Kochbuch) sowie der Import einer GP-Datei als neues Lied. alphaTab liest die Datei dabei im Browser und
 * wandelt die Noten in alphaTex um (siehe readGpFile() in notation.js).
 */

import {
    addUpload,
    API_URL,
    apiWrite,
    audioUrl,
    commandBox,
    copyCommand,
    coverUrl,
    deleteCover,
    escapeHtml,
    formatTime,
    importSong,
    LEVELS,
    loadScoreText,
    loadSongs,
    loadYoutubeInfo,
    playedTimes,
    searchCovers,
    setCover,
    svgIcon,
    uploadCover,
} from './base.js';
import {
    createScore,
    describeScoreLoss,
    loadAlphaTab,
    parseScore,
    readGpFile,
    scoreDuration,
    WIP_MARK,
} from './notation.js';

/** @typedef {import('./base.js').Song} Song */
/** @typedef {import('./notation.js').ScoreLoss} ScoreLoss */

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
const pickSel = /** @type {HTMLSelectElement} */ (document.getElementById('pickSel'));
const resultCount = document.getElementById('resultCount');
const subCount = document.getElementById('subCount');

/**
 * Kurzform für document.getElementById(), typisiert als Eingabefeld.
 * @param {string} id ID des Elements
 * @returns {?HTMLInputElement} das Element oder null
 */
function byId(id) {
    return /** @type {?HTMLInputElement} */ (document.getElementById(id));
}

/** Schlüssel im `localStorage` für den Suchbegriff, den Genre- (Tags) und Spur-Filter und die Sortierung der Liste. */
const VIEW_STATE_KEY = 'gitarrenbuch_view_state';

// `true`, während ein Dialog offen ist, in dem man etwas eingeben oder einstellen kann (ungespeicherte Eingaben sind
// möglich). Dann schließen nur die Knöpfe des Dialogs das Overlay, nicht ein Klick daneben oder Escape. Das gilt für
// alle Dialoge außer reinen Übersichten (openOverlay() mit modal = false).
let formIsOpen = false;

/**
 * Ersetzt bzw. ergänzt ein Lied in SONGS (nach Anlegen, Bearbeiten, Import) und zeichnet die Liste neu.
 * @param {Song} song gespeichertes Lied
 * @param {string} [oldSlug] Slug vor einem Rename
 * @returns {void}
 */
export function storeSong(song, oldSlug = song.slug) {
    SONGS = SONGS.filter(s => s.slug !== oldSlug && s.slug !== song.slug);
    SONGS.push(song);
    refreshLibrary();
}

/**
 * Entfernt ein Lied aus SONGS und zeichnet die Liste neu.
 * @param {string} slug Slug des Lieds
 * @returns {void}
 */
export function removeSong(slug) {
    SONGS = SONGS.filter(s => s.slug !== slug);
    refreshLibrary();
}

/**
 * Sucht ein Lied in SONGS.
 * @param {string} slug Slug des Lieds
 * @returns {?Song} das Lied oder null
 */
export function findSong(slug) {
    return SONGS.find(s => s.slug === slug) ?? null;
}

/**
 * Farbton des Platzhalters, aus dem Slug berechnet, damit jedes Lied immer dieselbe Farbe hat.
 * @param {string} slug Slug des Lieds
 * @returns {number} Farbton 0–359
 */
function placeholderHue(slug) {
    let h = 0;
    for (const c of slug) h = (h * 31 + c.charCodeAt(0)) % 360;
    return h;
}

/**
 * HTML einer Kachel der Liederliste. Ohne Cover zeigt sie einen farbigen Platzhalter mit dem Anfangsbuchstaben.
 * @param {Song} s Lied
 * @returns {string} HTML
 */
function cardHtml(s) {
    // Noten hat jeder Song; markiert wird nur, was fehlt.
    const badges = (s.favorite ? '<span class="badge badge-fav" title="Favorit">★</span>' : '')
        + (hasWip(s) ? `<span class="badge badge-wip" title="${escapeHtml(s.wip.reason || 'Baustelle')}">${WIP_MARK}</span>`
            : '')
        + (s.files.includes('audio') ? '' : '<span class="badge missing" title="Keine Audiospur">Audio</span>');
    const level = LEVELS.find(l => l.value === s.level);
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
      ${s.tags.length || level ? `<div class="tags">${level ? `<span class="tag level-${level.value}">${level.short}</span>`
        : ''}${s.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
    </div>
  </a>`;
}

/**
 * Alle verwendeten Tags (in der Oberfläche "Genre").
 * @returns {string[]} alphabetisch, ohne Duplikate
 */
function knownTags() {
    return [...new Set(SONGS.flatMap(s => s.tags))].sort((a, b) => a.localeCompare(b, 'de'));
}

/**
 * Baut die Optionen des Genre-Filters (Tags) neu auf und behält die Auswahl bei, falls es das Genre noch gibt.
 * @returns {void}
 */
function refreshTagFilter() {
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
 * Alle Spurnamen aus den Partituren (auch für die Namensliste im Editor, Dialog "Spuren").
 * @returns {string[]} alphabetisch, ohne Duplikate
 */
export function knownTracks() {
    return [...new Set(SONGS.flatMap(s => s.tracks))].sort((a, b) => a.localeCompare(b, 'de'));
}

/**
 * Baut die Optionen des Spur-Filters neu auf: alle Spurnamen, nach einer Trennlinie "Mit Audio" und "Ohne Audio".
 * Behält die Auswahl bei, falls es sie noch gibt.
 * @returns {void}
 */
function refreshTrackFilter() {
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
function hasTrack(s, track) {
    if (track === WITH_AUDIO) return s.files.includes('audio');
    if (track === WITHOUT_AUDIO) return !s.files.includes('audio');
    return s.tracks.includes(track);
}

/**
 * Werte im Filter "Auswahl" (pickSel): Favoriten, Songs mit Baustelle, Einstufung (dahinter der Wert bzw. NO_LEVEL).
 */
const PICK_FAVORITES = ':favoriten';
const PICK_WIP = ':baustelle';
const PICK_LEVEL = ':stufe:';
/** Songs ohne Einstufung. */
const NO_LEVEL = 'ohne';

/**
 * Ob ein Song eine Spur hat, an der noch gearbeitet wird (leadsheet.wip).
 * @param {Song} s Song
 * @returns {boolean}
 */
function hasWip(s) {
    return Boolean(s.wip);
}

/**
 * Baut den Filter "Auswahl" neu auf: Favoriten, Songs mit Baustelle und die Einstufungen, je mit der Zahl der Songs.
 * Behält die Auswahl bei.
 * @returns {void}
 */
function refreshPickFilter() {
    const current = pickSel.value;
    const count = test => SONGS.filter(test).length;
    pickSel.innerHTML = '<option value="">Alle Songs</option>'
        + `<option value="${PICK_FAVORITES}">★ Favoriten (${count(s => s.favorite)})</option>`
        + `<option value="${PICK_WIP}">${WIP_MARK} Mit Baustelle (${count(hasWip)})</option>`
        + LEVELS.map(l => `<option value="${PICK_LEVEL}${l.value}">${l.label} (${count(s => s.level === l.value)})</option>`)
            .join('')
        + `<option value="${PICK_LEVEL}${NO_LEVEL}">Ohne Einstufung (${count(s => !s.level)})</option>`;
    pickSel.value = [...pickSel.options].some(o => o.value === current) ? current : '';
}

/**
 * Aktualisiert die Filter (Genre, Spur, Auswahl), Anzahl im Kopfbereich und Liste.
 * @returns {void}
 */
function refreshLibrary() {
    refreshTagFilter();
    refreshTrackFilter();
    refreshPickFilter();
    subCount.textContent = `${SONGS.length} ${SONGS.length === 1 ? 'Song' : 'Songs'}`;
    renderList();
}

/**
 * Zeichnet die Liste nach Suchbegriff, Genre- und Spur-Filter und Sortierung.
 * @returns {void}
 */
function renderList() {
    const q = searchInput.value.trim().toLowerCase();
    const tag = tagSel.value;
    const track = trackSel.value;
    let items = SONGS.slice();

    if (tag) {
        items = items.filter(s => s.tags.includes(tag));
    }
    if (track) {
        items = items.filter(s => hasTrack(s, track));
    }
    const pick = pickSel.value;
    if (pick === PICK_FAVORITES) items = items.filter(s => s.favorite);
    else if (pick === PICK_WIP) items = items.filter(hasWip);
    else if (pick.startsWith(PICK_LEVEL)) {
        const level = pick.slice(PICK_LEVEL.length);
        items = items.filter(s => level === NO_LEVEL ? !s.level : s.level === level);
    }
    if (q) {
        items = items.filter(s =>
            s.title.toLowerCase().includes(q)
            || (s.artist || '').toLowerCase().includes(q)
            || s.tags.some(t => t.toLowerCase().includes(q))
        );
    }

    const byTitle = (a, b) => a.title.localeCompare(b.title, 'de');
    const played = playedTimes();
    switch (sortSel.value) {
        case 'played-desc':
            // Nie gespielte ans Ende, nach Titel.
            items.sort((a, b) => (played[b.slug] ?? 0) - (played[a.slug] ?? 0) || byTitle(a, b));
            break;
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
function saveViewState() {
    localStorage.setItem(VIEW_STATE_KEY, JSON.stringify({
        search: searchInput.value, tag: tagSel.value, track: trackSel.value, sort: sortSel.value, pick: pickSel.value,
    }));
}

/**
 * Liest den gemerkten Zustand der Liste.
 * @returns {{search?: string, tag?: string, track?: string, sort?: string, pick?: string}} leer, wenn nichts (Gültiges) gespeichert
 *   ist
 */
function loadViewState() {
    try {
        return JSON.parse(localStorage.getItem(VIEW_STATE_KEY) || '{}');
    } catch (err) {
        return {};
    }
}

/**
 * Öffnet das Overlay mit Schließen-Button und dem übergebenen Inhalt.
 * @param {string} html Inhalt des Sheets
 * @param {boolean} [small] schmales Sheet für kurze Dialoge (z. B. "Darstellung")
 * @param {boolean} [modal] der Dialog schließt nur über seine Knöpfe (Voreinstellung); false für reine Übersichten, die
 *   auch ein Klick daneben oder Escape schließt
 * @param {boolean} [wide] breites Sheet für Seiten wie Akkorde und Patterns (wird auch gedruckt)
 * @returns {void}
 */
export function openOverlay(html, small = false, modal = true, wide = false) {
    formIsOpen = modal;
    sheet.classList.toggle('sheet-small', small);
    sheet.classList.toggle('sheet-wide', wide);
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
 * @param {boolean} [modal] wie bei openOverlay()
 * @returns {void}
 */
export function openStackedOverlay(html, modal = true) {
    sheetStack.push({
        nodes: [...sheet.childNodes],
        formIsOpen,
        drag: [overlay.ondragover, overlay.ondragleave, overlay.ondrop],
    });
    overlay.ondragover = overlay.ondragleave = overlay.ondrop = null;
    openOverlay(html, false, modal);
}

/**
 * Zeigt über allem eine Fläche mit einem Hinweis in der Mitte, solange etwas dauert (z. B. "Audiospur wird
 * ausgewertet …"); Klicks darunter gehen nicht durch. Wartet, bis sie gezeichnet ist, damit eine Rechnung danach sie
 * nicht verdeckt.
 * @param {string} text Hinweis
 * @returns {Promise<function(): void>} entfernt die Fläche wieder
 */
export async function showBusy(text) {
    const busy = document.createElement('div');
    busy.className = 'busy';
    busy.setAttribute('role', 'status');
    busy.innerHTML = `<div class="busy-box"><span class="busy-spinner" aria-hidden="true"></span>${escapeHtml(text)}</div>`;
    document.body.append(busy);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return () => busy.remove();
}

/**
 * Ob ein Dialog offen ist.
 * @returns {boolean}
 */
export function isOverlayOpen() {
    return overlay.classList.contains('open');
}

/**
 * Schließt den obersten Dialog. Lag darunter ein verdrängter Dialog, erscheint dieser wieder (seine Elemente erhalten das
 * Ereignis "overlayshow"); sonst wird das
 * Overlay geschlossen, geleert und die Drag-&-Drop-Handler werden entfernt.
 * @returns {void}
 */
export function closeOverlay() {
    const previous = sheetStack.pop();
    if (previous) {
        sheet.replaceChildren(...previous.nodes);
        formIsOpen = previous.formIsOpen;
        [overlay.ondragover, overlay.ondragleave, overlay.ondrop] = previous.drag;
        // Wer Inhalt im verdrängten Dialog hat, kann ihn neu zeichnen (Ereignis "overlayshow" am Element).
        for (const node of previous.nodes) node.dispatchEvent(new Event('overlayshow'));
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
function field(id, label, value, attrs = '') {
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
function coverPickHtml(s) {
    return s.files.includes('cover')
        ? `<img src="${escapeHtml(coverUrl(s))}" alt="">`
        : `<span class="cover-empty" style="--h:${placeholderHue(s.slug)}">Cover wählen</span>`;
}

/**
 * Verdrahtet die Knöpfe der vorhandenen Genres unter dem Feld "Genre" (gespeichert als tags): Ein Klick nimmt das
 * Genre in die Liste im Textfeld auf oder entfernt es; Tippen im Textfeld hält die Knöpfe auf dem gleichen Stand.
 * @returns {void}
 */
function bindGenrePicks() {
    const input = byId('tagsInput');
    const picks = byId('genrePicks');
    const current = () => input.value.split(',').map(t => t.trim()).filter(Boolean);
    const sync = () => {
        const chosen = current();
        picks.querySelectorAll('[data-genre]').forEach(b => b.classList.toggle('on', chosen.includes(b.dataset.genre)));
    };
    picks.addEventListener('click', e => {
        const genre = /** @type {HTMLElement} */ (e.target).closest('[data-genre]')?.dataset.genre;
        if (!genre) return;
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
function youtubeWatchUrl(url) {
    const m = url.trim().match(YOUTUBE_URL);
    return m ? `https://www.youtube.com/watch?v=${m[1]}` : url;
}

/**
 * Element mit data-ref in einem Block.
 * @param {HTMLElement} host Block
 * @param {string} name Wert von data-ref
 * @returns {?HTMLInputElement} das Element oder null
 */
function ref(host, name) {
    return /** @type {?HTMLInputElement} */ (host.querySelector(`[data-ref="${name}"]`));
}

/**
 * Quelle der Audiodatei im Panel "Audio" des Bearbeitungsmodus: YouTube-URL mit Link zur YouTube-Suche nach Interpret
 * und Titel (wie die Trailersuche der Videothek; die gefundene URL trägt man selbst ein), den Längen von Partitur
 * und Audiospur und einem Knopf zum Speichern. Die Länge des Clips steht in song.json (youtubeSeconds); YouTube wird
 * nur gefragt, wenn sich die URL ändert oder die Länge noch fehlt.
 * Darunter steht, wenn nötig, dass bin/audio.php die Audiospur einbinden muss (siehe updateAudioHint()). Gespeichert
 * wird sofort, unabhängig von den Noten.
 * @param {HTMLElement} host leeres Element, in das der Block gezeichnet wird
 * @param {() => ?Song} getSong liefert das aktuelle Lied (Slug und Angaben können sich im Modus ändern)
 * @param {(saved: Song) => void} onSaved wird nach erfolgreichem Speichern aufgerufen
 * @param {HTMLElement} lengths leeres Element für die Längen (darf woanders stehen als host)
 * @param {() => ?number} scoreMs Länge der bearbeiteten Noten in ms; null, solange sie nicht geladen sind (dann zählt
 *   die gespeicherte Datei). Nach jeder Änderung setzt der Editor sie mit showScoreLength().
 * @returns {void}
 */
export function renderAudioSource(host, getSong, onSaved, lengths, scoreMs) {
    const song = getSong();
    if (!song) {
        host.replaceChildren();
        lengths.replaceChildren();
        return;
    }
    host.innerHTML = `
    <label for="audioSourceUrl">Quelle</label>
    <input type="text" id="audioSourceUrl" data-ref="url" value="${escapeHtml(song.sources.youtube ?? '')}"
      inputmode="url" placeholder="https://www.youtube.com/watch?v=…" title="YouTube-URL">
    <button class="ebtn" type="button" data-ref="save" title="Quelle speichern" aria-label="Quelle speichern"
      disabled>${svgIcon('save')}</button>
    <a class="field-link" data-ref="search" href="#" target="_blank" rel="noopener"
      title="Auf YouTube nach Interpret und Titel suchen">Clip suchen</a>
    <div class="hint" data-ref="hint" hidden></div>
    <div class="hint" data-ref="error" hidden></div>`;
    lengths.innerHTML = '<span data-ref="scoreLength"></span><span data-ref="audioLength"></span>';
    ref(host, 'search').href = 'https://www.youtube.com/results?search_query='
        + encodeURIComponent([song.artist, song.title].filter(Boolean).join(' '));
    showFileLengths(lengths, song, scoreMs);
    const input = ref(host, 'url');
    const save = ref(host, 'save');
    /** Länge des Clips in Sekunden (wird mit der Quelle gespeichert), null ohne URL oder solange sie unbekannt ist. */
    let seconds = song.sources.youtube ? (song.youtubeSeconds ?? null) : null;
    /** Zähler der Abfragen; eine Antwort zählt nur, wenn danach keine neue gestartet wurde. */
    let lookup = 0;
    const updateClipLength = async () => {
        const url = input.value.trim();
        const current = ++lookup;
        seconds = null;
        if (!url) return;
        try {
            const info = await loadYoutubeInfo(url);
            if (current === lookup) seconds = info.seconds;
        } catch (err) {
            // Ohne Länge wird die Quelle trotzdem gespeichert.
        }
    };
    if (seconds === null && input.value.trim()) void updateClipLength();
    /** @type {?number} */
    let timer = null;
    input.addEventListener('input', () => {
        // Kopierte Links enthalten oft Playlist und Startzeit (&list=…&start_radio=1); nur die Video-ID bleibt.
        const short = youtubeWatchUrl(input.value);
        if (short !== input.value) input.value = short;
        save.disabled = !changedSource(song, short);
        updateAudioHint(host, song, short);
        clearTimeout(timer);
        timer = setTimeout(() => void updateClipLength(), YOUTUBE_LOOKUP_DELAY_MS);
    });
    updateAudioHint(host, song, input.value);
    ref(host, 'hint').addEventListener('click', e => {
        const copy = /** @type {?HTMLElement} */ (/** @type {HTMLElement} */ (e.target).closest('[data-copy]'));
        if (copy) copyCommand(copy);
    });

    save.addEventListener('click', async () => {
        const current = getSong() ?? song;
        const error = ref(host, 'error');
        error.hidden = true;
        save.disabled = true;
        try {
            const saved = await saveSongFields(current.slug, {
                sources: {youtube: youtubeWatchUrl(input.value).trim()},
                youtubeSeconds: seconds,
            });
            onSaved(saved);
            renderAudioSource(host, getSong, onSaved, lengths, scoreMs);
        } catch (err) {
            error.textContent = err.message;
            error.hidden = false;
            save.disabled = false;
        }
    });
}

/**
 * Ändert einzelne Angaben eines Songs und lässt die übrigen, wie sie sind (der Server ersetzt sonst alle Felder, die
 * der Request nennt). Der Stand kommt aus der Liste, ein im Dialog "Stammdaten" geänderter Song gilt also schon.
 * @param {string} slug Slug des Lieds
 * @param {Object<string, *>} changes zu ändernde Felder der API (z. B. sources, youtubeSeconds, trackDefaults)
 * @returns {Promise<Song>} das gespeicherte Lied (auch schon in der Liste)
 */
export async function saveSongFields(slug, changes) {
    const s = findSong(slug);
    if (!s) throw new Error('Song nicht gefunden.');
    const saved = await apiWrite(`${API_URL}songs.php?slug=${encodeURIComponent(slug)}`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            title: s.title,
            artist: s.artist ?? '',
            tags: s.tags,
            notes: s.notes ?? '',
            sources: {youtube: s.sources.youtube ?? ''},
            level: s.level ?? null,
            favorite: !!s.favorite,
            ...changes,
        }),
    });
    storeSong(saved, slug);
    return saved;
}

/**
 * Ob die eingegebene YouTube-URL von der gespeicherten abweicht.
 * @param {Song} s Lied
 * @param {string} url eingegebene YouTube-URL
 * @returns {boolean} true bei einer anderen URL
 */
function changedSource(s, url) {
    return youtubeWatchUrl(url.trim()) !== youtubeWatchUrl((s.sources.youtube ?? '').trim());
}

/**
 * Hinweis unter dem YouTube-Feld: Die Audiospur holt bin/audio.php (Befehl zum Kopieren). Bei einem anderen Clip
 * entfernt der Server die bisherige audio.mp3 beim Speichern (siehe update_song() in api/lib/crud.php).
 * @param {HTMLElement} host Block der Quelle (renderAudioSource())
 * @param {Song} s Lied
 * @param {string} url eingegebene YouTube-URL
 * @returns {void}
 */
function updateAudioHint(host, s, url) {
    const hint = ref(host, 'hint');
    const hasAudio = s.files?.includes('audio') ?? false;
    const text = !url.trim() ? ''
        : hasAudio && changedSource(s, url)
            ? '⚠ Anderer Clip: Beim Speichern wird die bisherige Audiospur entfernt. Danach erneuern mit:'
            : !hasAudio ? '⚠ Audiospur aus dem YouTube-Video extrahieren mit:' : '';
    hint.innerHTML = text && `${escapeHtml(text)}${commandBox(`php bin/audio.php --password=… --only=${s.slug}`)}`;
    hint.hidden = !text;
}

/**
 * Zeigt die Länge der Noten (im eigenen Tempo) bei den Längen (renderAudioSource()).
 * @param {HTMLElement} lengths Element der Längen
 * @param {number} ms Länge in Millisekunden
 * @returns {void}
 */
export function showScoreLength(lengths, ms) {
    const scoreLength = ref(lengths, 'scoreLength');
    if (scoreLength) scoreLength.textContent = `Partitur: ${formatTime(ms)}`;
}

/**
 * Zeigt die Längen der Noten (im eigenen Tempo) und der vorhandenen MP3, damit man sieht, ob der YouTube-Clip zu den
 * Noten passt. Die Noten kommen aus dem Editor (scoreMs), solange er sie noch lädt aus der gespeicherten Datei.
 * @param {HTMLElement} host Element der Längen (renderAudioSource())
 * @param {Song} s Lied
 * @param {() => ?number} scoreMs Länge der bearbeiteten Noten in ms, null, solange sie nicht geladen sind
 * @returns {void}
 */
function showFileLengths(host, s, scoreMs) {
    const scoreLength = ref(host, 'scoreLength');
    scoreLength.textContent = 'Partitur: …';
    // Nacheinander statt mit Promise.all: Dort verliert die IDE die Typen der einzelnen Ergebnisse.
    void (async () => {
        const edited = scoreMs();
        if (edited !== null) {
            showScoreLength(host, edited);
            return;
        }
        const alphaTab = await loadAlphaTab();
        const tex = await loadScoreText(s.slug);
        // Inzwischen geladene Noten haben Vorrang (der Editor setzt sie dann selbst).
        if (scoreMs() === null) showScoreLength(host, scoreDuration(alphaTab, parseScore(alphaTab, tex)));
    })()
        .catch(err => {
            scoreLength.textContent = 'Partitur: ?';
            scoreLength.title = err.message;
        });

    if (!s.files.includes('audio')) return;
    // Nur die Metadaten der MP3 laden; danach die Verbindung wieder freigeben.
    const audioLength = ref(host, 'audioLength');
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.addEventListener('loadedmetadata', () => {
        audioLength.textContent = `Audiospur: ${formatTime(audio.duration * 1000)}`;
        audio.removeAttribute('src');
        audio.load();
    }, {once: true});
    audio.addEventListener('error', () => {
        if (audio.getAttribute('src')) audioLength.textContent = 'Audiospur: ?';
    }, {once: true});
    audio.src = audioUrl(s.slug);
}

/**
 * Formular zum Anlegen oder Bearbeiten eines Lieds. Beim Anlegen erzeugt der Browser Noten mit leeren Takten
 * (siehe createScore() in notation.js), denn jeder Song hat Noten; Tonart, Capo, Tempo und Tuning gehen nur dort hinein
 * und werden später im Editor geändert. Beim Bearbeiten steht das Cover neben Titel und Interpret; ein Klick darauf
 * öffnet den Cover-Dialog über dem Formular (Eingaben bleiben erhalten). Die Quelle der Audiodatei steht im Reiter
 * "Audio" des Bearbeitungsmodus (renderAudioSource()), die Quellen der übrigen Dateien im Dialog "Uploads" (uploads.js).
 * @param {?Song} song zu bearbeitendes Lied, null zum Anlegen
 * @param {(saved: Song) => void} onSaved wird nach erfolgreichem Speichern aufgerufen
 * @param {?function(): void} [onDeleted] wird nach "Song löschen" aufgerufen; ohne gibt es den Knopf nicht
 * @returns {void}
 */
export function openSongForm(song, onSaved, onDeleted = null) {
    const isEdit = song !== null;
    const s = song ?? /** @type {Song} */ ({tags: [], sources: {}});
    formIsOpen = true;

    const nameFields = `
    ${field('titleInput', 'Titel', s.title)}
    ${field('artistInput', 'Interpret', s.artist, 'list="artistList" autocomplete="off"')}`;
    openOverlay(`
    <h2>${isEdit ? 'Stammdaten' : 'Neuer Song'}</h2>
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
    </div>
    ${isEdit ? '' : `<div class="form-field">
      <label for="tuningInput">Tuning</label>
      <input type="text" id="tuningInput" placeholder="E A D G B E">
      <div class="hint">Tonart, Capo, Tempo und Tuning gehen in die Noten und werden dort später geändert.</div>
    </div>`}
    <div class="form-field">
      <label for="tagsInput">Genre</label>
      <input type="text" id="tagsInput" value="${escapeHtml(s.tags.join(', '))}"
        placeholder="z. B. Rock &amp; Pop, Weihnachtslied">
      <div class="genre-picks" id="genrePicks">${knownTags().map(t => `<button class="tag-pick${
        s.tags.includes(t) ? ' on' : ''}" type="button" data-genre="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join('')}</div>
      <div class="hint">Mehrere durch Komma trennen, vorhandene per Klick an- und abwählen.</div>
    </div>
    ${isEdit ? ratingHtml(s) : ''}
    ${isEdit ? wipHtml(s) : ''}
    <div class="form-field">
      <label for="notesInput">Notizen</label>
      <textarea id="notesInput" rows="6">${escapeHtml(s.notes ?? '')}</textarea>
    </div>
    <div class="btn-row">
      <button class="btn btn-primary" id="saveBtn" type="button">Speichern</button>
      <button class="btn" id="cancelBtn" type="button">Abbrechen</button>
      ${isEdit && onDeleted ? '<button class="btn btn-danger btn-row-end" id="deleteBtn" type="button">Song löschen …</button>'
        : ''}
    </div>
  `);

    byId('cancelBtn').addEventListener('click', closeOverlay);
    // Das Cover wird im Dialog sofort gespeichert, unabhängig vom Speichern des Formulars.
    byId('coverPick')?.addEventListener('click', () => openCoverForm(s, saved => {
        s.files = saved.files;
        s.updated = saved.updated;
        byId('coverPick').innerHTML = coverPickHtml(s);
    }, {artist: byId('artistInput').value.trim(), title: byId('titleInput').value.trim() || s.title}));
    byId('deleteBtn')?.addEventListener('click', async () => {
        if (!await deleteSongUI(s)) return;
        closeOverlay();
        onDeleted();
    });

    bindGenrePicks();
    bindRating();
    byId('wipInput')?.addEventListener('change', e => {
        byId('wipFields').hidden = !(/** @type {HTMLInputElement} */ (e.target).checked);
    });

    byId('saveBtn').addEventListener('click', async () => {
        const errorBox = byId('formError');
        errorBox.innerHTML = '';
        const payload = {
            title: byId('titleInput').value.trim(),
            artist: byId('artistInput').value.trim(),
            tags: byId('tagsInput').value.split(',').map(t => t.trim()).filter(Boolean),
            // Die Quelle ändert sich hier nicht (YouTube: Panel "Audio").
            sources: {youtube: s.sources.youtube ?? ''},
            notes: byId('notesInput').value.trim(),
            // Einstufung und Favorit gibt es nur am vorhandenen Song (Bearbeitungsmodus).
            ...(isEdit ? {
                level: document.querySelector('#ratingLine [data-level][aria-pressed="true"]')?.dataset.level ?? null,
                favorite: byId('favoriteInput').getAttribute('aria-pressed') === 'true',
                wip: /** @type {HTMLInputElement} */ (byId('wipInput')).checked ? {
                    reason: /** @type {HTMLInputElement} */ (byId('wipReason')).value.trim(),
                    tracks: [...document.querySelectorAll('#wipFields [data-wip-track]:checked')]
                        .map(b => /** @type {HTMLInputElement} */ (b).value),
                    audio: /** @type {HTMLInputElement} */ (byId('wipAudio')).checked,
                } : null,
            } : {}),
        };
        if (!payload.title) {
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
        } catch (err) {
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
 * Schalter "Baustelle" der Stammdaten; eingeschaltet mit Grund, den betroffenen Spuren und der Audiospur (alles
 * optional).
 * @param {Song} s Lied
 * @returns {string} HTML
 */
function wipHtml(s) {
    const tracks = s.tracks ?? [];
    return `<div class="form-field">
    <label class="wip-switch"><input type="checkbox" role="switch" class="switch" id="wipInput"${s.wip ? ' checked' : ''}>
      Baustelle ${WIP_MARK}</label>
    <div id="wipFields"${s.wip ? '' : ' hidden'}>
      <input type="text" id="wipReason" maxlength="500" value="${escapeHtml(s.wip?.reason ?? '')}"
        placeholder="Grund, z. B. Melodie fehlt noch" aria-label="Grund der Baustelle">
      <div class="wip-tracks">${tracks.map(name => `<label><input type="checkbox" data-wip-track
        value="${escapeHtml(name)}"${s.wip?.tracks.includes(name) ? ' checked' : ''}> ${escapeHtml(name)}</label>`)
        .join('')}<label><input type="checkbox" id="wipAudio"${s.wip?.audio ? ' checked' : ''}> Audio</label></div>
    </div>
  </div>`;
}

/** Pfade der Symbole für die Einstufung (Material Symbols, Apache 2.0; viewBox 0 -960 960 960): Daumen runter, Hand, Daumen hoch, Herz. */
const RATING_ICONS = {
    cannot: 'M120-320q-32 0-56-24t-24-56v-80q0-7 1.5-15t4.5-15l120-282q9-20 30-34t44-14h320q33 0 56.5 23.5T640-760v407q0 16-6.5 30.5T616-297L399-81q-15 14-35.5 17T324-71q-19-10-27.5-28t-3.5-37l45-184H120Zm680-520q33 0 56.5 23.5T880-760v360q0 33-23.5 56.5T800-320q-33 0-56.5-23.5T720-400v-360q0-33 23.5-56.5T800-840Z',
    practice: 'M80-400q-33 0-56.5-23.5T0-480v-240q0-12 5-23t13-19l126-126q9-9 20-13.5t22-4.5q26 0 45 20t14 51l-13 75h208q17 0 28.5 11.5T480-720v50q0 6-1 11.5t-3 10.5l-90 212q-7 17-22.5 26.5T330-400H80Zm440 200q-17 0-28.5-11.5T480-240v-50q0-6 1-11.5t3-10.5l90-212q8-17 23-26.5t33-9.5h250q33 0 56.5 23.5T960-480v240q0 12-4.5 22.5T942-198L816-72q-9 9-20 13.5T774-54q-26 0-45-20t-14-51l13-75H520Z',
    can: 'M840-640q32 0 56 24t24 56v80q0 7-1.5 15t-4.5 15L794-168q-9 20-30 34t-44 14H400q-33 0-56.5-23.5T320-200v-407q0-16 6.5-30.5T344-663l217-216q15-14 35.5-17t39.5 7q19 10 27.5 28t3.5 37l-45 184h218ZM160-120q-33 0-56.5-23.5T80-200v-360q0-33 23.5-56.5T160-640q33 0 56.5 23.5T240-560v360q0 33-23.5 56.5T160-120Z',
    favorite: 'M451.5-152q-14.5-5-25.5-16l-69-63q-106-97-191.5-192.5T80-634q0-94 63-157t157-63q53 0 100 22.5t80 61.5q33-39 80-61.5T660-854q94 0 157 63t63 157q0 115-85 211T602-230l-68 62q-11 11-25.5 16t-28.5 5q-14 0-28.5-5Z',
};

/**
 * Einstufung und Favorit als Knöpfe mit Symbolen: Daumen runter (Kann ich nicht), Hand (Übe ich gerade), Daumen hoch
 * (Kann ich) und das Herz für den Favoriten. Die Einstufungen schließen sich aus, ein zweiter Klick nimmt sie zurück
 * (bindRating()).
 * @param {Song} s Lied
 * @returns {string} HTML
 */
function ratingHtml(s) {
    const icon = path => `<svg class="rate-icon" viewBox="0 -960 960 960" aria-hidden="true"><path d="${path}"/></svg>`;
    const levels = ['cannot', 'practice', 'can'].map(value => {
        const level = LEVELS.find(l => l.value === value);
        return `<button class="rate-btn" type="button" data-level="${value}" aria-pressed="${s.level === value}"
      title="${level.label}" aria-label="${level.label}">${icon(RATING_ICONS[value])}</button>`;
    }).join('');
    return `<div class="form-field">
    <span class="label">Wie gut kann ich den Song?</span>
    <div class="rating-line" id="ratingLine">${levels}<button class="rate-btn rate-fav" type="button" id="favoriteInput"
      aria-pressed="${!!s.favorite}" title="Favorit" aria-label="Favorit">${icon(RATING_ICONS.favorite)}</button></div>
  </div>`;
}

/**
 * Verdrahtet die Knöpfe von ratingHtml(): Eine Einstufung gilt allein, ein Klick auf die gewählte hebt sie auf; das
 * Herz schaltet für sich um.
 * @returns {void}
 */
function bindRating() {
    const line = byId('ratingLine');
    if (!line) return;
    line.addEventListener('click', e => {
        const button = /** @type {?HTMLElement} */ (/** @type {HTMLElement} */ (e.target).closest('.rate-btn'));
        if (!button) return;
        const on = button.getAttribute('aria-pressed') !== 'true';
        if (button.dataset.level) {
            line.querySelectorAll('[data-level]').forEach(b => b.setAttribute('aria-pressed', 'false'));
        }
        button.setAttribute('aria-pressed', String(on));
    });
}

/**
 * "Interpret - Titel" aus dem Dateinamen, falls die GP-Datei selbst keinen Titel enthält.
 * @param {string} fileName Dateiname, z. B. "Bob Marley - Three Little Birds.gp"
 * @returns {{artist: string, title: string}} ohne " - " ist alles Titel
 */
function metaFromFileName(fileName) {
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
export function bindDropzone(onFile) {
    const dropzone = document.getElementById('dropzone');
    const input = /** @type {HTMLInputElement} */ (dropzone.querySelector('input[type="file"]'));
    input.addEventListener('change', () => {
        if (input.files[0]) onFile(input.files[0]);
    });
    // Im Overlay darf überall im Dialog abgelegt werden, im Panel des Bearbeitungsmodus nur auf der Fläche.
    const target = overlay.classList.contains('open') ? overlay : dropzone;
    target.ondragover = e => {
        e.preventDefault();
        dropzone.classList.add('dragover');
    };
    target.ondragleave = e => {
        if (!target.contains(/** @type {Node} */ (e.relatedTarget))) dropzone.classList.remove('dragover');
    };
    target.ondrop = e => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        const dropped = e.dataTransfer?.files[0];
        if (dropped) onFile(dropped);
    };
}

/**
 * Warnt im Import-Dialog, dass beim Umwandeln etwas verloren geht, und wartet auf die Entscheidung des Benutzers.
 * @param {HTMLElement} box Bereich für Meldungen im Dialog
 * @param {ScoreLoss} loss betroffene Takte (siehe exportScore() in notation.js)
 * @returns {Promise<boolean>} true bei "Trotzdem übernehmen", false bei "Abbrechen"
 */
function confirmLoss(box, loss) {
    box.innerHTML = `
    <div class="error-box">
      <p>Beim Umwandeln gehen Angaben verloren, die alphaTex nicht schreiben kann.
        ${escapeHtml(describeScoreLoss(loss))} Die Originaldatei bleibt unter upload/ erhalten.</p>
      <div class="btn-row">
        <button class="btn btn-primary" type="button" data-loss="accept">Trotzdem übernehmen</button>
        <button class="btn" type="button" data-loss="cancel">Abbrechen</button>
      </div>
    </div>`;
    return new Promise(resolve => {
        box.addEventListener('click', function onClick(e) {
            const choice = /** @type {?HTMLElement} */ (/** @type {HTMLElement} */ (e.target).closest('[data-loss]'));
            if (!choice) return;
            box.removeEventListener('click', onClick);
            box.innerHTML = '';
            resolve(choice.dataset.loss === 'accept');
        });
    });
}

/**
 * Dialog "Song importieren" hinter "+ Neuer Song": Import einer Guitar-Pro-Datei als neuer Song (wie der Rezept-Import
 * im Kochbuch). "Manuell" legt den Song ohne GP-Datei im Formular an (wie "Manuell" im Import-Dialog der Videothek).
 * @param {(saved: Song) => void} onImported wird nach erfolgreichem Import aufgerufen
 * @returns {void}
 */
export function openImportForm(onImported) {
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
    ${field('importUgInput', 'Quelle der Datei', '',
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
        closeOverlay();
        openSongForm(null, onImported);
    });
    byId('importSubmitBtn').addEventListener('click', async () => {
        const errorBox = byId('formError');
        errorBox.innerHTML = '';
        if (!file) {
            errorBox.innerHTML = '<div class="error-box">Bitte eine Datei wählen.</div>';
            return;
        }

        const btn = byId('importSubmitBtn');
        btn.disabled = true;
        btn.textContent = 'Importiert …';
        try {
            const {meta, tex, loss, changes, lyrics} = await readGpFile(file);
            if (loss && !await confirmLoss(errorBox, loss)) {
                btn.disabled = false;
                btn.textContent = 'Importieren';
                return;
            }
            if (!meta.title) {
                Object.assign(meta, metaFromFileName(file.name), meta.artist ? {artist: meta.artist} : {});
            }
            // Die Quelle der Datei (z. B. die Seite des Tabs bei Ultimate Guitar) hält der Server beim Upload fest.
            const saved = await importSong({...meta, gpSource: byId('importUgInput').value.trim()}, tex, file);
            // Konfliktlöser (conflicts.js): Liedtext, der nicht in die Textspur passte, kommt als Chord-Datei in den
            // Upload-Ordner (übernehmen mit "Chord-Datei importieren"); die Änderungen nur in der Konsole.
            for (const {name, text} of lyrics) {
                await addUpload(saved.slug, {
                    file: new File([text], name, {type: 'text/plain;charset=utf-8'}),
                    description: 'Liedtext einer anderen Spur, beim Import nicht übernommen'
                });
            }
            if (changes.length) console.info(`Import ${saved.slug}:`, changes.map(c => (c.critical ? '⚠ ' : '') + c.text));
            storeSong(saved);
            closeOverlay();
            onImported(saved);
        } catch (err) {
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
async function toCoverJpeg(file) {
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
function openCoverForm(song, onSaved, query = song) {
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
        } catch (err) {
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
        if (!title) return;
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
                if (btn) void apply(() => setCover(song.slug, hits[Number(btn.dataset.hit)].url));
            };
        } catch (err) {
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
    for (const id of ['coverArtist', 'coverTitle']) {
        byId(id).addEventListener('keydown', e => {
            if (e.key === 'Enter') void search();
        });
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
async function deleteSongUI(song) {
    if (!window.confirm(`„${song.title}“ samt aller Dateien wirklich unwiderruflich löschen?`)) return false;
    try {
        await apiWrite(`${API_URL}songs.php?slug=${encodeURIComponent(song.slug)}`, {method: 'DELETE'});
        removeSong(song.slug);
        return true;
    } catch (err) {
        alert('Löschen fehlgeschlagen: ' + err.message);
        return false;
    }
}

/**
 * Lädt die Liederliste und verdrahtet Suche, Filter und Overlay.
 * @returns {Promise<void>}
 */
export async function initLibrary() {
    overlay.addEventListener('click', e => {
        if (e.target === overlay && !formIsOpen) closeOverlay();
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && !formIsOpen) closeOverlay();
    });
    const onFilterChange = () => {
        saveViewState();
        renderList();
    };
    searchInput.addEventListener('input', onFilterChange);
    sortSel.addEventListener('change', onFilterChange);
    tagSel.addEventListener('change', onFilterChange);
    trackSel.addEventListener('change', onFilterChange);
    pickSel.addEventListener('change', onFilterChange);

    SONGS = await loadSongs();
    refreshTagFilter();
    refreshTrackFilter();
    refreshPickFilter();

    // Suchbegriff/Filter/Sortierung vom letzten Besuch wiederherstellen (Genre und Spur nur, wenn es sie noch gibt).
    const saved = loadViewState();
    if (saved.search) searchInput.value = saved.search;
    if (saved.sort && [...sortSel.options].some(o => o.value === saved.sort)) sortSel.value = saved.sort;
    if (saved.tag && [...tagSel.options].some(o => o.value === saved.tag)) tagSel.value = saved.tag;
    if (saved.track && [...trackSel.options].some(o => !o.disabled && o.value === saved.track)) trackSel.value = saved.track;
    if (saved.pick && [...pickSel.options].some(o => o.value === saved.pick)) pickSel.value = saved.pick;

    refreshLibrary();
}
