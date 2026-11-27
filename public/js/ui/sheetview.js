/**
 * Leadsheet-Generator: setzt aus Noten und Angaben das Blatt (HTML), passt es auf die Seiten ein, druckt es;
 * dazu die Tab-Stellen, die alphaTab zeichnet. Seite 1 ist die Spielanleitung (Links, Patterns, Griffbilder, Tabs,
 * Hinweise), Seite 2 "Text & Akkorde"; gedruckt wird, was die Vorschau zeigt.
 */

import qrcode from '../../vendor/qrcode/qrcode.mjs';
import {ATTRIBUTION_TEXT, creditHtml, useCreditLogos} from './credit.js';
import {COMMON_CHORDS} from '../lib/chords.js';
import {FONT_SIZES, VERSE_GROUPS, normalizeSheet, sectionGroup, sectionName, tabOnWip, tabPieces, tabTrack} from '../lib/sheetmodel.js';
import {GLYPHS, glyph} from './icons.js';
import {TECHNIQUES, countLabels, parseStep, patternAccents, patternNotation, patternTokens} from '../lib/patterns.js';
import {TRIPLET_FEELS, chordsTrack, compareTuning, deleteBar, hasStrings, keyName, markWip, parseScore, shapeKey, stringedStaves, trackName, writeScore} from '../lib/notation.js';
import {buildTextModel, playTimeline, verseFor} from '../lib/textmodel.js';
import {renderTextView} from './textview.js';
import {chordDiagramSvg} from './chorddiagram.js';
import {escapeHtml} from '../lib/format.js';
import {loadChordCatalog, loadPatterns} from '../lib/api.js';

/** @typedef {import('../lib/patterns.js').Pattern} Pattern */
/** @typedef {import('../lib/patterns.js').DerivedPattern} DerivedPattern */
/** @typedef {import('../lib/sheetmodel.js').SheetTab} SheetTab */
/** @typedef {import('../lib/sheetmodel.js').SheetCut} SheetCut */
/** @typedef {import('../lib/sheetmodel.js').Sheet} Sheet */
/** @typedef {import('../lib/sheetmodel.js').SheetLayout} SheetLayout */
/** @typedef {import('../../../types/alphatab').model.MasterBar} MasterBar */
/** @typedef {import('../../../types/alphatab').model.Track} Track */
/** @typedef {import('../../../types/alphatab').model.Bar} Bar */
/** @typedef {import('../../../types/alphatab').model.Beat} Beat */
/** @typedef {import('../../../types/alphatab').model.Score} Score */
/** @typedef {import('../../../types/alphatab').model.Staff} Staff */
/** @typedef {typeof import('../../../types/alphatab')} AlphaTabModule */
/** @typedef {{title: string, artist?: ?string}} SongHead Titel und Interpret für den Kopf des Blatts */

/**
 * Anzeige der Schlagzeichen im Raster: Plektrumzeichen (abwärts, aufwärts) der Notenschrift (wie in den Noten, alphaTab
 * zeichnet sd/su so), gedämpft ×. Pfeile wären missverständlich: In den Noten bedeutet ein Pfeil Brush/Arpeggio.
 * @type {Object<string, string>} Zeichen (klein) → HTML
 */
const STROKE_SIGNS = {
    d: glyph(GLYPHS.pickDown, true, 'smufl-pickdown'), u: glyph(GLYPHS.pickUp, true, 'smufl-pickup'),
    x: '<span class="pgrid-mute">×</span>', '.': ''
};

/**
 * Zeilen des Zupfrasters von oben nach unten: [Finger im Pattern, Beschriftung, angezeigter Finger]. Saiten englisch
 * benannt (b statt h), beide Bass-Zeilen nur "B": Welcher Bass gemeint ist, zeigt die Lage.
 * Auf beiden steht der Daumen p (q gibt es nur in der Eingabe).
 */
const PICK_ROWS = [['a', 'e', 'a'], ['m', 'b', 'm'], ['i', 'g', 'i'], ['p', 'B', 'p'], ['q', 'B', 'p']];

/**
 * Patterns als kleines Raster, ganz unten die Zählzeiten (aus Taktart und Raster berechnet).
 * - Strumming Patterns: eine Zeile mit Plektrumzeichen (gedämpft ×), Betonungen zusätzlich als ">" darüber.
 * - Picking Patterns: wie eine kleine Tab, je Saite eine Zeile (e, b, g, Bass; Bass 2 nur, wenn benutzt), darauf der
 *   Finger. Eine Pause steht als x auf den Saiten, die zuletzt angeschlagen wurden (sie werden abgedämpft).
 * Betonte Schritte stehen bei beiden als fette Zählzeit.
 * Bearbeitbar (Vorschau im Katalog-Formular): alle Zeilen da, jede Zelle mit data-cell zum Anklicken;
 * die Zählzeit schaltet die Betonung (beim Picking Pattern an leerer Stelle die Pause).
 * @param {Pattern|DerivedPattern} pattern Pattern
 * @param {boolean} [editable] alle Zeilen zeigen und Zellen anklickbar machen
 * @param {boolean} [uniform] beim Strumming Pattern immer die Zeile für die Betonung freihalten, damit alle Patterns
 *   gleich hoch sind
 * @param {{slot: number, name: string}[][]} [chords] Akkordzeilen über dem Raster: je Zeile die Akkorde mit ihrem
 *   Rasterplatz (Dialog "Rhythmus ableiten")
 * @returns {string} HTML; ohne passendes Raster die Kurzschreibweise
 */
export function patternGridHtml(pattern, editable = false, uniform = false, chords = []) {
    const counts = countLabels(pattern.timeSignature, pattern.grid);
    const tokens = 'tokens' in pattern ? pattern.tokens : patternTokens(pattern);
    if (!counts.length || tokens.length !== counts.length) return `<code>${escapeHtml(patternNotation(pattern))}</code>`;
    const strum = pattern.technique === 'strumming';
    const accents = patternAccents(pattern);
    const head = strum ? '' : '<td class="pgrid-label"></td>';
    const cell = (html, kind, slot, cls = '') => editable
        ? `<td data-cell="${kind}" data-slot="${slot}"${cls ? ` class="${cls}"` : ''}>${html}</td>`
        : `<td${cls ? ` class="${cls}"` : ''}>${html}</td>`;
    const row = (cls, cells, label = null) => `
        <tr class="${cls}">${label === null ? head
            : `<td class="pgrid-label">${escapeHtml(label)}</td>`}${cells.join('')}</tr>
    `;
    // Senkrechte Linie vor jedem Schlag, damit die Taktart zu sehen ist; in 6/8, 9/8, 12/8 je drei Achtel.
    const compound = /^(6|9|12)\/8$/.test(pattern.timeSignature);
    const beats = counts.map(c => /^\d+$/.test(c) && c !== '1' && (!compound || (Number(c) - 1) % 3 === 0));
    let body;
    if (strum) {
        body = row('pgrid-token', tokens.map((t, k) => cell(STROKE_SIGNS[t.toLowerCase()] ?? escapeHtml(t), 'stroke', k)));
    } else {
        const steps = tokens.map(t => parseStep(t) ?? []);
        const used = new Set(steps.flat().map(n => n.finger));
        // Pause: x auf den Saiten, die zuletzt angeschlagen wurden und abgedämpft werden (ohne Anschlag davor im Takt
        // auf dem Bass).
        const muted = tokens.map((t, k) => {
            if (t !== 'x') return [];
            const before = steps.slice(0, k).findLast(notes => notes.length);
            return before ? before.map(n => n.finger) : ['p'];
        });
        body = PICK_ROWS.filter(([finger]) => editable || finger !== 'q' || used.has(finger))
            .map(([finger, label, shown]) => row('pgrid-string', steps.map((notes, k) =>
                notes.some(n => n.finger === finger) ? cell(`<span>${shown}</span>`, finger, k)
                    : muted[k].includes(finger) ? cell('<span>x</span>', finger, k, 'pgrid-x') : cell('', finger, k)), label))
            .join('');
    }
    return `
        <table class="pgrid${strum ? ' pgrid-strum' : ' pgrid-pick'}${editable ? ' pgrid-edit' : ''}"><colgroup>${
            strum ? '' : '<col>'}${beats.map(b => `<col${b ? ' class="pgrid-beat"' : ''}>`).join('')}</colgroup>
            ${chords.map(line => row('pgrid-chord', counts.map((_, k) => {
                const names = line.filter(m => m.slot === k).map(m => m.name).join(' ');
                return `<td>${names ? `<span>${escapeHtml(names)}</span>` : ''}</td>`;
            }))).join('')}
            ${strum && (editable || uniform || accents.some(Boolean)) ? row('pgrid-accent', accents.map((a, k) =>
                cell(a ? '&gt;' : '', 'count', k))) : ''}
            ${body}
            ${row('pgrid-count', counts.map((c, k) => cell(escapeHtml(c), 'count', k, accents[k] ? 'pgrid-strong' : '')))}
        </table>
    `;
}

/**
 * Vergleichsschlüssel eines Takts einer Tab: Anschläge mit Zeit, Dauer, Saite, Bund, gedämpft, gebunden.
 * @param {import('../../../types/alphatab').model.Bar} bar Takt eines Notensystems
 * @returns {string}
 */
function barKey(bar) {
    return bar.voices.map(v => v.beats.map(b => b.isRest ? `r${b.playbackStart}` : `${b.playbackStart}:${
        b.playbackDuration}:${b.notes.map(n => `${n.string}/${n.fret}/${n.isDead ? 'x' : ''}${n.isTieDestination ? 't' : ''}`)
        .join(',')}`).join(' ')).join('|');
}

/** Längster Block gleicher Takte, der beim Zusammenfassen als Ganzes wiederholt werden darf (zwei Phrasen à 4 Takte). */
const REPEAT_MAX_BARS = 8;

/**
 * Fasst Wiederholungen in einem Taktbereich zusammen: Folgt ein Block aus 1 bis REPEAT_MAX_BARS Takten mehrmals
 * gleich aufeinander, steht er einmal da, mit der Zahl der Durchgänge. Gewählt wird an jeder Stelle der Block, der die
 * meisten Takte einspart, bei Gleichstand der kürzere ("Takt 3 zweimal, dann weiter mit Takt 5").
 * @param {Staff} staff Notensystem
 * @param {number} from erster Takt
 * @param {number} to letzter Takt
 * @returns {{from: number, to: number, times: number}[]} Blöcke in Spielreihenfolge
 */
