/**
 * Dialog "Rhythmus ableiten" des Bearbeitungsmodus (Knopf im Dialog "Spuren"): legt aus einer Spur (z. B. Fingerstyle)
 * eine Begleitspur "Rhythmus" mit Strumming an, ohne Pattern-Katalog und ohne Namen für die Patterns.
 *
 * - Der Dialog zeigt alle Rhythmen, die in der Quellspur vorkommen (je Takt aus den Anschlägen abgeleitet, deriveBar()
 *   in sheet.js; die Anschlagrichtung berechnet, nicht aus den Noten, strumDirections()), gleiche zusammengefasst und
 *   nach Häufigkeit sortiert. Dazu steht, wo sie vorkommen ("ganzer Song",
 *   "Verse, Chorus", "Takte mit C, Akkordwechsel auf 3", "letzter Takt im Chorus", sonst die Abschnitte mit Anteil,
 *   beim häufigsten "Grundrhythmus" (Rhythmushinweis, rhythmHint() in rhythmhint.js).
 * - Die Rhythmen sind durchnummeriert. "Ähnliche zusammenfassen" übernimmt für jeden Rhythmus den häufigeren, dem er
 *   ähnlich ist (SIMILAR); der Kreispfeil stellt nach einer Änderung die abgeleiteten wieder her.
 * - Der Schalter "Rhythmen anhand der Abschnitte unterscheiden" teilt jeden Rhythmus nach Abschnittsgruppen ("Verse 1"
 *   und "Verse 2" sind "Verse", sectionGroup() in sheet.js) und zeigt die Liste je Gruppe mit Überschrift, in der
 *   Reihenfolge des Songs. Hinweis, Zusammenfassen und Übernehmen gelten dann nur innerhalb der Gruppe; ausgeschaltet
 *   fließen gleiche wieder zusammen.
 * - Der Schalter "Rhythmen anhand der Akkorde unterscheiden" teilt jeden Rhythmus nach den Akkorden im Takt (Namen und
 *   Stellen, barChords()); die Akkorde stehen über dem Raster, eine Zeile je Akkordfolge. Die Teile behalten den
 *   Rhythmus und lassen sich einzeln ändern; zusammengefasst wird dann nur bei gleichen Akkorden, außer mit
 *   "übernehmen".
 * - Jeder Rhythmus lässt sich ändern (Feld oder Klick ins Raster: nichts → ab → auf → gedämpft; Klick auf die Zählzeit
 *   betont). Ist ein anderer Rhythmus ähnlich (SIMILAR) und fällt mit ihm kein Anschlag eines Akkordwechsels weg,
 *   bietet ein Knopf an, ihn zu übernehmen.
 * - Wechselt in einem Takt ein Akkord an einer Stelle, an der die Quellspur anschlägt, sein Rhythmus aber nicht, steht
 *   dort eine rote Warnung, und "Übernehmen" ist gesperrt: Akkorde werden nie verschoben. Schlägt auch die Quellspur
 *   dort nicht an (Haltebogen, Pause), ist das kein Fehler.
 * - Der Schalter "Akkorde aus den Tönen der Spur bestimmen" leitet die Akkorde
 *   aus der Quellspur ab (songChordsFrom() im Editor, chorddetect.js); ist er an, erscheint "Akkorde mit Hilfe der
 *   Audiospur korrigieren". Die Rhythmen richten sich dann nach den abgeleiteten Akkorden; beim Übernehmen ersetzen
 *   sie zuerst alle bisherigen (placeSongChords()), dann folgt der Rhythmus.
 * - Übernehmen legt die Spur "Rhythmus" als erste Spur an (die Akkorde stehen oben; Akustikgitarre, Capo und Tuning der
 *   Quellspur) oder überschreibt die Quellspur, schreibt je Takt seinen Rhythmus mit dem Griff des Akkords, der dann
 *   klingt (fillBar() in sheet.js), übernimmt Ein- und Ausblenden der Quellspur (an den Anschlag, der dort klingt) und
 *   zieht die Akkorde in diese Spur (sie wird die Akkordspur). Ein Schritt für "Rückgängig".
 */

import {escapeHtml, loadChordLibraryOrEmpty, svgIcon} from './base.js';
import {closeOverlay, isOverlayOpen, openOverlay, openStackedOverlay, showBusy} from './library.js';
import {
    deleteTrack,
    duplicateTrack,
    freeTrackName,
    instrumentByKey,
    instrumentOf,
    lyricsTrack,
    makeRest,
    moveContent,
    parseScore,
    playbackSyncPoints,
    setInstrument,
    timeline,
    trackName,
    WHOLE_TICKS,
} from './notation.js';
import {
    chordTimeline,
    deriveBar,
    editPattern,
    fillBar,
    gripFor,
    patternGridHtml,
    similarity,
    slotCount,
} from './sheet.js';
import {countAt, rhythmHint, sectionParts} from './rhythmhint.js';

/** @typedef {import('../../types/alphatab').model.Score} Score */
/** @typedef {import('./sheet.js').Pattern} Pattern */

/** Ab dieser Ähnlichkeit (Anteil gleicher Rasterplätze, similarity()) bietet der Dialog an, einen Rhythmus zu übernehmen. */
const SIMILAR = 0.75;

/** So viele Knöpfe "Rhythmus aus … übernehmen" stehen höchstens an einem Rhythmus. */
const TAKE_MAX = 2;

/**
 * Ein Rhythmus und die Takte, in denen er gilt.
 * @typedef {Object} RhythmRow
 * @property {Set<number>} bars Takte (Index)
 * @property {Pattern} pattern Strumming Pattern (strokes: ein Zeichen je Rasterplatz)
 * @property {boolean} derived false: In der Quellspur hat keiner dieser Takte Anschläge
 * @property {boolean} simplified In einigen Takten lagen Anschläge neben dem Sechzehntelraster (32tel, Triolen); sie
 *   sind weggelassen (simplifiedBar())
 * @property {string[]} [chords] Akkordfolgen seiner Takte, wenn nach Akkorden geteilt (barChords()), z. B.
 *   ["C, G/B auf 3"]
 * @property {RowSection} [section] Abschnittsgruppe, wenn nach Abschnitten geteilt (splitBySections())
 */

