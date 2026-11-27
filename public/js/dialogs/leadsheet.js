/**
 * Dialog "Leadsheet" der Bearbeitungsseite: links die Eingaben für das Blatt (Patterns, Tab-Stellen, Griffbilder,
 * Links, Hinweise), rechts die Vorschau (ui/sheetview.js). Dazu die Werkzeuge des Pattern-Katalogs (vorschlagen,
 * ausrollen, bearbeiten) und "Abschnitte vergleichen". Gespeichert wird mit den Noten (NoteEditor.sheet, score.json).
 */

import * as edit from '../lib/notation.js';
import {hasStrings, isWip, markWip, parseScore, trackName} from '../lib/notation.js';
import {FONT_SIZES, sectionGroup, sections, tabTrack} from '../lib/sheetmodel.js';
import {glyph, GLYPHS} from '../ui/icons.js';
import {
    barCellHtml,
    capoMismatch,
    collapseSections,
    compareSectionBars,
    describeLayout,
    fillCompareTabs,
    fillSheetTabs,
    generateLeadsheet,
    layoutLeadsheet,
    measureLeadsheet,
    patternGridHtml,
    printLeadsheet,
    sectionBars,
    sheetChords,
    SheetTabs
} from '../ui/sheetview.js';
import {
    formatStep,
    parseStep,
    patternError,
    patternId,
    patternNotation,
    patternTokens,
    rollOut,
    slotCount,
    suggestPatterns,
    TECHNIQUES,
    TIME_SIGNATURES,
    withAccent
} from '../lib/patterns.js';
import {loadChordCatalog, loadChordCatalogOrEmpty, loadPatterns, savePatterns, WIP_MARK} from '../lib/api.js';
import {buildTextModel} from '../lib/textmodel.js';
import {chordDiagramSvg} from '../ui/chorddiagram.js';
import {closeOverlay, isOverlayOpen, openOverlay, openStackedOverlay} from '../ui/overlay.js';
import {findSong} from '../lib/songs.js';
import {creditHtml} from '../ui/credit.js';
import {escapeHtml} from '../lib/format.js';

/** @typedef {import('../lib/patterns.js').Pattern} Pattern */
/** @typedef {import('../lib/patterns.js').PickNote} PickNote */
/** @typedef {import('../lib/sheetmodel.js').Sheet} Sheet */
/** @typedef {import('../ui/sheetview.js').BarDiffRow} BarDiffRow */
/** @typedef {import('../../../types/alphatab').model.Track} Track */
/** @typedef {import('../../../types/alphatab').model.Bar} Bar */
/** @typedef {import('../../../types/alphatab').model.Score} Score */

/** Übliche Abschnittsnamen für die Auswahlliste (dazu die des Songs). */
export const SECTION_NAMES = ['Intro', 'Verse', 'Pre-Chorus', 'Chorus', 'Bridge', 'Solo', 'Interlude', 'Outro'];

/** Reihenfolge beim Klicken auf einen Rasterplatz eines Strumming Patterns. */
const STROKE_CYCLE = ['.', 'd', 'u', 'x'];

/** Hinweis im Feld "wann". */
const WHEN_PLACEHOLDER = 'Wann? z. B. Strophe, Refrain ab dem 2. Mal';

/**
 * Spuren mit Saiten (für Tabs und Patterns).
 * @param {Score} score Noten
 * @param {boolean} [six] nur mit sechs Saiten (Patterns)
 * @param {boolean} [wip] auch Baustellen
 * @returns {import('../../../types/alphatab').model.Track[]}
 */
function stringedTracks(score, six = false, wip = true) {
    return score.tracks.filter(t => hasStrings(t.staves[0]) && (six ? t.staves[0].tuning.length === 6
        : t.staves[0].tuning.length > 0) && (wip || !isWip(t)));
}

/**
 * Ändert ein Pattern nach einem Klick ins Raster der Vorschau: Strumming Patterns wechseln je Klick nichts → ab → auf →
 * gedämpft. Picking Patterns setzen bzw. nehmen den Finger auf dieser Saite. Die Zählzeit schaltet bei einem Anschlag
 * die Betonung (Großbuchstaben), beim Picking Pattern an leerer Stelle die Pause (x).
 * @param {Pattern} pattern Pattern aus dem Formular
 * @param {string} kind angeklickte Zeile: stroke, count oder ein Finger (p, q, i, m, a)
 * @param {number} slot Rasterplatz
 * @returns {string} neuer Text für das Feld "Patterns"
 */
export function editPattern(pattern, kind, slot) {
    const slots = slotCount(pattern.timeSignature, pattern.grid) ?? 0;
    const strum = pattern.technique === 'strumming';
    const tokens = patternTokens(pattern);
    while (tokens.length < slots) tokens.push(strum ? '.' : '.');
    tokens.length = slots;
    const t = tokens[slot] ?? '.';
    if (strum) {
        const lower = t.toLowerCase();
        if (kind === 'stroke') {
            const next = STROKE_CYCLE[(STROKE_CYCLE.indexOf(lower) + 1) % STROKE_CYCLE.length];
            tokens[slot] = t !== lower && next !== '.' ? next.toUpperCase() : next;
        } else if (kind === 'count' && lower !== '.') {
            tokens[slot] = t === lower ? lower.toUpperCase() : lower;
        }
        return tokens.join('');
    }

    /** @type {PickNote[]} */
    let notes = parseStep(t) ?? [];
    if (kind === 'count' && !notes.length) {
        tokens[slot] = t === 'x' ? '.' : 'x';
    } else if (kind === 'count') {
        const accent = !notes.some(n => n.accent);
        tokens[slot] = formatStep(notes.map(n => withAccent(n, accent)));
    } else {
        const accent = notes.some(n => n.accent);
        notes = notes.some(n => n.finger === kind) ? notes.filter(n => n.finger !== kind)
            : [...notes, {finger: kind, string: '', accent}];
        tokens[slot] = formatStep(notes);
    }
    return tokens.join(' ');
}

/**
 * Öffnet einen Dialog der Leadsheet-Werkzeuge: aus dem Dialog "Leadsheet" heraus geöffnet, liegt er über ihm (Schließen
 * zeigt ihn wieder), sonst allein (Menü der Werkzeugleiste).
 * @param {string} html Inhalt
 * @returns {void}
 */
function openDialog(html) {
    if (isOverlayOpen()) openStackedOverlay(html);
    else openOverlay(html);
}

/**
 * Dialog "Leadsheet" eines NoteEditor.
 */
export class LeadsheetTab {
    /**
     * @param {import('../pages/editor.js').NoteEditor} editor Bearbeitungsseite
     */
    constructor(editor) {
        this.editor = editor;

        /**
         * Pattern-Katalog, leer bis geladen.
         * @type {Pattern[]}
         */
        this.patternCatalog = [];

        /**
         * In wie vielen Songs ein Pattern vorkommt (aus api/patterns.php).
         * @type {Object<string, number>}
         */
        this.usage = {};

        /**
         * Akkord-Katalog (Standardgriffe, für die Regel der Griffbilder), null bis geladen bzw. ohne.
         * @type {?import('../lib/chords.js').ChordCatalog}
         */
        this.chordCatalog = null;

        /** Zeitgeber für die Vorschau beim Tippen der Hinweise zur Spielweise. */
        this.instructionsTimer = 0;
    }

    /**
     * Inhalt des Dialogs "Leadsheet" (editor.js), null, solange er nicht zu sehen ist.
     * @returns {?HTMLElement}
     */
    get tab() {
        return /** @type {?HTMLElement} */ (document.querySelector('.dialog .etab-leadsheet'));
    }

    /**
     * Lädt Pattern-Katalog und Akkord-Katalog und zeichnet danach neu.
     * @returns {Promise<void>}
     */
    async loadPatternCatalog() {
        try {
            const data = await loadPatterns();
            this.patternCatalog = data.patterns;
            this.usage = data.usage ?? {};
        } catch (err) {
            this.editor.toast(err.message);
        }
        this.chordCatalog = await loadChordCatalog().catch(() => null);
        this.render();
    }

    /**
     * Zeichnet Eingaben und Vorschau neu.
     * @returns {void}
     */
    render() {
        this.renderList();
        void this.renderPreview();
    }

