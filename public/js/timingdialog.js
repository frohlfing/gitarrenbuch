/**
 * Dialog "Metrum umschreiben" des Bearbeitungsmodus: rechnet die zeitliche Einteilung des Songs um, ohne dass er anders
 * klingt (Gegenstück zu "Transponieren" für die Tonhöhe).
 *
 * - Notenwerte verdoppeln, halbieren, verdreifachen, dritteln, um die Hälfte verlängern oder um ein Drittel kürzen
 *   (Viertel → Halbe, Achtel, punktierte Halbe, Achteltriole; Achteltriole → Achtel, Achtel → Achteltriole); was
 *   nicht als ein Notenwert geht, wird angebunden.
 * - Tempo mit demselben Faktor (so klingt es gleich) oder mit einem anderen.
 * - Takte zusammenfassen (je 2 oder 3 zu einem) oder teilen (in 2 oder 3); ein Auftakt bleibt für sich.
 * - Taktart: alle, die zur neuen Taktlänge passen (z. B. 6/8 → 6/4 oder 12/8); weitere Taktarten im Song folgen
 *   derselben Regel (gleicher Faktor im Nenner).
 * - Shuffle bleibt auf den Achteln (das Gitarrenbuch kennt nur Achtel-Shuffle); ändern sich die Notenwerte, sagt ein
 *   Hinweis, welche Noten jetzt geswingt werden.
 * - Sync-Punkte, Tempowechsel und Fermaten behalten ihre Stelle in der Musik; Abschnitte, Wiederholungen und
 *   Taktstriche wandern mit ihrem Takt. Was sich so nicht umrechnen lässt, steht rot im Dialog, und "Anwenden" ist
 *   gesperrt.
 * - Vorschau: Tabelle mit Taktart, Tempo, Takten und Notenwerten jetzt und danach; darunter die häufigsten Rhythmen
 *   einer Spur, je "Jetzt" über "Danach", was zur gleichen Zeit klingt, untereinander.
 */

import {escapeHtml, glyph, GLYPHS} from './base.js';
import {closeOverlay, openOverlay} from './library.js';
import {
    beatTicks,
    chordsTrack,
    parseScore,
    relinkBars,
    splitTicks,
    tempoAt,
    tieChain,
    timeline,
    WHOLE_TICKS,
    writeScore,
} from './notation.js';
import {chordTimeline} from './sheet.js';
import {analyzeRhythm, groupsOfThree} from './rhythmdialog.js';
import {countAt} from './rhythmhint.js';

/** @typedef {import('../../types/alphatab').model.Score} Score */
/** @typedef {import('../../types/alphatab').model.Beat} Beat */
/** @typedef {import('./notation.js').AlphaTabModule} AlphaTabModule */

/**
 * Faktor als Bruch: Zähler, Nenner.
 * @typedef {[number, number]} Ratio
 */

/**
 * Taktart.
 * @typedef {{num: number, den: number}} TimeSig
 */

/**
 * Was der Dialog am Song ändert.
 * @typedef {Object} Retime
 * @property {Ratio} notes Faktor der Notenwerte
 * @property {Ratio} tempo Faktor des Tempos
 * @property {Ratio} bars Faktor der Taktzahl (1/2: je 2 zusammenfassen, 2/1: jeden teilen)
 * @property {number} denFactor Faktor im Nenner der Taktart (aus der gewählten Taktart, gilt für alle Taktarten)
 */

/**
 * Ergebnis der Umrechnung.
 * @typedef {Object} RetimeResult
 * @property {string[]} problems was sich nicht umrechnen lässt (dann ist das Modell unbrauchbar)
 * @property {string[]} warnings Hinweise (Abschnitt verschoben, Takt aufgefüllt …)
 * @property {number} ties neu angebundene Schläge
 * @property {string} [shuffle] Hinweis, welche Noten das Shuffle jetzt swingt (shuffleHint()); fehlt ohne Shuffle oder
 *   bei gleichen Notenwerten
 */

/** Auswahl für Notenwerte und Tempo: Faktor und Bezeichnung. @type {[Ratio, string][]} */
const FACTORS = [[[1, 3], 'dritteln'], [[1, 2], 'halbieren'], [[2, 3], 'um ein Drittel kürzen'],
    [[1, 1], 'unverändert'], [[3, 2], 'um die Hälfte verlängern'], [[2, 1], 'verdoppeln'], [[3, 1], 'verdreifachen']];

/** Auswahl für die Takte: Faktor der Taktzahl und Bezeichnung. @type {[Ratio, string][]} */
const BAR_FACTORS = [[[1, 3], 'je 3 zu einem zusammenfassen'], [[1, 2], 'je 2 zu einem zusammenfassen'],
    [[1, 1], 'unverändert'], [[2, 1], 'jeden in 2 teilen'], [[3, 1], 'jeden in 3 teilen']];

/** Notenwerte, die ein Schlag haben kann (1 = Ganze). */
const VALUES = [1, 2, 4, 8, 16, 32, 64];

/** Nenner, die eine Taktart haben kann. */
const DENOMINATORS = [1, 2, 4, 8, 16, 32];

/** Namen der Notenwerte. @type {Object<number, string>} */
const VALUE_NAMES = {1: 'Ganze', 2: 'Halbe', 4: 'Viertel', 8: 'Achtel', 16: 'Sechzehntel', 32: 'Zweiunddreißigstel',
    64: 'Vierundsechzigstel'};

/** Zeichen der Notenwerte (Bravura). @type {Object<number, string>} */
const VALUE_GLYPHS = {1: GLYPHS.whole, 2: GLYPHS.half, 4: GLYPHS.quarter, 8: GLYPHS.eighth, 16: GLYPHS.sixteenth,
    32: GLYPHS.thirtySecond};

/** So viele Rhythmen zeigt die Vorschau. */
const PREVIEW_PATTERNS = 4;

/** Wartezeit nach der letzten Eingabe, bis die Vorschau neu entsteht (ms). */
const PREVIEW_MS = 300;

/** Höchste Breite einer Zeile "Jetzt"/"Danach" in der Vorschau (px). */
const LANE_WIDTH = 760;

/** Breite eines Rasterplatzes des feinsten Rasters in der Vorschau, wenn Platz ist (px). */
const SLOT_WIDTH = 26;

/**
 * Wert mal Faktor.
 * @param {number} x Wert
 * @param {Ratio} ratio Faktor
 * @returns {number}
 */
const times = (x, [p, q]) => x * p / q;

/**
 * Ob zwei Faktoren gleich sind.
 * @param {Ratio} a Faktor
 * @param {Ratio} b Faktor
 * @returns {boolean}
 */
const sameRatio = (a, b) => a[0] * b[1] === a[1] * b[0];

/**
 * Notenwert ohne Triole, der genau so lang ist.
 * @param {number} ticks Länge
 * @returns {?{duration: number, dots: number}}
 */
function plainValue(ticks) {
    for (const duration of VALUES) {
        for (const dots of [0, 1, 2]) {
            if (Math.abs(WHOLE_TICKS / duration * [1, 1.5, 1.75][dots] - ticks) < 1e-6) return {duration, dots};
        }
    }
    return null;
}

/**
 * Rechnet den Notenwert eines Schlags um: als ein Notenwert (auch punktiert oder als Triole), sonst als Kette
 * angebundener Schläge. Vorschläge bleiben, wie sie sind.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Beat} beat Schlag
 * @param {Ratio} ratio Faktor
 * @returns {?Beat[]} der Schlag und angebundene neue; null, wenn es nicht geht (Triole, die angebunden werden müsste,
 *   oder kürzer als eine Vierundsechzigstel)
 */
function scaleBeat(alphaTab, beat, ratio) {
    if (beat.graceType) return [beat];
    const ticks = times(beatTicks(beat), ratio);
    const plain = plainValue(ticks);
    if (plain) {
        beat.duration = plain.duration;
        beat.dots = plain.dots;
        beat.tupletNumerator = beat.tupletDenominator = -1;
        return [beat];
    }
    const tuplets = beat.hasTuplet ? [[beat.tupletNumerator, beat.tupletDenominator]] : [];
    if (!tuplets.some(([n, d]) => n === 3 && d === 2)) tuplets.push([3, 2]);
    for (const [n, d] of tuplets) {
        const value = plainValue(ticks * n / d);
        if (!value) continue;
        beat.duration = value.duration;
        beat.dots = value.dots;
        beat.tupletNumerator = n;
        beat.tupletDenominator = d;
        return [beat];
    }
    const parts = beat.hasTuplet ? null : splitTicks(ticks);
    return parts ? tieChain(alphaTab, beat, parts) : null;
}

/**
 * Taktarten mit der Länge einer Taktart mal Faktor: gleicher Zähler zuerst (6/8 → 6/4), mit sameDen gleicher Nenner
 * zuerst (4/4 geteilt → 2/4), dann nach Nenner.
 * @param {TimeSig} ts Taktart
 * @param {Ratio} ratio Faktor der Länge
 * @param {boolean} [sameDen] gleichen Nenner vorziehen
 * @returns {TimeSig[]}
 */
export function timeSignatureOptions(ts, [p, q], sameDen = false) {
    const options = [];
    for (const den of DENOMINATORS) {
        const top = ts.num * p * den;
        const bottom = ts.den * q;
        if (top % bottom === 0 && top / bottom >= 1 && top / bottom <= 32) options.push({num: top / bottom, den});
    }
    const rank = o => (o.num === ts.num ? 0 : 2) - (o.den === ts.den ? (sameDen ? 3 : 1) : 0);
    return options.sort((a, b) => rank(a) - rank(b) || a.den - b.den);
}