/**
 * Abschnittsgruppe für "Rhythmen anhand der Abschnitte unterscheiden" (sectionGroups()); ein Objekt je Gruppe, alle
 * Rhythmen darin teilen es.
 * @typedef {Object} RowSection
 * @property {string} label Name ohne Nummer, z. B. "Verse"
 * @property {number} first erster Takt (Reihenfolge der Gruppen)
 * @property {Set<number>} bars alle Takte der Gruppe
 * @property {number} count Durchgänge (Abschnitte der Gruppe)
 */

/**
 * Akkordwechsel ohne Anschlag.
 * @typedef {{bar: number, count: string, name: string}} RhythmWarning
 */

/**
 * Schlüssel eines Rhythmus: gleich heißt gleiche Taktart, gleiches Raster und gleiche Zeichen.
 * @param {Pattern} pattern Pattern
 * @returns {string}
 */
function rhythmKey(pattern) {
    return `${pattern.timeSignature}|${pattern.grid}|${pattern.strokes}`;
}

/** Ticks einer Sechzehntel, das feinste Raster der Rhythmen. */
const SIXTEENTH_TICKS = WHOLE_TICKS / 16;

/**
 * Rhythmus eines Takts, wenn deriveBar() keinen findet, weil Anschläge neben dem Sechzehntelraster liegen (32tel,
 * Triolen, Verzierungen): Nur die Anschläge auf Sechzehnteln zählen, die anderen fallen ungefragt weg. Nur gedämpfte
 * Töne ergeben x, sonst d (die Richtung rechnet strumDirections()).
 * @param {import('../../types/alphatab').model.Bar} bar Takt
 * @param {string} timeSignature Taktart
 * @returns {?{grid: number, tokens: string[]}} null ohne Anschlag auf dem Raster
 */
function simplifiedBar(bar, timeSignature) {
    const voice = bar.voices[0];
    if (!voice) return null;
    const hits = timeline(voice).filter(e => e.end > e.start && e.beat.notes.length && !e.beat.isRest
        && !e.beat.notes.every(n => n.isTieDestination) && e.start % SIXTEENTH_TICKS === 0);
    const grid = [8, 16].find(g => slotCount(timeSignature, g) && hits.every(e => e.start % (WHOLE_TICKS / g) === 0));
    if (!hits.length || !grid) return null;
    const tokens = Array(slotCount(timeSignature, grid)).fill('.');
    for (const {beat, start} of hits) {
        const slot = start / (WHOLE_TICKS / grid);
        if (slot >= tokens.length) continue;
        const sign = beat.notes.every(n => n.isDead) ? 'x' : 'd';
        tokens[slot] = beat.notes.some(n => n.accentuated) ? sign.toUpperCase() : sign;
    }
    return {grid, tokens};
}

/**
 * Ob eine Taktart Dreiergruppen hat (6/8, 9/8, 12/8, 6/4 …: Schläge zu je drei Zählzeiten).
 * @param {number} num Zähler
 * @returns {boolean}
 */
export function groupsOfThree(num) {
    return num > 3 && num % 3 === 0;
}

/**
 * Anschlagrichtungen eines Rhythmus, unabhängig davon, wie sie in den Noten stehen (auch beim Shuffle):
 * - Taktarten mit Dreiergruppen (6/8, 12/8 …): je Gruppe ab, ab, auf; liegen Anschläge dazwischen (Sechzehntel),
 *   pendelt die Hand in Achteln: ab auf jeder Zählzeit, auf dazwischen.
 * - Sonst pendelt die Hand: ab auf den Zählzeiten (Nenner der Taktart), auf auf "+". Liegt ein Anschlag auf "e" oder
 *   "a", pendelt sie doppelt so schnell: ab auf Zählzeit und "+", auf auf "e" und "a".
 * Gedämpft (x) und Betonung (groß) bleiben.
 * @param {string[]} tokens Zeichen je Rasterplatz (d, u, x, ., groß = betont)
 * @param {number} grid Raster (8 oder 16)
 * @param {string} timeSignature Taktart, z. B. "4/4"
 * @returns {string} Zeichen mit berechneter Richtung
 */
export function strumDirections(tokens, grid, timeSignature) {
    const [num, den] = timeSignature.split('/').map(Number);
    const hit = t => t !== '.';
    const slot = WHOLE_TICKS / grid;
    const count = WHOLE_TICKS / den;
    // Feiner als das Pendel: bei Dreiergruppen neben den Zählzeiten, sonst neben Zählzeit und "+".
    const coarse = groupsOfThree(num) ? count : count / 2;
    const fine = tokens.some((t, i) => hit(t) && (i * slot) % coarse !== 0);
    const down = i => {
        const at = i * slot;
        if (groupsOfThree(num)) return at % count === 0 && (fine || (at / count) % 3 !== 2);
        const pulse = fine ? count / 2 : count;
        return at % pulse === 0;
    };
    return tokens.map((t, i) => {
        if (!hit(t) || t.toLowerCase() === 'x') return t;
        const sign = down(i) ? 'd' : 'u';
        return t === t.toUpperCase() ? sign.toUpperCase() : sign;
    }).join('');
}

/**
 * Leitet je Takt der Quellspur den Rhythmus ab und fasst gleiche zusammen, häufigste zuerst. Die Anschlagrichtung
 * kommt nicht aus den Noten, sondern aus der Lage (strumDirections()). Anschläge neben dem
 * Sechzehntelraster fallen weg (simplifiedBar(), der Rhythmus heißt dann "vereinfacht"); Takte ohne Anschlag bilden je
 * Taktart einen eigenen Rhythmus ohne Anschläge.
 * @param {Score} score Noten (frisch eingelesen)
 * @param {number} index Quellspur
 * @returns {RhythmRow[]}
 */
export function analyzeRhythm(score, index) {
    const staff = score.tracks[index].staves[0];
    /** @type {Map<string, RhythmRow>} */
    const rows = new Map();
    for (const mb of score.masterBars) {
        const timeSignature = `${mb.timeSignatureNumerator}/${mb.timeSignatureDenominator}`;
        const exact = deriveBar(staff.bars[mb.index], 'strumming');
        const found = exact ?? simplifiedBar(staff.bars[mb.index], timeSignature);
        const simplified = !exact && !!found;
        const grid = found?.grid ?? [8, 16].find(g => slotCount(timeSignature, g));
        if (!grid) continue;
        /** @type {Pattern} */
        const pattern = {
            id: '', name: '', technique: 'strumming', timeSignature, grid,
            strokes: found ? strumDirections(found.tokens, grid, timeSignature)
                : '.'.repeat(slotCount(timeSignature, grid))
        };
        const key = `${rhythmKey(pattern)}|${!!found}|${simplified}`;
        const row = rows.get(key) ?? {bars: new Set(), pattern, derived: !!found, simplified};
        row.bars.add(mb.index);
        rows.set(key, row);
    }
    return sortRows([...rows.values()]);
}