    /**
     * Zeichnet die Eingaben links neu (nicht, während in einem ihrer Felder geschrieben wird).
     * @returns {void}
     */
    renderList() {
        const ed = this.editor;
        const list = /** @type {?HTMLElement} */ (this.tab?.querySelector('.els-list'));
        if (!list || !ed.score || list.contains(document.activeElement)
            && document.activeElement.matches('input, select, textarea')) return;
        const score = ed.score;
        const sheet = ed.sheet;
        const byId = new Map(this.patternCatalog.map(p => [p.id, p]));
        const signatures = new Set(score.masterBars.map(mb => `${mb.timeSignatureNumerator}/${mb.timeSignatureDenominator}`));
        const button = (action, k, label, title, disabled = false) => `
            <button type="button" class="ebtn" data-ls-action="${action}" data-ls-index="${k}" title="${title}" aria-label="${title}"${disabled ? ' disabled' : ''}>
                ${label}
            </button>
        `;
        const patterns = sheet.patterns.map((entry, k) => {
            const p = byId.get(entry.id);
            const name = escapeHtml(p?.name ?? entry.id);
            return `
                <div class="els-item">
                    <div class="els-grid">${p ? patternGridHtml(p) : ''}</div>
                    <div class="els-meta">
                        <div><strong>${name}</strong> <span class="efield-hint">${p ? `${TECHNIQUES[p.technique]}, ${
                            escapeHtml(p.timeSignature)}` : this.patternCatalog.length ? 'nicht im Katalog' : ''}</span></div>
                        <input type="text" data-ls="when" data-ls-index="${k}" value="${escapeHtml(entry.when)}" placeholder="${WHEN_PLACEHOLDER}" aria-label="Wann wird ${name} gespielt?">
                    </div>
                    <div class="els-btns">
                        ${button('patternUp', k, '↑', 'Nach oben', k === 0)}
                        ${button('patternDown', k, '↓', 'Nach unten', k === sheet.patterns.length - 1)}
                        ${button('patternRemove', k, '×', 'Aus dem Song nehmen (bleibt im Katalog)')}
                    </div>
                </div>
            `;
        }).join('');
        // Angeboten werden Patterns mit einer Taktart des Songs, die er noch nicht hat.
        const options = Object.entries(TECHNIQUES).map(([technique, label]) => {
            const group = this.patternCatalog.filter(p => p.technique === technique && signatures.has(p.timeSignature)
                && !sheet.patterns.some(e => e.id === p.id));
            return group.length ? `
                <optgroup label="${label}">${group.map(p => `<option value="${escapeHtml(p.id)}">
                    ${escapeHtml(p.name)} (${escapeHtml(p.timeSignature)})</option>`).join('')}
                </optgroup>
            ` : '';
        }).join('');
        const tracks = stringedTracks(score);
        const count = score.masterBars.length;
        const tabs = sheet.tabs.map((tab, k) => {
            const known = tracks.some(t => t.name === tab.track);
            const number = (field, value, label) => `<input type="number" min="1" max="${count}" value="${value + 1}" data-ls="${field}" data-ls-index="${k}" aria-label="${label}" class="els-num">`;
            return `
                <div class="els-tab">
                    <button type="button" class="ebtn ebtn-text" data-bar-goto="${tab.from}" title="Cursor auf Takt ${tab.from + 1}">Takt</button>
                    ${number('tabFrom', tab.from, 'Erster Takt')}<span>–</span>${number('tabTo', tab.to, 'Letzter Takt')}
                    <select data-ls="tabTrack" data-ls-index="${k}" aria-label="Spur">
                        ${tracks.map(t => `<option value="${escapeHtml(t.name)}"${t.name === tab.track ? ' selected' : ''}>
                        ${escapeHtml(isWip(t) ? `${trackName(t)} ${WIP_MARK} (Baustelle, nicht auf dem Blatt)`
                            : trackName(t))}</option>`).join('')}
                        ${known ? '' : `<option value="${escapeHtml(tab.track)}" selected>${escapeHtml(tab.track || '–')} (fehlt)
                        </option>`}
                    </select>
                    <input type="text" data-ls="tabLabel" data-ls-index="${k}" value="${escapeHtml(tab.label)}" placeholder="z. B. Intro, Lick nach der Strophe" aria-label="Beschriftung">
                    ${button('tabRemove', k, '×', 'Tab-Stelle entfernen')}
                </div>
            `;
        }).join('');
        // Takte, die in "Text & Akkorde" durch einen Hinweis ersetzt sind.
        const cuts = sheet.cuts.map((cut, k) => {
            const number = (field, value, label) => `<input type="number" min="1" max="${count}" value="${value + 1}" data-ls="${field}" data-ls-index="${k}" aria-label="${label}" class="els-num">`;
            return `
                <div class="els-tab">
                    <button type="button" class="ebtn ebtn-text" data-bar-goto="${cut.from}" title="Cursor auf Takt ${cut.from + 1}">Takt</button>
                    ${number('cutFrom', cut.from, 'Erster Takt')}<span>–</span>${number('cutTo', cut.to, 'Letzter Takt')}
                    <input type="text" data-ls="cutText" data-ls-index="${k}" value="${escapeHtml(cut.text)}" placeholder="z. B. 2 mal spielen, wiederholen und leiser werden" aria-label="Hinweis statt der Takte">
                    ${button('cutRemove', k, '×', 'Takte wieder ausschreiben')}
                </div>
            `;
        }).join('');
        const chords = sheetChords(score, sheet, this.chordCatalog).map(c => `
            <label class="els-chord${c.shown ? '' : ' els-off'}" title="${c.auto ? 'Selten oder eigener Griff: vorgeschlagen'
                : 'Gängiger Akkord: nicht vorgeschlagen'}">
            ${chordDiagramSvg(c.name, c.grip)}
            <input type="checkbox" data-ls="chordShown" data-ls-chord="${escapeHtml(c.name)}"${c.shown ? ' checked' : ''} aria-label="Griffbild ${escapeHtml(c.name)} auf dem Blatt">
            </label>
        `).join('');
        const youtube = findSong(ed.player.slug)?.sources?.youtube ?? '';
        const links = sheet.links.map((link, k) => `
            <div class="els-link">
                <input type="text" data-ls="linkLabel" data-ls-index="${k}" value="${escapeHtml(link.label)}" placeholder="Bezeichnung, z. B. Original" aria-label="Bezeichnung" class="els-link-label">
                <input type="url" data-ls="linkUrl" data-ls-index="${k}" value="${escapeHtml(link.url)}" placeholder="https://…" aria-label="Adresse" class="els-link-url">
                <label class="efield-check"><input type="checkbox" data-ls="linkQr" data-ls-index="${k}"${link.qr ? ' checked' : ''}>
                    QR-Code
                </label>
                ${button('linkRemove', k, '×', 'Link entfernen')}
            </div>
        `).join('');
        // Layout: Kontrollkästchen, gespeichert in den Angaben (das Blatt passt sich nicht von allein an).
        const check = (key, label, title) => `
            <label class="efield-check" title="${title}">
                <input type="checkbox" data-ls="layout" data-ls-key="${key}"${sheet.layout[key] ? ' checked' : ''}> ${label}
            </label>
        `;
        const layout = `
            <div class="els-layout">
                ${check('twoPages', 'Auf 2 Seiten drucken', 'Seite 1 Spielanleitung, Seite 2 Text & Akkorde; sonst alles auf einer')}
                ${check('columns', 'Text zweispaltig', 'Text & Akkorde in zwei Spalten')}
                ${check('compactTabs', 'Tabs zusammenfassen', 'Wiederholte Takte in den Tabs nur einmal, mit Wiederholungszeichen')}
                ${check('tabCounts', 'Zählzeiten unter den Tabs', '1 + 2 + … unter den Notenhälsen der Tabs')}
                ${check('smallChords', 'Griffbilder klein', 'Griffbilder kleiner zeichnen')}
                ${check('mergeSections', 'Gleiche Abschnitte nur einmal', 'Ein Chorus, der genauso noch einmal kommt, steht '
                    + 'dann nur mit „wie oben“ bzw. „2ד da')}
                <label class="efield-check" title="Grundschrift auf dem Blatt">Schrift
                    <select data-ls="layout" data-ls-key="font">${FONT_SIZES.map(pt => `<option value="${pt}"${
                        pt === sheet.layout.font ? ' selected' : ''}>${pt} pt</option>`).join('')}</select></label>
            </div>
        `;
        list.innerHTML = `
      <h4>Seite</h4>
      ${layout}
      <h4>Patterns</h4>
      ${patterns || '<p class="efield-hint">Noch kein Pattern: aus dem Katalog wählen oder aus einer Begleitspur '
        + 'vorschlagen lassen.</p>'}
      <div class="ebar-actions">
        <select data-ls="addPattern" aria-label="Pattern aus dem Katalog hinzufügen">
          <option value="">+ Pattern aus dem Katalog …</option>${options}</select>
        <button type="button" class="ebtn ebtn-text" data-cmd="patternSuggest"
          title="Strumming bzw. Picking Patterns aus einer Begleitspur ableiten und mit dem Katalog vergleichen">
          Aus Spur vorschlagen …</button>
        <button type="button" class="ebtn ebtn-text" data-cmd="patternRollOut"
          title="Ein Pattern mit den Akkorden in eine Spur schreiben">Auf Spur ausrollen …</button>
        <button type="button" class="ebtn ebtn-text" data-cmd="patternCatalog"
          title="Strumming und Picking Patterns ansehen, neu aufnehmen, ändern">Pattern-Katalog …</button>
      </div>
      <h4>Tabs</h4>
      ${tabs || '<p class="efield-hint">Noch keine. Takte in den Noten markieren (Strg+Umschalt+←/→) und übernehmen.</p>'}
      <div class="ebar-actions">
        <button type="button" class="ebtn ebtn-text" data-ls-action="tabAdd"
          title="Die markierten Takte (ohne Auswahl den Takt am Cursor) als Tab auf das Blatt">${this.addTabLabel()}
        </button>
      </div>
      <h4>Takte ersetzen</h4>
      ${cuts || '<p class="efield-hint">Takte auf dem Blatt durch einen Hinweis ersetzen, z. B. „2-mal spielen“ statt '
        + 'der Takte noch einmal: in „Text &amp; Akkorde“ und in den Tabs. Die Noten bleiben, wie sie sind.</p>'}
      <div class="ebar-actions">
        <button type="button" class="ebtn ebtn-text" data-ls-action="cutAdd"
          title="Die markierten Takte (ohne Auswahl den Takt am Cursor) auf dem Blatt durch einen Hinweis ersetzen">
          ${this.addCutLabel()}</button>
      </div>
      <h4>Griffbilder</h4>
      ${chords ? `<div class="els-chords">${chords}</div>` : '<p class="efield-hint">Der Song hat keine Akkorde mit '
            + 'Griff.</p>'}
      <h4>Links</h4>
      ${links}
      <div class="ebar-actions">
        <button type="button" class="ebtn ebtn-text" data-ls-action="linkAdd">+ Link</button>
        ${youtube && !sheet.links.some(l => l.url === youtube) ? `<button type="button" class="ebtn ebtn-text"
          data-ls-action="linkYoutube" title="${escapeHtml(youtube)}">+ YouTube-Link aus den Stammdaten</button>` : ''}
      </div>
      <h4>Spielweise</h4>
      <textarea data-ls="instructions" rows="5" spellcheck="true" aria-label="Hinweise zur Spielweise"
        placeholder="Hinweise zur Spielweise für Seite 1. Markdown: # Überschrift, **fett**, *kursiv*, - Aufzählung, 1. Liste, [Text](https://…)"
        >${escapeHtml(sheet.instructions)}</textarea>`;
        const instructions = /** @type {HTMLTextAreaElement} */ (list.querySelector('[data-ls="instructions"]'));
        // Vorschau beim Tippen (übernommen wird beim Verlassen des Felds, ein Schritt für "Rückgängig").
        instructions.addEventListener('input', () => {
            clearTimeout(this.instructionsTimer);
            this.instructionsTimer = window.setTimeout(() => this.renderPreview({instructions: instructions.value}), 300);
        });
    }