export function tabUnits(staff, from, to) {
    const last = Math.min(to, staff.bars.length - 1);
    const keys = [];
    for (let i = from; i <= last; i++) keys.push(barKey(staff.bars[i]));
    const units = [];
    for (let k = 0; k < keys.length;) {
        let best = {size: 1, times: 1};
        for (let size = 1; size <= REPEAT_MAX_BARS && k + 2 * size <= keys.length; size++) {
            let times = 1;
            while (k + (times + 1) * size <= keys.length
            && keys.slice(k + times * size, k + (times + 1) * size).every((key, j) => key === keys[k + j])) times++;
            if (times > 1 && (times - 1) * size > (best.times - 1) * best.size) best = {size, times};
        }
        units.push({from: from + k, to: from + k + best.size - 1, times: best.times});
        k += best.size * best.times;
    }
    return units;
}

/**
 * Spielfolge zusammengefasster Takte in Worten, z. B. "Takt 1–2 zweimal, dann Takt 5–8".
 * @param {{from: number, to: number, times: number}[]} units Blöcke aus tabUnits()
 * @returns {string}
 */
export function tabUnitsText(units) {
    const times = n => ({2: 'zweimal', 3: 'dreimal', 4: 'viermal'})[n] ?? `${n}-mal`;
    // Folgen ohne Wiederholung hintereinander zu einem Bereich zusammenziehen.
    const parts = [];
    for (const u of units) {
        const prev = parts.at(-1);
        if (prev && prev.times === 1 && u.times === 1 && u.from === prev.to + 1) prev.to = u.to;
        else parts.push({...u});
    }
    return parts.map(u => `Takt ${u.from + 1}${u.to > u.from ? `–${u.to + 1}` : ''}${u.times > 1 ? ` ${times(u.times)}`
        : ''}`).join(', dann ');
}

/** Ticks einer Viertel (wie alphaTab). */
const QUARTER_TICKS = 960;

/**
 * Raster der Zählzeiten eines Takts: Sechzehntel, wenn ein Anschlag auf einer Sechzehntel liegt, sonst Achtel; passt
 * ein Anschlag in keins von beiden (Triolen), nur die Schläge der Taktart. Für die Zählzeiten unter den Tabs von
 * alphaTab (ui/sheetview.js).
 * @param {MasterBar} mb Takt
 * @param {number[]} times Zeiten der Anschläge im Takt
 * @returns {number} Raster für countLabels()
 */
export function countGrid(mb, times) {
    const fits = grid => times.every(t => t % (QUARTER_TICKS * 4 / grid) === 0);
    return fits(8) ? Math.max(8, mb.timeSignatureDenominator) : fits(16) ? 16 : mb.timeSignatureDenominator;
}

/**
 * Texte über den Schlägen (Randnotizen) in der Reihenfolge der Takte, aus allen Spuren, gleiche im selben Takt nur
 * einmal.
 * @param {Score} score Noten
 * @returns {{bar: number, text: string}[]}
 */
export function beatTexts(score) {
    /** @type {Map<string, {bar: number, text: string}>} */
    const found = new Map();
    for (const track of score.tracks) for (const staff of track.staves) for (const bar of staff.bars) {
        for (const voice of bar.voices) for (const beat of voice.beats) {
            const text = beat.text?.trim();
            if (text) found.set(`${bar.index}|${text}`, {bar: bar.index, text});
        }
    }
    return [...found.values()].sort((a, b) => a.bar - b.bar);
}

/**
 * Griffbilder des Songs in der Reihenfolge des ersten Anschlags, mit der Entscheidung, ob sie auf das Blatt kommen.
 * Regel: Akkorde, die nicht gängig sind (COMMON_CHORDS), und gängige mit eigenem Griff (anders als der Standardgriff
 * des Katalogs, z. B. "G*" in "Kokain"); sheet.chords weicht davon ab.
 * @param {Score} score Noten
 * @param {Sheet} sheet Angaben
 * @param {?import('../lib/chords.js').ChordCatalog} chordCatalog Akkord-Katalog (Standardgriff zuerst), null ohne
 * @returns {{name: string, grip: string, auto: boolean, shown: boolean}[]} auto: nach der Regel
 */
export function sheetChords(score, sheet, chordCatalog) {
    // Ohne eigenen Griff in den Noten gilt der Standardgriff des Katalogs; ohne beides gibt es kein Griffbild.
    return buildTextModel(score).chords.flatMap(({name, grip}) => {
        const standard = chordCatalog?.[name.toLowerCase()]?.[0] ?? '';
        if (!grip && !standard) return [];
        const auto = !COMMON_CHORDS.includes(name) || !!grip && !!standard && standard !== grip;
        return [{name, grip: grip || standard, auto, shown: sheet.chords[name] ?? auto}];
    });
}

/**
 * Markdown in kleinem Umfang für die Hinweise zur Spielweise: Überschrift (#, ##, ###), Aufzählung (- oder *),
 * nummerierte Liste (1.), Absatz (Leerzeile), Zeilenumbruch, **fett**, *kursiv* bzw. _kursiv_, [Text](https://…).
 * Eigener kleiner Umsetzer statt einer Bibliothek: Mehr braucht das Feld nicht. HTML im Text wird nicht ausgeführt
 * (escapeHtml zuerst), Links nur mit http(s).
 * @param {string} text Markdown
 * @returns {string} HTML
 */
export function markdownHtml(text) {
    const inline = line => escapeHtml(line)
        .replace(/\[([^\]]+)]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => `<a href="${url}">${label}</a>`)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, '$1<em>$2</em>')
        .replace(/(^|\W)_(?!\s)(.+?)_(?!\w)/g, '$1<em>$2</em>');
    const out = [];

    /** @type {?{tag: string, lines: string[]}} */
    let block = null;
    const flush = () => {
        if (!block) return;
        out.push(block.tag === 'p' ? `<p>${block.lines.map(inline).join('<br>')}</p>`
            : `<${block.tag}>${block.lines.map(l => `<li>${inline(l)}</li>`).join('')}</${block.tag}>`);
        block = null;
    };
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trimEnd();
        const heading = line.match(/^(#{1,3})\s+(.*)$/);
        const bullet = line.match(/^\s*[-*]\s+(.*)$/);
        const number = line.match(/^\s*\d+[.)]\s+(.*)$/);
        if (!line.trim()) {
            flush();
        } else if (heading) {
            flush();
            out.push(`<h${heading[1].length + 3}>${inline(heading[2])}</h${heading[1].length + 3}>`);
        } else if (bullet || number) {
            const tag = bullet ? 'ul' : 'ol';
            if (block?.tag !== tag) {
                flush();
                block = {tag, lines: []};
            }
            block.lines.push((bullet ?? number)[1]);
        } else {
            if (block?.tag !== 'p') {
                flush();
                block = {tag: 'p', lines: []};
            }
            block.lines.push(line.trim());
        }
    }
    flush();
    return out.join('');
}

/**
 * QR-Code einer URL als SVG (qrcode-generator, Fehlerkorrektur M). Die URL wird als ASCII kodiert (new URL() maskiert
 * Umlaute).
 * @param {string} url Adresse
 * @returns {string} SVG, skalierbar
 */
export function qrSvg(url) {
    let href = url.trim();
    try {
        href = new URL(href).href;
    } catch {
        // keine vollständige URL: so, wie sie ist
    }
    const qr = qrcode(0, 'M');
    qr.addData(href);
    qr.make();
    return qr.createSvgTag({cellSize: 1, margin: 0, scalable: true});
}

/**
 * Seite 1 "Spielanleitung": Kopf (Titel, Interpret, Capo, Tuning, Tonart, Taktart, Tempo, Feeling; rechts die
 * QR-Codes),
 * Patterns mit "wann", Griffbilder, Tab-Stellen, Spielweise, Links ohne QR-Code, Hinweise (Texte über den Schlägen).
 * Die Größen sind relativ zur Breite der Seite (CSS .ls-page), so passt die verkleinerte Vorschau zum Ausdruck.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Score} score Noten
 * @param {Sheet} sheet Angaben für das Leadsheet
 * @param {Pattern[]} patternCatalog Pattern-Katalog
 * @param {?import('../lib/chords.js').ChordCatalog} chordCatalog Akkord-Katalog, null ohne
 * @param {{compact?: boolean, head?: SongHead}} [options] compact: Wiederholungen in den Tabs zusammenfassen
 *   (tabUnits(), hier nur für die Spielfolge in Worten); head: Titel und Interpret (ohne Angabe die der Noten)
 * @returns {string} HTML
 */