/**
 * Neue Taktart nach der Regel des Dialogs: der gewählte Faktor im Nenner, sonst die erste passende.
 * @param {TimeSig} ts alte Taktart
 * @param {Ratio} ratio Faktor der Länge
 * @param {number} denFactor Faktor im Nenner
 * @returns {?TimeSig} null, wenn keine passt
 */
function newTimeSignature(ts, ratio, denFactor) {
    const options = timeSignatureOptions(ts, ratio);
    return options.find(o => o.den === ts.den * denFactor) ?? options[0] ?? null;
}

/**
 * Faktor der Taktlänge: Notenwerte geteilt durch den Faktor der Taktzahl.
 * @param {Retime} plan Änderung
 * @returns {Ratio}
 */
export function lengthRatio(plan) {
    return [plan.notes[0] * plan.bars[1], plan.notes[1] * plan.bars[0]];
}

/**
 * Name eines Notenwerts nach der Umrechnung, z. B. Achtel halbiert: "Sechzehntel".
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {number} duration Notenwert vorher (4 = Viertel)
 * @param {Ratio} ratio Faktor
 * @param {boolean} [triplet] Notenwert vorher als Triole
 * @returns {string} mehrere angebunden mit "+"
 */
function scaledValueName(alphaTab, duration, ratio, triplet = false) {
    const beat = new alphaTab.model.Beat();
    beat.duration = duration;
    if (triplet) {
        beat.tupletNumerator = 3;
        beat.tupletDenominator = 2;
    }
    const chain = scaleBeat(alphaTab, beat, ratio);
    return chain ? chain.map(b => valueOf(b).name).join(' + ') : '?';
}

/**
 * Hinweis zum Shuffle, wenn sich die Notenwerte ändern: Das Gitarrenbuch kennt nur Achtel-Shuffle (Sechzehntel-
 * Shuffle macht der Import zu geraden Sechzehnteln), darum bleibt es auf den Achteln, und geswingt werden andere Noten.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Ratio} notes Faktor der Notenwerte
 * @returns {string}
 */
function shuffleHint(alphaTab, notes) {
    const was = scaledValueName(alphaTab, 8, notes);
    const now = scaledValueName(alphaTab, 8, [notes[1], notes[0]]);
    return `Shuffle bleibt auf den Achteln. Die Achtel werden zu ${was} und werden daher nicht mehr swingen. `
        + `Statt dessen werden die ${now} swingen.`;
}

/**
 * Takte als Text, z. B. "Takt 3, 7 und 4 weitere".
 * @param {Iterable<number>} indexes Indizes der Takte
 * @returns {string}
 */
function barList(indexes) {
    const list = [...new Set(indexes)].sort((a, b) => a - b).map(i => i + 1);
    const shown = list.slice(0, 5).join(', ');
    return `Takt ${shown}${list.length > 5 ? ` und ${list.length - 5} weitere` : ''}`;
}

/**
 * Abschnitt eines alten Takts in einem neuen: Ticks (umgerechnet) von from bis to; to Infinity: bis zum Ende.
 * @typedef {{bar: number, from: number, to: number, length: number}} Segment
 */

/**
 * Ein neuer Takt aus Abschnitten alter Takte.
 * @typedef {{segments: Segment[], ts: TimeSig, pad: number, anacrusis: boolean}} NewBar
 */

/**
 * Teilt die Takte neu ein: zusammenfassen, teilen oder lassen. Ein Auftakt bleibt für sich (beim Teilen wird von
 * hinten geteilt, der Rest vorne bleibt Auftakt).
 * @param {{ts: TimeSig, full: number, len: number, anacrusis: boolean}[]} info alte Takte (Längen in Ticks, vor
 *   der Umrechnung)
 * @param {Retime} plan Änderung
 * @param {string[]} problems Liste für Probleme
 * @param {string[]} warnings Liste für Hinweise
 * @returns {NewBar[]}
 */
function layoutBars(info, plan, problems, warnings) {
    const ratio = lengthRatio(plan);
    /** @type {NewBar[]} */
    const out = [];
    const bad = new Set();
    const tsOf = i => {
        const ts = newTimeSignature(info[i].ts, ratio, plan.denFactor);
        if (!ts) bad.add(i);
        return ts ?? info[i].ts;
    };
    const tsTicks = ts => WHOLE_TICKS * ts.num / ts.den;
    const scaled = ticks => times(ticks, plan.notes);
    const [grow, shrink] = plan.bars;
    if (shrink > 1) {
        let i = 0;
        if (info[0]?.anacrusis) {
            out.push({segments: [{bar: 0, from: 0, to: Infinity, length: scaled(info[0].len)}], ts: null, pad: 0,
                anacrusis: true});
            i = 1;
        }
        const mixed = [];
        for (; i < info.length; i += shrink) {
            const group = info.slice(i, i + shrink).map((_, k) => i + k);
            const key = j => `${info[j].ts.num}/${info[j].ts.den}`;
            if (group.some(j => key(j) !== key(i))) mixed.push(i);
            const ts = tsOf(i);
            const segments = group.map(j => ({bar: j, from: 0, to: Infinity, length: scaled(info[j].full)}));
            const pad = tsTicks(ts) - segments.reduce((sum, s) => sum + s.length, 0);
            if (pad > 0) warnings.push(`Der letzte Takt wird mit Pausen aufgefüllt: ${barList(group)} ${group.length > 1
                ? 'ergeben' : 'ergibt'} keinen ganzen Takt.`);
            out.push({segments, ts, pad: Math.max(0, pad), anacrusis: false});
        }
        if (mixed.length) problems.push(`${barList(mixed)}: Takte mit verschiedenen Taktarten lassen sich nicht `
            + 'zusammenfassen.');
        if (out[0]?.anacrusis) out[0].ts = out[1]?.ts ?? tsOf(0);
    } else {
        const uneven = [];
        for (const [i, bar] of info.entries()) {
            const ts = tsOf(i);
            const part = scaled(bar.full) / grow;
            if (grow > 1 && !bad.has(i) && Math.abs(part - tsTicks(ts)) > 1e-6) uneven.push(i);
            const end = scaled(bar.anacrusis ? bar.len : bar.full);
            const starts = [];
            for (let s = end; s > 1e-6; s -= part) starts.unshift(Math.max(0, s - part));
            starts.forEach((from, k) => {
                const to = k === starts.length - 1 ? Infinity : starts[k + 1];
                const length = (to === Infinity ? end : to) - from;
                out.push({segments: [{bar: i, from, to, length}], ts, pad: 0,
                    anacrusis: bar.anacrusis && k === 0 && length < part - 1e-6});
            });
        }
        if (uneven.length) problems.push(`${barList(uneven)}: Der Takt lässt sich nicht gleichmäßig teilen.`);
    }
    if (bad.size) problems.push(`${barList(bad)}: Zu dieser Taktlänge passt keine Taktart.`);
    return out;
}

/**
 * Schneidet die Schläge einer Stimme an Stellen im Takt; ein Schlag über einer Stelle wird zur Kette angebundener
 * Schläge (tieChain()).
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {{beat: Beat, start: number, end: number}[]} entries Schläge (timeline())
 * @param {number[]} cuts Stellen in Ticks, aufsteigend
 * @returns {?{beat: Beat, start: number, end: number}[]} null, wenn ein Schlag sich nicht teilen lässt (Triole)
 */
function cutEntries(alphaTab, entries, cuts) {
    const out = [];
    for (const entry of entries) {
        const inside = cuts.filter(c => c > entry.start + 1e-6 && c < entry.end - 1e-6);
        if (!inside.length) {
            out.push(entry);
            continue;
        }
        if (entry.beat.hasTuplet || entry.beat.graceType) return null;
        const bounds = [entry.start, ...inside, entry.end];
        const parts = [];
        for (let k = 1; k < bounds.length; k++) {
            const piece = splitTicks(bounds[k] - bounds[k - 1]);
            if (!piece) return null;
            parts.push(...piece);
        }
        let start = entry.start;
        for (const beat of tieChain(alphaTab, entry.beat, parts)) {
            const end = start + beatTicks(beat);
            out.push({beat, start, end});
            start = end;
        }
    }
    return out;
}

/**
 * Pausen über eine Länge, wenn nötig als Triolen (z. B. 2/3 Ganze nach dem Dritteln).
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {number} ticks Länge
 * @returns {?Beat[]} null, wenn die Länge keine Notenwerte ergibt
 */
function restBeats(alphaTab, ticks) {
    const plain = splitTicks(Math.round(ticks));
    const triplet = plain ? null : splitTicks(Math.round(ticks * 3 / 2));
    return (plain ?? triplet)?.map(({duration, dots}) => {
        const beat = new alphaTab.model.Beat();
        beat.duration = duration;
        beat.dots = dots;
        if (triplet) {
            beat.tupletNumerator = 3;
            beat.tupletDenominator = 2;
        }
        return beat;
    }) ?? null;
}

/**
 * Angaben der Takte vor der Umrechnung (Längen in Ticks, Abschnitte, Wiederholungen, Sync-Punkte …).
 * @param {Score} score Noten (frisch eingelesen)
 * @returns {Object[]}
 */