    /**
     * Takte für eine neue Tab-Stelle: die Auswahl in den Noten, sonst der Takt am Cursor.
     * @returns {{from: number, to: number, track: number}}
     */
    range() {
        const ed = this.editor;
        const sel = ed.selection;
        return sel ? {from: sel.from, to: sel.to, track: sel.track} : {
            from: ed.pos.bar,
            to: ed.pos.bar,
            track: ed.pos.track
        };
    }

    /**
     * Aufschrift des Knopfs für eine neue Tab-Stelle.
     * @returns {string}
     */
    addTabLabel() {
        const {from, to} = this.range();
        return `+ ${from === to ? `Takt ${from + 1}` : `Takt ${from + 1}–${to + 1}`} als Tab`;
    }

    /**
     * Aufschrift des Knopfs für neue ersetzte Takte.
     * @returns {string}
     */
    addCutLabel() {
        const {from, to} = this.range();
        return `+ ${from === to ? `Takt ${from + 1}` : `Takt ${from + 1}–${to + 1}`} durch Hinweis ersetzen`;
    }

    /**
     * Cursor oder Auswahl haben sich geändert: Aufschrift der Knöpfe nachziehen.
     * @returns {void}
     */
    cursorMoved() {
        const button = this.tab?.querySelector('[data-ls-action="tabAdd"]');
        if (button) button.textContent = this.addTabLabel();
        const cut = this.tab?.querySelector('[data-ls-action="cutAdd"]');
        if (cut) cut.textContent = this.addCutLabel();
    }

    /**
     * Zeichnet die Vorschau rechts neu (generateLeadsheet(), layoutLeadsheet()), nur bei offenem Dialog; darunter
     * steht, ob das Blatt passt. Gemessen wird erst, wenn alphaTab die Tabs gezeichnet hat; bei mehreren Aufrufen gilt
     * nur der Letzte.
     * @param {Partial<Sheet>} [draft] Angaben, die noch nicht übernommen sind (Hinweise zur Spielweise beim Tippen)
     * @returns {Promise<void>} fertig, wenn die Vorschau samt Tabs steht
     */
    async renderPreview(draft = {}) {
        const ed = this.editor;
        const tab = this.tab;
        const view = /** @type {?HTMLElement} */ (tab?.querySelector('.els-preview'));
        if (!view || !ed.score) return;
        const sheet = {...ed.sheet, ...draft};
        const top = view.scrollTop;
        const song = findSong(ed.player.slug);
        const parts = generateLeadsheet(ed.alphaTab, ed.score, sheet, this.patternCatalog, this.chordCatalog,
            {title: song?.title ?? '', artist: song?.artist ?? ''});
        const run = this.previewRun = (this.previewRun ?? 0) + 1;
        layoutLeadsheet(view, parts, sheet.layout);
        this.sheetTabs ??= new SheetTabs(ed.alphaTab);
        const filled = fillSheetTabs(view, this.sheetTabs, ed.tex, sheet);
        view.scrollTop = top;
        await filled;
        if (run !== this.previewRun) return;
        const {text, problem} = describeLayout(measureLeadsheet(view), parts, sheet.layout);
        const capo = capoMismatch(ed.score);
        const warn = [problem, capo.length ? `Capo ungleich (${capo.map(c => `${c.track} ${c.capo}`)
            .join(', ')}); auf dem Blatt steht der Capo der Akkordspur.` : '']
            .filter(Boolean).join(' ');
        // Je ungleichem Vorkommen ein Knopf, der es mit dem ersten seiner Gruppe vergleicht.
        const compare = parts.differ.map(d => `<button type="button" class="ebtn ebtn-text" data-ls-action="compare" data-ls-a="${d.like}" data-ls-b="${d.index}">${escapeHtml(d.name)} vergleichen …</button>`).join(' ');
        tab.querySelector('.els-fit').innerHTML = `${warn ? `<strong class="edit-warn">${escapeHtml(warn)}</strong> ` : ''}${
            escapeHtml(text)}${compare ? ` ${compare}` : ''}`;
        view.scrollTop = top;
    }