export function renderInstructions(alphaTab, score, sheet, patternCatalog, chordCatalog, options = {}) {
    const head = options.head ?? {title: score.title, artist: score.artist};
    const staff = guitarStaff(score);
    const mb = score.masterBars[0];
    const bar = staff.bars[0];
    const minor = bar.keySignatureType === alphaTab.model.KeySignatureType.Minor;
    const key = keyName(bar.keySignature, minor);
    // Tuning nur, wenn es vom Standard-Tuning abweicht, die abweichenden Saiten fett (wie im Kopf des Players,
    // describeScoreInfo()). Auch "alles einen Halbton tiefer" gehört hierher: Die Griffe sind dieselben, aber man muss
    // umstimmen.
    const strings = staff.tuning.length ? compareTuning(alphaTab, staff.tuning) : [];
    const tuning = strings.some(s => s.changed)
        ? 'Tuning ' + strings.map(s => s.changed ? `<strong>${escapeHtml(s.name)}</strong>` : escapeHtml(s.name)).join(' ')
        : '';
    // Wechselt das Tempo, steht der Bereich da.
    const tempos = [score.tempo, ...score.masterBars.flatMap(m => m.tempoAutomations.map(a => a.value))]
        .filter(t => t > 0).map(Math.round);
    const tempo = !tempos.length ? '' : Math.min(...tempos) === Math.max(...tempos) ? `${tempos[0]} BPM`
        : `${Math.min(...tempos)}–${Math.max(...tempos)} BPM`;
    // Den Capo übersieht man leicht, deshalb fett, dazu die Tonart der Griffe.
    const capoKey = staff.capo ? shapeKey(key, staff.capo) : '';
    const facts = [
        staff.capo ? `
            <strong>Capo ${staff.capo}</strong>${capoKey && capoKey !== key
                ? ` (Griffe ${escapeHtml(capoKey)})` : ''}
        ` : '',
        tuning,
        escapeHtml(key),
        `${mb.timeSignatureNumerator}/${mb.timeSignatureDenominator}`,
        tempo,
        Number(mb.tripletFeel) ? escapeHtml(TRIPLET_FEELS[Number(mb.tripletFeel)]) : '',
    ].filter(Boolean);
    const links = sheet.links.filter(l => l.url.trim());
    const qrs = links.filter(l => l.qr).map(l => `
        <figure class="ls-qr">${qrSvg(l.url)}
            <figcaption>${escapeHtml(l.label || 'Link')}</figcaption>
        </figure>
    `).join('');
    const byId = new Map(patternCatalog.map(p => [p.id, p]));
    const patterns = sheet.patterns.map(({id, when}) => {
        const p = byId.get(id);
        return `
            <div class="ls-pattern">
                <div class="ls-pattern-head"><strong>${escapeHtml(p?.name ?? id)}</strong>${p ? ` <span class="ls-soft">${
                    escapeHtml(TECHNIQUES[p.technique] ?? '')}</span>` : ' <span class="ls-soft">(nicht im Katalog)</span>'}${
                    when ? ` – ${escapeHtml(when)}` : ''}</div>
                ${p ? patternGridHtml(p) : ''}
            </div>
        `;
    }).join('');
    const chords = sheetChords(score, sheet, chordCatalog).filter(c => c.shown)
        .map(c => chordDiagramSvg(c.name, c.grip)).join('');
    // Die Tab selbst zeichnet alphaTab nachträglich in den Platzhalter.
    const tabs = sheet.tabs.map((tab, k) => {
        if (tabOnWip(score, tab)) return '';
        const track = tabTrack(score, tab.track);
        // Ersetzte Takte teilen die Tab-Stelle (tabPieces()); dann steht nur der Bereich in der Überschrift, die
        // Wiederholungszeichen der Stücke sprechen für sich.
        const pieces = tabPieces(tab, sheet.cuts);
        const whole = pieces.length === 1 && 'from' in pieces[0];
        // Zusammengefasst steht die Spielfolge in Worten da ("Takt 1–2 zweimal, dann Takt 5–8"), sonst der Bereich.
        const units = options.compact && track && whole ? tabUnits(track.staves[0], tab.from, tab.to) : [];
        const range = units.some(u => u.times > 1) ? tabUnitsText(units)
            : tab.from === tab.to ? `Takt ${tab.from + 1}` : `Takt ${tab.from + 1}–${tab.to + 1}`;
        return `
            <div class="ls-tab">
                <h3>${escapeHtml(tab.label || sectionName(score.masterBars[tab.from]?.section) || 'Tab')}
                    <span class="ls-soft">${range}</span>
                </h3>
                ${!track ? '<p class="ls-soft">Keine Spur mit Saiten.</p>' : pieces.map(piece => 'hint' in piece
                    ? (piece.hint ? `<p class="ls-tab-hint">${escapeHtml(piece.hint)}</p>` : '')
                    : `<div class="ls-at" data-tab="${k}" data-from="${piece.from}" data-to="${piece.to}"></div>`).join('')}
            </div>
        `;
    }).join('');
    const textLinks = links.filter(l => !l.qr);
    const hints = beatTexts(score);
    return `
        <div class="ls-head">
            <div class="ls-head-text">
                <h1>${escapeHtml(head.title || 'Ohne Titel')}</h1>
                ${head.artist ? `<div class="ls-artist">${escapeHtml(head.artist)}</div>` : ''}
                <div class="ls-facts">${facts.join(' · ')}</div>
            </div>
            ${qrs ? `<div class="ls-qrs">${qrs}</div>` : ''}
        </div>
        ${patterns ? `<div class="ls-patterns">${patterns}</div>` : ''}
        ${chords ? `<div class="ls-chords">${chords}</div>` : ''}
        ${tabs ? `<div class="ls-tabs">${tabs}</div>` : ''}
        ${sheet.instructions.trim() ? `<div class="ls-md">${markdownHtml(sheet.instructions)}</div>` : ''}
        ${textLinks.length ? `<p class="ls-links">${textLinks.map(l => `<span>${l.label ? `${escapeHtml(l.label)}: `
            : ''}${escapeHtml(l.url)}</span>`).join('')}</p>` : ''}
        ${hints.length ? `<p class="ls-hints">${hints.map(n => `<span><span class="ls-soft">T. ${n.bar + 1}</span> ${
            escapeHtml(n.text)}</span>`).join(' · ')}</p>` : ''}
    `;
}

/**
 * Notensystem der Gitarre für Capo und Tuning im Kopf: das der Akkordspur (nach ihr richtet "Capo angleichen" die
 * anderen Spuren aus), sonst das erste mit sechs Saiten, sonst das erste mit Saiten. Nicht einfach die erste Spur, die
 * ist oft der Gesang.
 * @param {Score} score Noten
 * @returns {Staff}
 */
function guitarStaff(score) {
    const stringed = stringedStaves(score);
    const chords = chordsTrack(score)?.staves[0];
    return (chords && stringed.includes(chords) ? chords : null) ?? stringed.find(st => st.tuning.length === 6)
        ?? stringed[0] ?? score.tracks[0].staves[0];
}

/**
 * Spuren mit Saiten, deren Capo von dem auf dem Blatt abweicht (löst der Konfliktlöser beim Import, siehe
 * conflicts.js).
 * @param {Score} score Noten
 * @returns {{track: string, capo: number}[]} leer, wenn alle gleich sind; sonst alle Spuren mit Saiten (track: Name
 *   wie in der Oberfläche)
 */
export function capoMismatch(score) {
    const stringed = stringedStaves(score);
    return new Set(stringed.map(st => st.capo)).size > 1
        ? stringed.map(st => ({track: trackName(st.track), capo: st.capo})) : [];
}

/**
 * Ein Abschnitt auf der Textseite: so wie aus buildTextModel() oder als Verweis auf ein gleiches Vorkommen davor
 * (lines leer, note "wie oben"); times: Durchgänge, wenn gleiche direkt aufeinander folgen.
 * @typedef {{name: string, lines: import('../lib/textmodel.js').TextLine[], note?: string, times?: number}}
 *   SheetSection
 */

/**
 * Ungleiches Vorkommen einer Gruppe: index der Abschnitt, like das erste Vorkommen seiner Gruppe (beides Indizes in
 * TextModel.sections), für "Vergleichen" in der Meldung unter der Vorschau.
 * @typedef {{name: string, index: number, like: number}} DifferEntry
 */

/**
 * Vergleichsschlüssel eines Abschnitts: Text, Akkorde und Taktstriche (ohne Zeiten), so wie sie auf dem Blatt
 * stehen. Gleicher Schlüssel heißt: steht nur einmal da.
 * @param {import('../lib/textmodel.js').TextLine[]} lines Zeilen
 * @returns {string}
 */
function sectionKey(lines) {
    return JSON.stringify(lines.map(l => l.hint !== undefined ? ['h', l.hint] : l.bars ? ['b', l.bars.map(b => b.chords)]
        : ['t', l.parts.map(p => [p.text, p.chords, p.bar])]));
}

/**
 * Vergleichsschlüssel eines Takts für "Abschnitte vergleichen": alle Stimmen mit Zeit und Dauer der Schläge, je Note
 * Tonhöhe, Saite, Bund, gedämpft und gebunden (so gilt er auch für Spuren ohne Tab), dazu Text (alle Strophen) und
 * Akkorde: Übernommen wird der ganze Takt, also unterscheidet ihn auch ein anderes Wort.
 * @param {import('../../../types/alphatab').model.Bar} bar Takt eines Notensystems
 * @returns {string}
 */
function barContentKey(bar) {
    return [...beatKeys(bar)].map(([t, key]) => `${t}=${key}`).join('|');
}

/**
 * Schläge eines Takts nach ihrer Zeit im Takt (playbackStart), je mit Schlüssel aus Dauer, Noten, Text und Akkord
 * aller Stimmen, die dort beginnen. Für barContentKey() und die Markierung der Unterschiede in einem Takt.
 * @param {import('../../../types/alphatab').model.Bar} bar Takt eines Notensystems
 * @param {boolean} [notesOnly] ohne Text und Akkord (für die roten Bundzahlen: ein anderes Wort ist keine andere Note)
 * @returns {Map<number, string>}
 */
function beatKeys(bar, notesOnly = false) {
    const chords = bar.staff.chords;

    /** @type {Map<number, string>} */
    const keys = new Map();
    bar.voices.forEach((v, i) => v.beats.forEach(b => {
        const key = `${i}:${b.playbackDuration}:${b.isRest ? 'r' : b.notes.map(n => `${n.realValue}/${n.string}/${n.fret}/${
            n.isDead ? 'x' : ''}${n.isTieDestination ? 't' : ''}`).join(',')}${notesOnly ? '' : `:${b.lyrics?.join('/') ?? ''}:${
            b.chordId ? chords?.get(b.chordId)?.name ?? '' : ''}`}`;
        keys.set(b.playbackStart, keys.has(b.playbackStart) ? `${keys.get(b.playbackStart)} ${key}` : key);
    }));
    return new Map([...keys].sort((x, y) => x[0] - y[0]));
}

/**
 * Zeiten im Takt, an denen sich die Noten zweier Takte unterscheiden (ein Schlag fehlt im anderen oder ist anders).
 * @param {import('../../../types/alphatab').model.Bar} bar Takt
 * @param {import('../../../types/alphatab').model.Bar} other Takt zum Vergleich
 * @returns {Set<number>}
 */
function beatDiff(bar, other) {
    const mine = beatKeys(bar, true);
    const theirs = beatKeys(other, true);
    return new Set([...mine].filter(([t, key]) => theirs.get(t) !== key).map(([t]) => t));
}