function barInfo(score) {
    return score.masterBars.map(mb => ({
        ts: {num: mb.timeSignatureNumerator, den: mb.timeSignatureDenominator},
        full: mb.calculateDuration(false),
        len: mb.calculateDuration(),
        anacrusis: mb.isAnacrusis,
        section: mb.section,
        repeatStart: mb.isRepeatStart,
        repeatCount: mb.repeatCount,
        endings: mb.alternateEndings,
        doubleBar: mb.isDoubleBar,
        directions: mb.directions,
        feel: mb.tripletFeel,
        sync: (mb.syncPoints ?? []).map(p => ({item: p, tick: p.ratioPosition * mb.calculateDuration()})),
        tempo: mb.tempoAutomations.map(a => ({item: a, tick: a.ratioPosition * mb.calculateDuration()})),
        fermata: mb.fermata ? [...mb.fermata.entries()] : [],
    }));
}

/**
 * Neue Taktzahl und Probleme der Einteilung, ohne umzurechnen (für die Liste der Varianten).
 * @param {Score} score Noten (frisch eingelesen)
 * @param {Retime} plan Änderung
 * @returns {{count: number, ok: boolean}}
 */
function layoutSummary(score, plan) {
    const problems = [];
    const count = layoutBars(barInfo(score), plan, problems, []).length;
    return {count, ok: !problems.length};
}

/**
 * Rechnet die zeitliche Einteilung um (siehe Kopf der Datei). Bei Problemen ist das Modell danach unbrauchbar: erst
 * an einer Kopie prüfen.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Score} score Noten (frisch eingelesen), werden geändert
 * @param {Retime} plan Änderung
 * @returns {RetimeResult}
 */
export function retime(alphaTab, score, plan) {
    /** @type {string[]} */
    const problems = [];
    /** @type {string[]} */
    const warnings = [];
    const old = score.masterBars.slice();
    const songTempo = score.tempo;
    const info = barInfo(score);
    const layout = layoutBars(info, plan, problems, warnings);
    if (problems.length) return {problems, warnings, ties: 0};

    // Notenwerte umrechnen
    let ties = 0;
    const failed = new Set();
    const tempoType = alphaTab.model.AutomationType.Tempo;
    for (const track of score.tracks) for (const staff of track.staves) for (const bar of staff.bars) {
        for (const voice of bar.voices) {
            if (voice.isEmpty) continue;
            const beats = voice.beats.flatMap(beat => {
                for (const a of beat.automations) if (a.type === tempoType) a.value = times(a.value, plan.tempo);
                const chain = scaleBeat(alphaTab, beat, plan.notes);
                if (!chain) failed.add(bar.index);
                else if (beat.notes.length) ties += chain.length - 1;
                return chain ?? [beat];
            });
            voice.beats.splice(0, voice.beats.length, ...beats);
        }
    }
    if (failed.size) problems.push(`${barList(failed)}: Notenwerte lassen sich so nicht umrechnen (Triolen oder kürzer `
        + 'als eine Vierundsechzigstel).');

    // Wo jeder alte Takt landet: neuer Takt, Abschnitt und Abstand vom Anfang des neuen Takts.
    /** @type {{k: number, seg: Segment, offset: number}[][]} */
    const places = info.map(() => []);
    layout.forEach((nb, k) => {
        let offset = 0;
        for (const seg of nb.segments) {
            places[seg.bar].push({k, seg, offset});
            offset += seg.length;
        }
    });
    /**
     * Neuer Takt und Stelle darin zu einer Stelle in einem alten Takt.
     * @param {number} i alter Takt
     * @param {number} tick Stelle (umgerechnet)
     * @returns {{k: number, offset: number, last: boolean}}
     */
    const locate = (i, tick) => {
        const place = places[i].findLast(p => p.seg.from <= tick + 1e-6) ?? places[i][0];
        const nb = layout[place.k];
        return {
            k: place.k, offset: place.offset + tick - place.seg.from,
            last: place.seg === nb.segments.at(-1) && place.seg.to === Infinity && !nb.pad
        };
    };
    const lengthOf = nb => nb.anacrusis ? nb.segments.reduce((sum, s) => sum + s.length, 0)
        : WHOLE_TICKS * nb.ts.num / nb.ts.den;

    // Neue Takte (MasterBar): der erste Abschnitt ab dem Anfang eines alten Takts übernimmt dessen Objekt (daran hängen
    // die Tab-Stellen des Leadsheets).
    const used = new Set();
    const reuse = layout.map(nb => {
        const s = nb.segments[0];
        const take = s.from === 0 && !used.has(s.bar);
        if (take) used.add(s.bar);
        return take;
    });
    const shuffle = !sameRatio(plan.notes, [1, 1]) && info.some(bar => bar.feel) ? shuffleHint(alphaTab, plan.notes)
        : '';
    const masterBars = layout.map((nb, k) => {
        const src = info[nb.segments[0].bar];
        const mb = reuse[k] ? old[nb.segments[0].bar] : new alphaTab.model.MasterBar();
        if (!reuse[k]) {
            mb.score = score;
            mb.isFreeTime = old[nb.segments[0].bar].isFreeTime;
        }
        mb.timeSignatureNumerator = nb.ts.num;
        mb.timeSignatureDenominator = nb.ts.den;
        mb.timeSignatureCommon = false;
        mb.isAnacrusis = nb.anacrusis;
        mb.tripletFeel = src.feel;
        mb.section = null;
        mb.isRepeatStart = false;
        mb.repeatCount = 0;
        mb.alternateEndings = 0;
        mb.isDoubleBar = false;
        mb.directions = null;
        mb.fermata = null;
        mb.tempoAutomations = [];
        mb.syncPoints = undefined;
        return mb;
    });
    const moved = [];
    const notAtStart = [];
    const notAtEnd = [];
    info.forEach((bar, i) => {
        const start = locate(i, 0);
        const mb = masterBars[start.k];
        const atStart = start.offset < 1e-6;
        if (bar.section) {
            if (atStart || !mb.section) mb.section = bar.section;
            else problems.push(`Takt ${i + 1}: Abschnitt „${bar.section.text}“ landet in einem Takt mit einem `
                + 'anderen.');
            if (!atStart) moved.push(`„${bar.section.text}“`);
        }
        if (bar.repeatStart || bar.endings) {
            if (atStart) {
                mb.isRepeatStart ||= bar.repeatStart;
                mb.alternateEndings ||= bar.endings;
            } else notAtStart.push(i);
        }
        if (bar.directions) mb.directions = bar.directions;
        const end = locate(i, Infinity);
        if (bar.repeatCount) {
            if (end.last) masterBars[end.k].repeatCount = bar.repeatCount;
            else notAtEnd.push(i);
        }
        if (bar.doubleBar && end.last) masterBars[end.k].isDoubleBar = true;
        for (const {item, tick} of bar.sync) {
            const at = locate(i, times(tick, plan.notes));
            item.ratioPosition = at.offset / lengthOf(layout[at.k]);
            masterBars[at.k].addSyncPoint(item);
        }
        for (const {item, tick} of bar.tempo) {
            const at = locate(i, times(tick, plan.notes));
            item.ratioPosition = at.offset / lengthOf(layout[at.k]);
            item.value = times(item.value, plan.tempo);
            masterBars[at.k].tempoAutomations.push(item);
        }
        for (const [offset, fermata] of bar.fermata) {
            const at = locate(i, times(offset, plan.notes));
            masterBars[at.k].addFermata(at.offset, fermata);
        }
    });
    if (moved.length) {
        warnings.push(`Abschnitt ${moved.join(', ')} beginnt jetzt am Anfang des zusammengefassten Takts.`);
    }
    if (notAtStart.length) problems.push(`${barList(notAtStart)}: Wiederholung beginnt mitten in einem Takt.`);
    if (notAtEnd.length) problems.push(`${barList(notAtEnd)}: Wiederholung endet mitten in einem Takt.`);

    // Takte der Spuren: Schläge an den Grenzen schneiden, in die neuen Takte verteilen.
    const {BarLineStyle, SimileMark} = alphaTab.model;
    const cutFailed = new Set();
    const overfull = new Set();
    const unfilled = new Set();
    /**
     * Pausen über eine Länge; geht das nicht, ein Problem am alten Takt.
     * @param {number} ticks Länge
     * @param {number} i alter Takt
     * @returns {Beat[]}
     */
    const rests = (ticks, i) => {
        const beats = restBeats(alphaTab, ticks);
        if (!beats) unfilled.add(i);
        return beats ?? [];
    };
    for (const track of score.tracks) for (const staff of track.staves) {
        const oldBars = staff.bars.slice();
        const pieces = oldBars.map((bar, i) => {
            const cuts = places[i].map(p => p.seg.from).filter(c => c > 0);
            return bar.voices.map(voice => {
                if (voice.isEmpty) return null;
                const cut = cutEntries(alphaTab, timeline(voice), cuts);
                if (!cut) cutFailed.add(i);
                return cut ?? timeline(voice);
            });
        });
        const bars = layout.map((nb, k) => {
            const first = nb.segments[0];
            const src = oldBars[first.bar];
            const lastSeg = nb.segments.at(-1);
            const bar = reuse[k] ? src : new alphaTab.model.Bar();
            if (!reuse[k]) {
                bar.staff = staff;
                bar.clef = src.clef;
                bar.clefOttava = src.clefOttava;
                bar.keySignature = src.keySignature;
                bar.keySignatureType = src.keySignatureType;
            }
            bar.barLineLeft = first.from === 0 ? src.barLineLeft : BarLineStyle.Automatic;
            bar.barLineRight = lastSeg.to === Infinity && !nb.pad ? oldBars[lastSeg.bar].barLineRight
                : BarLineStyle.Automatic;
            if (nb.segments.length > 1 || first.from > 0 || lastSeg.to !== Infinity) {
                bar.simileMark = SimileMark.None;
                bar.sustainPedals = [];
            }
            const voiceCount = Math.max(...nb.segments.map(s => pieces[s.bar].length));
            /** @type {Beat[][]} */
            const voices = [];
            for (let v = 0; v < voiceCount; v++) {
                const parts = nb.segments.map(s => pieces[s.bar][v] ?? null);
                if (parts.every(p => !p)) {
                    voices.push(null);
                    continue;
                }
                /** @type {Beat[]} */
                const beats = [];
                nb.segments.forEach((s, n) => {
                    // Stimme, die in diesem alten Takt leer ist, zwischen anderen mit Inhalt: Pausen.
                    if (!parts[n]) {
                        beats.push(...rests(s.length, s.bar));
                        return;
                    }
                    const own = parts[n].filter(e => e.start >= s.from - 1e-6
                        && (s.to === Infinity || e.start < s.to - 1e-6));
                    beats.push(...own.map(e => e.beat));
                    const filled = own.length ? own.at(-1).end - s.from : 0;
                    const following = n < nb.segments.length - 1 || nb.pad > 0;
                    if (!following) return;
                    if (filled > s.length + 1e-6) overfull.add(s.bar);
                    else if (filled < s.length - 1e-6) beats.push(...rests(s.length - filled, s.bar));
                });
                if (nb.pad) beats.push(...rests(nb.pad, lastSeg.bar));
                voices.push(beats);
            }
            bar.voices = [];
            voices.forEach((beats, v) => {
                if (!beats && v > 0) return;
                const voice = new alphaTab.model.Voice();
                bar.addVoice(voice);
                if (!beats) {
                    const empty = new alphaTab.model.Beat();
                    empty.duration = alphaTab.model.Duration.Whole;
                    empty.isEmpty = true;
                    voice.addBeat(empty);
                } else {
                    for (const beat of beats) voice.addBeat(beat);
                }
            });
            return bar;
        });
        staff.bars.splice(0, staff.bars.length, ...bars);
    }
    if (cutFailed.size) problems.push(`${barList(cutFailed)}: Eine Triole liegt über der neuen Taktgrenze.`);
    if (overfull.size) problems.push(`${barList(overfull)}: Der Takt ist zu voll und lässt sich nicht anhängen.`);
    if (unfilled.size) problems.push(`${barList(unfilled)}: Die Lücke lässt sich nicht mit Pausen füllen.`);
    if (problems.length) return {problems, warnings, ties, shuffle};

    score.masterBars.splice(0, score.masterBars.length, ...masterBars);
    relinkBars(score);
    // Neue Takte gelten bis finish() als leer, und der Exporter ließe sie aus. Nur das ganze Stück verkettet die
    // Schläge über die Taktgrenzen (sonst finden angebundene Noten ihren Anfang nicht).
    score.finish(new alphaTab.Settings());
    // Ohne Tempoangabe am Anfang gilt das Standardtempo: umgerechnet als Angabe setzen.
    const first = masterBars[0];
    if (!sameRatio(plan.tempo, [1, 1]) && !first.tempoAutomations.some(a => a.ratioPosition === 0)) {
        first.tempoAutomations.unshift(alphaTab.model.Automation.buildTempoAutomation(false, 0,
            times(songTempo, plan.tempo), 2));
    }
    return {problems, warnings, ties, shuffle};
}