    /**
     * Übernimmt ein Feld des Dialogs als einen Schritt für "Rückgängig".
     * @param {HTMLInputElement} input Feld (data-ls, data-ls-index)
     * @returns {void}
     */
    apply(input) {
        const ed = this.editor;
        const k = Number(input.dataset.lsIndex);
        const value = input.value.trim();
        switch (input.dataset.ls) {
            case 'addPattern':
                input.blur();
                if (value) ed.changeSheet(sheet => {
                    if (!sheet.patterns.some(p => p.id === value)) sheet.patterns.push({id: value, when: ''});
                });
                return;
            case 'when':
                ed.changeSheet(sheet => {
                    if (sheet.patterns[k]) sheet.patterns[k].when = value;
                });
                return;
            case 'tabFrom':
            case 'tabTo': {
                const bar = Math.round(Number(value)) - 1;
                const last = ed.score.masterBars.length - 1;
                input.blur();
                if (value && Number.isFinite(bar)) ed.changeSheet(sheet => {
                    const tab = sheet.tabs[k];
                    const n = Math.max(0, Math.min(last, bar));
                    if (input.dataset.ls === 'tabFrom') {
                        tab.from = n;
                        tab.to = Math.max(tab.to, n);
                    } else {
                        tab.to = n;
                        tab.from = Math.min(tab.from, n);
                    }
                    sheet.tabs.sort((a, b) => a.from - b.from || a.to - b.to);
                });
                this.renderList();
                return;
            }
            case 'tabTrack':
                input.blur();
                ed.changeSheet(sheet => {
                    sheet.tabs[k].track = input.value;
                });
                return;
            case 'tabLabel':
                ed.changeSheet(sheet => {
                    sheet.tabs[k].label = value;
                });
                return;
            case 'cutFrom':
            case 'cutTo': {
                const bar = Math.round(Number(value)) - 1;
                const last = ed.score.masterBars.length - 1;
                input.blur();
                if (value && Number.isFinite(bar)) ed.changeSheet(sheet => {
                    const cut = sheet.cuts[k];
                    const n = Math.max(0, Math.min(last, bar));
                    if (input.dataset.ls === 'cutFrom') {
                        cut.from = n;
                        cut.to = Math.max(cut.to, n);
                    } else {
                        cut.to = n;
                        cut.from = Math.min(cut.from, n);
                    }
                    sheet.cuts.sort((a, b) => a.from - b.from || a.to - b.to);
                });
                this.renderList();
                return;
            }
            case 'cutText':
                ed.changeSheet(sheet => {
                    sheet.cuts[k].text = value;
                });
                return;
            case 'chordShown': {
                // Gespeichert wird nur die Abweichung von der Regel.
                const name = input.dataset.lsChord;
                const auto = sheetChords(ed.score, ed.sheet, this.chordCatalog).find(c => c.name === name)?.auto;
                input.blur();
                ed.changeSheet(sheet => {
                    if (input.checked === auto) delete sheet.chords[name];
                    else sheet.chords[name] = input.checked;
                });
                return;
            }
            case 'linkLabel':
            case 'linkUrl':
                ed.changeSheet(sheet => {
                    if (sheet.links[k]) sheet.links[k][input.dataset.ls === 'linkLabel' ? 'label' : 'url'] = value;
                });
                return;
            case 'linkQr':
                input.blur();
                ed.changeSheet(sheet => {
                    if (sheet.links[k]) sheet.links[k].qr = input.checked;
                });
                return;
            case 'layout': {
                const key = input.dataset.lsKey;
                input.blur();
                ed.changeSheet(sheet => {
                    sheet.layout[key] = key === 'font' ? Number(value) : /** @type {HTMLInputElement} */ (input).checked;
                });
                return;
            }
            case 'instructions':
                clearTimeout(this.instructionsTimer);
                ed.changeSheet(sheet => {
                    sheet.instructions = input.value.replace(/\s+$/, '');
                });
        }
    }

    /**
     * Knöpfe des Dialogs (data-ls-action): Patterns verschieben bzw. herausnehmen, Tab-Stelle anlegen bzw. entfernen.
     * @param {HTMLElement} button Knopf
     * @returns {void}
     */
    action(button) {
        const ed = this.editor;
        const k = Number(button.dataset.lsIndex);
        switch (button.dataset.lsAction) {
            case 'patternUp':
            case 'patternDown': {
                const j = k + (button.dataset.lsAction === 'patternUp' ? -1 : 1);
                ed.changeSheet(sheet => {
                    const list = sheet.patterns;
                    if (j >= 0 && j < list.length) [list[k], list[j]] = [list[j], list[k]];
                });
                return;
            }
            case 'patternRemove':
                ed.changeSheet(sheet => {
                    sheet.patterns.splice(k, 1);
                });
                return;
            case 'tabRemove':
                ed.changeSheet(sheet => {
                    sheet.tabs.splice(k, 1);
                });
                return;
            case 'tabAdd':
                this.addTab();
                return;
            case 'cutRemove':
                ed.changeSheet(sheet => {
                    sheet.cuts.splice(k, 1);
                });
                return;
            case 'cutAdd': {
                const {from, to} = this.range();
                if (ed.sheet.cuts.some(c => c.from <= to && c.to >= from)) {
                    ed.toast('Diese Takte sind schon ganz oder teilweise ersetzt.');
                    return;
                }
                ed.changeSheet(sheet => {
                    sheet.cuts.push({from, to, text: ''});
                    sheet.cuts.sort((a, b) => a.from - b.from || a.to - b.to);
                });
                // Gleich weiterschreiben: Der Hinweis ist der Zweck.
                const at = ed.sheet.cuts.findIndex(c => c.from === from && c.to === to);
                (/** @type {?HTMLInputElement} */ (this.tab?.querySelector(`[data-ls="cutText"][data-ls-index="${at}"]`)))?.focus();
                return;
            }
            case 'print': {
                // Gedruckt wird die Vorschau, frisch gezeichnet.
                // Erst drucken, wenn alphaTab die Tabs gezeichnet hat.
                this.renderPreview().then(() => {
                    const view = /** @type {?HTMLElement} */ (this.tab?.querySelector('.els-preview'));
                    const score = ed.score;
                    const song = findSong(ed.player.slug);
                    if (view && score) printLeadsheet(view, [song?.artist, song?.title].filter(Boolean).join(' - ') || 'Leadsheet');
                });
                return;
            }
            case 'compare':
                this.compareDialog(button.dataset.lsA === undefined ? undefined : Number(button.dataset.lsA),
                    button.dataset.lsB === undefined ? undefined : Number(button.dataset.lsB));
                return;
            case 'linkAdd':
                // Neue Zeile zum Ausfüllen; ohne Adresse lässt der Server sie beim Speichern weg.
                ed.changeSheet(sheet => {
                    sheet.links.push({label: '', url: '', qr: true});
                });
                (/** @type {?HTMLInputElement} */ ([...this.tab?.querySelectorAll('[data-ls="linkLabel"]') ?? []].at(-1)))?.focus();
                return;
            case 'linkYoutube': {
                const url = findSong(ed.player.slug)?.sources?.youtube ?? '';
                if (url) ed.changeSheet(sheet => {
                    sheet.links.push({label: 'YouTube', url, qr: true});
                });
                return;
            }
            case 'linkRemove':
                ed.changeSheet(sheet => {
                    sheet.links.splice(k, 1);
                });
        }
    }

    /**
     * Legt eine Tab-Stelle für die Auswahl in den Noten (ohne Auswahl den Takt am Cursor) an: Spur ist die der
     * Auswahl, hat die keine Saiten, die Akkordspur; beschriftet mit dem Abschnitt, wenn sie an seinem Anfang beginnt.
     * @returns {void}
     */
    addTab() {
        const ed = this.editor;
        const score = ed.score;
        const {from, to, track} = this.range();
        if (ed.sheet.tabs.some(t => t.from === from && t.to === to)) {
            ed.toast('Diese Takte stehen schon als Tab auf dem Blatt.');
            return;
        }
        // Gesangsspuren sind in Guitar-Pro-Dateien oft "Gitarren" mit Saiten; als Tab taugen sie nicht. Dann die erste
        // Spur mit Noten in diesen Takten, zuletzt die Akkordspur.
        const vocal = t => /voc|voice|gesang|stimme|sing/i.test(t.name);
        const playing = t => t.staves[0].bars.slice(from, to + 1).some(b => b.voices.some(v => v.beats.some(x => x.notes.length)));
        const candidates = stringedTracks(score, false, false).filter(t => !vocal(t));
        const chosen = score.tracks[track];
        const pick = candidates.includes(chosen) ? chosen : candidates.find(playing) ?? tabTrack(score, '');
        const name = pick?.name ?? '';
        const label = sections(score).find(s => s.from === from)?.name ?? '';
        ed.changeSheet(sheet => {
            sheet.tabs.push({from, to, track: name, label});
            sheet.tabs.sort((a, b) => a.from - b.from || a.to - b.to);
        });
    }