/**
 * Takte eines Abschnitts in Abspielreihenfolge: die Takte seines Markers (Abschnittsname am Takt), nicht sein
 * Zeitbereich. Der beginnt bei einem Auftakt schon im letzten Takt des vorigen Abschnitts, der gehört musikalisch
 * aber noch dorthin; sonst fehlte beim Vergleich der Takte der Schlusstakt jedes Abschnitts. Gewählt wird der
 * Markerbereich, der den Zeitbereich am meisten überdeckt.
 * @param {Score} score Noten
 * @param {{start: number, end: number}} section Abschnitt aus buildTextModel()
 * @returns {{mb: import('../../../types/alphatab').model.MasterBar, pass: number, t: number, end: number}[]}
 */
export function sectionBars(score, section) {
    const ranges = [];
    for (const x of playTimeline(score)) {
        if (!ranges.length || x.mb.section) ranges.push([]);
        ranges.at(-1).push(x);
    }
    const overlap = r => Math.min(section.end, r.at(-1).end) - Math.max(section.start, r[0].t);
    return ranges.reduce((best, r) => (overlap(r) > overlap(best) ? r : best), ranges[0] ?? []);
}

/**
 * Zeile im Vergleich der Takte: das k-te Taktpaar zweier Abschnitte (left/right: Takt, null, wenn der Abschnitt
 * kürzer ist), mit den Spuren, in denen sich die Takte unterscheiden.
 * @typedef {Object} BarDiffRow
 * @property {number} k Position im Abschnitt (ab 0)
 * @property {?{index: number, pass: number}} left Takt links (Index des Mastertakts, Durchgang)
 * @property {?{index: number, pass: number}} right Takt rechts
 * @property {number[]} tracks Spuren mit Unterschied (Index), bei fehlendem Takt leer
 */

/**
 * Vergleicht die Takte zweier Abschnitte Spur für Spur, Takt für Takt in der Reihenfolge (der erste mit dem ersten
 * usw., wie ein Diff-Editor Zeile für Zeile; verschoben wird nichts, Übernehmen ersetzt den Takt an derselben Stelle).
 * Derselbe Takt in zwei Durchgängen einer Wiederholung ist gleich.
 * @param {Score} score Noten
 * @param {{start: number, end: number}} a linker Abschnitt
 * @param {{start: number, end: number}} b rechter Abschnitt
 * @returns {{rows: BarDiffRow[], count: [number, number]}} nur verschiedene bzw. fehlende Takte; count: Takte je Seite
 */
export function compareSectionBars(score, a, b) {
    const sides = [sectionBars(score, a), sectionBars(score, b)];

    /** @type {BarDiffRow[]} */
    const rows = [];
    for (let k = 0; k < Math.max(sides[0].length, sides[1].length); k++) {
        const [left, right] = sides.map(list => list[k] ? {index: list[k].mb.index, pass: list[k].pass} : null);
        if (left && right && left.index === right.index) continue;
        const tracks = left && right ? score.tracks.map((t, i) => i).filter(i => {
            const bars = score.tracks[i].staves[0].bars;
            return barContentKey(bars[left.index]) !== barContentKey(bars[right.index]);
        }) : [];
        if (!left || !right || tracks.length) rows.push({k, left, right, tracks});
    }
    return {rows, count: [sides[0].length, sides[1].length]};
}

/**
 * Inhalt eines Takts einer Spur für den Vergleich: als Tab (Spuren mit Saiten), sonst nur der Hinweis "Noten", dazu
 * die Akkorde und der Text (Strophe des Durchgangs) darunter.
 * @param {import('../../../types/alphatab').model.Track} track Spur
 * @param {number} index Takt
 * @param {number} pass Durchgang (für die Strophe)
 * @param {number} [other] Takt auf der anderen Seite: Schläge, die dort anders sind, werden rot (nur im Tab)
 * @returns {string} HTML
 */
export function barCellHtml(track, index, pass, other) {
    const staff = track.staves[0];
    const bar = staff.bars[index];
    const otherBar = other === undefined ? null : staff.bars[other] ?? null;
    const marks = otherBar ? beatDiff(bar, otherBar) : null;

    /** Akkorde und Text eines Takts in Zeilenform (Text als Wörter: "knock- in'" → "knockin'"). */
    const lines = b => {
        const beats = b?.voices.flatMap(v => v.beats) ?? [];
        return {
            chords: beats.map(x => x.chordId ? staff.chords?.get(x.chordId)?.name : '').filter(Boolean).join(' '),
            words: beats.map(x => {
                const verse = verseFor(x.lyrics ?? [], pass);
                return verse >= 0 ? x.lyrics[verse].trim() : '';
            }).filter(Boolean).join(' ').replace(/- /g, ''),
        };
    };
    const mine = lines(bar);
    const theirs = otherBar ? lines(otherBar) : mine;
    const hasNotes = bar?.voices.some(v => v.beats.some(b => b.notes.length));
    // Die Tab zeichnet alphaTab nachträglich in den Platzhalter (fillCompareTabs() in js/ui/sheetview.js), abweichende
    // Bundzahlen rot (data-cmp-marks: Zeiten der abweichenden Schläge).
    const notes = hasStrings(staff) ? `
        <div class="cmp-tab" data-cmp-bar="${index}" data-cmp-track="${track.index}"${
            marks?.size ? ` data-cmp-marks="${[...marks].join(',')}"` : ''}></div>
    ` : `
            <div class="efield-hint${marks?.size ? ' cmp-bar-diff' : ''}">${hasNotes ? 'Noten'
                : 'Pause'}</div>
        `;
    // Anders als auf der anderen Seite: rot wie die Bundzahlen.
    const line = (kind, text) => text ? `
        <div class="cmp-bar-${kind}${text !== theirs[kind] ? ' cmp-bar-diff' : ''}">${
            escapeHtml(text)}</div>
    ` : '';
    return `${notes}${line('chords', mine.chords)}${line('words', mine.words)}`;
}

/**
 * Gleiche Abschnitte nur einmal: Ein Abschnitt, der einem früheren derselben Gruppe
 * (sectionGroup()) in Text und Akkorden gleicht, steht nur mit Namen und "wie oben" (bzw. "wie Chorus", wenn der
 * frühere anders heißt) da. Folgt er direkt auf dieses Vorkommen, bekommt das stattdessen "2×". Abschnitte ohne Namen
 * bleiben stehen; ungleiche Vorkommen einer Gruppe auch, sie werden gemeldet (Vereinheitlichen hilft beim Einpassen),
 * außer bei Strophen.
 * @param {import('../lib/textmodel.js').TextSection[]} list Abschnitte aus buildTextModel()
 * @returns {{sections: SheetSection[], merged: {name: string, count: number}[], differ: DifferEntry[]}} merged:
 *   Abschnitte, die nur einmal ausgeschrieben sind, mit der Zahl ihrer Vorkommen; differ: ungleiche Vorkommen
 */
export function collapseSections(list) {
    /** @type {(SheetSection & {ref?: SheetSection})[]} */
    const out = [];

    /** @type {{group: string, key: string, section: SheetSection, count: number, index: number}[]} */
    const written = [];

    /** @type {DifferEntry[]} */
    const differ = [];
    list.forEach((s, index) => {
        const group = sectionGroup(s.name);
        if (!group || !s.lines.length) {
            out.push({...s});
            return;
        }
        const k = sectionKey(s.lines);
        const same = written.find(w => w.group === group && w.key === k);
        if (!same) {
            // Strophen haben verschiedenen Text, ihre Abweichung ist keine Meldung wert. Verglichen werden
            // soll mit dem ersten Vorkommen der Gruppe: Das steht auf dem Blatt ganz da, nach ihm richten sich die
            // anderen.
            const first = written.find(w => w.group === group);
            if (!VERSE_GROUPS.test(group) && first) differ.push({name: s.name, index, like: first.index});
            const section = {...s};
            out.push(section);
            written.push({group, key: k, section, count: 1, index});
            return;
        }
        same.count++;
        const prev = out.at(-1);
        // Direkt hintereinander: Durchgänge am vorigen zählen (am Original oder an seinem Verweis).
        if (prev === same.section || prev.ref === same.section) {
            prev.times = (prev.times ?? 1) + 1;
            prev.note = prev.ref ? `${prev.ref.name === prev.name ? 'wie oben' : `wie ${prev.ref.name}`}, ${prev.times}×`
                : `${prev.times}×`;
        } else {
            out.push({
                name: s.name, lines: [], note: same.section.name === s.name ? 'wie oben' : `wie ${same.section.name}`,
                ref: same.section
            });
        }
    });
    return {
        sections: out.map(({ref, ...s}) => s), merged: written.filter(w => w.count > 1)
            .map(w => ({name: w.section.name, count: w.count})), differ
    };
}

/**
 * Fußzeile der Seite mit den Tabs: der Hinweis auf alphaTab mit dem offiziellen Logo, einmal je Seite, gut lesbar,
 * am Bildschirm mit Link.
 */
const CREDIT_HTML = creditHtml('ls-credit');

/**
 * Nimmt die ersetzten Takte (SheetCut) aus den Abschnitten von "Text & Akkorde" und setzt an ihre Stelle eine Zeile
 * mit dem Hinweis (TextLine.hint). Gerechnet wird in Zeit: Jeder Takt des Bereichs hat in der Spielfolge
 * (playTimeline()) seinen Zeitraum, aufeinander folgende Takte bilden einen Block; Silben, Akkorde und Takte, die
 * in einem Block beginnen, fallen weg. Wird ein Bereich wiederholt gespielt, ist jeder Durchgang ein eigener Block
 * mit eigenem Hinweis. Ein Bereich, in dem nichts steht (z. B. außerhalb des Songs), bleibt ohne Wirkung.
 * Fällt ein Abschnitt ganz weg, fällt auch seine Überschrift weg, und sein Hinweis schließt an den Abschnitt davor
 * an: So steht unter dem Chorus "2-mal spielen" statt einer zweiten Überschrift "Chorus" mit dem Hinweis darunter.
 * @param {import('../lib/textmodel.js').TextSection[]} list Abschnitte aus buildTextModel()
 * @param {Score} score Noten
 * @param {SheetCut[]} cuts ersetzte Takte
 * @returns {import('../lib/textmodel.js').TextSection[]} neue Liste
 */