/**
 * Nach Abschnittsgruppen in der Reihenfolge des Songs (wenn geteilt), darin häufigste Rhythmen zuerst, bei gleicher
 * Zahl der frühere.
 * @param {RhythmRow[]} rows Rhythmen
 * @returns {RhythmRow[]}
 */
function sortRows(rows) {
    return rows.sort((a, b) => (a.section?.first ?? 0) - (b.section?.first ?? 0) || b.bars.size - a.bars.size
        || Math.min(...a.bars) - Math.min(...b.bars));
}

/**
 * Abschnittsgruppen des Songs (sectionParts() in rhythmhint.js), je Takt.
 * @param {Score} score Noten
 * @returns {Map<number, RowSection>} Gruppe je Takt
 */
export function sectionGroups(score) {
    /** @type {Map<string, RowSection>} */
    const byGroup = new Map();
    /** @type {Map<number, RowSection>} */
    const ofBar = new Map();
    for (const part of sectionParts(score)) {
        const group = byGroup.get(part.group) ?? {label: part.label, first: part.from, bars: new Set(), count: 0};
        group.count++;
        for (let i = part.from; i <= part.to; i++) {
            group.bars.add(i);
            ofBar.set(i, group);
        }
        byGroup.set(part.group, group);
    }
    return ofBar;
}

/**
 * Teilt jeden Rhythmus nach den Abschnittsgruppen seiner Takte ("Rhythmen anhand der Abschnitte unterscheiden"); die
 * Teile behalten den Rhythmus.
 * @param {RhythmRow[]} rows Rhythmen
 * @param {Map<number, RowSection>} groupOf Gruppe je Takt (sectionGroups())
 * @returns {RhythmRow[]}
 */
export function splitBySections(rows, groupOf) {
    /** @type {RhythmRow[]} */
    const split = [];
    for (const row of rows) {
        /** @type {Map<RowSection, RhythmRow>} */
        const parts = new Map();
        for (const bar of row.bars) {
            const section = groupOf.get(bar);
            const part = parts.get(section) ?? {...row, bars: new Set(), pattern: {...row.pattern}, section};
            part.bars.add(bar);
            parts.set(section, part);
        }
        split.push(...parts.values());
    }
    return sortRows(split);
}

/**
 * Akkordfolgen eines Rhythmus als Vergleichswert (leer, wenn nicht nach Akkorden geteilt).
 * @param {RhythmRow} row Rhythmus
 * @returns {string}
 */
function chordsKey(row) {
    return row.chords?.join(' / ') ?? '';
}

/**
 * Legt einen Rhythmus mit seinen Takten in einen anderen ("Rhythmus N übernehmen"); dessen Pattern gilt.
 * @param {RhythmRow[]} rows Rhythmen
 * @param {RhythmRow} row Rhythmus, der aufgeht
 * @param {RhythmRow} into Rhythmus, der ihn aufnimmt
 * @returns {RhythmRow[]}
 */
function joinRow(rows, row, into) {
    for (const bar of row.bars) into.bars.add(bar);
    into.derived ||= row.derived;
    into.simplified ||= row.simplified;
    if (row.chords || into.chords) into.chords = [...new Set([...into.chords ?? [], ...row.chords ?? []])].sort();
    return sortRows(rows.filter(r => r !== row));
}

/**
 * Fasst Rhythmen mit gleichem Pattern, gleichen Akkordfolgen und gleicher Abschnittsgruppe zusammen (beim Ausschalten
 * von "Rhythmen anhand der Akkorde unterscheiden" bzw. "Rhythmen anhand der Abschnitte unterscheiden").
 * @param {RhythmRow[]} rows Rhythmen
 * @returns {RhythmRow[]}
 */
function mergeRows(rows) {
    /** @type {Map<string, RhythmRow>} */
    const merged = new Map();
    /** @type {Map<RowSection, number>} */
    const sectionIds = new Map();
    for (const row of rows) {
        if (row.section && !sectionIds.has(row.section)) sectionIds.set(row.section, sectionIds.size);
        const key = `${rhythmKey(row.pattern)}|${chordsKey(row)}|${sectionIds.get(row.section) ?? ''}`;
        const known = merged.get(key);
        if (known) {
            for (const bar of row.bars) known.bars.add(bar);
            known.derived ||= row.derived;
            known.simplified ||= row.simplified;
        } else {
            merged.set(key, {
                bars: new Set(row.bars), pattern: {...row.pattern}, derived: row.derived,
                simplified: row.simplified, chords: row.chords, section: row.section
            });
        }
    }
    return sortRows([...merged.values()]);
}

/**
 * Fasst ähnliche Rhythmen zusammen: Jeder übernimmt den ersten häufigeren mit gleicher Taktart, dem er mindestens
 * SIMILAR ähnlich ist (similarity()), dessen Rhythmus in seinen Takten keinen Akkordwechsel ohne Anschlag ergibt (fits)
 * und der dieselben Akkorde (nach "Rhythmen anhand der Akkorde unterscheiden") und dieselbe Abschnittsgruppe hat (nach
 * "Rhythmen anhand der Abschnitte unterscheiden"); sonst bleibt er für sich.
 * @param {RhythmRow[]} rows Rhythmen, häufigste zuerst
 * @param {function(Pattern, Set<number>): boolean} [fits] ob ein Rhythmus in diesen Takten passt
 * @returns {RhythmRow[]}
 */
export function mergeSimilar(rows, fits = () => true) {
    /** @type {RhythmRow[]} */
    const kept = [];
    for (const row of rows) {
        const target = kept.find(k => chordsKey(k) === chordsKey(row) && k.section === row.section
            && similarity(k.pattern, row.pattern) >= SIMILAR && fits(k.pattern, row.bars));
        if (target) {
            for (const bar of row.bars) target.bars.add(bar);
            target.simplified ||= row.simplified;
        } else {
            kept.push({
                bars: new Set(row.bars), pattern: {...row.pattern}, derived: row.derived, simplified: row.simplified,
                chords: row.chords, section: row.section
            });
        }
    }
    return sortRows(kept);
}