    /**
     * Dialog "Patterns aus Spur vorschlagen": leitet je Abschnitt das häufigste Pattern einer Begleitspur ab, fasst
     * gleiche zusammen (mit den Abschnitten, in denen sie vorkommen, als Vorschlag für "wann") und zeigt das ähnlichste
     * Katalog-Pattern. Übernommen werden sie in die Patterns des Songs; Patterns ohne Gegenstück kommen gleich in den
     * Katalog.
     * @returns {void}
     */
    suggest() {
        const ed = this.editor;
        const score = parseScore(ed.alphaTab, ed.tex);
        markWip(score, ed.sheet.wip);
        const tracks = stringedTracks(score, true, false);
        if (!tracks.length) {
            ed.toast('Keine Gitarrenspur mit sechs Saiten (außer Baustellen).');
            return;
        }
        const preferred = tracks.find(t => /^(strumming|picking)/i.test(t.name.trim())) ?? tracks[0];
        openDialog(`
            <h2>Patterns aus Spur vorschlagen</h2>
            <div class="struct-form">
                <div class="form-field"><label for="patternSource">Begleitspur</label>
                    <select id="patternSource">${tracks.map(t => `<option value="${t.index}"${t === preferred ? ' selected' : ''}>
                        ${escapeHtml(trackName(t))}</option>`).join('')}</select>
                </div>
                <div id="patternSuggestions"></div>
                <div class="struct-actions">
                    <button class="btn btn-primary" type="button" id="patternApply">Übernehmen</button>
                    <button class="btn" type="button" id="patternCancel">Abbrechen</button>
                </div>
            </div>
        `);
        const source = /** @type {HTMLSelectElement} */ (document.getElementById('patternSource'));

        /**
         * Gefundene Patterns, gleiche zusammengefasst.
         * @type {{derived: DerivedPattern, best: ?Pattern, score: number, exact: boolean,
         *   names: string[], bars: number, matching: number}[]}
         */
        let groups = [];
        const show = () => {
            groups = [];

            /** @type {Map<string, typeof groups[0]>} */
            const byKey = new Map();
            for (const s of suggestPatterns(score, Number(source.value), this.patternCatalog)) {
                if (!s.derived) continue;
                const exact = !!s.best && s.score === 1;
                const key = exact ? `id:${s.best.id}`
                    : `new:${s.derived.technique}|${s.derived.timeSignature}|${patternNotation(s.derived)}`;
                let group = byKey.get(key);
                if (!group) {
                    group = {derived: s.derived, best: s.best, score: s.score, exact, names: [], bars: 0, matching: 0};
                    byKey.set(key, group);
                    groups.push(group);
                }
                const name = s.section || 'Anfang';
                if (!group.names.includes(name)) group.names.push(name);
                group.bars += s.bars;
                group.matching += s.matching;
            }
            const inSong = new Set(ed.sheet.patterns.map(p => p.id));
            const title = score.title.trim() || 'Neues Pattern';
            const fresh = groups.filter(g => !g.exact);
            document.getElementById('patternSuggestions').innerHTML = groups.length ? `
                <table class="ebar-table ebar-suggest">
                    <thead><tr><th>In der Spur</th><th>Übernehmen als</th><th>Wann</th></tr></thead>
                    <tbody>${groups.map((g, k) => {
                        const candidates = this.patternCatalog.filter(p => p.technique === g.derived.technique
                            && p.timeSignature === g.derived.timeSignature);
                        const n = fresh.indexOf(g);
                        return `<tr>
                            <td>${patternGridHtml(g.derived)}
                                <span class="efield-hint">${TECHNIQUES[g.derived.technique]}: ${escapeHtml(g.names.join(', '))},
                                    ${g.matching} von ${g.bars} Takten</span>
                            </td>
                            <td><select data-suggest="${k}">
                                <option value="">nicht übernehmen</option>
                                ${g.exact ? '' : '<option value="+" selected>neu in den Katalog …</option>'}
                                ${candidates.map(p => `<option value="${escapeHtml(p.id)}"${g.exact && p === g.best ? ' selected' : ''}>
                                ${escapeHtml(p.name)}${p === g.best ? ` (${Math.round(g.score * 100)} %)` : ''}${
                                    inSong.has(p.id) ? ', schon im Song' : ''}</option>`).join('')}
                                </select>
                                ${g.exact ? '' : `<input type="text" data-suggest-name="${k}" placeholder="Name des neuen Patterns" value="${escapeHtml(n ? `${title} ${n + 1}` : title)}">`}
                            </td>
                            <td>
                                <input type="text" data-suggest-when="${k}" placeholder="${WHEN_PLACEHOLDER}" value="${escapeHtml(groups.length === 1 ? 'ganzer Song' : g.names.join(', '))}">
                            </td>
                            </tr>`;
                                }).join('')}</tbody>
                </table>
                <p class="hint">Je Abschnitt zählt das häufigste Pattern; gleiche Patterns stehen in einer Zeile. „Wann“ ist ein
                    Vorschlag aus den Abschnitten und lässt sich ändern.
                </p>
            `
                : '<p class="hint">In dieser Spur ist kein Pattern zu erkennen.</p>';
        };
        show();
        source.addEventListener('change', show);
        document.getElementById('patternCancel').addEventListener('click', closeOverlay);
        document.getElementById('patternApply').addEventListener('click', async () => {
            /** @type {Pattern[]} */
            const added = [];

            /** @type {{id: string, when: string}[]} */
            const chosen = [];
            for (const [k, g] of groups.entries()) {
                const valueField = /** @type {HTMLSelectElement} */ (document.querySelector(`[data-suggest="${k}"]`));
                const whenField = /** @type {HTMLInputElement} */ (document.querySelector(`[data-suggest-when="${k}"]`));
                const value = valueField.value;
                const when = whenField.value.trim();
                if (!value) continue;
                if (value !== '+') {
                    chosen.push({id: value, when});
                    continue;
                }
                const d = g.derived;
                const nameInput = /** @type {HTMLInputElement} */ (document.querySelector(`[data-suggest-name="${k}"]`));
                const name = nameInput.value.trim();

                /** @type {Pattern} */
                const pattern = {
                    id: patternId(name, [...this.patternCatalog, ...added]), name, technique: d.technique,
                    timeSignature: d.timeSignature, grid: d.grid
                };
                if (d.technique === 'strumming') pattern.strokes = d.tokens.join('');
                else pattern.steps = d.tokens.join(' ');
                const error = patternError(pattern);
                if (error) {
                    ed.toast(error);
                    nameInput.focus();
                    return;
                }
                added.push(pattern);
                chosen.push({id: pattern.id, when});
            }
            if (added.length) {
                try {
                    const data = await savePatterns([...this.patternCatalog, ...added]);
                    this.patternCatalog = data.patterns;
                    this.usage = data.usage ?? {};
                } catch (err) {
                    ed.toast('Katalog nicht gespeichert: ' + err.message);
                    return;
                }
            }
            closeOverlay();
            // Schon vorhandene Patterns bekommen den Vorschlag für "wann" nur, wenn dort noch nichts steht.
            ed.changeSheet(sheet => {
                for (const {id, when} of chosen) {
                    const existing = sheet.patterns.find(p => p.id === id);
                    if (!existing) sheet.patterns.push({id, when});
                    else if (!existing.when) existing.when = when;
                }
            });
            this.render();
            ed.toast(`${chosen.length} ${chosen.length === 1 ? 'Pattern' : 'Patterns'} übernommen`
                + (added.length ? `, ${added.length} neu im Katalog.` : '.'));
        });
    }