export function applyCuts(list, score, cuts) {
    if (!cuts.length) return list;

    /** @type {{t: number, end: number, text: string, used: boolean}[]} */
    const blocks = [];
    for (const cut of cuts) {
        let last = null;
        for (const {mb, t, end} of playTimeline(score)) {
            if (mb.index < cut.from || mb.index > cut.to) continue;
            if (last && last.end === t) last.end = end;
            else blocks.push(last = {t, end, text: cut.text.trim(), used: false});
        }
    }
    const blockAt = t => blocks.find(b => t >= b.t && t < b.end);

    /** @type {import('../lib/textmodel.js').TextSection[]} */
    const out = [];
    for (const section of list) {
        /** @type {import('../lib/textmodel.js').TextLine[]} */
        const lines = [];
        for (const line of section.lines) {
            const items = line.bars ?? line.parts ?? [];
            const kept = items.filter(item => {
                const block = blockAt(item.t);
                if (!block) return true;
                // Der Hinweis steht einmal je Block, dort, wo sein erster Takt stand.
                if (!block.used && block.text) lines.push({t: block.t, parts: [], hint: block.text});
                block.used = true;
                return false;
            });
            if (kept.length === items.length) lines.push(line);
            else if (kept.length) {
                /** @type {import('../lib/textmodel.js').TextLine} */
                const rest = {...line};
                if (line.bars) rest.bars = /** @type {import('../lib/textmodel.js').BarCell[]} */ (kept);
                else rest.parts = /** @type {import('../lib/textmodel.js').LinePart[]} */ (kept);
                lines.push(rest);
            }
        }
        // Zeilen bleiben in der Reihenfolge der Zeit (der Hinweis kann vor dem Rest seiner Zeile entstanden sein).
        lines.sort((a, b) => a.t - b.t);
        const gone = section.lines.length > 0 && lines.every(l => l.hint !== undefined);
        if (gone && out.length) out.at(-1).lines.push(...lines);
        else {
            /** @type {import('../lib/textmodel.js').TextSection} */
            const rest = {...section};
            rest.lines = lines;
            out.push(rest);
        }
    }
    return out;
}

/**
 * "Text & Akkorde": als eigene Seite oder als Teil unter der Anleitung, auf Wunsch gleiche Abschnitte nur einmal
 * (collapseSections()), ohne die ersetzten Takte (applyCuts()).
 * @param {Score} score Noten
 * @param {boolean} [own] eigene Seite: mit Titel oben
 * @param {boolean} [merge] gleiche Abschnitte nur einmal ausschreiben
 * @param {SheetCut[]} [cuts] Takte, die durch einen Hinweis ersetzt sind
 * @param {SongHead} [head] Titel und Interpret (aus song.json; ohne Angabe die der Noten)
 * @returns {{html: string, merged: {name: string, count: number}[], differ: DifferEntry[]}}
 */
export function renderLyricsPage(score, own = false, merge = true, cuts = [], head = {
    title: score.title,
    artist: score.artist
}) {
    const model = buildTextModel(score);
    const sections = applyCuts(model.sections, score, cuts);
    const {sections: list, merged, differ} = merge ? collapseSections(sections)
        : {sections, merged: [], differ: []};
    const html = `${own ? `<div class="ls-page2-head"><strong>${escapeHtml(head.title || 'Ohne Titel')}</strong>${
        head.artist ? ` <span class="ls-soft">${escapeHtml(head.artist)}</span>` : ''}</div>` : ''}
    <div class="ls-text">${renderTextView({...model, sections: list})}</div>`;
    return {html, merged, differ};
}

/** Spielraum beim Vergleich mit der Seitenhöhe (Rundung beim Messen). */
const FIT_SLACK = 1.003;

/**
 * Seiten des Blatts, fertig zum Setzen (layoutLeadsheet()).
 * @typedef {Object} LeadsheetParts
 * @property {{label: string, html: string, text: boolean}[]} pages Seiten: Bezeichnung (bei zwei Seiten), Inhalt,
 *   und ob Text & Akkorde darauf stehen (für die Spalten)
 * @property {{name: string, count: number}[]} merged nur einmal ausgeschriebene Abschnitte
 * @property {DifferEntry[]} differ ungleiche Vorkommen einer Gruppe
 */

/**
 * Erzeugt die Seiten des Blatts aus Noten und Angaben, so wie es das Layout in den Angaben will (sheet.layout):
 * eine Seite (Spielanleitung, darunter Text & Akkorde) oder zwei, Tabs zusammengefasst oder nicht, gleiche
 * Abschnitte einmal oder jedes Mal.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Score} score Noten
 * @param {Sheet} sheet Angaben für das Leadsheet
 * @param {Pattern[]} patternCatalog Pattern-Katalog
 * @param {?import('../lib/chords.js').ChordCatalog} chordCatalog Akkord-Katalog, null ohne
 * @param {SongHead} [head] Titel und Interpret (aus song.json; ohne Angabe die der Noten, die meist keine haben)
 * @returns {LeadsheetParts}
 */
export function generateLeadsheet(alphaTab, score, sheet, patternCatalog, chordCatalog, head = {
    title: score.title,
    artist: score.artist
}) {
    const {layout} = sheet;
    // Die Fußzeile gehört auf die Seite mit den Tabs, wenn alphaTab dort etwas zeichnet.
    const credit = sheet.tabs.some(tab => tabTrack(score, tab.track) && tabPieces(tab, sheet.cuts).some(p => 'from' in p))
        ? CREDIT_HTML : '';
    const instructions = renderInstructions(alphaTab, score, sheet, patternCatalog, chordCatalog, {
            compact: layout.compactTabs,
            head
        })
        + credit;
    const text = renderLyricsPage(score, layout.twoPages, layout.mergeSections, sheet.cuts, head);
    const wrap = `<div class="ls-text-wrap">${text.html}</div>`;
    return {
        pages: layout.twoPages ? [{label: 'Seite 1 – Spielanleitung', html: instructions, text: false},
                {label: 'Seite 2 – Text & Akkorde', html: wrap, text: true}]
            : [{label: '', html: instructions + wrap, text: true}],
        merged: text.merged,
        differ: text.differ,
    };
}

/**
 * Setzt das Blatt nach dem Layout und lässt es in view stehen (die Seiten als .ls-page; view muss ein Container
 * sein, siehe CSS .els-preview bzw. #lsPrint). Entschieden wird hier nichts mehr: Schrift, Spalten und Größe der
 * Griffbilder kommen aus dem Layout. Gemessen wird nur, ob jede Seite auf ein DIN-A4-Blatt passt.
 * @param {HTMLElement} view Behälter
 * @param {LeadsheetParts} parts Seiten aus generateLeadsheet()
 * @param {SheetLayout} layout Layout aus den Angaben
 * @returns {number[]} je Seite ihre Länge in Seiten, wenn sie nicht passt (sonst 0)
 */
export function layoutLeadsheet(view, parts, layout) {
    view.innerHTML = parts.pages.map(p => `${p.label ? `<div class="ls-page-label">${escapeHtml(p.label)}</div>` : ''}
    <div class="ls-page${layout.smallChords ? ' ls-small' : ''}${p.text && layout.columns ? ' ls-cols2' : ''}"
      style="--ls-pt:${layout.font}">${p.html}</div>`).join('');
    return measureLeadsheet(view);
}

/**
 * Misst das gesetzte Blatt: je Seite ihre Länge in Seiten, wenn sie nicht auf ein DIN-A4-Blatt passt. Eigene
 * Funktion, weil die Tabs erst nach dem Setzen dazukommen (alphaTab zeichnet sie nachträglich, fillSheetTabs() in
 * ui/sheetview.js); gemessen wird danach.
 * @param {HTMLElement} view Behälter mit den gesetzten Seiten
 * @returns {number[]} je Seite ihre Länge in Seiten, wenn sie nicht passt (sonst 0)
 */
export function measureLeadsheet(view) {
    // Seitenlänge in Seiten (DIN A4: Höhe = Breite × 297/210).
    return [...view.querySelectorAll('.ls-page')].map(page => {
        const length = page.scrollHeight / (page.clientWidth * 297 / 210);
        return length <= FIT_SLACK ? 0 : length;
    });
}

/**
 * Meldung unter der Vorschau: ob das Blatt passt, und wenn nicht, was hilft (die Kästchen, die noch nicht gesetzt
 * sind).
 * @param {number[]} over Ergebnis von layoutLeadsheet()
 * @param {LeadsheetParts} parts Seiten (für die zusammengefassten Abschnitte)
 * @param {SheetLayout} layout Layout aus den Angaben
 * @returns {{text: string, problem: string}} problem: was nicht passt (rot anzeigen), sonst leer
 */
export function describeLayout(over, parts, layout) {
    const num = n => String(n).replace('.', ',');
    let text = over.some(Boolean) ? '' : over.length === 1 ? 'Passt auf eine Seite.' : 'Passt auf zwei Seiten.';
    if (parts.merged.length) {
        text += ` Nur einmal ausgeschrieben: ${parts.merged.map(m => `${m.name} (${m.count}×)`).join(', ')}.`;
    }
    // Aufgerundet, damit "zu lang" nie "etwa 1,0 Seiten" heißt.
    const long = over.map((length, i) => length ? `${over.length === 1 ? 'Das Blatt' : `Seite ${i + 1}`} ist etwa `
        + `${num((Math.ceil(length * 10) / 10).toFixed(1))} Seiten lang` : '').filter(Boolean);
    let problem = '';
    if (long.length) {
        const help = [layout.twoPages ? '' : 'auf zwei Seiten drucken', layout.columns ? '' : 'Text zweispaltig',
            layout.font > FONT_SIZES.at(-1) ? 'kleinere Schrift' : '', layout.compactTabs ? '' : 'Tabs zusammenfassen',
            layout.smallChords ? '' : 'Griffbilder klein', layout.mergeSections ? '' : 'gleiche Abschnitte nur einmal']
            .filter(Boolean);
        problem = `Passt nicht: ${long.join('; ')}.${help.length ? ` Abhilfe: ${help.join(', ')}.` : ''}`;
    }
    if (parts.differ.length) {
        const many = parts.differ.length > 1;
        text += ` ${parts.differ.map(d => d.name).join(', ')} ${many ? 'weichen' : 'weicht'} von früheren Vorkommen ab und `
            + `${many ? 'stehen' : 'steht'} deshalb ganz da.`;
    }
    return {text: text.trim(), problem};
}