/**
 * Akkorde in einem Takt: der beim Taktanfang klingende und die Wechsel im Takt.
 * @param {Score} score Noten
 * @param {{tick: number, name: string}[]} events Akkordwechsel (chordTimeline())
 * @param {number} index Takt
 * @returns {{key: string, marks: {offset: number, name: string}[]}} key z. B. "C, G/B auf 3" ("ohne Akkord", wenn
 *   keiner klingt); marks mit Stelle in Ticks ab Taktanfang
 */
function barChords(score, events, index) {
    const mb = score.masterBars[index];
    const end = mb.start + mb.calculateDuration();
    const first = events.findLast(e => e.tick <= mb.start)?.name;
    const changes = events.filter(e => e.tick > mb.start && e.tick < end);
    return {
        key: [first ?? 'ohne Akkord', ...changes.map(e =>
            `${e.name} auf ${countAt(e.tick - mb.start, mb.timeSignatureDenominator)}`)].join(', '),
        marks: [...(first ? [{offset: 0, name: first}] : []),
            ...changes.map(e => ({offset: e.tick - mb.start, name: e.name}))],
    };
}

/**
 * Akkorde über dem Raster eines Rhythmus: eine Zeile je Akkordfolge seiner Takte, jeder Akkord am Rasterplatz, an dem
 * er beginnt.
 * @param {Score} score Noten
 * @param {{tick: number, name: string}[]} events Akkordwechsel (chordTimeline())
 * @param {RhythmRow} row Rhythmus
 * @returns {{slot: number, name: string}[][]} ohne Takte ohne Akkord
 */
export function rowChordLines(score, events, row) {
    const slotTicks = WHOLE_TICKS / row.pattern.grid;
    /** @type {Map<string, {slot: number, name: string}[]>} */
    const lines = new Map();
    for (const bar of [...row.bars].sort((a, b) => a - b)) {
        const {key, marks} = barChords(score, events, bar);
        if (!lines.has(key)) lines.set(key, marks.map(m => ({slot: Math.floor(m.offset / slotTicks), name: m.name})));
    }
    return [...lines.values()].filter(line => line.length);
}

/**
 * Teilt jeden Rhythmus nach den Akkorden in seinen Takten (barChords()); die Teile behalten den Rhythmus.
 * @param {RhythmRow[]} rows Rhythmen
 * @param {Score} score Noten
 * @param {{tick: number, name: string}[]} events Akkordwechsel (chordTimeline())
 * @returns {RhythmRow[]}
 */
export function splitByChords(rows, score, events) {
    /** @type {RhythmRow[]} */
    const split = [];
    for (const row of rows) {
        /** @type {Map<string, Set<number>>} */
        const groups = new Map();
        for (const bar of [...row.bars].sort((a, b) => a - b)) {
            const {key} = barChords(score, events, bar);
            groups.set(key, (groups.get(key) ?? new Set()).add(bar));
        }
        for (const [key, bars] of groups) split.push({...row, bars, pattern: {...row.pattern}, chords: [key]});
    }
    return sortRows(split);
}

/**
 * Beschreibung eines Rhythmus als HTML; ist er vereinfacht, steht "vereinfacht" fett dabei: bei einer Gruppe vor der
 * Klammer ("Solo, vereinfacht (2 von 16 Takten)"), sonst am Ende.
 * @param {string} text Rhythmushinweis (rhythmHint())
 * @param {boolean} simplified ob Anschläge weggelassen wurden
 * @returns {string} HTML
 */