    /**
     * Dialog "Abschnitte vergleichen", wie ein Diff-Editor: die Taktpaare zweier Abschnitte, die sich unterscheiden
     * (compareSectionBars()), je Spur als Tab; → und ← übernehmen den ganzen Takt der Spur (copyBars()), je ein Schritt
     * für "Rückgängig". Ohne Angabe sind die ersten ungleichen Vorkommen einer Gruppe vorausgewählt.
     * @param {number} [a] Abschnitt links (Index in TextModel.sections)
     * @param {number} [b] Abschnitt rechts
     * @returns {void}
     */
    compareDialog(a, b) {
        const ed = this.editor;
        if (!ed.score) return;
        let list = buildTextModel(ed.score).sections;
        if (list.length < 2) {
            ed.toast('Der Song hat nur einen Abschnitt.');
            return;
        }
        if (a === undefined || b === undefined) {
            const first = collapseSections(list).differ[0];
            const groups = list.map(s => sectionGroup(s.name));
            const k = groups.findIndex((g, i) => g && groups.indexOf(g) < i);
            [a, b] = first ? [first.like, first.index] : k >= 0 ? [groups.indexOf(groups[k]), k] : [0, 1];
        }
        openDialog('<h2>Abschnitte vergleichen</h2><div class="cmp" id="cmpBox"></div>');
        const box = /** @type {HTMLElement} */ (document.getElementById('cmpBox'));
        // Übernahmen in diesem Dialog: so oft geht "Rückgängig" hier (Strg+Z wirkt nicht, solange ein Dialog offen
        // ist).
        let taken = 0;

        /** Taktpaare des letzten Zeichnens (für die Pfeile). @type {BarDiffRow[]} */
        let barRows = [];

        /**
         * Takte eines Abschnitts für die Auswahlliste ("Takt 9–16"), wie im Reiter "Noten" gezählt (ohne
         * Wiederholungen; ein zweiter Durchgang hat dieselben Nummern).
         * @type {(s: {start: number, end: number}) => string}
         */
        const barsOf = s => {
            const bars = sectionBars(ed.score, s).map(x => x.mb.index + 1);
            return bars.length ? `Takt ${bars[0]}${bars.length > 1 ? `–${bars.at(-1)}` : ''}` : '';
        };

        /** Pfeile → und ← (attrs: welche Takte bzw. Spur). */
        const arrows = (attrs, what) => `
            <span class="cmp-arrows">
                <button type="button" class="ebtn" data-cmp-bars="right" ${attrs} title="${what} links nach rechts übernehmen" aria-label="${what} links nach rechts übernehmen">→</button>
                <button type="button" class="ebtn" data-cmp-bars="left" ${attrs} title="${what} rechts nach links übernehmen" aria-label="${what} rechts nach links übernehmen">←</button>
            </span>
        `;
        const draw = () => {
            const pick = [a, b].map(i => list[Math.min(i, list.length - 1)]);
            const one = a === b;
            const diff = compareSectionBars(ed.score, pick[0], pick[1]);
            barRows = one ? [] : diff.rows;
            const differing = barRows.filter(r => r.tracks.length);
            const options = sel => list.map((s, i) => `
                <option value="${i}"${i === sel ? ' selected' : ''}>${
                    escapeHtml(s.name || 'Anfang')} · ${barsOf(s)}</option>
            `).join('');
            const label = side => side ? `Takt ${side.index + 1}` : '–';
            const cell = (t, side, other) => `
                <div class="cmp-bar-cell"><div class="cmp-bar-track">${
                    escapeHtml(trackName(ed.score.tracks[t]))}</div>${barCellHtml(ed.score.tracks[t], side.index, side.pass,
                    other.index)}</div>
            `;
            const rows = barRows.map((r, n) => {
                if (!r.tracks.length) return `
                    <div class="cmp-bar-head"><span>${label(r.left)}</span><span class="efield-hint">
                        ohne Gegenüber</span><span>${label(r.right)}</span>
                    </div>
                `;
                return `
                    <div class="cmp-bar-head"><span>${label(r.left)}</span>${arrows(`data-cmp-row="${n}"`,
                        r.tracks.length > 1 ? 'Takt in allen Spuren' : 'Takt')}<span>${label(r.right)}</span></div>
                `
                    + r.tracks.map(t => `
                        <div class="cmp-bar-row">${cell(t, r.left, r.right)}${r.tracks.length > 1
                            ? arrows(`data-cmp-row="${n}" data-cmp-track="${t}"`, 'Takt dieser Spur') : '<span class="cmp-arrows"></span>'}${
                            cell(t, r.right, r.left)}</div>
                    `).join('');
            }).join('');
            box.innerHTML = `
                <div class="cmp-picks">
                    <select data-cmp-pick="0" aria-label="Linker Abschnitt">${options(a)}</select>
                    <span class="cmp-arrows">${differing.length > 1 ? arrows('', 'Alle verschiedenen Takte') : ''}</span>
                    <select data-cmp-pick="1" aria-label="Rechter Abschnitt">${options(b)}</select>
                </div>
                ${rows ? `<div class="cmp-bars">${rows}</div>` : `<p class="cmp-same" aria-live="polite">${one
                    ? 'Derselbe Abschnitt.' : 'Alle Takte gleich.'}</p>`}
                ${taken ? '<div class="cmp-foot"><button type="button" class="btn" data-cmp-undo>Rückgängig</button></div>' : ''}
                ${rows.includes('data-cmp-bar=') ? creditHtml('cmp-credit') : ''}
            `;
            // Die Takte zeichnet alphaTab nachträglich (fillCompareTabs() in js/ui/sheetview.js).
            this.sheetTabs ??= new SheetTabs(ed.alphaTab);
            void fillCompareTabs(box, this.sheetTabs, ed.tex);
        };

        /**
         * Pfeil gedrückt: Takte in eine Richtung übernehmen (copyBars() in notation.js), ein Schritt für "Rückgängig".
         * Ohne data-cmp-row alle verschiedenen Takte, ohne data-cmp-track alle Spuren des Taktpaars.
         * @param {HTMLButtonElement} arrow Pfeil (data-cmp-bars: Zielseite left/right)
         * @returns {void}
         */
        const takeBars = arrow => {
            const toRight = arrow.dataset.cmpBars === 'right';
            const rows = arrow.dataset.cmpRow === undefined ? barRows : [barRows[Number(arrow.dataset.cmpRow)]];
            const only = arrow.dataset.cmpTrack === undefined ? null : Number(arrow.dataset.cmpTrack);
            const copies = rows.filter(r => r?.left && r.right).flatMap(r => r.tracks.filter(t => only === null || t === only)
                .map(track => ({
                    track,
                    from: (toRight ? r.left : r.right).index,
                    to: (toRight ? r.right : r.left).index
                })));
            if (!copies.length) return;
            let count = 0;
            ed.change(() => {
                count = edit.copyBars(t => parseScore(ed.alphaTab, t), ed.score, ed.tex, copies);
            }, {label: `Takte ${toRight ? 'rechts' : 'links'} übernommen (Abschnitte vergleichen)`});
            list = buildTextModel(ed.score).sections;
            const bars = new Set(copies.map(c => c.to + 1));
            const tracks = new Set(copies.map(c => c.track));
            ed.toast(`${bars.size === 1 ? `Takt ${[...bars][0]}` : `${bars.size} Takte`} ${toRight ? 'rechts' : 'links'} `
                + `übernommen (${tracks.size === 1 ? trackName(ed.score.tracks[[...tracks][0]]) : `${tracks.size} Spuren`}`
                + `${count < copies.length ? `, ${copies.length - count} nicht möglich` : ''}).`);
            taken++;
            draw();
        };
        box.addEventListener('change', e => {
            const select = /** @type {HTMLSelectElement} */ (e.target);
            if (!select.matches('[data-cmp-pick]')) return;
            if (select.dataset.cmpPick === '0') a = Number(select.value);
            else b = Number(select.value);
            draw();
        });
        box.addEventListener('click', e => {
            const target = /** @type {HTMLElement} */ (e.target);
            if (target.closest('[data-cmp-undo]')) {
                ed.undo(ed.undoStack, ed.redoStack);
                taken--;
                list = buildTextModel(ed.score).sections;
                draw();
                return;
            }
            const arrow = /** @type {?HTMLButtonElement} */ (target.closest('[data-cmp-bars]'));
            if (arrow) takeBars(arrow);
        });
        draw();
    }