/**
 * Druckt das Leadsheet eines Songs ohne den Dialog "Leadsheet" (Menü der Playerseite): Das Blatt wird unsichtbar
 * gesetzt wie in der Vorschau (generateLeadsheet(), layoutLeadsheet(), Tabs mit fillSheetTabs()) und dann gedruckt.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {string} tex Noten als alphaTex
 * @param {*} data Angaben für das Leadsheet (score.json, wird normalisiert)
 * @param {SongHead} head Titel und Interpret (Kopf des Blatts; daraus auch der Titel des Dokuments)
 * @returns {Promise<void>} fertig, wenn der Druckdialog geöffnet ist
 */
export async function printSongLeadsheet(alphaTab, tex, data, head) {
    const score = parseScore(alphaTab, tex);
    const sheet = normalizeSheet(data);
    markWip(score, sheet.wip);
    const patternCatalog = await loadPatterns().then(p => p.patterns).catch(() => []);
    const chordCatalog = await loadChordCatalog().catch(() => null);
    // Unsichtbar, aber mit Breite: Die Seite rechnet in cqw, gemessen wird beim Setzen.
    const view = document.createElement('div');
    view.className = 'els-preview';
    view.style.cssText = 'position:absolute; left:-20000px; top:0; width:800px; visibility:hidden;';
    document.body.append(view);
    try {
        layoutLeadsheet(view, generateLeadsheet(alphaTab, score, sheet, patternCatalog, chordCatalog, head), sheet.layout);
        await fillSheetTabs(view, new SheetTabs(alphaTab), tex, sheet);
        printLeadsheet(view, [head.artist, head.title].filter(Boolean).join(' - ') || 'Leadsheet');
    } finally {
        view.remove();
    }
}

/**
 * Druckt das Blatt so, wie es gesetzt in view steht: Die Seiten werden in einen Behälter in Papierbreite kopiert
 * (#lsPrint, Größen relativ zur Breite, siehe CSS), alles andere blendet @media print aus. Danach wird aufgeräumt.
 * @param {HTMLElement} view Vorschau mit den gesetzten Seiten (.ls-page)
 * @param {string} title Titel des Dokuments (Vorschlag für den Dateinamen beim Speichern als PDF)
 * @returns {HTMLElement} der Behälter (für Tests; nach dem Drucken wieder entfernt)
 */