function hintHtml(text, simplified) {
    if (!simplified) return escapeHtml(text);
    const mark = '<strong>vereinfacht</strong>';
    const one = /^([^,(]+) (\(\d+ von \d+ Takten\))$/.exec(text);
    return one ? `${escapeHtml(one[1])}, ${mark} ${escapeHtml(one[2])}` : `${escapeHtml(text)}, ${mark}`;
}

/**
 * Stellen (Tick ab Songanfang), an denen eine Spur anschlägt (Schläge mit Noten, die nicht nur übergebunden sind).
 * @param {import('../../types/alphatab').model.Track} track Spur
 * @returns {Set<number>}
 */
export function attackTicks(track) {
    return new Set(track.staves[0].bars.flatMap(bar => (bar.voices[0] ? timeline(bar.voices[0]) : [])
        .filter(e => e.beat.notes.length && !e.beat.notes.every(n => n.isTieDestination))
        .map(e => bar.masterBar.start + e.start)));
}

/**
 * Akkordwechsel in den Takten eines Rhythmus an Stellen ohne Anschlag (auch zwischen den Rasterplätzen). Gezählt
 * werden nur Wechsel, an denen die Quellspur anschlägt: Klingt dort in der Quellspur nur ein Ton weiter (Haltebogen)
 * oder ist Pause, wird der neue Akkord auch im Original erst später angeschlagen, und es fällt kein Anschlag weg.
 * @param {Score} score Noten
 * @param {RhythmRow} row Rhythmus
 * @param {{tick: number, name: string}[]} events Akkordwechsel (chordTimeline())
 * @param {Set<number>} attacks Stellen, an denen die Quellspur anschlägt (attackTicks())
 * @returns {RhythmWarning[]}
 */
export function rhythmWarnings(score, row, events, attacks) {
    const {grid, strokes} = row.pattern;
    const slotTicks = WHOLE_TICKS / grid;
    /** @type {RhythmWarning[]} */
    const warnings = [];
    for (const i of [...row.bars].sort((a, b) => a - b)) {
        const mb = score.masterBars[i];
        const end = mb.start + mb.calculateDuration();
        for (const e of events) {
            if (e.tick < mb.start || e.tick >= end || !attacks.has(e.tick)) continue;
            const offset = e.tick - mb.start;
            const slot = offset / slotTicks;
            if (Number.isInteger(slot) && strokes[slot] && strokes[slot] !== '.') continue;
            warnings.push({bar: i, count: countAt(offset, mb.timeSignatureDenominator), name: e.name});
        }
    }
    return warnings;
}

/**
 * Schreibt die Rhythmen in eine Spur: Kopie der Quellspur (Capo, Tuning) ohne Inhalt, je Takt sein Rhythmus mit den
 * Griffen der klingenden Akkorde (fillBar()), Takte ohne Rhythmus als Pausen; danach ziehen die Akkorde in diese Spur.
 * Ohne Ziel kommt sie als neue Spur "Rhythmus" an die erste Stelle, mit Ziel ersetzt sie die Zielspur (Stelle, Name,
 * Instrument und Liedtext bleiben).
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {string} tex alphaTex der Noten (Stand vor der Änderung)
 * @param {Score} score dieselben Noten als Modell, werden geändert
 * @param {number} index Quellspur
 * @param {RhythmRow[]} rows Rhythmen
 * @param {Object<string, string[]>} library Akkordkatalog (Griffe, wo die Noten keinen haben)
 * @param {?number} [target] Spur, die überschrieben wird (auch die Quellspur selbst); null für eine neue
 * @returns {{track: import('../../types/alphatab').model.Track, gripless: string[]}} Spur mit dem Rhythmus und Akkorde
 *   ohne Griff (dort Pausen)
 */
export function applyRhythm(alphaTab, tex, score, index, rows, library, target = null) {
    const events = chordTimeline(score);
    /** @type {Map<number, Pattern>} */
    const perBar = new Map(rows.flatMap(row => [...row.bars].map(i => [i, row.pattern])));
    const gripless = new Set();
    /**
     * Legt eine Kopie der Quellspur an der Stelle at an und schreibt die Rhythmen hinein.
     * @param {number} at Index der neuen Spur
     * @param {string} name gewünschter Name
     * @param {import('./notation.js').Instrument} instrument Instrument
     * @returns {import('../../types/alphatab').model.Track}
     */
    const rhythmTrack = (at, name, instrument) => {
        // duplicateTrack() liest die Quellspur aus dem alphaTex vor der Änderung, dort hat sie noch ihren Index.
        const track = duplicateTrack(t => parseScore(alphaTab, t), tex, score, index, at);
        track.name = track.shortName = freeTrackName(score, name, track);
        setInstrument(alphaTab, track, instrument);
        /** @type {?import('../../types/alphatab').model.Beat} letzter Schlag des vorigen Takts (klingt in den nächsten) */
        let ringing = null;
        for (const bar of track.staves[0].bars) {
            const pattern = perBar.get(bar.index);
            if (!pattern) {
                for (const voice of bar.voices) for (const beat of voice.beats) makeRest(beat);
                ringing = null;
                continue;
            }
            const start = score.masterBars[bar.index].start;
            fillBar(alphaTab, bar, pattern, tick => {
                const event = events.findLast(e => e.tick <= start + tick);
                if (!event) return null;
                const grip = gripFor(event, library);
                if (!grip) gripless.add(event.name);
                return grip;
            }, ringing);
            ringing = bar.voices[0].beats.at(-1) ?? null;
        }
        return track;
    };
    // Ein- und Ausblenden der Quellspur (z. B. am Schlussakkord): Takt, Stelle im Takt und Art.
    const fades = score.tracks[index].staves[0].bars.flatMap(bar => (bar.voices[0] ? timeline(bar.voices[0]) : [])
        .filter(e => e.beat.fade).map(e => ({bar: bar.index, at: e.start, fade: e.beat.fade})));
    const old = target === null ? null : score.tracks[target];
    // Die neue Spur kommt vor die alte (an ihre Stelle), die alte fällt am Ende weg.
    const track = old ? rhythmTrack(target, old.name, instrumentOf(old))
        : rhythmTrack(0, 'Rhythmus', instrumentByKey('guitar'));
    // Übernommen an den Anschlag der neuen Spur, der dort klingt (auch aus einem Takt davor, wenn der Ton der Quellspur
    // übergebunden ist und die neue Spur dort pausiert).
    const struck = track.staves[0].bars.flatMap(bar => (bar.voices[0] ? timeline(bar.voices[0]) : [])
        .filter(e => e.beat.notes.some(n => !n.isTieDestination)).map(e => ({
            bar: bar.index,
            at: e.start,
            beat: e.beat
        })));
    for (const {bar, at, fade} of fades) {
        const target = struck.findLast(e => e.bar < bar || (e.bar === bar && e.at <= at));
        if (target) target.beat.fade = fade;
    }
    moveContent(alphaTab, score, 'chords', track.index, 'insert');
    if (old) {
        if (lyricsTrack(score) === old) moveContent(alphaTab, score, 'lyrics', track.index, 'insert');
        deleteTrack(score, old.index);
        track.name = track.shortName = old.name;
    }
    return {track, gripless: [...gripless]};
}

/**
 * Dialog "Rhythmus ableiten" für eine Spur.
 */
export class RhythmDialog {
    /**
     * @param {import('./editor.js').NoteEditor} editor Editor
     * @param {number} index Quellspur
     */
    constructor(editor, index) {
        /** Editor. */
        this.editor = editor;
        /** Quellspur. */
        this.index = index;
        /** Frisch eingelesene Noten (Abspielzeiten stimmen). @type {Score} */
        this.score = parseScore(editor.alphaTab, editor.tex);
        /** Akkordwechsel des Songs. @type {{tick: number, name: string}[]} */
        this.ownEvents = chordTimeline(this.score);
        /** Akkordwechsel, nach denen sich die Rhythmen richten: die des Songs oder die abgeleiteten. */
        this.events = this.ownEvents;
        /**
         * Abgeleitete Akkorde (Schalter "Akkorde aus den Tönen der Spur bestimmen"), null ohne.
         * @type {?{chords: {tick: number, name: string}[], grips: Map<string, string>}}
         */
        this.derived = null;
        /** Zählt die Ableitungen mit, damit eine ältere, die später fertig wird, nichts überschreibt. */
        this.deriving = 0;
        /** Stellen, an denen die Quellspur anschlägt (für die Warnungen). @type {Set<number>} */
        this.attacks = attackTicks(this.score.tracks[index]);
        /**
         * Ob ein Rhythmus in Takten passt: kein Akkordwechsel ohne Anschlag (für "Ähnliche zusammenfassen").
         * @type {function(Pattern, Set<number>): boolean}
         */
        this.fits = (pattern, bars) => !rhythmWarnings(this.score, {bars, pattern, derived: true, simplified: false},
            this.events, this.attacks).length;
        /** Rhythmen. @type {RhythmRow[]} */
        this.rows = analyzeRhythm(this.score, index);
        /** Dialog. @type {?HTMLElement} */
        this.box = null;
        /** Ob die Rhythmen nicht mehr die abgeleiteten sind (dann ist der Knopf zum Zurücksetzen aktiv). */
        this.changed = false;
        /** Ob die Rhythmen nach Akkorden geteilt sind ("Rhythmen anhand der Akkorde unterscheiden"). */
        this.byChords = false;
        /** Ob die Rhythmen nach Abschnittsgruppen geteilt sind ("Rhythmen anhand der Abschnitte unterscheiden"). */
        this.bySections = false;
        /** Abschnittsgruppe je Takt. @type {Map<number, RowSection>} */
        this.groupOf = sectionGroups(this.score);
    }

    /**
     * Öffnet den Dialog über dem Dialog "Spuren" (Schließen zeigt ihn wieder).
     * @returns {void}
     */
    open() {
        const player = this.editor.player;
        const synced = player.hasAudio && playbackSyncPoints(this.editor.alphaTab, this.score).length > 0;
        /** Warum der Schalter "Akkorde mit Hilfe der Audiospur korrigieren" nicht geht; leer, wenn er geht. */
        this.noAudio = !player.hasAudio ? 'Keine Audiospur vorhanden.'
            : !synced ? 'Die Audiospur ist noch nicht mit den Noten synchronisiert.' : '';
        const html = `<h2>Rhythmus ableiten aus „${escapeHtml(trackName(this.score.tracks[this.index]))}“</h2>
      <div class="rh-tools">
        <button type="button" class="ebtn ebtn-text" id="rhMerge">Ähnliche zusammenfassen</button>
        <button type="button" class="ebtn" id="rhReset" disabled title="Rhythmen anzeigen, wie sie in der Spur stehen"
          aria-label="Rhythmen anzeigen, wie sie in der Spur stehen">${svgIcon('reload')}</button>
        <span class="efield-hint rh-count" id="rhCount"></span>
        <p class="rh-hint">Zusammengefasst werden Rhythmen, wenn mindestens ${Math.round(SIMILAR * 100)} % der Schläge
          gleich sind (in Sechzehnteln gerastert) und kein Akkordwechsel seinen Anschlag verliert. Der häufigste
          Rhythmus gewinnt.</p>
        <div class="rh-switches">
          <label class="rh-switch"
            title="Rhythmen je Abschnitt zeigen und ändern („Verse 1“ und „Verse 2“ sind „Verse“)">
            <input type="checkbox" role="switch" class="switch" id="rhSections"> Rhythmen anhand der Abschnitte
            unterscheiden</label>
          <label class="rh-switch" title="Ersetzt beim Übernehmen die bisherigen Akkorde"><input type="checkbox"
            role="switch" class="switch" id="rhDerive"> Akkorde aus den Tönen der Spur bestimmen</label>
          <label class="rh-switch" id="rhDeriveAudioRow"><input type="checkbox" role="switch" class="switch"
            id="rhDeriveAudio" disabled> Akkorde mit Hilfe der Audiospur korrigieren</label>
          <label class="rh-switch" title="Rhythmen nach den Akkorden im Takt teilen"><input type="checkbox"
            role="switch" class="switch" id="rhChords"> Rhythmen anhand der Akkorde unterscheiden</label>
          <p class="rh-hint" id="rhDeriveHint" hidden></p>
        </div>
      </div>
      <div class="rh" id="rhBox"></div>
      <div class="rh-target" role="radiogroup" aria-label="Wohin der Rhythmus kommt">
        <label><input type="radio" name="rhTarget" value="new" checked> Spur neu anlegen</label>
        <label><input type="radio" name="rhTarget" value="overwrite"> Spur überschreiben</label>
      </div>
      <div class="struct-actions">
        <button class="btn btn-primary" type="button" id="rhApply">Übernehmen</button>
        <button class="btn" type="button" id="rhCancel">Abbrechen</button>
      </div>`;
        if (isOverlayOpen()) openStackedOverlay(html);
        else openOverlay(html);
        this.box = document.getElementById('rhBox');
        this.box.addEventListener('click', e => this.click(/** @type {HTMLElement} */ (e.target)));
        this.box.addEventListener('change', e => this.typed(/** @type {HTMLInputElement} */ (e.target)));
        document.getElementById('rhCancel').addEventListener('click', closeOverlay);
        document.getElementById('rhMerge').addEventListener('click', () => {
            this.rows = mergeSimilar(this.rows, this.fits);
            this.changed = true;
            this.render();
        });
        document.getElementById('rhChords').addEventListener('change', e => {
            this.byChords = /** @type {HTMLInputElement} */ (e.target).checked;
            this.rows = this.byChords ? splitByChords(this.rows, this.score, this.events)
                : mergeRows(this.rows.map(row => ({...row, chords: undefined})));
            this.changed = true;
            this.render();
        });
        document.getElementById('rhSections').addEventListener('change', e => {
            this.bySections = /** @type {HTMLInputElement} */ (e.target).checked;
            this.rows = this.bySections ? splitBySections(this.rows, this.groupOf)
                : mergeRows(this.rows.map(row => ({...row, section: undefined})));
            this.changed = true;
            this.render();
        });
        document.getElementById('rhReset').addEventListener('click', () => this.resetRows());
        document.getElementById('rhDerive').addEventListener('change', () => void this.deriveChords());
        document.getElementById('rhDeriveAudio').addEventListener('change', () => void this.deriveChords());
        document.getElementById('rhApply').addEventListener('click', () => void this.apply());
        this.showAudioSwitch(false);
        this.render();
    }

    /**
     * Schalter "Akkorde mit Hilfe der Audiospur korrigieren": immer zu sehen, ausgegraut, solange die Akkorde nicht aus
     * der Spur bestimmt werden oder der Song keine synchronisierte Audiospur hat; der Tooltip sagt warum.
     * @param {boolean} on ob "Akkorde aus den Tönen der Spur bestimmen" an ist
     * @returns {void}
     */
    showAudioSwitch(on) {
        const audio = /** @type {HTMLInputElement} */ (document.getElementById('rhDeriveAudio'));
        audio.disabled = !on || !!this.noAudio;
        /** @type {HTMLElement} */ (document.getElementById('rhDeriveAudioRow')).title = this.noAudio
            || (on ? '' : 'Erst „Akkorde aus den Tönen der Spur bestimmen“ einschalten.');
    }

    /**
     * Zeigt die Rhythmen wieder, wie sie in der Spur stehen (Kreispfeil; auch nach neuen Akkorden), geteilt nach den
     * Schaltern "Rhythmen anhand der Abschnitte unterscheiden" und "Rhythmen anhand der Akkorde unterscheiden".
     * @returns {void}
     */
    resetRows() {
        this.rows = analyzeRhythm(this.score, this.index);
        if (this.bySections) this.rows = splitBySections(this.rows, this.groupOf);
        if (this.byChords) this.rows = splitByChords(this.rows, this.score, this.events);
        this.changed = false;
        this.render();
    }

    /**
     * Schalter "Akkorde aus den Tönen der Spur bestimmen" (und darunter "Akkorde mit Hilfe der Audiospur
     * korrigieren", nur dann nicht ausgegraut): leitet die Akkorde ab (songChordsFrom() im Editor). Die Rhythmen richten sich
     * danach gleich nach ihnen (Teilen nach Akkorden, Warnungen); sie beginnen wieder, wie sie in der Spur stehen.
     * Ausgeschaltet gelten wieder die Akkorde des Songs. Während die Audiospur ausgewertet wird, liegt eine Fläche mit
     * Hinweis über allem (showBusy()); geht es nicht, sagt ein Hinweis unter den Schaltern warum.
     * @returns {Promise<void>}
     */
    async deriveChords() {
        const on = /** @type {HTMLInputElement} */ (document.getElementById('rhDerive')).checked;
        const audio = /** @type {HTMLInputElement} */ (document.getElementById('rhDeriveAudio'));
        const hint = /** @type {HTMLElement} */ (document.getElementById('rhDeriveHint'));
        this.showAudioSwitch(on);
        const run = ++this.deriving;
        this.derived = null;
        this.events = this.ownEvents;
        hint.hidden = true;
        if (on) {
            const withAudio = audio.checked && !audio.disabled;
            const done = withAudio ? await showBusy('Audiospur wird ausgewertet …') : () => {};
            let result;
            try {
                result = await this.editor.songChordsFrom(this.index, withAudio);
            } finally {
                done();
            }
            if (run !== this.deriving) return;
            if ('error' in result) {
                hint.textContent = `Keine Akkorde abgeleitet: ${result.error}`;
                hint.hidden = false;
            } else {
                this.derived = result;
                this.events = result.chords;
                hint.hidden = true;
            }
        }
        this.resetRows();
    }

    /**
     * Zeichnet alle Rhythmen mit Ort, Raster, Feld, Knöpfen zum Übernehmen und Warnungen.
     * @returns {void}
     */
    render() {
        let blocked = false;
        this.box.innerHTML = this.rows.map((row, k) => {
            const warnings = rhythmWarnings(this.score, row, this.events, this.attacks);
            blocked ||= warnings.length > 0;
            // Angeboten werden nur Rhythmen, mit denen hier kein Anschlag eines Akkordwechsels wegfällt, die ähnlichsten
            // zuerst (ein gleicher, etwa nach "Rhythmen anhand der Akkorde unterscheiden", immer).
            const similar = this.rows.filter(o => o !== row && o.section === row.section && o.bars.size >= row.bars.size
                && similarity(o.pattern, row.pattern) >= SIMILAR && this.fits(o.pattern, row.bars))
                .sort((a, b) => similarity(b.pattern, row.pattern) - similarity(a.pattern, row.pattern))
                .slice(0, TAKE_MAX).sort((a, b) => this.rows.indexOf(a) - this.rows.indexOf(b));
            const n = row.bars.size;
            const canHalve = row.pattern.grid === 16 && [...row.pattern.strokes].every((t, i) => i % 2 === 0 || t === '.');
            // Grundrhythmus: der häufigste mit Anschlägen in seiner Abschnittsgruppe (auch als einziger), ungeteilt der
            // häufigste mit Anschlägen von mehreren im Song.
            const peers = this.rows.filter(o => o.section === row.section);
            const main = peers.find(o => o.derived) === row && (!!row.section || peers.length > 1);
            const s = row.section;
            const heading = s && this.rows[k - 1]?.section !== s ? `<h3 class="rh-group">${escapeHtml(s.label)}
          <span class="efield-hint">${s.count} ${s.count === 1 ? 'Durchgang' : 'Durchgänge'}, ${s.bars.size}
          ${s.bars.size === 1 ? 'Takt' : 'Takte'}</span></h3>` : '';
            return `${heading}<div class="rh-row${warnings.length ? ' rh-bad' : ''}">
        <div class="rh-head"><span class="rh-title">Rhythmus ${k + 1}:</span>
          <span class="efield-hint rh-bars">${n} ${n === 1 ? 'Takt' : 'Takte'}${
                row.derived ? '' : ', in der Spur ohne Anschläge'}</span></div>
        <p class="rh-hint rh-where">${hintHtml(rhythmHint(this.score, row.bars, this.events, main, s?.bars ?? null),
                row.simplified)}</p>
        <div class="rh-edit">
          ${patternGridHtml(row.pattern, true, false, this.chordLines(row))}
          <input type="text" data-rh-strokes="${k}" value="${escapeHtml(row.pattern.strokes)}" spellcheck="false"
            aria-label="Rhythmus: d ab, u auf, x gedämpft, . nichts; groß = betont">
          <button type="button" class="ebtn ebtn-text" data-rh-grid="${k}" title="${row.pattern.grid === 8 || canHalve
                ? 'Raster wechseln' : 'Anschläge zwischen den Achteln fallen weg'}">${row.pattern.grid === 8 ? 'in Sechzehnteln'
                : canHalve ? 'in Achteln' : 'auf Achtel vereinfachen'}</button>
        </div>
        ${similar.length ? `<div class="rh-take">${similar.map(o => `<button type="button" class="ebtn ebtn-text"
          data-rh-take="${k}" data-rh-from="${this.rows.indexOf(o)}">Rhythmus ${this.rows.indexOf(o) + 1} übernehmen</button>`)
                .join('')}</div>` : ''}
        ${warnings.length ? `<p class="rh-warn">${warnings.slice(0, 6).map(w =>
                `Takt ${w.bar + 1}, Zählzeit ${escapeHtml(w.count)}: ${escapeHtml(w.name)} ohne Anschlag`).join('; ')}${
                warnings.length > 6 ? ` und ${warnings.length - 6} weitere` : ''}.</p>` : ''}
      </div>`;
        }).join('');
        for (const [k, table] of [...this.box.querySelectorAll('table.pgrid')].entries()) table.dataset.rhRow = String(k);
        const n = this.rows.length;
        document.getElementById('rhCount').textContent = `${n} ${n === 1 ? 'Rhythmus' : 'Rhythmen'}`;
        /** @type {HTMLButtonElement} */ (document.getElementById('rhMerge')).disabled =
            mergeSimilar(this.rows, this.fits).length === n;
        /** @type {HTMLButtonElement} */ (document.getElementById('rhReset')).disabled = !this.changed;
        /** @type {HTMLInputElement} */ (document.getElementById('rhChords')).checked = this.byChords;
        /** @type {HTMLInputElement} */ (document.getElementById('rhSections')).checked = this.bySections;
        const apply = /** @type {HTMLButtonElement} */ (document.getElementById('rhApply'));
        apply.disabled = blocked || !this.rows.length;
        apply.title = blocked ? 'Erst die roten Warnungen lösen: Jeder Akkordwechsel braucht einen Anschlag.' : '';
        this.alignTools();
    }

    /**
     * Akkorde über dem Raster eines Rhythmus (nur nach "Rhythmen anhand der Akkorde unterscheiden"): eine Zeile je
     * Akkordfolge seiner Takte, jeder Akkord am Rasterplatz, an dem er beginnt.
     * @param {RhythmRow} row Rhythmus
     * @returns {{slot: number, name: string}[][]}
     */
    chordLines(row) {
        return this.byChords ? rowChordLines(this.score, this.events, row) : [];
    }

    /**
     * Rückt Zahl und Hinweis oben so ein, dass sie rechts mit dem Text der Rhythmen darunter abschließen (die Liste hat
     * Rahmen, Innenabstand und je nach Höhe eine Scrollleiste).
     * @returns {void}
     */
    alignTools() {
        const tools = /** @type {?HTMLElement} */ (document.querySelector('.rh-tools'));
        const bars = this.box.querySelector('.rh-bars');
        if (!tools || !bars) return;
        tools.style.paddingRight = '0px';
        const gap = tools.getBoundingClientRect().right - bars.getBoundingClientRect().right;
        tools.style.paddingRight = `${Math.max(0, gap)}px`;
    }

    /**
     * Klick ins Raster (Zeichen wechseln, Betonung), auf das Raster oder auf "Rhythmus aus … übernehmen". Beim Bearbeiten
     * wird nicht zusammengefasst.
     * @param {HTMLElement} target angeklicktes Element
     * @returns {void}
     */
    click(target) {
        const take = /** @type {?HTMLElement} */ (target.closest('[data-rh-take]'));
        if (take) {
            this.rows = joinRow(this.rows, this.rows[Number(take.dataset.rhTake)], this.rows[Number(take.dataset.rhFrom)]);
            this.changed = true;
            this.render();
            return;
        }
        const gridButton = /** @type {?HTMLElement} */ (target.closest('[data-rh-grid]'));
        if (gridButton) {
            const pattern = this.rows[Number(gridButton.dataset.rhGrid)].pattern;
            const tokens = [...pattern.strokes];
            // Auf Achtel: Anschläge dazwischen fallen weg; die Richtungen rechnet strumDirections() neu, gedämpft und
            // Betonung bleiben.
            const grid = pattern.grid === 8 ? 16 : 8;
            pattern.strokes = strumDirections(pattern.grid === 8 ? tokens.flatMap(t => [t, '.'])
                : tokens.filter((_, i) => i % 2 === 0), grid, pattern.timeSignature);
            pattern.grid = grid;
            this.changed = true;
            this.render();
            return;
        }
        const cell = /** @type {?HTMLElement} */ (target.closest('[data-cell]'));
        const table = /** @type {?HTMLElement} */ (target.closest('table[data-rh-row]'));
        if (!cell || !table) return;
        const pattern = this.rows[Number(table.dataset.rhRow)].pattern;
        pattern.strokes = editPattern(pattern, cell.dataset.cell, Number(cell.dataset.slot));
        this.changed = true;
        this.render();
    }

    /**
     * Geändertes Feld übernehmen: der getippte Rhythmus (nur d, u, x, groß = betont, und Punkt, so viele
     * wie Rasterplätze; sonst bleibt der vorige).
     * @param {HTMLInputElement} input Feld
     * @returns {void}
     */
    typed(input) {
        if (input.dataset.rhStrokes === undefined) return;
        const pattern = this.rows[Number(input.dataset.rhStrokes)].pattern;
        const value = input.value.replace(/\s+/g, '');
        const slots = slotCount(pattern.timeSignature, pattern.grid);
        if (value.length !== slots || /[^duxDUX.]/.test(value)) {
            this.editor.toast(`${slots} Zeichen nötig: d ab, u auf, x gedämpft, . nichts (groß = betont).`);
        } else {
            pattern.strokes = value;
            this.changed = true;
        }
        this.render();
    }

    /**
     * Legt die Spur an bzw. überschreibt die Quellspur (ein Schritt für "Rückgängig") und schließt den Dialog.
     * @returns {Promise<void>}
     */
    async apply() {
        const ed = this.editor;
        const overwrite = /** @type {?HTMLInputElement} */ (document.querySelector('input[name="rhTarget"]:checked'))
            ?.value === 'overwrite';
        const target = overwrite ? this.index : null;
        const library = await loadChordLibraryOrEmpty();
        /** @type {?{track: import('../../types/alphatab').model.Track, gripless: string[]}} */
        let result = null;
        let lost = 0;
        const derived = this.derived;
        closeOverlay();
        ed.changeTracks(score => {
            // Abgeleitete Akkorde zuerst in die Quellspur; der Rhythmus nimmt sie dann mit (applyRhythm()).
            if (derived) lost = ed.placeSongChords(score, score.tracks[this.index], derived.chords, derived.grips);
            result = applyRhythm(ed.alphaTab, ed.tex, score, this.index, this.rows, library, target);
        }, target ?? 0, 0);
        if (!result) return;
        const name = trackName(ed.score.tracks[target ?? 0]);
        const message = (target === null ? `Spur „${name}“ als erste Spur angelegt` : `Spur „${name}“ überschrieben`)
            + ', sie trägt jetzt die Akkorde.'
            + (result.gripless.length ? ` Ohne Griff (Pausen): ${result.gripless.join(', ')}.` : '');
        if (lost) ed.toast(`${message}\n• ${lost} abgeleitete Akkorde ohne Schlag (Triole oder Vorschlag an der Stelle).`,
            {warn: true});
        else ed.toast(message);
    }
}