/**
 * Notenwert eines Schlags als Schlüssel und Anzeige.
 * @param {Beat} beat Schlag
 * @returns {{key: string, ticks: number, html: string, name: string}}
 */
function valueOf(beat) {
    const tuplet = beat.hasTuplet ? `${beat.tupletNumerator}:${beat.tupletDenominator}` : '';
    const dots = beat.dots;
    const name = `${['', 'punktierte ', 'doppelt punktierte '][dots]}${VALUE_NAMES[beat.duration] ?? beat.duration}`
        + (tuplet ? (tuplet === '3:2' ? '-Triole' : ` (${tuplet})`) : '');
    const sign = VALUE_GLYPHS[beat.duration];
    const html = (sign ? glyph(sign + GLYPHS.dot.repeat(dots)) : escapeHtml(`1/${beat.duration}`))
        + (tuplet ? `<sup>${tuplet === '3:2' ? '3' : escapeHtml(tuplet)}</sup>` : '');
    return {key: `${beat.duration}.${dots}.${tuplet}`, ticks: beatTicks(beat), html, name};
}

/**
 * Notenwerte, die im Song vorkommen (Noten und Pausen, ohne Vorschläge), längste zuerst.
 * @param {Score} score Noten
 * @returns {string} HTML
 */
function songValues(score) {
    /** @type {Map<string, {html: string, name: string, ticks: number}>} */
    const found = new Map();
    for (const track of score.tracks) for (const staff of track.staves) for (const bar of staff.bars) {
        for (const voice of bar.voices) {
            if (voice.isEmpty) continue;
            for (const beat of voice.beats) {
                if (beat.graceType || beat.isEmpty) continue;
                const value = valueOf(beat);
                if (!found.has(value.key)) found.set(value.key, value);
            }
        }
    }
    return [...found.values()].sort((a, b) => b.ticks - a.ticks)
        .map(v => `<span class="tm-value" title="${escapeHtml(v.name)}">${v.html}</span>`).join('');
}

/**
 * Taktarten nach Häufigkeit (ohne Auftakt), die häufigste zuerst.
 * @param {Score} score Noten
 * @returns {TimeSig[]}
 */