export function printLeadsheet(view, title) {
    document.getElementById('lsPrint')?.remove();
    const box = document.createElement('div');
    box.id = 'lsPrint';
    for (const p of view.querySelectorAll('.ls-page')) box.append(p.cloneNode(true));
    document.body.append(box);
    document.body.classList.add('ls-printing');
    const oldTitle = document.title;
    document.title = title;
    // Bilder (Logo in der Fußzeile, QR-Code) müssen geladen sein, sonst fehlen sie auf dem Papier.
    const images = [...box.querySelectorAll('img')].filter(img => !img.complete);
    const cleanup = () => {
        box.remove();
        document.body.classList.remove('ls-printing');
        document.title = oldTitle;
        window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    // Was nicht lädt, kommt weg statt als kaputtes Bild aufs Papier (ohne Logo steht in der Fußzeile der Name).
    const ready = () => {
        for (const img of box.querySelectorAll('img')) if (!img.naturalWidth) img.remove();
        window.print();
    };
    if (!images.length) ready();
    else Promise.all(images.map(img => new Promise(done => {
        img.addEventListener('load', done, {once: true});
        img.addEventListener('error', done, {once: true});
    }))).then(ready);
    return box;
}


// --------------------------------------------------------------------------------------------------------------------
// Tabs von alphaTab
// --------------------------------------------------------------------------------------------------------------------
//
// Tabs auf dem Leadsheet und im Dialog "Abschnitte vergleichen", gezeichnet von alphaTab.
//
// Ablauf: alphaTab zeichnet die Takte einer Spur (display.startBar/barCount, nur Tab mit Notenhälsen) in einen
// unsichtbaren Behälter fester Breite. Das Ergebnis, mehrere SVG-Stücke, wird zu einer SVG mit viewBox
// zusammengesetzt. So skaliert die Tab mit der Breite der Seite (Vorschau und Druck haben verschiedene Breiten,
// siehe printLeadsheet()) und lässt sich als fertiges HTML kopieren. Die Stücke bleiben, wie alphaTab sie liefert.
//
// - Zusammenfassen (tabUnits()): Wiederholte Blöcke stehen einmal zwischen Wiederholungszeichen. Dazu
//   werden in einer Kopie der Noten die wiederholten Takte gelöscht und die Zeichen gesetzt. Die Taktnummern stimmen
//   in der Kopie nicht mehr und werden ausgeblendet; die Spielfolge steht in Worten in der Überschrift der Tab-Stelle.
// - Zählzeiten: Die kennt alphaTab nicht. Sie stehen als Text unter jeder Zeile, an den Stellen, an denen alphaTab
//   die Schläge gezeichnet hat (boundsLookup), dazwischen gleichmäßig verteilt. Sie zeigen auch den Unterschied
//   zwischen Halber und Viertel, die in den Notenhälsen der Tab (ohne Notenkopf) gleich aussehen.
//
// Zeichnen dauert etwa 0,2 s je Zeichnung; fertige Zeichnungen werden gemerkt, solange die Noten dieselben sind. Im
// Dialog "Abschnitte vergleichen" dauert es so ein paar Sekunden; das ist hingenommen, er wird selten gebraucht.
//
// --------------------------------------------------------------------------------------------------------------------

/**
 * Was gezeichnet wird: Takte from bis to einer Spur (Name wie in SheetTab oder Index).
 * @typedef {{from: number, to: number, track: string | number}} TabRange
 */

/**
 * Darstellung einer Zeichnung.
 * @typedef {Object} TabOptions
 * @property {boolean} [compact] Wiederholungen zusammenfassen (Leadsheet)
 * @property {boolean} [counts] Zählzeiten unter den Zeilen
 * @property {?Set<number>} [marks] Zeiten im ersten Takt (playbackStart), deren Bundzahlen rot sind (Vergleich)
 * @property {number} [width] Breite der Zeichnung in px (sonst RENDER_WIDTH)
 * @property {boolean} [single] ein Takt über die ganze Breite, ohne Taktnummer und Akkordnamen (Vergleich: dort
 *   stehen Nummer und Akkorde über bzw. unter der Zeichnung)
 */

const VENDOR_URL = new URL('../../vendor/alphatab/', import.meta.url).href;

/**
 * Breite, in der alphaTab zeichnet (px). Sie bestimmt, wie groß die Bundzahlen im Verhältnis zur Seite sind (die
 * Tab füllt immer die Breite): 13 px Schrift auf 800 px sind rund 1,6 % der Breite, etwas kleiner als der Text
 * des Blatts bei 12 pt, so passen meist vier Takte in eine Zeile.
 */
const RENDER_WIDTH = 800;

/** Breite einer Zeichnung im Vergleich (ein Takt, etwa die halbe Breite des Dialogs). */
const COMPARE_WIDTH = 360;

/** Farbe abweichender Bundzahlen im Vergleich (wie --danger in css/base.css). */
const MARK_COLOR = '#d32f2f';

/** Zusätzlicher Abstand unter jeder Zeile für die Zählzeiten (px in der Zeichnung). */
const COUNT_SPACE = 14;

/** Angaben über den Noten, die auf der Tab-Stelle nichts verloren haben (stehen im Kopf des Blatts). */
const HIDDEN_ELEMENTS = ['ScoreTitle', 'ScoreSubTitle', 'ScoreArtist', 'ScoreAlbum', 'ScoreWords', 'ScoreMusic',
    'ScoreWordsAndMusic', 'ScoreCopyright', 'GuitarTuning', 'ChordDiagrams', 'EffectCapo', 'TrackNames', 'EffectMarker',
    'EffectTempo', 'EffectLyrics', 'EffectDynamics'];

/** Schrift für Texte in der Tab (Akkordnamen, Taktnummern) wie im Player. */
const TEXT_FONT = '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** Höchste Wartezeit auf eine Zeichnung. */
const RENDER_TIMEOUT = 15000;

/**
 * Löst Bögen, die über den Rand des gezeichneten Bereichs hinausgehen: Haltebögen, Hammer-on/Pull-off und
 * Bindebögen, deren anderes Ende vor dem ersten oder hinter dem letzten Takt liegt. alphaTab 1.8.4 bricht sonst
 * beim Zeichnen ab ("Cannot read properties of null (reading 'staff')"), weil es das Ende außerhalb des Bereichs
 * nicht findet. Eine angebundene Note am Anfang steht dann als gewöhnliche Note da.
 * @param {Score} score Noten (eine Kopie nur fürs Zeichnen)
 * @param {number} track Index der Spur
 * @param {number} from erster gezeichneter Takt
 * @param {number} to letzter gezeichneter Takt
 * @returns {void}
 */
function cutEdgeArcs(score, track, from, to) {
    const barOf = note => note.beat.voice.bar.index;
    const outside = note => !!note && (barOf(note) < from || barOf(note) > to);
    for (const staff of score.tracks[track].staves) for (const index of new Set([from, to])) {
        for (const voice of staff.bars[index]?.voices ?? []) for (const beat of voice.beats) {
            if (outside(beat.effectSlurOrigin?.notes[0])) beat.effectSlurOrigin = null;
            if (outside(beat.effectSlurDestination?.notes[0])) {
                beat.effectSlurDestination = null;
                beat.isEffectSlurOrigin = false;
            }
            for (const note of beat.notes) {
                if (note.isTieDestination && (!note.tieOrigin || outside(note.tieOrigin))) {
                    if (note.tieOrigin) note.tieOrigin.tieDestination = null;
                    note.tieOrigin = null;
                    note.isTieDestination = false;
                }
                if (outside(note.tieDestination)) {
                    note.tieDestination.isTieDestination = false;
                    note.tieDestination.tieOrigin = null;
                    note.tieDestination = null;
                }
                if (outside(note.hammerPullOrigin)) {
                    note.hammerPullOrigin.isHammerPullOrigin = false;
                    note.hammerPullOrigin.hammerPullDestination = null;
                    note.hammerPullOrigin = null;
                }
                if (outside(note.hammerPullDestination)) {
                    note.hammerPullDestination.hammerPullOrigin = null;
                    note.hammerPullDestination = null;
                    note.isHammerPullOrigin = false;
                }
                if (outside(note.slurOrigin)) {
                    note.slurOrigin.slurDestination = null;
                    note.slurOrigin = null;
                    note.isSlurDestination = false;
                }
                if (outside(note.slurDestination)) {
                    note.slurDestination.isSlurDestination = false;
                    note.slurDestination.slurOrigin = null;
                    note.slurDestination = null;
                }
                if (outside(note.effectSlurOrigin)) note.effectSlurOrigin = null;
                if (outside(note.effectSlurDestination)) {
                    note.effectSlurDestination = null;
                    note.isEffectSlurOrigin = false;
                }
            }
        }
    }
}

/**
 * Zeichnet Tab-Stellen mit alphaTab und merkt sich die Ergebnisse.
 */
export class SheetTabs {
    /**
     * @param {AlphaTabModule} alphaTab alphaTab-Modul
     */
    constructor(alphaTab) {
        this.alphaTab = alphaTab;

        /** Noten, zu denen die gemerkten Zeichnungen gehören. */
        this.tex = '';

        /** @type {Map<string, string>} Schlüssel (key()) → SVG */
        this.cache = new Map();

        /** Zeichnungen laufen nacheinander (ein Behälter). */
        this.queue = Promise.resolve();
    }

    /**
     * Schlüssel einer Zeichnung.
     * @param {TabRange} tab Takte
     * @param {TabOptions} options Darstellung
     * @returns {string}
     */
    key(tab, options) {
        return JSON.stringify([tab.from, tab.to, tab.track, !!options.compact, !!options.counts,
            options.marks ? [...options.marks].sort((a, b) => a - b) : null, options.width ?? RENDER_WIDTH, !!options.single]);
    }

    /**
     * Gemerkte Zeichnung, wenn es sie zu diesen Noten gibt.
     * @param {string} tex Noten als alphaTex
     * @param {TabRange} tab Takte
     * @param {TabOptions} options Darstellung
     * @returns {?string} SVG
     */
    cached(tex, tab, options) {
        return tex === this.tex ? this.cache.get(this.key(tab, options)) ?? null : null;
    }

    /**
     * Zeichnet Takte einer Spur.
     * @param {string} tex Noten als alphaTex
     * @param {TabRange} tab Takte
     * @param {TabOptions} [options] Darstellung
     * @returns {Promise<string>} SVG (bzw. ein Hinweis, wenn die Spur fehlt oder alphaTab scheitert)
     */
    render(tex, tab, options = {}) {
        const known = this.cached(tex, tab, options);
        if (known) return Promise.resolve(known);
        const job = this.queue.then(async () => {
            if (tex !== this.tex) {
                this.tex = tex;
                this.cache.clear();
            }
            const again = this.cache.get(this.key(tab, options));
            if (again) return again;
            let svg;
            try {
                svg = await this.draw(tex, tab, options);
            } catch (err) {
                console.error(err);
                svg = `<p class="ls-soft">Die Tab konnte nicht gezeichnet werden (${escapeHtml(err.message)}).</p>`;
            }
            // Nur merken, wenn die Noten inzwischen nicht gewechselt haben.
            if (tex === this.tex) this.cache.set(this.key(tab, options), svg);
            return svg;
        });
        this.queue = job.catch(() => {
        });
        return job;
    }

    /**
     * Noten für die Zeichnung: frisch eingelesen (alphaTab ändert das Modell beim Zeichnen nicht, aber die Kopie für
     * das Zusammenfassen wird umgebaut). Zusammengefasst: wiederholte Takte gelöscht, Wiederholungszeichen gesetzt.
     * @param {string} tex Noten als alphaTex
     * Rot markiert (marks): Die Noten der Schläge im ersten Takt bekommen eine eigene Farbe für die Bundzahl.
     * @param {TabRange} tab Takte
     * @param {TabOptions} options Darstellung
     * @returns {?{score: Score, track: number, from: number, count: number, renumbered: boolean}} null ohne Spur mit
     *   Saiten; renumbered: Die Taktnummern stimmen nicht mehr
     */
    prepare(tex, tab, options) {
        const alphaTab = this.alphaTab;
        const compact = !!options.compact;
        let score = parseScore(alphaTab, tex);
        const track = typeof tab.track === 'number' ? score.tracks[tab.track] ?? null : tabTrack(score, tab.track);
        if (!track) return null;
        if (options.marks?.size) {
            const {Color, NoteStyle, NoteSubElement} = alphaTab.model;
            for (const voice of track.staves[0].bars[tab.from]?.voices ?? []) for (const beat of voice.beats) {
                if (!options.marks.has(beat.playbackStart)) continue;
                for (const note of beat.notes) {
                    note.style = new NoteStyle();
                    note.style.colors.set(NoteSubElement.GuitarTabFretNumber, Color.fromJson(MARK_COLOR));
                }
            }
        }
        // Die Spur als Tab, auch wenn sie in den Noten anders gezeigt wird (eine Begleitspur nur mit Schlagnotation
        // hat für alphaTab sonst keine Zeile, es bricht dann ab). Vor dem Schreiben, damit es die Kopie fürs
        // Zusammenfassen übernimmt.
        const asTab = t => t.staves.forEach(staff => {
            staff.showTablature = true;
            staff.showStandardNotation = false;
            staff.showSlash = false;
            staff.showNumbered = false;
        });
        asTab(track);
        const to = Math.min(tab.to, score.masterBars.length - 1);
        const units = compact ? tabUnits(track.staves[0], tab.from, to) : [];
        if (!units.some(u => u.times > 1)) {
            cutEdgeArcs(score, track.index, tab.from, to);
            return {score, track: track.index, from: tab.from, count: to - tab.from + 1, renumbered: false};
        }
        // Von hinten, damit die Indizes davor gültig bleiben. Die Lage der Blöcke in der Kopie: Jeder Block steht
        // einmal da, die folgenden rücken auf.
        const size = u => u.to - u.from + 1;
        let at = tab.from + units.reduce((sum, u) => sum + size(u) * u.times, 0);
        const marks = [];
        for (const u of [...units].reverse()) {
            at -= size(u) * u.times;
            for (let i = at + size(u) * u.times - 1; i >= at + size(u); i--) deleteBar(score, i);
            if (u.times > 1) marks.push({start: at, end: at + size(u) - 1, times: u.times});
        }
        for (const m of marks) {
            score.masterBars[m.start].isRepeatStart = true;
            score.masterBars[m.end].repeatCount = m.times;
        }
        // Über alphaTex, damit das Modell wieder in sich stimmt (Verkettung der Takte, Zeiten).
        score = parseScore(alphaTab, writeScore(alphaTab, score));
        asTab(score.tracks[track.index]);
        const count = units.reduce((sum, u) => sum + size(u), 0);
        cutEdgeArcs(score, track.index, tab.from, tab.from + count - 1);
        return {score, track: track.index, from: tab.from, count, renumbered: true};
    }

    /**
     * Zeichnet mit alphaTab und setzt die Stücke zu einer SVG zusammen.
     * @param {string} tex Noten als alphaTex
     * @param {TabRange} tab Takte
     * @param {TabOptions} options Darstellung
     * @returns {Promise<string>} SVG
     */
    async draw(tex, tab, options) {
        const alphaTab = this.alphaTab;
        const width = options.width ?? RENDER_WIDTH;
        const plan = this.prepare(tex, tab, options);
        if (!plan) return '<p class="ls-soft">Keine Spur mit Saiten.</p>';
        // Unsichtbar, aber mit Breite: alphaTab zeichnet nur in ein Element, das Platz einnimmt.
        const host = document.createElement('div');
        host.style.cssText = `position:absolute; left:-20000px; top:0; width:${width}px; visibility:hidden;`;
        document.body.append(host);
        const api = new alphaTab.AlphaTabApi(host, {
            core: {fontDirectory: VENDOR_URL + 'font/', enableLazyLoading: false, useWorkers: false},
            display: {
                staveProfile: 'Tab',
                startBar: plan.from + 1,
                barCount: plan.count,
                layoutMode: 'Page',
                padding: [2, 0],
                resources: {barNumberColor: plan.renumbered || options.single ? '#00000000' : '#666666'},
                // Ein einzelner Takt füllt die Breite (sonst stünde er schmal links).
                justifyLastSystem: !!options.single,
                ...options.counts ? {systemPaddingBottom: 10 + COUNT_SPACE} : {},
            },
            notation: {rhythmMode: 'ShowWithBars'},
        });
        try {
            for (const element of HIDDEN_ELEMENTS) {
                const id = alphaTab.NotationElement[element];
                if (id !== undefined) api.settings.notation.elements.set(id, false);
            }
            if (options.single) api.settings.notation.elements.set(alphaTab.NotationElement.EffectChordNames, false);
            // Texte in der Schrift der Seite statt Georgia/Arial (wie im Player), Akkordnamen gerade und fett.
            const {Font, FontStyle, FontWeight} = alphaTab.model;
            const fonts = api.settings.display.resources.elementFonts;
            for (const [element, font] of fonts) fonts.set(element, new Font(TEXT_FONT, font.size, font.style, font.weight));
            fonts.set(alphaTab.NotationElement.EffectChordNames, new Font(TEXT_FONT, 13, FontStyle.Plain, FontWeight.Bold));
            await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('Zeitüberschreitung')), RENDER_TIMEOUT);
                api.renderFinished.on(() => {
                    clearTimeout(timer);
                    resolve();
                });
                api.error.on(err => {
                    clearTimeout(timer);
                    reject(err);
                });
                api.renderScore(plan.score, [plan.track]);
            });
            return this.compose(host, options.counts ? this.counts(api) : '', width);
        } finally {
            api.destroy();
            host.remove();
        }
    }

    /**
     * Setzt die Stücke von alphaTab zu einer SVG zusammen, jedes an seinem Platz und unverändert.
     * @param {HTMLElement} host Behälter, in den alphaTab gezeichnet hat
     * @param {string} extra weitere SVG-Elemente (Zählzeiten)
     * @param {number} width Breite der Zeichnung
     * @returns {string} SVG
     */
    compose(host, extra, width) {
        const box = host.getBoundingClientRect();
        let height = 0;
        let inner = '';
        for (const svg of host.querySelectorAll('svg')) {
            const r = svg.getBoundingClientRect();
            if (!r.width || !r.height) continue;
            // Hinweis auf alphaTab in der Fußzeile anzeigen.
            if (svg.textContent.trim() === ATTRIBUTION_TEXT) continue;
            const piece = /** @type {SVGSVGElement} */ (svg.cloneNode(true));
            piece.setAttribute('x', String(r.left - box.left));
            piece.setAttribute('y', String(r.top - box.top));
            piece.setAttribute('width', String(r.width));
            piece.setAttribute('height', String(r.height));
            piece.removeAttribute('style');
            inner += piece.outerHTML;
            height = Math.max(height, r.bottom - box.top);
        }
        if (!inner) throw new Error('alphaTab hat nichts gezeichnet');
        // Die Notenzeichen (Klasse "at") bekommen ihre Schrift bei alphaTab über ein Stylesheet, das nur in dessen
        // Behälter gilt und mit ihm verschwindet. Hier dieselbe Schrift (Bravura, in css/base.css als GbBravura) in der
        // Größe, die alphaTab gesetzt hat.
        const glyph = host.querySelector('svg .at');
        const size = glyph ? getComputedStyle(glyph).fontSize : '34px';
        // Platz für die Zählzeiten unter der letzten Zeile.
        if (extra) height += COUNT_SPACE;
        return `<svg class="ls-at-svg" viewBox="0 0 ${width} ${Math.ceil(height)}" role="img" style="--at-glyph:${size}" xmlns="http://www.w3.org/2000/svg">${inner}${extra}</svg>`;
    }

    /**
     * Zählzeiten unter jeder Zeile: je Takt die Zeichen aus countGrid(), an der Stelle ihres Schlags; zwischen zwei
     * gezeichneten Schlägen gleichmäßig nach der Zeit verteilt.
     * @param {import('../../../types/alphatab').AlphaTabApi} api alphaTab nach dem Zeichnen
     * @returns {string} SVG-Elemente
     */
    counts(api) {
        const lookup = api.boundsLookup ?? api.renderer.boundsLookup;
        const score = api.score;
        let svg = '';
        for (const system of lookup?.staffSystems ?? []) {
            const y = system.visualBounds.y + system.visualBounds.h + 9;
            for (const masterBar of system.bars) {
                const bar = masterBar.bars[0];
                if (!bar) continue;
                const mb = score?.masterBars[masterBar.index];
                if (!mb) continue;
                const length = mb.calculateDuration();
                // Stützpunkte: Zeit im Takt → x, am Ende der rechte Rand des Takts.
                const points = bar.beats.filter(b => !b.beat.graceType)
                    .map(b => ({t: b.beat.playbackStart, x: b.onNotesX}))
                    .sort((a, b) => a.t - b.t);
                if (!points.length) continue;
                points.push({t: length, x: masterBar.visualBounds.x + masterBar.visualBounds.w});
                const xAt = t => {
                    const k = Math.max(1, points.findIndex(p => p.t > t));
                    const a = points[k - 1];
                    const b = points[k] ?? a;
                    return b.t === a.t ? a.x : a.x + (b.x - a.x) * (t - a.t) / (b.t - a.t);
                };
                // Ein Auftakt ist das Ende eines vollen Takts: gezählt wird ab seiner Stelle darin (z. B. "2 +").
                const full = mb.calculateDuration(false);
                const offset = full - length;
                const grid = countGrid(mb, points.slice(0, -1).map(p => p.t + offset));
                const labels = countLabels(`${mb.timeSignatureNumerator}/${mb.timeSignatureDenominator}`, grid);
                labels.forEach((label, i) => {
                    const t = i * full / labels.length - offset;
                    if (label && t >= 0) svg += `<text x="${xAt(t).toFixed(1)}" y="${y.toFixed(1)}" class="ls-at-count${
                        /\d/.test(label) ? ' ls-at-count-beat' : ''}">${label}</text>`;
                });
            }
        }
        return svg;
    }
}