    /**
     * Dialog "Pattern auf Spur ausrollen": schreibt ein Pattern des Songs mit den Akkorden in eine Spur (rollOut() in
     * lib/patterns.js), in den gewählten Abschnitten bzw. der Auswahl in den Noten. Vorausgewählt sind die Abschnitte,
     * die im Feld "wann" genannt sind (sonst alle). Takte, die nicht nach Pattern aussehen (Break, Schluss), bleiben,
     * außer mit Häkchen.
     * @returns {void}
     */
    rollOut() {
        const ed = this.editor;
        const score = ed.score;
        const byId = new Map(this.patternCatalog.map(p => [p.id, p]));
        const usable = ed.sheet.patterns.filter(e => byId.has(e.id)).map(entry => ({
            entry,
            pattern: byId.get(entry.id)
        }));
        if (!usable.length) {
            ed.toast('Erst ein Pattern für den Song wählen (Dialog „Leadsheet“).');
            return;
        }
        const tracks = stringedTracks(score, true);
        const parts = sections(score);
        const sel = ed.selection;
        openDialog(`
            <h2>Pattern auf Spur ausrollen</h2>
            <form class="struct-form" id="rollOutForm">
                <div class="form-field"><label for="rollPattern">Pattern</label>
                    <select id="rollPattern">${usable.map((u, k) => `<option value="${k}">${escapeHtml(u.pattern.name)}${
                        u.entry.when ? ` – ${escapeHtml(u.entry.when)}` : ''}</option>`).join('')}</select></div>
                <div class="form-field"><label for="rollTarget">In Spur</label><select id="rollTarget"></select></div>
                <fieldset class="els-roll">
                    <legend>Takte</legend>
                    ${sel ? `<label class="check-field"><input type="checkbox" id="rollSelection" checked> Auswahl in den Noten:
                    Takt ${sel.from + 1}–${sel.to + 1}</label>` : ''}
                    <div id="rollSections">${parts.map((s, k) => `<label class="check-field">
                        <input type="checkbox" data-roll-section="${k}"> ${escapeHtml(s.name || 'Anfang')} <span class="efield-hint">Takt ${s.from + 1}–${
                            s.to + 1}</span></label>`).join('')}</div>
                </fieldset>
                <label class="check-field"><input type="checkbox" id="rollForce"> Auch Takte überschreiben, die von den
                    Pattern abweichen (Breaks, Schluss …)
                </label>
                <p class="hint">Vorausgewählt sind die Abschnitte, die im Feld „wann“ genannt sind, sonst alle. Je Anschlag der
                    Griff des Akkords, der dann klingt (aus den Noten, sonst aus dem Akkord-Katalog). Überschrieben werden nur
                    leere Takte und Takte, die einem Katalog-Pattern entsprechen; Takte mit anderer Taktart als das Pattern bleiben.
                </p>
                <div class="struct-actions">
                    <button class="btn btn-primary" type="submit">Ausrollen</button>
                    <button class="btn" type="button" id="rollCancel">Abbrechen</button>
                </div>
            </form>
        `);
        const select = /** @type {HTMLSelectElement} */ (document.getElementById('rollPattern'));
        const target = /** @type {HTMLSelectElement} */ (document.getElementById('rollTarget'));
        const selection = /** @type {?HTMLInputElement} */ (document.getElementById('rollSelection'));
        const boxes = /** @type {HTMLInputElement[]} */ ([...document.querySelectorAll('[data-roll-section]')]);
        const fill = () => {
            const {entry, pattern} = usable[Number(select.value)];
            const preferred = tracks.find(t => t.name.trim().toLowerCase() === pattern.technique);
            target.innerHTML = tracks.map(t => `
                <option value="${t.index}"${t === preferred ? ' selected' : ''}>
                ${escapeHtml(trackName(t))}</option>
            `).join('')
                + `<option value="new"${preferred ? '' : ' selected'}>neue Spur „${pattern.technique}“</option>`;
            // "Verse 2" zählt wie "Verse".
            const when = entry.when.toLowerCase();

            /** @type {boolean[]} */
            const named = parts.map(s => !!s.name && when.includes(s.name.toLowerCase().replace(/\s*\d+$/, '')));
            const any = named.some(Boolean);
            boxes.forEach((box, k) => {
                box.checked = any ? named[k] : true;
            });
        };
        const toggle = () => {
            for (const box of boxes) box.disabled = !!selection?.checked;
        };
        fill();
        toggle();
        select.addEventListener('change', fill);
        selection?.addEventListener('change', toggle);
        document.getElementById('rollCancel').addEventListener('click', closeOverlay);
        document.getElementById('rollOutForm').addEventListener('submit', async e => {
            e.preventDefault();

            /** @type {Pattern} */
            const pattern = usable[Number(select.value)].pattern;
            const forceBox = /** @type {HTMLInputElement} */ (document.getElementById('rollForce'));
            const force = forceBox.checked;
            const choice = target.value;

            /** @type {Set<number>} */
            const bars = new Set();
            if (selection?.checked) for (let i = sel.from; i <= sel.to; i++) bars.add(i);
            else boxes.forEach((box, k) => {
                if (box.checked) for (let i = parts[k].from; i <= parts[k].to; i++) bars.add(i);
            });
            if (!bars.size) {
                ed.toast('Keine Takte gewählt.');
                return;
            }
            closeOverlay();
            const chordCatalog = await loadChordCatalogOrEmpty();
            let result = {written: [], kept: [], misfit: [], chordless: [], gripless: []};
            let index = Number(choice);
            // Eine neue Spur gleich mit anzeigen (sie kommt ans Ende).
            if (choice === 'new') ed.trackIndexes = [...ed.trackIndexes, score.tracks.length];
            ed.change(() => {
                if (choice === 'new') {
                    edit.addTrack(ed.alphaTab, score, edit.freeTrackName(score, pattern.technique));
                    index = score.tracks.length - 1;
                }

                /** @type {(Pattern|null)[]} */
                const perBar = score.masterBars.map((_, i) => bars.has(i) ? pattern : null);
                result = rollOut(ed.alphaTab, score, index, perBar, this.patternCatalog, chordCatalog, force);
            }, {label: 'Pattern auf Spur ausgerollt'});

            const list = numbers => numbers.slice(0, 8).map(i => i + 1).join(', ') + (numbers.length > 8 ? ' …' : '');
            ed.toast(`${result.written.length} Takte geschrieben`
                + (result.kept.length ? `; nicht geändert (weichen vom Pattern ab): Takt ${list(result.kept)}` : '')
                + (result.misfit.length ? `; andere Taktart: Takt ${list(result.misfit)}` : '')
                + (result.chordless.length ? `; ohne Akkord (Pausen): Takt ${list(result.chordless)}` : '')
                + (result.gripless.length ? `; ohne Griff (Pausen): ${result.gripless.join(', ')}` : '') + '.');
        });
    }