function timeSignatures(score) {
    /** @type {Map<string, number>} */
    const counts = new Map();
    for (const mb of score.masterBars) {
        if (mb.isAnacrusis) continue;
        const key = `${mb.timeSignatureNumerator}/${mb.timeSignatureDenominator}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const keys = [...counts].sort((a, b) => b[1] - a[1]).map(([key]) => key);
    return (keys.length ? keys : ['4/4']).map(key => {
        const [num, den] = key.split('/').map(Number);
        return {num, den};
    });
}

/**
 * Häufigste Taktart (ohne Auftakt).
 * @param {Score} score Noten
 * @returns {TimeSig}
 */
function mainTimeSignature(score) {
    return timeSignatures(score)[0];
}

/**
 * Stück des Songs für die Vorschau, das vorher und nachher an einer Taktgrenze beginnt und endet: ein alter Takt mit
 * den Takten, in die er geteilt wird, bzw. die alten Takte, die zu einem zusammengefasst werden. Stellen in Ticks der
 * Noten vorher.
 * @typedef {{from: number, to: number, old: number[], fresh: number[]}} PreviewUnit
 */

/**
 * Teilt den Song in Stücke für die Vorschau (PreviewUnit).
 * @param {Score} before Noten vorher
 * @param {Score} after Noten nachher
 * @param {Ratio} notes Faktor der Notenwerte (rechnet die Ticks nachher auf vorher zurück)
 * @returns {PreviewUnit[]}
 */
function previewUnits(before, after, notes) {
    const toOld = t => t * notes[1] / notes[0];
    const near = (a, b) => Math.abs(a - b) < 1;
    const freshStarts = after.masterBars.map(mb => toOld(mb.start));
    const last = before.masterBars.at(-1);
    const bounds = before.masterBars.map(mb => mb.start).filter(s => freshStarts.some(n => near(n, s)));
    bounds.push(last.start + last.calculateDuration());
    const inside = (t, from, to) => t > from - 0.5 && t < to - 0.5;
    return bounds.slice(0, -1).map((from, k) => {
        const to = bounds[k + 1];
        return {
            from, to,
            old: before.masterBars.filter(mb => inside(mb.start, from, to)).map(mb => mb.index),
            fresh: after.masterBars.filter((mb, j) => inside(freshStarts[j], from, to)).map(mb => mb.index),
        };
    });
}

/**
 * Pattern je Takt einer Spur (analyzeRhythm(); Takte ohne Anschlag haben ein leeres).
 * @param {Score} score Noten
 * @param {number} track Spur
 * @returns {Map<number, import('./sheet.js').Pattern>}
 */
function barPatterns(score, track) {
    return new Map(analyzeRhythm(score, track).flatMap(row => [...row.bars].map(bar => [bar, row.pattern])));
}

/**
 * Ein Rhythmus der Vorschau: Stücke des Songs mit denselben Anschlagstellen (Richtung, Betonung und Akkorde zählen
 * nicht).
 * @typedef {Object} UnitGroup
 * @property {PreviewUnit} unit Stück, das gezeigt wird (eins mit allen Anschlagstellen)
 * @property {PreviewUnit[]} units alle Stücke
 * @property {Set<number>} hits Anschlagstellen (Ticks vorher ab Anfang des Stücks)
 * @property {string} shape Taktarten und Längen der Takte (nur bei gleicher Form vergleichbar)
 * @property {number} bars Zahl der Takte vorher
 */

/**
 * Fasst die Stücke zu Rhythmen zusammen: gleiche Anschlagstellen sind ein Rhythmus. Fehlen einem Rhythmus gegenüber
 * einem anderen nur Anschläge (alle seine Stellen hat auch der andere), zählt er zum häufigsten solchen. Stücke ohne
 * Anschlag fallen weg.
 * @param {PreviewUnit[]} units Stücke (previewUnits())
 * @param {Score} score Noten vorher
 * @param {Map<number, import('./sheet.js').Pattern>} patterns Pattern je Takt vorher (barPatterns())
 * @returns {UnitGroup[]} häufigste zuerst
 */
function groupUnits(units, score, patterns) {
    /** @type {Map<string, UnitGroup>} */
    const groups = new Map();
    for (const unit of units) {
        /** @type {Set<number>} */
        const hits = new Set();
        const shape = [];
        for (const i of unit.old) {
            const mb = score.masterBars[i];
            const pattern = patterns.get(i);
            const length = Math.round(mb.calculateDuration());
            shape.push(`${mb.timeSignatureNumerator}/${mb.timeSignatureDenominator}:${length}`);
            if (!pattern) continue;
            const slot = WHOLE_TICKS / pattern.grid;
            [...pattern.strokes].forEach((t, k) => {
                if (t !== '.') hits.add(Math.round(mb.start - unit.from + k * slot));
            });
        }
        if (!hits.size) continue;
        const form = `${shape.join(' ')}|${unit.fresh.length}`;
        const key = `${form}|${[...hits].sort((a, b) => a - b).join(',')}`;
        const group = groups.get(key) ?? {unit, units: [], hits, shape: form, bars: 0};
        group.units.push(unit);
        group.bars += unit.old.length;
        groups.set(key, group);
    }
    /** @type {UnitGroup[]} */
    const kept = [];
    const bySize = [...groups.values()].sort((a, b) => b.hits.size - a.hits.size || b.units.length - a.units.length);
    for (const group of bySize) {
        const target = kept.filter(k => k.shape === group.shape && [...group.hits].every(h => k.hits.has(h)))
            .sort((a, b) => b.units.length - a.units.length)[0];
        if (target) {
            target.units.push(...group.units);
            target.bars += group.bars;
        } else {
            kept.push(group);
        }
    }
    return kept.sort((a, b) => b.units.length - a.units.length || a.unit.from - b.unit.from);
}

/**
 * Akkorde über einem Rhythmus: am Anfang und an jeder Stelle, an der in einem seiner Stücke ein Akkord wechselt, der
 * Akkord vom ersten Vorkommen dort (am Anfang der dort klingende). Es können mehr Wechsel sein als in einem Takt.
 * @param {UnitGroup} group Rhythmus
 * @param {{tick: number, name: string}[]} events Akkordwechsel (chordTimeline() der Noten vorher)
 * @returns {{offset: number, name: string}[]} Stelle in Ticks vorher ab Anfang des Stücks
 */
function groupChords(group, events) {
    const units = [...group.units].sort((a, b) => a.from - b.from);
    /** @type {Map<number, string>} */
    const chords = new Map();
    for (const unit of units) {
        const sounding = events.findLast(e => e.tick <= unit.from + 0.5);
        if (sounding && !chords.has(0)) chords.set(0, sounding.name);
        for (const e of events) {
            const offset = Math.round(e.tick - unit.from);
            if (e.tick > unit.from + 0.5 && e.tick < unit.to - 0.5 && !chords.has(offset)) chords.set(offset, e.name);
        }
    }
    return [...chords].map(([offset, name]) => ({offset, name}));
}

/**
 * Zeichen eines Anschlags im Raster: Plektrumzeichen wie in den Noten, gedämpft ×.
 * @param {string} token Zeichen des Patterns (d, u, x, ., groß = betont)
 * @returns {string} HTML
 */
function strokeSign(token) {
    const t = token.toLowerCase();
    return t === 'd' ? glyph(GLYPHS.pickDown, true, 'smufl-pickdown') : t === 'u'
        ? glyph(GLYPHS.pickUp, true, 'smufl-pickup') : t === 'x' ? '×' : '';
}

/**
 * Ein Takt in einer Zeile der Vorschau.
 * @typedef {Object} LaneBar
 * @property {?import('./sheet.js').Pattern} pattern Pattern (null: ohne Raster)
 * @property {TimeSig} ts Taktart (Zählzeiten, Schläge des Metronoms)
 * @property {number} den Nenner der Taktart (für die Zählzeiten)
 * @property {number} factor Ticks vorher je eigenem Tick (1 bzw. Kehrwert des Faktors der Notenwerte)
 * @property {number} length Länge in Ticks vorher
 * @property {number} slot Länge eines Rasterplatzes in Ticks vorher
 * @property {number} slotTicks Länge eines Rasterplatzes in eigenen Ticks (für die Zählzeiten)
 */

/**
 * Größter gemeinsamer Teiler.
 * @param {number} a ganze Zahl
 * @param {number} b ganze Zahl
 * @returns {number}
 */
const gcd = (a, b) => b ? gcd(b, a % b) : a;

/**
 * Feinstes gemeinsames Raster einer Vorschau: größter gemeinsamer Teiler aller Rasterplätze und Taktlängen.
 * @param {LaneBar[]} bars Takte beider Zeilen
 * @returns {number} Ticks vorher
 */
function laneStep(bars) {
    return bars.reduce((step, bar) => gcd(gcd(step, Math.round(bar.length)), Math.round(bar.pattern ? bar.slot
        : bar.length)), 0) || 1;
}

/**
 * Zeile "Jetzt" bzw. "Danach" eines Rhythmus: Akkorde, Betonungen, Anschläge und Zählzeiten. Die Spalten sind das
 * feinste gemeinsame Raster beider Zeilen (punktierte Linien, Taktstriche durchgezogen); jedes Zeichen steht am
 * Anfang seiner Dauer, so steht gleichzeitig Gespieltes untereinander.
 * @param {string} label "Jetzt" oder "Danach"
 * @param {LaneBar[]} bars Takte
 * @param {{offset: number, name: string}[]} chords Akkorde mit Stelle (Ticks vorher ab Anfang des Stücks)
 * @param {number} step Breite einer Spalte in Ticks vorher (laneStep())
 * @param {number} scale Pixel je Tick vorher
 * @returns {string} HTML
 */
function laneHtml(label, bars, chords, step, scale) {
    const total = Math.round(bars.reduce((sum, bar) => sum + bar.length, 0) / step);
    /** @type {{token: string, count: string, chord: string, bar: boolean}[]} */
    const cells = Array.from({length: total}, () => ({token: '.', count: '', chord: '', bar: false}));
    let at = 0;
    for (const bar of bars) {
        const first = Math.round(at / step);
        if (cells[first]) cells[first].bar = true;
        if (bar.pattern) {
            const slots = Math.min(bar.pattern.strokes.length, Math.round(bar.length / bar.slot));
            for (let k = 0; k < slots; k++) {
                const cell = cells[Math.round((at + k * bar.slot) / step)];
                if (!cell) continue;
                cell.token = bar.pattern.strokes[k];
                // "2+" → "+", "3e" → "e": Zwischen den Zählzeiten steht nur das Zeichen.
                cell.count = countAt(k * bar.slotTicks, bar.den).replace(/^\d+(?=\D)/, '');
            }
        }
        at += bar.length;
    }
    for (const {offset, name} of chords) {
        const cell = cells[Math.floor(offset / step + 1e-6)];
        if (cell) cell.chord = cell.chord ? `${cell.chord} ${name}` : name;
    }
    const row = (kind, content) => cells.map(c => `<span class="tm-${kind}${c.bar ? ' tm-bar' : ''}">${
        content(c)}</span>`).join('');
    return `<span class="tm-label">${escapeHtml(label)}</span>
      <div class="tm-grid" data-total="${total}" style="grid-template-columns:repeat(${total}, ${
        (step * scale).toFixed(2)}px)">
        ${row('chord', c => escapeHtml(c.chord))}
        ${row('accent', c => /[DUX]/.test(c.token) ? '&gt;' : '')}
        ${row('stroke', c => strokeSign(c.token))}
        ${row('count', c => escapeHtml(c.count))}
      </div>`;
}

/**
 * Schläge eines Takts mit ihrer Betonung, nach der Musiklehre: Taktarten mit Dreiergruppen (6/8, 9/8, 12/8, 6/4)
 * haben Schläge zu je drei Zählzeiten, die anderen einen Schlag je Zählzeit. Betont ist die 1; halbstark die 3 im
 * Vierer (4/4), der zweite Schlag im zusammengesetzten Zweier (4 in 6/8) und der dritte im Vierer aus Dreiergruppen
 * (7 in 12/8).
 * @param {TimeSig} ts Taktart
 * @returns {{at: number, level: number}[]} Stelle in Ticks ab Taktanfang; Stufe 3 betont, 2 halbstark, 1 unbetont
 */
function beatAccents(ts) {
    const unit = WHOLE_TICKS / ts.den;
    const three = groupsOfThree(ts.num);
    const count = three ? ts.num / 3 : ts.num;
    return Array.from({length: count}, (_, i) => ({
        at: i * unit * (three ? 3 : 1),
        level: i === 0 ? 3 : count === 4 && i === 2 || three && count === 2 && i === 1 ? 2 : 1,
    }));
}

/**
 * Eine Taktart in Worten: Schläge und Betonung im Takt.
 * @param {TimeSig} ts Taktart
 * @returns {string} z. B. "6/8 (2 Schläge zu je 3 Achteln, betont 1, halbstark 4)"
 */
function describeMeter(ts) {
    const unit = WHOLE_TICKS / ts.den;
    const name = VALUE_NAMES[ts.den] ?? `1/${ts.den}`;
    const beats = beatAccents(ts);
    const counts = level => beats.filter(b => b.level === level).map(b => b.at / unit + 1).join(' und ');
    const kind = groupsOfThree(ts.num) ? `${beats.length} Schläge zu je 3 ${name}n` : `${ts.num} ${name}`;
    const medium = counts(2);
    return `${ts.num}/${ts.den} (${kind}, betont ${counts(3)}${medium ? `, halbstark ${medium}` : ''})`;
}

/**
 * Vergleicht die Betonung im Takt vorher und nachher, relativ zur 1 (wie schnell der Fuß wippt, zählt nicht): gleiche
 * Zahl der Schläge mit gleichen Stufen und gleicher Gruppierung ist gleich. Wechselt die Gruppierung (Zweier- gegen
 * Dreiergruppen, z. B. 6/8 gegen 3/4), ist das eine Warnung (rot), sonst ein Hinweis (gelb, z. B. 4/4 → 2/4).
 * @param {TimeSig} before Taktart vorher
 * @param {TimeSig} after Taktart nachher
 * @returns {?{red: boolean, text: string}} null, wenn die Betonung gleich bleibt
 */
function accentChange(before, after) {
    const shape = ts => `${groupsOfThree(ts.num)}|${beatAccents(ts).map(b => b.level).join('')}`;
    if (shape(before) === shape(after)) return null;
    const red = groupsOfThree(before.num) !== groupsOfThree(after.num);
    const from = describeMeter(before);
    const to = describeMeter(after);
    return {
        red, text: red ? `Die Betonung ändert sich: ${from} → ${to}. Die Schläge sind anders gruppiert.`
            : `Die Betonung im Takt verschiebt sich: ${from} → ${to}.`,
    };
}

/** Übliche Taktarten, die häufigsten zuerst (Varianten mit anderen stehen unten). */
const COMMON_TS = ['4/4', '3/4', '2/4', '6/8', '12/8', '2/2', '9/8', '3/8', '6/4', '3/2', '5/4', '7/8'];

/** Faktoren für die Takte. @type {Ratio[]} */
const RATIOS = BAR_FACTORS.map(([r]) => r);

/** Faktoren für die Notenwerte. @type {Ratio[]} */
const NOTE_RATIOS = FACTORS.map(([r]) => r);

/**
 * Eine Variante, die gleich klingt: Notenwerte (das Tempo ändert sich mit), Takte und Taktart.
 * @typedef {{notes: Ratio, bars: Ratio, ts: TimeSig}} Variant
 */

/**
 * Rang einer Taktart: übliche nach COMMON_TS, die anderen dahinter.
 * @param {TimeSig} ts Taktart
 * @returns {number}
 */
function tsRank(ts) {
    const i = COMMON_TS.indexOf(`${ts.num}/${ts.den}`);
    return i < 0 ? COMMON_TS.length : i;
}

/**
 * Alle Varianten, die gleich klingen und etwas ändern: jede Kombination aus Notenwerten und Takten mit jeder
 * Taktart, die zur neuen Taktlänge passt (Zähler 2 bis 12, Nenner ab 2 bis 8 bzw. bis zum Nenner des Songs).
 * @param {TimeSig} main häufigste Taktart des Songs
 * @returns {Variant[]}
 */
function allVariants(main) {
    /** @type {Variant[]} */
    const out = [];
    for (const notes of NOTE_RATIOS) {
        for (const bars of RATIOS) {
            for (const ts of timeSignatureOptions(main, lengthRatio({notes, bars, tempo: notes, denFactor: 1}))) {
                if (ts.num < 2 || ts.num > 12 || ts.den < 2 || ts.den > Math.max(8, main.den)) continue;
                if (sameRatio(notes, [1, 1]) && sameRatio(bars, [1, 1]) && ts.num === main.num && ts.den === main.den) {
                    continue;
                }
                out.push({notes, bars, ts});
            }
        }
    }
    const distance = v => Math.abs(Math.log(v.notes[0] / v.notes[1])) + Math.abs(Math.log(v.bars[0] / v.bars[1]));
    return out.sort((a, b) => tsRank(a.ts) - tsRank(b.ts) || distance(a) - distance(b) || a.ts.den - b.ts.den);
}

/** Reiter des Dialogs: Schlüssel, Bezeichnung, Feld. */
const TABS = [['notes', 'Notenwerte ändern', 'Notenwerte'], ['ts', 'Taktart ändern', 'Neue Taktart'],
    ['bars', 'Taktanzahl ändern', 'Takte']];

/**
 * Bezeichnung eines Faktors der Notenwerte, z. B. "halbieren".
 * @param {Ratio} ratio Faktor
 * @returns {string}
 */
const notesLabel = ratio => FACTORS.find(([r]) => sameRatio(r, ratio))?.[1] ?? '';

/**
 * Was beim Abspielen einer Zeile der Vorschau klingt: die Schläge des Metronoms mit Betonung (beatAccents()) und die
 * Anschläge des Patterns.
 * @param {LaneBar[]} bars Takte der Zeile
 * @returns {{clicks: {at: number, level: number}[], strokes: {at: number, token: string}[], length: number}} Stellen in
 *   Ticks vorher ab Anfang der Zeile
 */
function laneEvents(bars) {
    const clicks = [];
    const strokes = [];
    let at = 0;
    for (const bar of bars) {
        for (const beat of beatAccents(bar.ts)) {
            const offset = beat.at * bar.factor;
            if (offset < bar.length - 1e-6) clicks.push({at: at + offset, level: beat.level});
        }
        [...bar.pattern?.strokes ?? ''].forEach((token, k) => {
            if (token !== '.' && k * bar.slot < bar.length - 1e-6) strokes.push({at: at + k * bar.slot, token});
        });
        at += bar.length;
    }
    return {clicks, strokes, length: at};
}

/** Pause zwischen "Jetzt" und "Danach" beim Abspielen (s). */
const PLAY_GAP = 0.8;

/**
 * Klick des Metronoms: kurzer Ton, betonte Schläge höher und lauter.
 * @param {AudioContext} ctx Audio
 * @param {number} time Zeitpunkt (s, Zeit des AudioContext)
 * @param {number} level Betonung (3 betont, 2 halbstark, 1 unbetont)
 * @returns {void}
 */
function playClick(ctx, time, level) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = [0, 900, 1250, 1700][level];
    gain.gain.setValueAtTime([0, .25, .35, .5][level], time);
    gain.gain.exponentialRampToValueAtTime(.001, time + .05);
    osc.connect(gain).connect(ctx.destination);
    osc.start(time);
    osc.stop(time + .06);
}

/**
 * Anschlag: kurzes gefiltertes Rauschen, ab tiefer als auf, betont lauter, gedämpft kürzer.
 * @param {AudioContext} ctx Audio
 * @param {AudioBuffer} noise Rauschen (0,1 s)
 * @param {number} time Zeitpunkt (s, Zeit des AudioContext)
 * @param {string} token Zeichen des Patterns (d, u, x; groß = betont)
 * @returns {void}
 */
function playStroke(ctx, noise, time, token) {
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    source.buffer = noise;
    filter.type = 'bandpass';
    filter.frequency.value = token.toLowerCase() === 'u' ? 2600 : 1300;
    const peak = token === token.toUpperCase() ? .9 : .5;
    gain.gain.setValueAtTime(peak, time);
    gain.gain.exponentialRampToValueAtTime(.001, time + (token.toLowerCase() === 'x' ? .03 : .09));
    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(time);
}

/**
 * Dialog "Metrum umschreiben" eines NoteEditor.
 */
export class TimingDialog {
    /**
     * @param {import('./editor.js').NoteEditor} editor Bearbeitungsmodus
     */
    constructor(editor) {
        this.editor = editor;
        this.alphaTab = editor.alphaTab;
        /** Zeitgeber der Vorschau. */
        this.timer = 0;
        /** Zähler der Vorschauen: Nur die jüngste zeichnet. */
        this.run = 0;
        /** Noten vorher. @type {Score} */
        this.before = parseScore(this.alphaTab, editor.tex);
        /** Häufigste Taktart vorher. */
        this.mainTs = mainTimeSignature(this.before);
        /** Spur, deren Rhythmen die Vorschau zeigt: die Akkordspur. */
        this.track = this.before.tracks.indexOf(chordsTrack(this.before) ?? this.before.tracks[0]);
        /** Alle Varianten, die gleich klingen. */
        this.variants = allVariants(this.mainTs);
        /** Gewählter Reiter. */
        this.tab = 'notes';
        /** Varianten des gewählten Reiters und der gewählten Auswahl. @type {Variant[]} */
        this.shown = [];
        /** Gewählte Variante. @type {?Variant} */
        this.variant = null;
        /** Ob die gewählte Variante ohne Probleme umrechenbar ist. */
        this.valid = false;
        /** Gezeigter Rhythmus (Reiter in der Vorschau). */
        this.rhythm = 0;
        /** Zuletzt gezeigte Vorschau (für den Wechsel des Rhythmus). @type {{after: ?Score, plan: Retime}} */
        this.last = {after: this.before, plan: {notes: [1, 1], tempo: [1, 1], bars: [1, 1], denFactor: 1}};
        /** Was der gezeigte Rhythmus beim Abspielen braucht. @type {?{msPerTick: number, lanes: Object[]}} */
        this.playback = null;
        /** Audio für das Metronom (erst beim ersten Abspielen). @type {?AudioContext} */
        this.audio = null;
        /** Laufendes Abspielen. @type {?{start: number, frame: number, cell: ?HTMLElement[]}} */
        this.playing = null;
    }

    /**
     * Öffnet den Dialog, gleich mit fertiger Vorschau (sonst springt er beim Öffnen in der Breite).
     * @returns {void}
     */
    open() {
        const identity = {notes: [1, 1], tempo: [1, 1], bars: [1, 1], denFactor: 1};
        openOverlay(`<h2>Metrum umschreiben</h2>
      <div class="tp tm">
        <div class="tp-inputs">
        <div class="upl-tabs tm-tabs" role="tablist">${TABS.map(([key, label]) => `<button type="button" role="tab"
          data-tm-tab="${key}" aria-selected="${key === this.tab}">${escapeHtml(label)}</button>`).join('')}</div>
        <div class="form-field"><label for="tmChoice" id="tmChoiceLabel"></label><select id="tmChoice"></select></div>
        <div id="tmVariants"></div>
        </div>
        <div class="tp-preview" id="tmPreview">${this.previewHtml(this.before, identity)}</div>
      </div>
      <div class="tp-warn tm-warn" id="tmWarn" aria-live="polite"></div>
      <div class="struct-actions">
        <button class="btn btn-primary" type="button" id="tmApply" disabled>Anwenden</button>
        <button class="btn" type="button" id="tmCancel">Abbrechen</button>
      </div>`);
        const root = /** @type {HTMLElement} */ (document.querySelector('.sheet .tm'));
        root.addEventListener('click', e => {
            const tab = /** @type {?HTMLElement} */ (/** @type {HTMLElement} */ (e.target).closest('[data-tm-tab]'));
            if (tab) {
                this.tab = tab.dataset.tmTab;
                for (const b of root.querySelectorAll('[data-tm-tab]')) {
                    b.setAttribute('aria-selected', String(b === tab));
                }
                this.fillChoice();
                this.choose();
            }
            const row = /** @type {?HTMLElement} */ (/** @type {HTMLElement} */ (e.target).closest('[data-variant]'));
            if (row) this.select(Number(row.dataset.variant));
            const rhythm = /** @type {?HTMLElement} */ (/** @type {HTMLElement} */ (e.target)
                .closest('[data-tm-rhythm]'));
            if (rhythm) {
                this.stop();
                this.rhythm = Number(rhythm.dataset.tmRhythm);
                document.getElementById('tmPreview').innerHTML = this.previewHtml(this.last.after, this.last.plan);
            }
            if (/** @type {HTMLElement} */ (e.target).closest('[data-tm-play]')) {
                if (this.playing) this.stop();
                else this.play();
            }
        });
        document.getElementById('tmChoice').addEventListener('change', () => this.choose());
        document.getElementById('tmCancel').addEventListener('click', () => {
            this.stop();
            closeOverlay();
        });
        document.getElementById('tmApply').addEventListener('click', () => this.apply());
        this.fillChoice();
    }

    /**
     * Spielt den gezeigten Rhythmus ab: erst "Jetzt", nach einer kurzen Pause "Danach", je mit Metronom (betonte
     * Schläge höher) und Anschlägen; die Spalte, die gerade klingt, ist in beiden Zeilen markiert. Das Tempo ist das
     * des Songs an dieser Stelle (beide klingen gleich schnell).
     * @returns {void}
     */
    play() {
        if (!this.playback) return;
        this.audio ??= new AudioContext();
        const ctx = this.audio;
        void ctx.resume();
        const noise = ctx.createBuffer(1, ctx.sampleRate / 10, ctx.sampleRate);
        noise.getChannelData(0).forEach((_, i, data) => {
            data[i] = Math.random() * 2 - 1;
        });
        const {msPerTick, lanes} = this.playback;
        const seconds = ticks => ticks * msPerTick / 1000;
        const start = ctx.currentTime + .15;
        const offsets = [0, seconds(lanes[0].length) + PLAY_GAP];
        lanes.forEach((lane, n) => {
            for (const {at, level} of lane.clicks) playClick(ctx, start + offsets[n] + seconds(at), level);
            for (const {at, token} of lane.strokes) playStroke(ctx, noise, start + offsets[n] + seconds(at), token);
        });
        const end = offsets[1] + seconds(lanes[1].length);
        const grids = [...document.querySelectorAll('#tmPreview .tm-grid')];
        const button = document.querySelector('[data-tm-play]');
        if (button) button.textContent = '■ Stopp';
        this.playing = {start, frame: 0, cell: null};
        const tick = () => {
            if (!this.playing || !grids[0]?.isConnected) {
                this.stop();
                return;
            }
            const t = ctx.currentTime - start;
            if (t > end) {
                this.stop();
                return;
            }
            const n = t >= offsets[1] ? 1 : 0;
            const ticks = (t - offsets[n]) * 1000 / msPerTick;
            const grid = grids[n];
            const total = Number(grid.dataset.total);
            const index = ticks >= 0 && ticks < lanes[n].length ? Math.floor(ticks / lanes[n].length * total) : -1;
            const cells = index < 0 ? [] : [0, 1, 2, 3].map(r => grid.children[r * total + index]);
            if (this.playing.cell?.[0] !== cells[0]) {
                for (const c of this.playing.cell ?? []) c.classList.remove('tm-now');
                for (const c of cells) c.classList.add('tm-now');
                this.playing.cell = cells;
            }
            this.playing.frame = requestAnimationFrame(tick);
        };
        this.playing.frame = requestAnimationFrame(tick);
    }

    /**
     * Hält das Abspielen an (Klänge, Markierung, Knopf).
     * @returns {void}
     */
    stop() {
        if (!this.playing) return;
        cancelAnimationFrame(this.playing.frame);
        for (const c of this.playing.cell ?? []) c.classList.remove('tm-now');
        this.playing = null;
        // Schon geplante Klänge verstummen nur mit dem Audio selbst; beim nächsten Abspielen entsteht es neu.
        void this.audio?.close();
        this.audio = null;
        const button = document.querySelector('[data-tm-play]');
        if (button) button.textContent = '▶ Metronom';
    }

    /**
     * Füllt die Auswahl des Reiters: Faktoren der Notenwerte, Taktarten (die üblichen zuerst) oder Faktoren der Takte;
     * zuerst "bitte wählen".
     * @returns {void}
     */
    fillChoice() {
        const [, , label] = TABS.find(([key]) => key === this.tab);
        document.getElementById('tmChoiceLabel').textContent = label;
        /** @type {[string, string][]} */
        let options;
        if (this.tab === 'notes') {
            // Um die Hälfte verlängert, werden aus Triolen gerade Notenwerte: das zweite Beispiel.
            const triplet = r => sameRatio(r, [3, 2])
                ? `, Achteltriole → ${scaledValueName(this.alphaTab, 8, r, true)}` : '';
            options = FACTORS.filter(([r]) => !sameRatio(r, [1, 1])).map(([r, name]) => [r.join('/'),
                `${name} (Viertel → ${scaledValueName(this.alphaTab, 4, r)}${triplet(r)})`]);
        } else if (this.tab === 'bars') {
            options = BAR_FACTORS.filter(([r]) => !sameRatio(r, [1, 1])).map(([r, name]) => [r.join('/'), name]);
        } else {
            const all = new Map(this.variants.map(v => [`${v.ts.num}/${v.ts.den}`, v.ts]));
            all.delete(`${this.mainTs.num}/${this.mainTs.den}`);
            options = [...all].sort((a, b) => tsRank(a[1]) - tsRank(b[1]) || a[1].den - b[1].den)
                .map(([key]) => [key, key]);
        }
        document.getElementById('tmChoice').innerHTML = '<option value="">bitte wählen</option>'
            + options.map(([value, text]) => `<option value="${value}">${escapeHtml(text)}</option>`).join('');
    }

    /**
     * Nach einer Auswahl: die passenden Varianten als Tabelle, die erste umrechenbare gewählt.
     * @returns {void}
     */
    choose() {
        const value = /** @type {HTMLSelectElement} */ (document.getElementById('tmChoice')).value;
        const [p, q] = value.split('/').map(Number);
        this.shown = !value ? [] : this.variants.filter(v => this.tab === 'notes' ? sameRatio(v.notes, [p, q])
            : this.tab === 'bars' ? sameRatio(v.bars, [p, q]) : v.ts.num === p && v.ts.den === q);
        // Zuerst die naheliegende: Notenwerte geändert → übliche Taktart (die bisherige vorn); Takte geändert → gleiche
        // Notenwerte; Taktart geändert → gleiche Taktzahl.
        const away = r => Math.abs(Math.log(r[0] / r[1]));
        const same = ts => ts.num === this.mainTs.num && ts.den === this.mainTs.den ? -1 : 0;
        /** @type {function(Variant): number[]} */
        const order = this.tab === 'notes' ? v => [tsRank(v.ts) + same(v.ts), away(v.bars)]
            : this.tab === 'bars' ? v => [away(v.notes), tsRank(v.ts)] : v => [away(v.bars), away(v.notes)];
        this.shown.sort((a, b) => {
            const [x, y] = [order(a), order(b)];
            return x[0] - y[0] || x[1] - y[1];
        });
        const tempo = tempoAt(this.before, 0);
        const summaries = this.shown.map(v => layoutSummary(this.before, this.plan(v)));
        // Spalten: Taktart immer, die anderen nur, wenn sie sich zwischen den Varianten unterscheiden.
        /** @type {[string, function(Variant, number): string, boolean][]} Überschrift, Inhalt, rechtsbündig */
        const columns = [
            ['Taktart', v => `${v.ts.num}/${v.ts.den}`, false],
            ['Notenwerte', v => escapeHtml(notesLabel(v.notes)), false],
            ['Tempo', v => `${Math.round(times(tempo, v.notes) * 10) / 10} BPM`, true],
            ['Takte', (v, k) => String(summaries[k].count), true],
        ].filter(([, cell], i) => i === 0 || new Set(this.shown.map((v, k) => cell(v, k))).size > 1);
        const rows = this.shown.map((v, k) => {
            const ok = summaries[k].ok;
            const cells = columns.map(([, cell, right]) => `<td${right ? ' class="tm-num"' : ''}>${cell(v, k)}</td>`);
            return `<tr data-variant="${k}" class="${ok ? '' : 'tm-impossible'}"${ok ? '' : ' title="geht nicht"'}>
              <td><input type="radio" name="tmVariant" aria-label="Variante ${k + 1}"></td>${cells.join('')}</tr>`;
        });
        document.getElementById('tmVariants').innerHTML = rows.length ? `<table class="tm-summary tm-variants"><thead>
          <tr><th></th>${columns.map(([head]) => `<th>${head}</th>`).join('')}</tr></thead>
          <tbody>${rows.join('')}</tbody></table>` : '';
        this.select(summaries.findIndex(s => s.ok));
    }

    /**
     * Wählt eine Variante (-1: keine) und rechnet die Vorschau neu.
     * @param {number} index Zeile in der Tabelle der Varianten
     * @returns {void}
     */
    select(index) {
        this.variant = this.shown[index] ?? null;
        document.querySelectorAll('#tmVariants [data-variant]').forEach((row, k) => {
            row.classList.toggle('tm-chosen', k === index);
            /** @type {HTMLInputElement} */ (row.querySelector('input')).checked = k === index;
        });
        clearTimeout(this.timer);
        this.timer = window.setTimeout(() => this.refresh(), PREVIEW_MS);
    }

    /**
     * Änderung zu einer Variante: Das Tempo ändert sich mit den Notenwerten, so klingt es gleich.
     * @param {Variant} v Variante
     * @returns {Retime}
     */
    plan(v) {
        return {notes: v.notes, tempo: v.notes, bars: v.bars, denFactor: v.ts.den / this.mainTs.den};
    }

    /**
     * Rechnet die gewählte Variante an einer Kopie um und zeichnet Hinweise und Vorschau neu: Probleme, Shuffle und
     * eine geänderte Betonung rot, eine verschobene Betonung gelb, Sonstiges grau.
     * @returns {void}
     */
    refresh() {
        const run = ++this.run;
        const apply = /** @type {?HTMLButtonElement} */ (document.getElementById('tmApply'));
        if (!apply) return;
        this.stop();
        const identity = {notes: [1, 1], tempo: [1, 1], bars: [1, 1], denFactor: 1};
        if (!this.variant) {
            this.valid = false;
            apply.disabled = true;
            document.getElementById('tmWarn').innerHTML = '';
            document.getElementById('tmPreview').innerHTML = this.previewHtml(this.before, identity);
            return;
        }
        const plan = this.plan(this.variant);
        const ed = this.editor;
        const copy = parseScore(this.alphaTab, ed.tex);
        const result = retime(this.alphaTab, copy, plan);
        /** @type {?Score} */
        let after = null;
        if (!result.problems.length) {
            try {
                after = parseScore(this.alphaTab, writeScore(this.alphaTab, copy));
            } catch (err) {
                result.problems.push(`Das Ergebnis lässt sich nicht lesen: ${err.message}`);
            }
        }
        if (run !== this.run) return;
        this.valid = !!after;
        apply.disabled = !this.valid;
        const accent = accentChange(this.mainTs, this.variant.ts);
        const hint = (text, kind = '') => `<div class="hint${kind ? ` ${kind}` : ''}">${escapeHtml(text)}</div>`;
        document.getElementById('tmWarn').innerHTML = [
            ...result.problems.map(p => hint(p, 'hint-warn')),
            ...(result.shuffle ? [hint(result.shuffle, 'hint-warn')] : []),
            ...(accent ? [hint(accent.text, accent.red ? 'hint-warn' : 'hint-caution')] : []),
            ...result.warnings.map(w => hint(w)),
            ...(result.ties ? [hint(`${result.ties} Schläge werden angebunden.`)] : []),
        ].join('');
        document.getElementById('tmPreview').innerHTML = this.previewHtml(after, plan);
    }

    /**
     * Vorschau: Tabelle mit Taktart, Tempo, Takten und Notenwerten jetzt und danach, darunter die häufigsten Rhythmen
     * der Akkordspur (groupUnits(), Akkorde groupChords()) als Reiter, der gewählte mit "Jetzt" über "Danach" im
     * gemeinsamen Zeitraster (laneHtml(), ein Maßstab für alle) und dem Knopf für das Metronom (play()).
     * @param {?Score} after Noten danach (frisch eingelesen); null, wenn es nicht geht
     * @param {Retime} plan Änderung
     * @returns {string} HTML
     */
    previewHtml(after, plan) {
        this.last = {after, plan};
        this.playback = null;
        const before = this.before;
        const summary = (label, score) => {
            if (!score) return `<tr><th>${label}</th><td colspan="4">–</td></tr>`;
            const ts = timeSignatures(score).map(t => `${t.num}/${t.den}`).join(', ');
            return `<tr><th>${label}</th><td>${ts}</td><td>${Math.round(tempoAt(score, 0) * 10) / 10} BPM</td>
              <td class="tm-num">${score.masterBars.length}</td><td class="tm-values">${songValues(score)}</td></tr>`;
        };
        const table = `<table class="tm-summary"><thead><tr><th></th><th>Taktart</th><th>Tempo</th><th>Takte</th>
          <th>Notenwerte</th></tr></thead>
          <tbody>${summary('Jetzt', before)}${summary('Danach', after)}</tbody></table>`;
        if (!after) return table;
        const toOld = t => t * plan.notes[1] / plan.notes[0];
        const oldPatterns = barPatterns(before, this.track);
        const newPatterns = barPatterns(after, this.track);
        const events = chordTimeline(before);
        const groups = groupUnits(previewUnits(before, after, plan.notes), before, oldPatterns);
        const shown = groups.slice(0, PREVIEW_PATTERNS).map(group => {
            const unit = group.unit;
            /** @type {LaneBar[]} */
            const oldBars = unit.old.map(i => {
                const mb = before.masterBars[i];
                const pattern = oldPatterns.get(i) ?? null;
                const slotTicks = pattern ? WHOLE_TICKS / pattern.grid : 0;
                return {pattern, ts: {num: mb.timeSignatureNumerator, den: mb.timeSignatureDenominator},
                    den: mb.timeSignatureDenominator, factor: 1, length: mb.calculateDuration(), slot: slotTicks,
                    slotTicks};
            });
            /** @type {LaneBar[]} */
            const newBars = unit.fresh.map(i => {
                const mb = after.masterBars[i];
                const pattern = newPatterns.get(i) ?? null;
                const slotTicks = pattern ? WHOLE_TICKS / pattern.grid : 0;
                return {pattern, ts: {num: mb.timeSignatureNumerator, den: mb.timeSignatureDenominator},
                    den: mb.timeSignatureDenominator, factor: toOld(1), length: toOld(mb.calculateDuration()),
                    slot: toOld(slotTicks), slotTicks};
            });
            const step = laneStep([...oldBars, ...newBars]);
            return {group, oldBars, newBars, chords: groupChords(group, events), step};
        });
        // Ein Maßstab für alle: Gleiche Dauer ist in allen Rhythmen gleich breit.
        const scale = Math.min(...shown.map(({group, oldBars, newBars}) => Math.min(
            LANE_WIDTH / (group.unit.to - group.unit.from),
            SLOT_WIDTH / Math.min(...[...oldBars, ...newBars].map(b => b.pattern ? b.slot : b.length)))));
        if (!shown.length) return `${table}<p class="empty">Keine Anschläge in der Akkordspur.</p>`;
        this.rhythm = Math.min(this.rhythm, shown.length - 1);
        const {group, oldBars, newBars, chords, step} = shown[this.rhythm];
        this.playback = {
            msPerTick: 60000 / tempoAt(before, group.unit.old[0]) / (WHOLE_TICKS / 4),
            lanes: [laneEvents(oldBars), laneEvents(newBars)],
        };
        const tabs = shown.map(({group: g}, n) => `<button type="button" role="tab" data-tm-rhythm="${n}"
          aria-selected="${n === this.rhythm}">Rhythmus ${n + 1} <span class="efield-hint">${g.bars} ${
            g.bars === 1 ? 'Takt' : 'Takte'}</span></button>`).join('');
        const more = groups.length - PREVIEW_PATTERNS;
        return `${table}
          <div class="tm-rhythm-bar"><div class="upl-tabs" role="tablist">${tabs}</div>
            <button type="button" class="ebtn ebtn-text" data-tm-play title="Erst Jetzt, dann Danach abspielen, mit
              Metronom (betonte Schläge höher) und den Anschlägen">▶ Metronom</button></div>
          <div class="tm-lanes">${laneHtml('Jetzt', oldBars, chords, step, scale)}${
            laneHtml('Danach', newBars, chords, step, scale)}</div>
          ${more > 0 ? `<p class="efield-hint">und ${more} weitere Rhythmen</p>` : ''}`;
    }

    /**
     * Übernimmt die gewählte Variante in den Editor (ein Schritt für "Rückgängig") und schließt den Dialog.
     * @returns {void}
     */
    apply() {
        if (!this.valid || !this.variant) return;
        this.stop();
        const plan = this.plan(this.variant);
        closeOverlay();
        this.editor.retimeSong(plan);
    }
}