/**
 * Zeichnet Noten mit alphaTab als SVG: Notensystem mit Schlüssel und Vorzeichen, darunter die Tab. Für kleine
 * Vorschauen im Editor (Dialog "Transponieren"); gezeichnet wird die erste Spur in einer Zeile (ohne Umbruch).
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Score} score Noten
 * @param {number} width Breite des Behälters in px (die Zeichnung ist so breit wie die Noten)
 * @returns {Promise<string>} SVG (bzw. ein Hinweis, wenn alphaTab scheitert)
 */
export async function renderMiniScore(alphaTab, score, width) {
    // Unsichtbar, aber mit Breite: alphaTab zeichnet nur in ein Element, das Platz einnimmt.
    const host = document.createElement('div');
    host.style.cssText = `position:absolute; left:-20000px; top:0; width:${width}px; visibility:hidden;`;
    document.body.append(host);
    const api = new alphaTab.AlphaTabApi(host, {
        core: {fontDirectory: VENDOR_URL + 'font/', enableLazyLoading: false, useWorkers: false},
        display: {
            staveProfile: 'ScoreTab', layoutMode: 'Horizontal', scale: 0.5, padding: [2, 0],
            resources: {barNumberColor: '#00000000'}
        },
        notation: {rhythmMode: 'ShowWithBars'},
    });
    try {
        for (const element of HIDDEN_ELEMENTS) {
            const id = alphaTab.NotationElement[element];
            if (id !== undefined) api.settings.notation.elements.set(id, false);
        }
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Zeitüberschreitung')), RENDER_TIMEOUT);
            api.renderFinished.on(() => {
                clearTimeout(timer);
                resolve();
            });
            api.error.on(err => {
                clearTimeout(timer);
                reject(err);
            });
            api.renderScore(score, [0]);
        });
        // Alles in einer Zeile: Die Breite ist die des Inhalts (nicht der Behälter).
        const left = host.getBoundingClientRect().left;
        const used = Math.ceil(Math.max(0, ...[...host.querySelectorAll('svg')].map(svg => svg.getBoundingClientRect().right - left)));
        // Mit fester Größe (Breite und Höhe der Zeichnung): Sie wächst nicht, wenn der Platz größer ist als die Noten.
        return new SheetTabs(alphaTab).compose(host, '', Math.max(used, 1))
            .replace(/<svg class="ls-at-svg" viewBox="0 0 (\d+) (\d+)"/, (all, w, h) => `${all} width="${w}" height="${h}" style="width:${w}px; height:${h}px"`);
    } catch (err) {
        console.error(err);
        return `<p class="ls-soft">Die Vorschau konnte nicht gezeichnet werden (${escapeHtml(err.message)}).</p>`;
    } finally {
        api.destroy();
        host.remove();
    }
}

/**
 * Füllt die Platzhalter der Tab-Stellen in einem gesetzten Blatt (.ls-at[data-tab][data-from][data-to], siehe
 * renderInstructions() in js/ui/sheetview.js): gemerkte Zeichnungen sofort, die übrigen, sobald alphaTab sie gezeichnet
 * hat.
 * @param {HTMLElement} view Behälter mit den Seiten
 * @param {SheetTabs} tabs Zeichner
 * @param {string} tex Noten als alphaTex
 * @param {Sheet} sheet Angaben für das Leadsheet
 * @returns {Promise<void>} fertig, wenn alle Tab-Stellen stehen
 */
export async function fillSheetTabs(view, tabs, tex, sheet) {
    const options = {compact: sheet.layout.compactTabs, counts: sheet.layout.tabCounts};
    const open = [];
    for (const slot of /** @type {NodeListOf<HTMLElement>} */ (view.querySelectorAll('.ls-at[data-tab]'))) {
        const whole = sheet.tabs[Number(slot.dataset.tab)];
        if (!whole) continue;
        // Das Stück der Tab-Stelle, das hier steht (ersetzte Takte teilen sie, tabPieces() in js/lib/sheetmodel.js).
        const tab = /** @type {TabRange} */ ({...whole, from: Number(slot.dataset.from), to: Number(slot.dataset.to)});
        const known = tabs.cached(tex, tab, options);
        if (known) slot.innerHTML = known;
        else open.push(tabs.render(tex, tab, options).then(svg => {
            slot.innerHTML = svg;
        }));
    }
    useCreditLogos(view);
    await Promise.all(open);
}

/**
 * Füllt im Dialog "Abschnitte vergleichen" die Platzhalter der Takte (.cmp-tab[data-cmp-bar], barCellHtml() in
 * ui/sheetview.js): je Takt eine Zeichnung von alphaTab, abweichende Bundzahlen rot. Gemerkte sofort, die übrigen
 * nacheinander, sobald alphaTab sie gezeichnet hat. Ein Platzhalter, der inzwischen nicht mehr im Dialog steht
 * (neu gezeichnet), bleibt unbeachtet.
 * @param {HTMLElement} box Dialog
 * @param {SheetTabs} tabs Zeichner
 * @param {string} tex Noten als alphaTex
 * @returns {Promise<void>} fertig, wenn alle Takte stehen
 */
export async function fillCompareTabs(box, tabs, tex) {
    const open = [];
    for (const slot of /** @type {NodeListOf<HTMLElement>} */ (box.querySelectorAll('.cmp-tab[data-cmp-bar]'))) {
        const bar = Number(slot.dataset.cmpBar);
        const tab = {from: bar, to: bar, track: Number(slot.dataset.cmpTrack)};
        const marks = slot.dataset.cmpMarks ? new Set(slot.dataset.cmpMarks.split(',').map(Number)) : null;
        // Schmal gezeichnet, damit die Bundzahlen in der halben Breite des Dialogs lesbar bleiben.
        const options = {marks, width: COMPARE_WIDTH, single: true};
        const known = tabs.cached(tex, tab, options);
        if (known) slot.innerHTML = known;
        else open.push(tabs.render(tex, tab, options).then(svg => {
            if (slot.isConnected) slot.innerHTML = svg;
        }));
    }
    useCreditLogos(box);
    await Promise.all(open);
}