    /**
     * Dialog "Pattern-Katalog": alle Patterns mit Verwendung; neu aufnehmen, ändern, löschen. Gespeichert wird der
     * ganze Katalog (PUT api/patterns.php); eine Änderung wirkt auf alle Songs, die das Pattern verwenden.
     * @param {?string} [editId] Pattern, das im Formular stehen soll
     * @returns {void}
     */
    patternCatalogDialog(editId = null) {
        const ed = this.editor;
        const current = this.patternCatalog.find(p => p.id === editId) ?? null;
        const rows = Object.entries(TECHNIQUES).map(([technique, label]) => {
            const group = this.patternCatalog.filter(p => p.technique === technique)
                .sort((a, b) => a.timeSignature.localeCompare(b.timeSignature) || a.name.localeCompare(b.name));
            return `<tr><th colspan="5">${label}</th></tr>` + group.map(p => `
                <tr${p.id === editId ? ' class="ebar-cursor"' : ''}>
                    <td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.timeSignature)}</td>
                    <td>${patternGridHtml(p)}</td>
                    <td class="efield-hint">${this.usage[p.id] ? `${this.usage[p.id]} Song${this.usage[p.id] === 1 ? '' : 's'}`
                        : ''}</td>
                    <td><button type="button" class="ebtn ebtn-text" data-pattern-edit="${escapeHtml(p.id)}">Ändern</button></td>
                </tr>
            `).join('');
        }).join('');
        const p = current ?? {id: '', name: '', technique: 'strumming', timeSignature: '4/4', grid: 8};
        openDialog(`
            <h2>Pattern-Katalog</h2>
            <table class="ebar-table ebar-patternCatalog"><tbody>${rows}</tbody></table>
            <form class="struct-form" id="patternForm">
                <fieldset>
                    <legend>${current ? `„${escapeHtml(current.name)}“ ändern` : 'Neues Pattern'}</legend>
                    <div class="form-field"><label for="patName">Name</label>
                        <input type="text" id="patName" value="${escapeHtml(p.name)}" required maxlength="80">
                    </div>
                    <div class="form-field"><label for="patTechnique">Technik</label>
                        <select id="patTechnique">${Object.entries(TECHNIQUES).map(([t, label]) =>
                            `<option value="${t}"${t === p.technique ? ' selected' : ''}>${label}</option>`).join('')}</select>
                    </div>
                    <div class="form-field"><label for="patTs">Taktart</label>
                        <input type="text" id="patTs" list="patSignatures" value="${escapeHtml(p.timeSignature)}">
                        <datalist id="patSignatures">${TIME_SIGNATURES.map(t => `<option value="${t}">`).join('')}</datalist>
                    </div>
                    <div class="form-field"><label for="patGrid">Raster</label>
                        <select id="patGrid"><option value="8"${p.grid === 8 ? ' selected' : ''}>Achtel</option>
                            <option value="16"${p.grid === 16 ? ' selected' : ''}>Sechzehntel</option></select>
                    </div>
                    <div class="form-field"><label for="patTokens">Pattern</label>
                        <input type="text" id="patTokens" value="${escapeHtml(patternTokens(p).length ? patternNotation(p) : '')}" spellcheck="false" autocapitalize="off">
                    </div>
                    <div class="form-field"><label>Raster (zum Anklicken; Zählzeiten aus Taktart und Raster)</label>
                        <div id="patPreview" class="pgrid-preview"></div>
                    </div>
                    <p class="hint">Eingabe im Feld oder per Klick ins Raster. Großbuchstabe = betont.
                        Strumming Patterns, je Rasterplatz ein Zeichen: d Plektrum abwärts (${glyph(GLYPHS.pickDown, true)}), u Plektrum
                        aufwärts (${glyph(GLYPHS.pickUp, true)}), x gedämpft (×), . klingen lassen; z. B. d.du.udu oder D.duD.du; im
                        Raster wechselt ein Klick auf das Zeichen nichts → abwärts → aufwärts → gedämpft, ein Klick auf die Zählzeit betont
                        (fett).
                        Picking Patterns als Fingersatz, je Rasterplatz ein Schritt, durch Leerzeichen getrennt: p Daumen auf dem tiefen
                        Bass, q Daumen auf dem zweiten Bass, i g-Saite, m b-Saite, a e-Saite; ohne Leerzeichen zugleich (pa, ima),
                        . klingen lassen, x Pause; z. B. p i q m p i q m. Im Raster: Klick auf die Saite setzt den Finger, Klick
                        auf die Zählzeit betont (fett) bzw. setzt eine Pause (x auf den zuletzt gespielten Saiten).${current && this.usage[current.id] ? ` Eine Änderung wirkt auf ${this.usage[current.id]}
                        Song${this.usage[current.id] === 1 ? '' : 's'}.` : ''}
                    </p>
                </fieldset>
                <div class="struct-actions">
                    <button class="btn btn-primary" type="submit">${current ? 'Speichern' : 'Aufnehmen'}</button>
                    ${current ? '<button class="btn" type="button" id="patNew">Neues Pattern</button>' : ''}
                    ${current ? '<button class="btn btn-danger" type="button" id="patDelete">Löschen</button>' : ''}
                    <button class="btn" type="button" id="patClose">Schließen</button>
                </div>
            </form>
        `);
        // Formular → Patterns (auch für die Vorschau beim Tippen).
        const readForm = () => {
            const value = id => {
                const input = /** @type {HTMLInputElement} */ (document.getElementById(id));
                return input.value.trim();
            };
            const technique = /** @type {'strumming'|'picking'} */ (value('patTechnique'));
            const name = value('patName');

            /** @type {Pattern} */
            const pattern = {
                id: current?.id ?? patternId(name, this.patternCatalog), name, technique,
                timeSignature: value('patTs').replace(/\s+/g, ''), grid: Number(value('patGrid'))
            };
            const tokens = value('patTokens');
            // Groß/klein bleibt (Betonung).
            if (technique === 'strumming') pattern.strokes = tokens.replace(/\s+/g, '');
            else pattern.steps = tokens.split(/\s+/).filter(Boolean).join(' ');
            return pattern;
        };
        const preview = () => {
            const pattern = readForm();
            const strum = pattern.technique === 'strumming';
            const slots = slotCount(pattern.timeSignature, pattern.grid);
            const tokenField = /** @type {HTMLInputElement} */ (document.getElementById('patTokens'));
            tokenField.placeholder = strum
                ? `${slots ?? '?'} Zeichen, z. B. d.du.udu` : `${slots ?? '?'} Schritte, z. B. p i q m p i q m`;
            // Leeres bzw. zu kurzes Pattern: Raster mit Punkten auffüllen, damit man hineinklicken kann.

            /** @type {Pattern} */
            const filled = {...pattern, name: pattern.name || 'x'};
            if (slots && strum) filled.strokes = (pattern.strokes ?? '').padEnd(slots, '.').slice(0, slots);
            else if (slots) filled.steps = [...patternTokens(pattern), ...Array(slots).fill('.')].slice(0, slots).join(' ');
            const error = patternError(filled);
            const tooLong = slots && patternTokens(pattern).length > slots;
            document.getElementById('patPreview').innerHTML = slots && !error && !tooLong ? patternGridHtml(filled, true)
                : `
                    <span class="efield-hint">${escapeHtml(error || (tooLong ? `Nur ${slots} Rasterplätze.`
                        : 'Raster passt nicht zur Taktart.'))}</span>
                `;
        };
        document.getElementById('patPreview').addEventListener('click', e => {
            const td = /** @type {?HTMLElement} */ (/** @type {HTMLElement} */ (e.target).closest('[data-cell]'));
            if (!td) return;
            const input = /** @type {HTMLInputElement} */ (document.getElementById('patTokens'));
            input.value = editPattern(readForm(), td.dataset.cell, Number(td.dataset.slot));
            preview();
        });
        preview();
        for (const id of ['patTechnique', 'patTs', 'patGrid', 'patTokens']) {
            document.getElementById(id).addEventListener('input', preview);
        }
        for (const button of document.querySelectorAll('[data-pattern-edit]')) {
            button.addEventListener('click', () => this.patternCatalogDialog(/** @type {HTMLElement} */ (button).dataset.patternEdit));
        }
        document.getElementById('patClose').addEventListener('click', () => {
            closeOverlay();
            this.render();
        });
        document.getElementById('patNew')?.addEventListener('click', () => this.patternCatalogDialog());
        const store = async (patterns, message) => {
            try {
                const data = await savePatterns(patterns);
                this.patternCatalog = data.patterns;
                this.usage = data.usage ?? {};
                ed.toast(message);
                return true;
            } catch (err) {
                ed.toast('Katalog nicht gespeichert: ' + err.message);
                return false;
            }
        };
        document.getElementById('patDelete')?.addEventListener('click', async () => {
            const uses = this.usage[current.id] ?? 0;
            if (uses && !confirm(`„${current.name}“ wird in ${uses} Song${uses === 1 ? '' : 's'} verwendet. Trotzdem `
                + 'löschen? Die Zuordnungen bleiben stehen und zeigen dann „nicht im Katalog“.')) return;
            if (await store(this.patternCatalog.filter(x => x !== current), `„${current.name}“ gelöscht.`)) this.patternCatalogDialog();
        });
        document.getElementById('patternForm').addEventListener('submit', async e => {
            e.preventDefault();
            const pattern = readForm();
            const name = pattern.name;
            const error = patternError(pattern);
            if (error) {
                ed.toast(error);
                return;
            }
            const uses = current ? this.usage[current.id] ?? 0 : 0;
            if (uses > 1 && !confirm(`„${current.name}“ wird in ${uses} Songs verwendet. Die Änderung gilt für alle.`)) return;
            const patterns = current ? this.patternCatalog.map(x => x === current ? pattern : x) : [...this.patternCatalog, pattern];
            if (await store(patterns, current ? `„${name}“ gespeichert.` : `„${name}“ in den Katalog aufgenommen.`)) {
                this.patternCatalogDialog(pattern.id);
            }
        });
    }
}
