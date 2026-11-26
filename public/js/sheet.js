/**
 * Leadsheet: Pattern-Katalog, Generator für das Blatt, Tab-Stellen darin und der Dialog "Leadsheet" im
 * Bearbeitungsmodus.
 */

import qrcode from '../vendor/qrcode/qrcode.mjs';
import {
    ATTRIBUTION_TEXT,
    chordDiagramSvg,
    chordKey,
    COMMON_CHORDS,
    creditHtml,
    escapeHtml,
    glyph,
    GLYPHS,
    loadChordLibrary,
    loadChordLibraryOrEmpty,
    loadPatterns,
    parseGrip,
    savePatterns,
    useCreditLogos,
} from './base.js';
import {closeOverlay, findSong, isOverlayOpen, openOverlay, openStackedOverlay} from './library.js';
import * as edit from './notation.js';
import {
    chordsTrack,
    compareTuning,
    deleteBar,
    hasStrings,
    isWip,
    keyName,
    markWip,
    parseScore,
    shapeKey,
    splitTicks,
    stringedStaves,
    timeline,
    trackName,
    TRIPLET_FEELS,
    WHOLE_TICKS,
    WIP_MARK,
    writeScore
} from './notation.js';
import {buildTextModel, playTimeline, renderTextView, verseFor} from './textview.js';

/** @typedef {import('../../types/alphatab').model.Score} Score */
/** @typedef {{title: string, artist?: ?string}} SongHead Titel und Interpret für den Kopf des Blatts */
/** @typedef {import('../../types/alphatab').model.Track} Track */
/** @typedef {import('../../types/alphatab').model.Bar} Bar */
/** @typedef {import('../../types/alphatab').model.Beat} Beat */
/** @typedef {import('../../types/alphatab').model.Staff} Staff */
/** @typedef {import('../../types/alphatab').model.Chord} Chord */
/** @typedef {typeof import('../../types/alphatab')} AlphaTabModule */
/** @typedef {import('../../types/alphatab').model.MasterBar} MasterBar */

// --------------------------------------------------------------------------------------------------------------------
// Strumming und Picking Patterns
// --------------------------------------------------------------------------------------------------------------------

/**
 * Strumming und Picking Patterns: Katalog (data/patterns.json, api/patterns.php), Ableiten aus einer Begleitspur, Ausrollen
 * auf eine Spur.
 *
 * Ein Pattern beschreibt einen Takt im Raster (Achtel oder Sechzehntel), ein Zeichen bzw. Schritt je Rasterplatz. Die
 * Zählzeiten werden nicht eingegeben, sondern aus Taktart und Raster berechnet (countLabels()). Betont wird mit
 * Großbuchstaben.
 * - Strumming Patterns (strumming), `strokes`: d = Plektrum abwärts, u = Plektrum aufwärts, x = gedämpfter Anschlag, . = nichts (der vorige
 *   Anschlag klingt weiter, am Anfang Pause); groß (D, U, X) = betont. Beispiel Folk in 4/4, Achtel: "d.du.udu",
 *   mit Betonung auf 1 und 3 "D.duD.du".
 * - Picking Patterns (picking), `steps`, ein Schritt je Rasterplatz, durch Leerzeichen getrennt, als Fingersatz.
 *   Die Saite folgt aus dem Finger wie in Gitarrenschulen üblich: p = Daumen auf dem tiefen Bass
 *   (tiefste gegriffene Saite des Akkords), q = Daumen auf dem zweiten Bass (Wechselbass), i = g-Saite, m = b-Saite,
 *   a = hohe e-Saite. Mehrere Buchstaben ohne Leerzeichen klingen zugleich ("pa", "ima"), groß = betont, . = klingen
 *   lassen, x = Pause. Beispiel Travis in 4/4, Achtel: "p i q m p i q m". Mit p und q gilt ein Pattern für jeden
 *   Akkord.
 *
 * Pattern und Spur speichern nicht dasselbe: Die Spur ist die genaue Ausführung mit allen Ausnahmen, das Pattern die
 * verallgemeinerte Beschreibung für das Blatt. Ableiten und Ausrollen sind Hilfen beim Übertragen, keine Kopplung.
 * Dieser Abschnitt kommt ohne DOM aus.
 */

/**
 * Ein Pattern im Katalog.
 * @typedef {Object} Pattern
 * @property {string} id Schlüssel, z. B. "travis" (die Angaben für das Leadsheet in score.json verweisen darauf)
 * @property {string} name Name auf dem Blatt, z. B. "Travis-Picking"
 * @property {'strumming'|'picking'} technique Strumming oder Picking Pattern
 * @property {string} timeSignature Taktart, z. B. "4/4"
 * @property {number} grid Raster: 8 (Achtel) oder 16 (Sechzehntel)
 * @property {string} [strokes] Strumming Patterns, ein Zeichen je Rasterplatz
 * @property {string} [steps] Picking Patterns, ein Schritt je Rasterplatz
 */

/**
 * Aus einem Takt abgeleitetes Pattern (ohne Namen).
 * @typedef {Object} DerivedPattern
 * @property {'strumming'|'picking'} technique Technik
 * @property {string} timeSignature Taktart
 * @property {number} grid Raster
 * @property {string[]} tokens Zeichen bzw. Schritte je Rasterplatz (wie patternTokens())
 */

/**
 * Ein Ton eines Zupfschritts.
 * @typedef {Object} PickNote
 * @property {string} finger p, q (Daumen auf dem zweiten Bass), i, m oder a
 * @property {string} string Saite dazu: "B" (Bass), "B2" (Wechselbass), "3", "2" oder "1"
 * @property {boolean} accent betont (Buchstabe groß geschrieben)
 */

/**
 * Kopie eines Tons mit anderer Betonung.
 * @param {PickNote} note Ton
 * @param {boolean} accent betont
 * @returns {PickNote} Kopie
 */
function withAccent(note, accent) {
    return {finger: note.finger, string: note.string, accent};
}

/** Bezeichnungen der Techniken in der Oberfläche. */
export const TECHNIQUES = {strumming: 'Strumming Pattern', picking: 'Picking Pattern'};

/** Mögliche Raster: Achtel und Sechzehntel (Zweiunddreißigstel sind fürs Gitarrenbuch zu fein). */
export const GRIDS = [8, 16];

/** Übliche Taktarten für die Auswahllisten (erweiterbar durch Eintippen). */
export const TIME_SIGNATURES = ['4/4', '3/4', '2/4', '6/8', '12/8', '2/2', '5/4', '7/8', '9/8'];

/** Buchstaben eines Zupfschritts in fester Reihenfolge (tief nach hoch): Finger → Saite. */
export const PICK_STRINGS = {p: 'B', q: 'B2', i: '3', m: '2', a: '1'};

/** Finger als alphaTab-Fingersatz (Fingers: Thumb = 0, IndexFinger = 1 …); q ist auch der Daumen. */
const FINGER_VALUES = {p: 0, q: 0, i: 1, m: 2, a: 3};

/** Ab so vielen Tönen je Anschlag im Schnitt gilt ein Takt als geschlagen, sonst als gezupft. */
const STRUM_MIN_NOTES = 3;

/**
 * Anschlagrichtung in alphaTab (PickStroke: Up = 1, Down = 2). Als Zahlen, weil
 * deriveBar() ohne das alphaTab-Modul auskommt.
 */
const UP = 1;
const DOWN = 2;

/**
 * Liest eine Taktart.
 * @param {string} text z. B. "6/8"
 * @returns {?{num: number, den: number}} null, wenn ungültig
 */
export function parseTimeSignature(text) {
    const m = /^\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*$/.exec(text ?? '');
    if (!m) return null;
    const num = Number(m[1]);
    const den = Number(m[2]);
    return num > 0 && num <= 32 && [1, 2, 4, 8, 16, 32].includes(den) ? {num, den} : null;
}

/**
 * Anzahl der Rasterplätze eines Takts.
 * @param {string} timeSignature Taktart
 * @param {number} grid Raster
 * @returns {?number} null, wenn das Raster nicht aufgeht (z. B. 3/8 in Achteln geht, 3/16 in Achteln nicht)
 */
export function slotCount(timeSignature, grid) {
    const ts = parseTimeSignature(timeSignature);
    if (!ts) return null;
    const slots = ts.num * grid / ts.den;
    return Number.isInteger(slots) && slots > 0 ? slots : null;
}

/**
 * Zeichen bzw. Schritte eines Patterns.
 * @param {Pattern} pattern Pattern
 * @returns {string[]} je Rasterplatz eins
 */
export function patternTokens(pattern) {
    return pattern.technique === 'strumming' ? [...(pattern.strokes ?? '')]
        : (pattern.steps ?? '').trim().split(/\s+/).filter(Boolean);
}

/**
 * Zählzeiten je Rasterplatz, berechnet aus Taktart und Raster (nicht eingegeben): je Schlag der Taktart die Zahl,
 * dazwischen "+" (Achtel in Viertel-Takten) bzw. "e + a" (Sechzehntel). In Achtel-Taktarten (6/8, 12/8) zählt jede
 * Achtel, bei Sechzehnteln mit "+" dazwischen.
 * @param {string} timeSignature Taktart
 * @param {number} grid Raster
 * @returns {string[]} z. B. ["1", "+", "2", "+", "3", "+", "4", "+"]; leer, wenn das Raster nicht passt
 */
export function countLabels(timeSignature, grid) {
    const ts = parseTimeSignature(timeSignature);
    const slots = slotCount(timeSignature, grid);
    if (!ts || !slots) return [];
    const per = grid / ts.den;
    const between = per >= 4 ? ['e', '+', 'a'] : per === 2 ? ['+'] : [];
    const step = per >= 4 ? per / 4 : 1;
    return Array.from({length: slots}, (_, i) => {
        if (per < 1) return String(i + 1);
        const beat = Math.floor(i / per);
        const pos = i % per;
        if (!pos) return String(beat + 1);
        return pos % step ? '' : between[pos / step - 1] ?? '';
    });
}

/**
 * Töne eines Zupfschritts.
 * @param {string} step Schritt, z. B. "pa"; "." = klingen lassen, "x" = Pause
 * @returns {?PickNote[]} leer bei "." und "x"; null, wenn der Schritt ungültig ist (unbekannter Buchstabe, ein
 *   Finger doppelt)
 */
export function parseStep(step) {
    if (step === '.' || step === 'x') return [];
    const letters = [...step];
    const lower = letters.map(c => c.toLowerCase());
    if (!letters.length || lower.some(c => !PICK_STRINGS[c]) || new Set(lower).size !== lower.length) return null;
    return letters.map((c, k) => ({finger: lower[k], string: PICK_STRINGS[lower[k]], accent: c !== lower[k]}));
}

/**
 * Schritt in fester Schreibweise: Buchstaben von tief nach hoch (p q i m a), betonte groß.
 * @param {PickNote[]} notes Töne
 * @returns {string} z. B. "pa"; ohne Töne "."
 */
export function formatStep(notes) {
    const order = Object.keys(PICK_STRINGS);
    return [...notes].sort((a, b) => order.indexOf(a.finger) - order.indexOf(b.finger))
        .map(n => n.accent ? n.finger.toUpperCase() : n.finger).join('') || '.';
}

/**
 * Betonungen je Rasterplatz: Strumming Patterns großes Zeichen, Picking Patterns ein großer Finger im Schritt.
 * @param {Pattern|DerivedPattern} pattern Pattern
 * @returns {boolean[]}
 */
export function patternAccents(pattern) {
    const tokens = 'tokens' in pattern ? pattern.tokens : patternTokens(pattern);
    return tokens.map(t => pattern.technique === 'strumming' ? t !== '.' && t === t.toUpperCase()
        : !!parseStep(t)?.some(n => n.accent));
}

/**
 * Prüft ein Pattern (beim Aufnehmen in den Katalog; der Server prüft nur Felder und Typen).
 * @param {Pattern} pattern Pattern
 * @returns {string} Fehlermeldung, leer, wenn es passt
 */
export function patternError(pattern) {
    if (!pattern.name?.trim()) return 'Das Pattern braucht einen Namen.';
    if (!TECHNIQUES[pattern.technique]) return 'Technik fehlt (Strumming oder Picking Pattern).';
    if (!parseTimeSignature(pattern.timeSignature)) return 'Taktart ungültig, z. B. 4/4.';
    const slots = slotCount(pattern.timeSignature, pattern.grid);
    if (!GRIDS.includes(pattern.grid) || !slots) return 'Raster passt nicht zur Taktart.';
    const tokens = patternTokens(pattern);
    if (tokens.length !== slots) return `${slots} Rasterplätze nötig, ${tokens.length} angegeben.`;
    if (pattern.technique === 'strumming') {
        if (tokens.some(t => !'duxDUX.'.includes(t))) return 'Strumming Patterns nur aus d, u, x (groß = betont) und Punkt.';
    } else {
        const bad = tokens.find(t => !parseStep(t));
        if (bad) return `„${bad}“: nur p, q, i, m, a (groß = betont, ohne Leerzeichen zugleich), . oder x.`;
    }
    return '';
}

/**
 * Schlüssel für ein Pattern aus seinem Namen ("Travis-Picking" → "travis-picking"), eindeutig im Katalog.
 * @param {string} name Name
 * @param {Pattern[]} catalog Katalog
 * @returns {string}
 */
export function patternId(name, catalog) {
    const base = name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'pattern';
    const taken = new Set(catalog.map(p => p.id));
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    return id;
}

/**
 * Kurzschreibweise eines Patterns, z. B. "D.DU.UDU" bzw. "B 3 B2 2 …".
 * @param {Pattern|DerivedPattern} pattern Pattern
 * @returns {string}
 */
export function patternNotation(pattern) {
    const tokens = 'tokens' in pattern ? pattern.tokens : patternTokens(pattern);
    return pattern.technique === 'strumming' ? tokens.join('') : tokens.join(' ');
}

/**
 * Zeichen auf das Sechzehntelraster gebracht, damit Patterns in Achteln und Sechzehnteln vergleichbar sind.
 * @param {string[]} tokens Zeichen
 * @param {number} grid Raster
 * @returns {string[]}
 */
function toSixteenths(tokens, grid) {
    const step = 16 / grid;
    return tokens.flatMap(t => [t, ...Array(step - 1).fill('.')]);
}

/**
 * Wie gut zwei Patterns übereinstimmen: Anteil der gleichen Rasterplätze (auf Sechzehnteln, ohne Betonung). Andere
 * Technik oder Taktart ergibt 0.
 * @param {Pattern|DerivedPattern} a Pattern
 * @param {Pattern|DerivedPattern} b Pattern
 * @returns {number} 0 … 1
 */
export function similarity(a, b) {
    if (a.technique !== b.technique || a.timeSignature !== b.timeSignature) return 0;
    // Ohne Betonung verglichen: Sie ist Ausdruck, kein anderes Pattern.
    const plain = p => ('tokens' in p ? p.tokens : patternTokens(p)).map(t => t.toLowerCase());
    const x = toSixteenths(plain(a), a.grid);
    const y = toSixteenths(plain(b), b.grid);
    if (!x.length || x.length !== y.length) return 0;
    return x.filter((t, i) => t === y[i]).length / x.length;
}

/**
 * Leitet aus einem Takt das Pattern ab: Rasterplatz je Anschlag, Richtung aus dem Anschlagzeichen (sd/su; ein Brush
 * zählt nicht), ohne Zeichen nach der Lage (gerade Plätze ab, ungerade auf); betonte Noten ergeben Großbuchstaben.
 * Gezupft: Finger nach der festen Regel aus der Saite (Basssaiten 4–6 Daumen, die tiefste im Takt p, andere q;
 * g-Saite i, b-Saite m, e-Saite a), Pausen auf einem Rasterplatz als x.
 * @param {Bar} bar Takt (aus frisch eingelesenen Noten)
 * @param {'strumming'|'picking'} [technique] Technik; ohne Angabe nach der Zahl der Töne je Anschlag
 * @returns {?DerivedPattern} null bei leerem Takt oder Anschlägen außerhalb des Rasters (z. B. Triolen)
 */
export function deriveBar(bar, technique) {
    const voice = bar.voices[0];
    if (!voice) return null;
    const hits = timeline(voice).filter(e => e.end > e.start && !e.beat.isRest && e.beat.notes.length
        && !e.beat.notes.every(n => n.isTieDestination));
    if (!hits.length) return null;
    const strings = bar.staff.tuning.length;
    technique ??= hits.reduce((sum, e) => sum + e.beat.notes.length, 0) / hits.length >= STRUM_MIN_NOTES
        ? 'strumming' : 'picking';
    const mb = bar.masterBar;
    const timeSignature = `${mb.timeSignatureNumerator}/${mb.timeSignatureDenominator}`;
    const grid = GRIDS.find(g => slotCount(timeSignature, g) && hits.every(e => e.start % (WHOLE_TICKS / g) === 0));
    if (!grid) return null;
    const slotTicks = WHOLE_TICKS / grid;
    const slots = slotCount(timeSignature, grid);
    const tokens = Array(slots).fill('.');
    // Gitarristische Saitennummer (1 = hohe e-Saite); alphaTab zählt von der tiefsten Saite aus.
    const guitarString = note => strings - note.string + 1;
    const bass = Math.max(...hits.flatMap(e => e.beat.notes.map(guitarString)));
    for (const {beat, start} of hits) {
        const slot = start / slotTicks;
        if (slot >= slots) continue;
        const accent = beat.notes.some(n => n.accentuated);
        if (technique === 'strumming') {
            // Richtung nur aus dem Anschlagzeichen (sd/su): Ein Brush (Arpeggio) sagt, wie der Akkord aufgefächert klingt,
            // nicht, wohin die Schlaghand geht (Guitar-Pro-Transkriptionen haben z. B. Brush ab auf einem "und").
            const sign = beat.notes.every(n => n.isDead) ? 'x' : beat.pickStroke === DOWN ? 'd' : beat.pickStroke === UP ? 'u'
                : slot % 2 ? 'u' : 'd';
            tokens[slot] = accent ? sign.toUpperCase() : sign;
        } else {
            // Finger nach der festen Regel: Basssaiten (4–6) Daumen, tiefste im Takt p, andere q; g i, b m, e a.
            /** @type {Map<string, PickNote>} */
            const notes = new Map();
            for (const note of beat.notes) {
                const g = guitarString(note);
                const finger = g >= 4 ? (g === bass ? 'p' : 'q') : ['a', 'm', 'i'][g - 1];
                const known = notes.get(finger);
                notes.set(finger, {
                    finger,
                    string: PICK_STRINGS[finger],
                    accent: !!note.accentuated || !!known?.accent
                });
            }
            tokens[slot] = formatStep([...notes.values()]);
        }
    }
    // Gezupft: eine Pause, die auf einem Rasterplatz beginnt und vor dem nächsten Anschlag liegt, ist "x" (sonst
    // klingt der Ton weiter, ".").
    if (technique === 'picking') {
        for (const {beat, start, end} of timeline(voice)) {
            const slot = start / slotTicks;
            if (end > start && beat.isRest && Number.isInteger(slot) && slot < slots && tokens[slot] === '.') tokens[slot] = 'x';
        }
    }
    return {technique, timeSignature, grid, tokens};
}

/**
 * Akkordwechsel des Songs in zeitlicher Folge, aus der Akkordspur (chordsTrack()).
 * @param {Score} score Noten (frisch eingelesen, mit Abspielzeiten)
 * @returns {{tick: number, name: string, chord: Chord}[]}
 */
export function chordTimeline(score) {
    const track = chordsTrack(score);
    if (!track) return [];
    /** @type {{tick: number, name: string, chord: Chord}[]} */
    const events = [];
    for (const staff of track.staves) for (const bar of staff.bars) for (const voice of bar.voices) {
        for (const beat of voice.beats) {
            const chord = /** @type {?Chord} */ (beat.chordId ? staff.chords?.get(beat.chordId) ?? null : null);
            if (chord) events.push({tick: bar.masterBar.start + beat.playbackStart, name: chord.name, chord});
        }
    }
    return events.sort((a, b) => a.tick - b.tick);
}

/**
 * Griff für einen Akkordwechsel: der Griff aus den Noten, sonst der Standardgriff des Katalogs.
 * @param {{name: string, chord: Chord}} event Akkordwechsel
 * @param {Object<string, string[]>} library Akkordkatalog
 * @returns {?number[]} Bünde von der tiefen E-Saite aus (-1 = nicht gespielt); null ohne sechssaitigen Griff
 */
export function gripFor(event, library) {
    const own = event.chord.strings;
    if (own.length === 6 && own.some(f => f >= 0)) return [...own].reverse();
    const grip = library?.[chordKey(event.name)]?.[0];
    const frets = grip ? parseGrip(grip) : null;
    return frets?.length === 6 ? frets : null;
}

/**
 * Saite (gitarristisch, 1 = hohe e-Saite) eines Tons im Picking Pattern für einen Griff.
 * @param {string} string "1", "2", "3", "B" oder "B2"
 * @param {number[]} frets Griff von der tiefen E-Saite aus
 * @returns {?number} null, wenn die Saite im Griff nicht gespielt wird
 */
function pickString(string, frets) {
    const plays = g => frets[6 - g] >= 0;
    const bass = [6, 5, 4, 3].find(plays) ?? 6;
    // Wechselbass: bei Bass auf der 6. Saite die 4. (wie beim Travis-Picking), sonst die nächsthöhere gegriffene.
    const alternate = (bass === 6 && plays(4) ? 4 : [bass - 1, bass - 2].find(g => g >= 3 && plays(g))) ?? bass;
    const g = string === 'B' ? bass : string === 'B2' ? alternate : Number(string);
    return plays(g) ? g : null;
}

/**
 * Schreibt ein Pattern in einen Takt (erste Stimme, weitere fallen weg): je Anschlag ein Schlag mit dem Griff des dann
 * klingenden Akkords, so lang bis zum nächsten Anschlag (bei krummen Längen angebunden). Ohne Akkord Pausen.
 * Betonte Anschläge bekommen einen Akzent, Zupftöne ihren Finger als Fingersatz. Beginnt der Takt ohne Anschlag und
 * klingt der letzte Anschlag des Takts davor noch (ringing), wird er bis zum ersten Anschlag übergebunden statt Pause.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Bar} bar Takt einer sechssaitigen Spur
 * @param {Pattern} pattern Pattern (Taktart wie der Takt)
 * @param {function(number): ?number[]} gripAt Griff zum Tick im Takt
 * @param {?Beat} [ringing] letzter Schlag des Takts davor (nur Töne, die nicht gedämpft sind, klingen weiter)
 * @returns {void}
 */
export function fillBar(alphaTab, bar, pattern, gripAt, ringing = null) {
    const {model} = alphaTab;
    const tokens = patternTokens(pattern);
    const strum = pattern.technique === 'strumming';
    const slotTicks = WHOLE_TICKS / pattern.grid;
    const strings = bar.staff.tuning.length;
    const voice = new model.Voice();
    const starts = tokens.map((t, i) => t === '.' ? -1 : i).filter(i => i >= 0);
    /** @type {{from: number, to: number, slot: number}[]} Abschnitte des Takts in Rasterplätzen, slot -1 = Pause */
    const spans = [];
    if (!starts.length || starts[0] > 0) spans.push({from: 0, to: starts[0] ?? tokens.length, slot: -1});
    starts.forEach((slot, k) => spans.push({from: slot, to: starts[k + 1] ?? tokens.length, slot}));
    const held = ringing?.isRest === false ? ringing.notes.filter(n => !n.isDead) : [];
    for (const {from, to, slot} of spans) {
        if (slot < 0 && from === 0 && held.length) {
            for (const {duration, dots} of splitTicks(to * slotTicks) ?? [{duration: pattern.grid, dots: 0}]) {
                const beat = new model.Beat();
                beat.duration = duration;
                beat.dots = dots;
                for (const {string, fret} of held) {
                    const note = new model.Note();
                    note.string = string;
                    note.fret = fret;
                    note.isTieDestination = true;
                    beat.addNote(note);
                }
                voice.addBeat(beat);
            }
            continue;
        }
        const frets = slot >= 0 ? gripAt(from * slotTicks) : null;
        const token = tokens[slot] ?? '.';
        const sign = token.toLowerCase();
        /** @type {{g: number, finger: number, accent: boolean}[]} */
        let played = [];
        if (frets && strum) {
            played = [6, 5, 4, 3, 2, 1].filter(g => frets[6 - g] >= 0)
                .map(g => ({g, finger: -1, accent: token !== sign}));
        } else if (frets) {
            played = (parseStep(token) ?? []).map(n => ({
                g: pickString(n.string, frets), finger: FINGER_VALUES[n.finger],
                accent: n.accent
            })).filter(n => n.g !== null);
        }
        const parts = splitTicks((to - from) * slotTicks) ?? [{duration: pattern.grid, dots: 0}];
        parts.forEach(({duration, dots}, k) => {
            const beat = new model.Beat();
            beat.duration = duration;
            beat.dots = dots;
            for (const {g, finger, accent} of played) {
                const note = new model.Note();
                note.string = strings - g + 1;
                note.fret = sign === 'x' ? 0 : frets[6 - g];
                note.isDead = sign === 'x';
                if (k) {
                    note.isTieDestination = true;
                } else {
                    if (accent) note.accentuated = model.AccentuationType.Normal;
                    if (finger >= 0) note.rightHandFinger = finger;
                }
                beat.addNote(note);
            }
            if (!k && played.length && strum) {
                const up = sign === 'u' || (sign === 'x' && slot % 2 === 1);
                beat.pickStroke = up ? model.PickStroke.Up : model.PickStroke.Down;
            }
            voice.addBeat(beat);
        });
    }
    bar.voices.splice(0);
    bar.addVoice(voice);
}

/**
 * Rollt Patterns auf eine Spur aus (Patterns × Akkorde). Überschrieben werden nur Takte, die leer sind (nur Pausen) oder
 * selbst einem Katalog-Pattern entsprechen; andere gelten als bewusste Ausnahme (Break, Schluss) und bleiben, außer
 * mit force. Takte mit anderer Taktart als das Pattern bleiben unverändert.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Score} score Noten (frisch eingelesen), werden geändert
 * @param {number} trackIndex Zielspur (sechs Saiten)
 * @param {Array<?Pattern>} perBar Patterns je Takt, null für Takte, die bleiben sollen
 * @param {Pattern[]} catalog Katalog (für "entspricht einem Pattern")
 * @param {Object<string, string[]>} library Akkordkatalog
 * @param {boolean} force auch abweichende Takte überschreiben
 * @returns {{written: number[], kept: number[], misfit: number[], chordless: number[], gripless: string[]}}
 *   Takt-Indizes; gripless: Akkorde ohne Griff (weder in den Noten noch im Katalog), dort Pausen
 */
export function rollOut(alphaTab, score, trackIndex, perBar, catalog, library, force) {
    const staff = score.tracks[trackIndex].staves[0];
    const events = chordTimeline(score);
    const result = {written: [], kept: [], misfit: [], chordless: [], gripless: []};
    const gripless = new Set();
    perBar.forEach((pattern, i) => {
        if (!pattern) return;
        const bar = staff.bars[i];
        const mb = score.masterBars[i];
        if (`${mb.timeSignatureNumerator}/${mb.timeSignatureDenominator}` !== pattern.timeSignature) {
            result.misfit.push(i);
            return;
        }
        const empty = bar.voices.every(v => v.beats.every(b => b.isRest || !b.notes.length));
        if (!force && !empty) {
            const derived = deriveBar(bar, pattern.technique);
            if (!derived || !catalog.some(p => similarity(p, derived) === 1)) {
                result.kept.push(i);
                return;
            }
        }
        let anyChord = false;
        fillBar(alphaTab, bar, pattern, tick => {
            const at = mb.start + tick;
            const event = events.findLast(e => e.tick <= at);
            if (!event) return null;
            anyChord = true;
            const grip = gripFor(event, library);
            if (!grip) gripless.add(event.name);
            return grip;
        });
        (anyChord ? result.written : result.chordless).push(i);
    });
    result.gripless = [...gripless];
    return result;
}

/**
 * Vorschlag je Abschnitt (Marker; ohne Marker der ganze Song): das häufigste abgeleitete Pattern der Takte, wie viele
 * Takte genau so gespielt werden, und das ähnlichste Katalog-Pattern.
 * @param {Score} score Noten (frisch eingelesen)
 * @param {number} trackIndex Begleitspur
 * @param {Pattern[]} catalog Katalog
 * @returns {{from: number, to: number, section: string, derived: ?DerivedPattern, matching: number, bars: number,
 *   best: ?Pattern, score: number}[]} je Abschnitt; best null, wenn der Katalog nichts mit Technik und Taktart hat
 */
export function suggestPatterns(score, trackIndex, catalog) {
    const staff = score.tracks[trackIndex].staves[0];
    const starts = score.masterBars.map((mb, i) => i === 0 || mb.section ? i : -1).filter(i => i >= 0);
    return starts.map((from, k) => {
        const to = (starts[k + 1] ?? score.masterBars.length) - 1;
        /** @type {Map<string, {derived: DerivedPattern, count: number}>} */
        const counts = new Map();
        for (let i = from; i <= to; i++) {
            const derived = deriveBar(staff.bars[i]);
            if (!derived) continue;
            const key = `${derived.technique}|${derived.timeSignature}|${toSixteenths(derived.tokens, derived.grid).join(' ')}`;
            const entry = counts.get(key) ?? {derived, count: 0};
            entry.count++;
            counts.set(key, entry);
        }
        const top = [...counts.values()].sort((a, b) => b.count - a.count)[0] ?? null;
        let best = null;
        let bestScore = 0;
        for (const pattern of top ? catalog : []) {
            const s = similarity(pattern, top.derived);
            if (s > bestScore) {
                best = pattern;
                bestScore = s;
            }
        }
        const text = score.masterBars[from].section?.text ?? '';
        return {
            from, to, section: text.replace(/^\[(.*)]$/, '$1'), derived: top?.derived ?? null,
            matching: top?.count ?? 0, bars: to - from + 1, best, score: bestScore
        };
    });
}

// --------------------------------------------------------------------------------------------------------------------
// Leadsheet-Generator
// --------------------------------------------------------------------------------------------------------------------

/**
 * Leadsheet: die Angaben dafür (score.json) und der Generator, der daraus und aus den Noten das Blatt
 * macht (Vorschau und Druck im Dialog "Leadsheet" des Bearbeitungsmodus).
 *
 * Das Blatt hat zwei Teile: Seite 1 "Spielanleitung" (Kopf mit QR-Codes der Links, Patterns, Griffbilder, Tab-Stellen,
 * Spielweise, Hinweise) und Seite 2 "Text & Akkorde" (die Ansicht aus textview.js). Passt beides auf eine Seite, steht
 * der Text direkt unter der Anleitung; sonst zwei Blätter, gedacht nebeneinander auf dem Notenständer. Ablauf und
 * Akkordfolge stehen nur auf Seite 2, nicht noch einmal auf Seite 1.
 *
 * Die Angaben (score.json) halten nur, was nicht in den Noten steht:
 *
 *   {"patterns": [{"id": "folk", "when": "Strophe und Refrain"}],
 *    "tabs": [{"from": 0, "to": 3, "track": "picking", "label": "Intro"}],
 *    "chords": {"G": false, "G*": true},
 *    "links": [{"label": "Original", "url": "https://www.youtube.com/watch?v=…", "qr": true}],
 *    "instructions": "Strophe **gedämpft**, Refrain voll …"}
 *
 * - patterns: die Strumming bzw. Picking Patterns des Songs (Verweis auf den Katalog data/patterns.json), meist eins oder
 *   zwei, jedes mit Freitext, wann es gespielt wird. Eine Zuordnung je Takt gibt es nicht: Der Ablauf steht in den
 *   Noten, Zusammenhänge erkennt der Generator.
 * - tabs: Takte, die als Tab auf das Blatt kommen (Intro, Licks, besondere Übergänge). from/to sind Indizes der Takte
 *   (0 = erster Takt), track ist der Name der Spur. Fügt der Editor Takte ein oder löscht welche, benennt er eine Spur
 *   um oder verschiebt sie, zieht er die Angaben nach (remapTabs()).
 * - chords: nur Abweichungen von der Regel für Griffbilder (sheetChords()): true zeigt, false blendet aus.
 * - links: Links mit Bezeichnung, auf dem Blatt als QR-Code (qr) oder als Text.
 * - instructions: Hinweise zur Spielweise für Seite 1 in Markdown (markdownHtml(), kleiner Umfang). Der Name
 *   grenzt das Feld von den Notizen der Stammdaten ab (notes in song.json); beide bleiben getrennt. Beim Import wird es
 *   mit den Anweisungen aus der GP-Datei vorbelegt (api/import.php).
 *
 * Randnotizen stehen nicht hier, sondern als Text über dem Schlag in den Noten (beat.text, alphaTex txt): Dann gibt es
 * sie nur an einer Stelle, sie sind auch im Player zu sehen und wandern mit den Noten.
 *
 * Der Generator (generateLeadsheet(), layoutLeadsheet(), Schritt 8):
 * - Gleiche Abschnitte stehen nur einmal da (collapseSections()): Gleich heißt gleicher Text und gleiche Akkorde
 *   in derselben Gruppe ("Chorus", "Chorus 2", "Refrain"). Spätere Vorkommen stehen nur mit Namen und "wie oben" da,
 *   direkt aufeinander folgende als "2×" beim ersten.
 * - Wie das Blatt gesetzt wird, bestimmt das Layout in den Angaben (SheetLayout, Kontrollkästchen im Dialog): eine
 *   oder zwei Seiten, Text zweispaltig, Schrift, Tabs zusammenfassen (Wiederholungen gleicher Takte als
 *   Wiederholungszeichen, sheet.js), Griffbilder klein, gleiche Abschnitte einmal.
 * - Gedruckt wird, was die Vorschau zeigt (printLeadsheet()): Die Größen sind relativ zur Breite der Seite, so passt
 *   die Vorschau genauso auf das Papier.
 */

/**
 * Ein Pattern des Songs.
 * @typedef {{id: string, when: string}} SheetPattern
 */

/**
 * Takte, die als Tab auf das Blatt kommen.
 * @typedef {{from: number, to: number, track: string, label: string}} SheetTab
 */

/**
 * Link auf dem Blatt.
 * @typedef {{label: string, url: string, qr: boolean}} SheetLink
 */

/**
 * Takte, die auf dem Blatt nicht ausgeschrieben werden, weder in "Text & Akkorde" noch in den Tabs (tabPieces());
 * an ihrer Stelle steht der Hinweis .
 * from/to sind Indizes der Takte wie bei SheetTab; text leer: Die Takte fallen ohne Hinweis weg. Geändert wird nur das
 * Blatt, nicht die Noten.
 * @typedef {{from: number, to: number, text: string}} SheetCut
 */

/**
 * Angaben für das Leadsheet (score.json).
 * @typedef {Object} Sheet
 * @property {SheetPattern[]} patterns Patterns des Songs
 * @property {SheetTab[]} tabs Tab-Stellen
 * @property {SheetCut[]} cuts Takte, die in Text & Akkorde durch einen Hinweis ersetzt sind
 * @property {Object<string, boolean>} chords Griffbilder: Abweichungen von der Regel (Akkordname → zeigen)
 * @property {SheetLink[]} links Links
 * @property {string} instructions Hinweise zur Spielweise (Markdown)
 * @property {SheetLayout} layout wie das Blatt gesetzt wird
 * @property {number} barsPerRow Takte pro Zeile in den Noten, gezählt ab jedem Abschnitt (rowBreaks()); 0 ohne
 * @property {string[]} wip Spuren der Baustelle (aus song.json, nicht in score.json): Der Editor führt sie hier mit,
 *   damit Umbenennen und Löschen sie nachziehen
 */

/**
 * Wie das Blatt gesetzt wird: Kontrollkästchen statt automatischem Einpassen). Bis dahin suchte der Generator selbst
 * die Fassung, die auf möglichst wenig Papier passt; das Ergebnis war nicht immer das gewünschte (z. B. eine Seite in
 * 9 pt mit umbrochenen Zeilen statt zwei Seiten in 12 pt).
 * @typedef {Object} SheetLayout
 * @property {boolean} twoPages Spielanleitung und Text & Akkorde je auf einer eigenen Seite
 * @property {boolean} columns Text & Akkorde zweispaltig
 * @property {number} font Grundschrift in pt (einer aus FONT_SIZES)
 * @property {boolean} compactTabs Wiederholungen in den Tabs zusammenfassen (tabUnits())
 * @property {boolean} smallChords Griffbilder kleiner
 * @property {boolean} tabCounts Zählzeiten unter den Tabs
 * @property {boolean} mergeSections gleiche Abschnitte nur einmal ausschreiben (collapseSections())
 */

/** Wählbare Grundschrift auf dem Blatt in pt, größte zuerst (Überschriften und Akkorde sind relativ dazu). */
export const FONT_SIZES = [12, 11, 10, 9];

/**
 * Layout ohne Angabe: alles auf einer Seite, einspaltig, größte Schrift; gleiche Abschnitte stehen nur einmal da
 * (das verliert nichts und war schon immer so).
 * @type {SheetLayout}
 */
export const DEFAULT_LAYOUT = {
    twoPages: false, columns: false, font: FONT_SIZES[0], compactTabs: false,
    smallChords: false, tabCounts: false, mergeSections: true
};

/**
 * Bringt die Angaben in die feste Form (fehlende Felder leer, Tab-Stellen nach Takt sortiert).
 * @param {*} data dekodiertes JSON
 * @returns {Sheet}
 */
export function normalizeSheet(data) {
    const patterns = Array.isArray(data?.patterns) ? data.patterns
        .filter(p => typeof p?.id === 'string' && p.id)
        .map(p => ({id: p.id, when: String(p.when ?? '')})) : [];
    const tabs = Array.isArray(data?.tabs) ? data.tabs
        .filter(t => Number.isInteger(t?.from) && Number.isInteger(t?.to) && t.from >= 0 && t.to >= t.from)
        .map(t => ({from: t.from, to: t.to, track: String(t.track ?? ''), label: String(t.label ?? '')}))
        .sort((a, b) => a.from - b.from || a.to - b.to) : [];
    const cuts = Array.isArray(data?.cuts) ? data.cuts
        .filter(c => Number.isInteger(c?.from) && Number.isInteger(c?.to) && c.from >= 0 && c.to >= c.from)
        .map(c => ({from: c.from, to: c.to, text: String(c.text ?? '')}))
        .sort((a, b) => a.from - b.from || a.to - b.to) : [];
    /** @type {Object<string, boolean>} */
    const chords = {};
    if (data?.chords && typeof data.chords === 'object' && !Array.isArray(data.chords)) {
        for (const [name, shown] of Object.entries(data.chords)) if (typeof shown === 'boolean') chords[name] = shown;
    }
    const links = Array.isArray(data?.links) ? data.links
        .filter(l => typeof l?.url === 'string')
        .map(l => ({label: String(l.label ?? ''), url: l.url, qr: l.qr !== false})) : [];
    const instructions = typeof data?.instructions === 'string' ? data.instructions : '';
    /** @type {SheetLayout} */
    const layout = {...DEFAULT_LAYOUT};
    for (const [key, preset] of Object.entries(DEFAULT_LAYOUT)) {
        const value = data?.layout?.[key];
        if (key === 'font' ? FONT_SIZES.includes(value) : typeof value === typeof preset) layout[key] = value;
    }
    const wip = Array.isArray(data?.wip) ? [...new Set(data.wip.filter(n => typeof n === 'string' && n))] : [];
    const barsPerRow = Number.isInteger(data?.barsPerRow) && data.barsPerRow > 0 ? data.barsPerRow : 0;
    return {patterns, tabs, cuts, chords, links, instructions, layout, wip, barsPerRow};
}

/**
 * Tab-Stellen, ersetzte Takte und Baustellen als Objekte des Modells (captureTabs()).
 * @typedef {Object} SheetCapture
 * @property {{tab: SheetTab, bars: MasterBar[], track: ?Track}[]} tabs Tab-Stellen
 * @property {{cut: SheetCut, bars: MasterBar[]}[]} cuts ersetzte Takte
 * @property {Track[]} wip Spuren, die Baustelle sind
 */

/**
 * Hält die Tab-Stellen fest, bevor sich Takte oder Spuren ändern: Takte und Spur als Objekte des Modells. Die bleiben
 * bei Änderungen am Modell dieselben (eingefügte sind neue, gelöschte fehlen danach), so findet remapTabs() die
 * neuen Indizes und Namen. Ersetzte Takte hängen genauso am Index, Baustellen am Namen der Spur.
 * @param {Sheet} sheet Angaben
 * @param {Score} score Noten vor der Änderung
 * @returns {SheetCapture} Stand vor der Änderung
 */
export function captureTabs(sheet, score) {
    return {
        tabs: sheet.tabs.map(tab => ({
            tab, bars: score.masterBars.slice(tab.from, tab.to + 1),
            track: score.tracks.find(t => t.name === tab.track) ?? null
        })),
        cuts: sheet.cuts.map(cut => ({cut, bars: score.masterBars.slice(cut.from, cut.to + 1)})),
        wip: score.tracks.filter(t => sheet.wip.includes(t.name)),
    };
}

/**
 * Zieht die Tab-Stellen nach einer Änderung am Modell nach (siehe captureTabs()): Anfang und Ende sind der erste
 * bzw. letzte Takt des Bereichs, der noch da ist; ist keiner mehr da, fällt die Stelle weg. Die Spur behält ihren
 * Platz in der Angabe auch umbenannt; gelöscht bleibt ihr Name stehen (der Generator nimmt dann die Akkordspur).
 * Baustellen folgen ihrer Spur; mit ihr gelöscht fallen sie weg, außer eine andere Spur trägt danach ihren Namen.
 * @param {Sheet} sheet Angaben, werden geändert
 * @param {Score} score Noten nach der Änderung (dasselbe Modell)
 * @param {SheetCapture} captured Stand davor
 * @returns {void}
 */
export function remapTabs(sheet, score, captured) {
    const index = new Map(score.masterBars.map((mb, i) => [mb, i]));
    sheet.tabs = captured.tabs.flatMap(({tab, bars, track}) => {
        const kept = bars.map(mb => index.get(mb)).filter(i => i !== undefined);
        if (!kept.length) return [];
        const name = track && score.tracks.includes(track) ? track.name : tab.track;
        return [{...tab, from: Math.min(...kept), to: Math.max(...kept), track: name}];
    });
    sheet.cuts = captured.cuts.flatMap(({cut, bars}) => {
        const kept = bars.map(mb => index.get(mb)).filter(i => i !== undefined);
        return kept.length ? [{...cut, from: Math.min(...kept), to: Math.max(...kept)}] : [];
    });
    sheet.wip = [...new Set(captured.wip.map(t => t.name).filter(name => score.tracks.some(t => t.name === name)))];
}

/**
 * Anzeige der Schlagzeichen im Raster: Plektrumzeichen (abwärts, aufwärts) der Notenschrift (wie in den Noten, alphaTab zeichnet
 * sd/su so), gedämpft ×. Pfeile wären missverständlich: In den Noten bedeutet ein Pfeil Brush/Arpeggio.
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
    const row = (cls, cells, label = null) => `<tr class="${cls}">${label === null ? head
        : `<td class="pgrid-label">${escapeHtml(label)}</td>`}${cells.join('')}</tr>`;
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
    return `<table class="pgrid${strum ? ' pgrid-strum' : ' pgrid-pick'}${editable ? ' pgrid-edit' : ''}"><colgroup>${
        strum ? '' : '<col>'}${beats.map(b => `<col${b ? ' class="pgrid-beat"' : ''}>`).join('')}</colgroup>
    ${chords.map(line => row('pgrid-chord', counts.map((_, k) => {
        const names = line.filter(m => m.slot === k).map(m => m.name).join(' ');
        return `<td>${names ? `<span>${escapeHtml(names)}</span>` : ''}</td>`;
    }))).join('')}
    ${strum && (editable || uniform || accents.some(Boolean)) ? row('pgrid-accent', accents.map((a, k) =>
        cell(a ? '&gt;' : '', 'count', k))) : ''}
    ${body}
    ${row('pgrid-count', counts.map((c, k) => cell(escapeHtml(c), 'count', k, accents[k] ? 'pgrid-strong' : '')))}
  </table>`;
}

/**
 * Name eines Abschnitts ohne die Klammern der importierten Songs ("[Verse]" → "Verse").
 * @param {?{text: string, marker?: string}} section Abschnitt eines Takts
 * @returns {string} leer ohne Abschnitt
 */
export function sectionName(section) {
    return (section?.text || section?.marker || '').replace(/^\[(.*)]$/, '$1').trim();
}

/**
 * Abschnitte in der Reihenfolge der Noten, je mit Takten. Vor dem ersten Abschnitt (Auftakt, Takte ohne Namen) steht
 * einer ohne Namen.
 * @param {Score} score Noten
 * @returns {{name: string, from: number, to: number}[]}
 */
export function sections(score) {
    const starts = score.masterBars.map((mb, i) => i === 0 || mb.section ? i : -1).filter(i => i >= 0);
    return starts.map((from, k) => ({
        name: sectionName(score.masterBars[from].section), from,
        to: (starts[k + 1] ?? score.masterBars.length) - 1
    }));
}

/**
 * Spur einer Tab-Stelle: die mit dem Namen, sonst die Akkordspur, sonst die erste mit Saiten; nie eine Baustelle.
 * @param {Score} score Noten
 * @param {string} name Name aus den Angaben (tabs[].track)
 * @returns {?Track} null ohne Spur mit Saiten bzw. bei einer Baustelle
 */
export function tabTrack(score, name) {
    const stringed = t => hasStrings(t.staves[0]);
    const named = score.tracks.find(t => t.name === name && stringed(t));
    if (named) return isWip(named) ? null : named;
    const usable = t => stringed(t) && !isWip(t);
    const chords = chordsTrack(score);
    return chords && usable(chords) ? chords : score.tracks.find(usable) ?? null;
}

/**
 * Ob eine Tab-Stelle auf einer Baustelle liegt (dann steht sie nicht auf dem Blatt).
 * @param {Score} score Noten
 * @param {{track: string}} tab Tab-Stelle
 * @returns {boolean}
 */
export function tabOnWip(score, tab) {
    return isWip(score.tracks.find(t => t.name === tab.track));
}

/**
 * Vergleichsschlüssel eines Takts einer Tab: Anschläge mit Zeit, Dauer, Saite, Bund, gedämpft, gebunden.
 * @param {import('../../types/alphatab').model.Bar} bar Takt eines Notensystems
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
 * alphaTab (sheet.js).
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
 * @param {?import('./base.js').ChordLibrary} library Akkordkatalog (Standardgriff zuerst), null ohne
 * @returns {{name: string, grip: string, auto: boolean, shown: boolean}[]} auto: nach der Regel
 */
export function sheetChords(score, sheet, library) {
    // Ohne eigenen Griff in den Noten gilt der Standardgriff des Katalogs; ohne beides gibt es kein Griffbild.
    return buildTextModel(score).chords.flatMap(({name, grip}) => {
        const standard = library?.[name.toLowerCase()]?.[0] ?? '';
        if (!grip && !standard) return [];
        const auto = !COMMON_CHORDS.includes(name) || !!grip && !!standard && standard !== grip;
        return [{name, grip: grip || standard, auto, shown: sheet.chords[name] ?? auto}];
    });
}

/**
 * Markdown in kleinem Umfang für die Hinweise zur Spielweise: Überschrift (#, ##, ###), Aufzählung (- oder *),
 * nummerierte Liste (1.), Absatz (Leerzeile), Zeilenumbruch, **fett**, *kursiv* bzw. _kursiv_, [Text](https://…).
 * Eigener kleiner Umsetzer statt einer Bibliothek: Mehr braucht das Feld nicht. HTML im Text wird nicht ausgeführt (escapeHtml
 * zuerst), Links nur mit http(s).
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
 * Patterns mit "wann", Griffbilder, Tab-Stellen, Spielweise, Links ohne QR-Code, Hinweise (Texte über den Schlägen). Die
 * Größen sind relativ zur Breite der Seite (CSS .ls-page), so passt die verkleinerte Vorschau zum Ausdruck.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Score} score Noten
 * @param {Sheet} sheet Angaben für das Leadsheet
 * @param {Pattern[]} catalog Pattern-Katalog
 * @param {?import('./base.js').ChordLibrary} library Akkordkatalog, null ohne
 * @param {{compact?: boolean, head?: SongHead}} [options] compact: Wiederholungen in den Tabs zusammenfassen (tabUnits(),
 *   hier nur für die Spielfolge in Worten); head: Titel und Interpret (ohne Angabe die der Noten)
 * @returns {string} HTML
 */
export function renderInstructions(alphaTab, score, sheet, catalog, library, options = {}) {
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
        staff.capo ? `<strong>Capo ${staff.capo}</strong>${capoKey && capoKey !== key
            ? ` (Griffe ${escapeHtml(capoKey)})` : ''}` : '',
        tuning,
        escapeHtml(key),
        `${mb.timeSignatureNumerator}/${mb.timeSignatureDenominator}`,
        tempo,
        Number(mb.tripletFeel) ? escapeHtml(TRIPLET_FEELS[Number(mb.tripletFeel)]) : '',
    ].filter(Boolean);
    const links = sheet.links.filter(l => l.url.trim());
    const qrs = links.filter(l => l.qr).map(l => `<figure class="ls-qr">${qrSvg(l.url)}
    <figcaption>${escapeHtml(l.label || 'Link')}</figcaption></figure>`).join('');
    const byId = new Map(catalog.map(p => [p.id, p]));
    const patterns = sheet.patterns.map(({id, when}) => {
        const p = byId.get(id);
        return `<div class="ls-pattern">
      <div class="ls-pattern-head"><strong>${escapeHtml(p?.name ?? id)}</strong>${p ? ` <span class="ls-soft">${
            escapeHtml(TECHNIQUES[p.technique] ?? '')}</span>` : ' <span class="ls-soft">(nicht im Katalog)</span>'}${
            when ? ` – ${escapeHtml(when)}` : ''}</div>
      ${p ? patternGridHtml(p) : ''}
    </div>`;
    }).join('');
    const chords = sheetChords(score, sheet, library).filter(c => c.shown)
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
        return `<div class="ls-tab">
      <h3>${escapeHtml(tab.label || sectionName(score.masterBars[tab.from]?.section) || 'Tab')}
        <span class="ls-soft">${range}</span></h3>
      ${!track ? '<p class="ls-soft">Keine Spur mit Saiten.</p>' : pieces.map(piece => 'hint' in piece
            ? (piece.hint ? `<p class="ls-tab-hint">${escapeHtml(piece.hint)}</p>` : '')
            : `<div class="ls-at" data-tab="${k}" data-from="${piece.from}" data-to="${piece.to}"></div>`).join('')}
    </div>`;
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
        escapeHtml(n.text)}</span>`).join(' · ')}</p>` : ''}`;
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
 * Spuren mit Saiten, deren Capo von dem auf dem Blatt abweicht (löst der Konfliktlöser beim Import, siehe conflicts.js).
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
 * Gruppe eines Abschnitts: der Name ohne Nummer, klein; "Refrain" zählt als "Chorus".
 * "Chorus 2" und "Chorus" gehören zusammen, "Verse 2" und "Verse" auch.
 * @param {string} name Name des Abschnitts
 * @returns {string} leer ohne Namen
 */
export function sectionGroup(name) {
    const base = name.toLowerCase().replace(/\s*\(.*\)\s*$/, '').replace(/[\s.#-]*\d+\s*$/, '').trim();
    return /^(chorus|refrain)$/.test(base) ? 'chorus' : base;
}

/** Gruppen, deren Vorkommen verschiedenen Text haben dürfen (Strophen). */
const VERSE_GROUPS = /^(verse|strophe)$/;

/**
 * Ein Abschnitt auf der Textseite: so wie aus buildTextModel() oder als Verweis auf ein gleiches Vorkommen davor
 * (lines leer, note "wie oben"); times: Durchgänge, wenn gleiche direkt aufeinander folgen.
 * @typedef {{name: string, lines: import('./textview.js').TextLine[], note?: string, times?: number}} SheetSection
 */

/**
 * Ungleiches Vorkommen einer Gruppe: index der Abschnitt, like das erste Vorkommen seiner Gruppe (beides Indizes in
 * TextModel.sections), für "Vergleichen" in der Meldung unter der Vorschau.
 * @typedef {{name: string, index: number, like: number}} DifferEntry
 */

/**
 * Vergleichsschlüssel eines Abschnitts: Text, Akkorde und Taktstriche (ohne Zeiten), so wie sie auf dem Blatt
 * stehen. Gleicher Schlüssel heißt: steht nur einmal da.
 * @param {import('./textview.js').TextLine[]} lines Zeilen
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
 * @param {import('../../types/alphatab').model.Bar} bar Takt eines Notensystems
 * @returns {string}
 */
function barContentKey(bar) {
    return [...beatKeys(bar)].map(([t, key]) => `${t}=${key}`).join('|');
}

/**
 * Schläge eines Takts nach ihrer Zeit im Takt (playbackStart), je mit Schlüssel aus Dauer, Noten, Text und Akkord
 * aller Stimmen, die dort beginnen. Für barContentKey() und die Markierung der Unterschiede in einem Takt.
 * @param {import('../../types/alphatab').model.Bar} bar Takt eines Notensystems
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
 * @param {import('../../types/alphatab').model.Bar} bar Takt
 * @param {import('../../types/alphatab').model.Bar} other Takt zum Vergleich
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
 * @returns {{mb: import('../../types/alphatab').model.MasterBar, pass: number, t: number, end: number}[]}
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
 * @param {import('../../types/alphatab').model.Track} track Spur
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
    // Die Tab zeichnet alphaTab nachträglich in den Platzhalter (fillCompareTabs() in sheet.js), abweichende
    // Bundzahlen rot (data-cmp-marks: Zeiten der abweichenden Schläge).
    const notes = hasStrings(staff) ? `<div class="cmp-tab" data-cmp-bar="${index}" data-cmp-track="${track.index}"${
        marks?.size ? ` data-cmp-marks="${[...marks].join(',')}"` : ''}></div>` : `<div class="efield-hint${marks?.size ? ' cmp-bar-diff' : ''}">${hasNotes ? 'Noten'
        : 'Pause'}</div>`;
    // Anders als auf der anderen Seite: rot wie die Bundzahlen.
    const line = (kind, text) => text ? `<div class="cmp-bar-${kind}${text !== theirs[kind] ? ' cmp-bar-diff' : ''}">${
        escapeHtml(text)}</div>` : '';
    return `${notes}${line('chords', mine.chords)}${line('words', mine.words)}`;
}

/**
 * Gleiche Abschnitte nur einmal (Planung 5.5, gilt immer): Ein Abschnitt, der einem früheren derselben Gruppe
 * (sectionGroup()) in Text und Akkorden gleicht, steht nur mit Namen und "wie oben" (bzw. "wie Chorus", wenn der
 * frühere anders heißt) da. Folgt er direkt auf dieses Vorkommen, bekommt das stattdessen "2×". Abschnitte ohne Namen
 * bleiben stehen; ungleiche Vorkommen einer Gruppe auch, sie werden gemeldet (Vereinheitlichen hilft beim Einpassen),
 * außer bei Strophen.
 * @param {import('./textview.js').TextSection[]} list Abschnitte aus buildTextModel()
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
            // Strophen haben verschiedenen Text (Planung 5.3), ihre Abweichung ist keine Meldung wert. Verglichen werden
            // soll mit dem ersten Vorkommen der Gruppe: Das steht auf dem Blatt ganz da, nach ihm richten sich die anderen.
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
 * Teilt eine Tab-Stelle an den ersetzten Takten (SheetCut): Was ersetzt ist, wird nicht gezeichnet, an der Stelle
 * steht der Hinweis. Die Stücke davor und danach sind eigene Zeichnungen.
 * @param {SheetTab} tab Tab-Stelle
 * @param {SheetCut[]} cuts ersetzte Takte, nach from sortiert
 * @returns {({from: number, to: number} | {hint: string})[]} Stücke in der Reihenfolge des Blatts; hint leer: Die
 *   Takte fallen ohne Hinweis weg
 */
export function tabPieces(tab, cuts) {
    /** @type {({from: number, to: number} | {hint: string})[]} */
    const pieces = [];
    let from = tab.from;
    for (const cut of cuts) {
        if (cut.to < from || cut.from > tab.to) continue;
        if (cut.from > from) pieces.push({from, to: cut.from - 1});
        pieces.push({hint: cut.text.trim()});
        from = cut.to + 1;
    }
    if (from <= tab.to) pieces.push({from, to: tab.to});
    return pieces;
}

/**
 * Nimmt die ersetzten Takte (SheetCut) aus den Abschnitten von "Text & Akkorde" und setzt an ihre Stelle eine Zeile
 * mit dem Hinweis (TextLine.hint). Gerechnet wird in Zeit: Jeder Takt des Bereichs hat in der Spielfolge
 * (playTimeline()) seinen Zeitraum, aufeinander folgende Takte bilden einen Block; Silben, Akkorde und Takte, die
 * in einem Block beginnen, fallen weg. Wird ein Bereich wiederholt gespielt, ist jeder Durchgang ein eigener Block
 * mit eigenem Hinweis. Ein Bereich, in dem nichts steht (z. B. außerhalb des Songs), bleibt ohne Wirkung.
 * Fällt ein Abschnitt ganz weg, fällt auch seine Überschrift weg, und sein Hinweis schließt an den Abschnitt davor
 * an: So steht unter dem Chorus "2 mal spielen" statt einer zweiten Überschrift "Chorus" mit dem Hinweis darunter.
 * @param {import('./textview.js').TextSection[]} list Abschnitte aus buildTextModel()
 * @param {Score} score Noten
 * @param {SheetCut[]} cuts ersetzte Takte
 * @returns {import('./textview.js').TextSection[]} neue Liste
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
    /** @type {import('./textview.js').TextSection[]} */
    const out = [];
    for (const section of list) {
        /** @type {import('./textview.js').TextLine[]} */
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
                /** @type {import('./textview.js').TextLine} */
                const rest = {...line};
                if (line.bars) rest.bars = /** @type {import('./textview.js').BarCell[]} */ (kept);
                else rest.parts = /** @type {import('./textview.js').LinePart[]} */ (kept);
                lines.push(rest);
            }
        }
        // Zeilen bleiben in der Reihenfolge der Zeit (der Hinweis kann vor dem Rest seiner Zeile entstanden sein).
        lines.sort((a, b) => a.t - b.t);
        const gone = section.lines.length > 0 && lines.every(l => l.hint !== undefined);
        if (gone && out.length) out.at(-1).lines.push(...lines);
        else {
            /** @type {import('./textview.js').TextSection} */
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
 * @param {Pattern[]} catalog Pattern-Katalog
 * @param {?import('./base.js').ChordLibrary} library Akkordkatalog, null ohne
 * @param {SongHead} [head] Titel und Interpret (aus song.json; ohne Angabe die der Noten, die meist keine haben)
 * @returns {LeadsheetParts}
 */
export function generateLeadsheet(alphaTab, score, sheet, catalog, library, head = {
    title: score.title,
    artist: score.artist
}) {
    const {layout} = sheet;
    // Die Fußzeile gehört auf die Seite mit den Tabs, wenn alphaTab dort etwas zeichnet.
    const credit = sheet.tabs.some(tab => tabTrack(score, tab.track) && tabPieces(tab, sheet.cuts).some(p => 'from' in p))
        ? CREDIT_HTML : '';
    const instructions = renderInstructions(alphaTab, score, sheet, catalog, library, {
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
 * sheet.js); gemessen wird danach.
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
 * Druckt das Leadsheet eines Songs ohne den Dialog "Leadsheet" (Menü der Liedansicht): Das Blatt wird unsichtbar gesetzt
 * wie in der Vorschau (generateLeadsheet(), layoutLeadsheet(), Tabs mit fillSheetTabs()) und dann gedruckt.
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
    const catalog = await loadPatterns().then(p => p.patterns).catch(() => []);
    const library = await loadChordLibrary().catch(() => null);
    // Unsichtbar, aber mit Breite: Die Seite rechnet in cqw, gemessen wird beim Setzen.
    const view = document.createElement('div');
    view.className = 'els-preview';
    view.style.cssText = 'position:absolute; left:-20000px; top:0; width:800px; visibility:hidden;';
    document.body.append(view);
    try {
        layoutLeadsheet(view, generateLeadsheet(alphaTab, score, sheet, catalog, library, head), sheet.layout);
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
// Tab-Stellen im Leadsheet
// --------------------------------------------------------------------------------------------------------------------

/**
 * Tabs auf dem Leadsheet und im Dialog "Abschnitte vergleichen", gezeichnet von alphaTab.
 *
 * Ablauf: alphaTab zeichnet die Takte einer Spur (display.startBar/barCount, nur Tab mit Notenhälsen) in einen
 * unsichtbaren Behälter fester Breite. Das Ergebnis, mehrere SVG-Stücke, wird zu einer SVG mit viewBox
 * zusammengesetzt. So skaliert die Tab mit der Breite der Seite (Vorschau und Druck haben verschiedene Breiten,
 * siehe printLeadsheet()) und lässt sich als fertiges HTML kopieren. Die Stücke bleiben, wie alphaTab sie liefert.
 *
 * - Zusammenfassen (tabUnits() in sheet.js): Wiederholte Blöcke stehen einmal zwischen Wiederholungszeichen. Dazu
 *   werden in einer Kopie der Noten die wiederholten Takte gelöscht und die Zeichen gesetzt. Die Taktnummern stimmen
 *   in der Kopie nicht mehr und werden ausgeblendet; die Spielfolge steht in Worten in der Überschrift der Tab-Stelle.
 * - Zählzeiten: Die kennt alphaTab nicht. Sie stehen als Text unter jeder Zeile, an den Stellen, an denen alphaTab
 *   die Schläge gezeichnet hat (boundsLookup), dazwischen gleichmäßig verteilt.
 *
 * Zeichnen dauert etwa 0,2 s je Zeichnung; fertige Zeichnungen werden gemerkt, solange die Noten dieselben sind.
 * Im Dialog bei vielen abweichenden Takten also ein paar Sekunden, bis alle stehen (Frank: Der Dialog wird selten
 * gebraucht, die Zeit spielt keine Rolle).
 */

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

const VENDOR_URL = new URL('../vendor/alphatab/', import.meta.url).href;

/**
 * Breite, in der alphaTab zeichnet (px). Sie bestimmt, wie groß die Bundzahlen im Verhältnis zur Seite sind (die
 * Tab füllt immer die Breite): 13 px Schrift auf 800 px sind rund 1,6 % der Breite, etwas kleiner als der Text
 * des Blatts bei 12 pt, so passen meist vier Takte in eine Zeile.
 */
const RENDER_WIDTH = 800;

/** Breite einer Zeichnung im Vergleich (ein Takt, etwa die halbe Breite des Dialogs). */
const COMPARE_WIDTH = 360;

/** Farbe abweichender Bundzahlen im Vergleich (wie --danger in app.css). */
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
        // Behälter gilt und mit ihm verschwindet. Hier dieselbe Schrift (Bravura, in app.css als GbBravura) in der
        // Größe, die alphaTab gesetzt hat.
        const glyph = host.querySelector('svg .at');
        const size = glyph ? getComputedStyle(glyph).fontSize : '34px';
        // Platz für die Zählzeiten unter der letzten Zeile.
        if (extra) height += COUNT_SPACE;
        return `<svg class="ls-at-svg" viewBox="0 0 ${width} ${Math.ceil(height)}" role="img"
      style="--at-glyph:${size}" xmlns="http://www.w3.org/2000/svg">${inner}${extra}</svg>`;
    }

    /**
     * Zählzeiten unter jeder Zeile: je Takt die Zeichen aus countGrid(), an der Stelle ihres Schlags; zwischen zwei
     * gezeichneten Schlägen gleichmäßig nach der Zeit verteilt.
     * @param {import('../../types/alphatab').AlphaTabApi} api alphaTab nach dem Zeichnen
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
 * renderInstructions() in sheet.js): gemerkte Zeichnungen sofort, die übrigen, sobald alphaTab sie gezeichnet hat.
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
        // Das Stück der Tab-Stelle, das hier steht (ersetzte Takte teilen sie, tabPieces() in sheet.js).
        const tab = {...whole, from: Number(slot.dataset.from), to: Number(slot.dataset.to)};
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
 * sheet.js): je Takt eine Zeichnung von alphaTab, abweichende Bundzahlen rot. Gemerkte sofort, die übrigen
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

// --------------------------------------------------------------------------------------------------------------------
// Dialog "Leadsheet"
// --------------------------------------------------------------------------------------------------------------------

/**
 * Dialog "Leadsheet" des Bearbeitungsmodus (Knopf in der Werkzeugleiste): links die Eingaben
 * für das Blatt, rechts die Vorschau (sheet.js): Seite 1 "Spielanleitung", Seite 2 "Text & Akkorde"; passt beides
 * auf eine Seite, nur eine.
 *
 * - Patterns: die Strumming bzw. Picking Patterns des Songs aus dem Katalog, meist eins oder zwei, jedes mit Freitext,
 *   wann es gespielt wird ("Strophe", "Refrain ab dem 2. Mal"). Dazu die Knöpfe für den Pattern-Katalog (js/sheet.js):
 *   Patterns aus einer Begleitspur vorschlagen, ein Pattern auf eine Spur ausrollen, Katalog bearbeiten.
 * - Tabs: Takte, die als Tab auf das Blatt kommen (Intro, Licks, besondere Übergänge), mit Spur und Beschriftung.
 * - Griffbilder: je Akkord des Songs das Griffbild mit einem Häkchen (ohne Text, das Griffbild ist die Beschriftung;
 *   ausgeblendete werden blass), vorbelegt nach sheetChords(). Akkord und Griff wählt man im linken Panel (Auswahlliste, "+").
 * - Links mit Bezeichnung, je als QR-Code oder Text; der YouTube-Link der Stammdaten lässt sich übernehmen.
 * - Spielweise: Hinweise in Markdown (markdownHtml()); die Vorschau folgt beim Tippen.
 *
 * Je Takt gibt es hier keine Angaben: der Abschnitt steht im linken Panel (Takt am Cursor), Tonart,
 * Taktart, Tempo samt der seltenen Wechsel und Triolen-Feeling im rechten (Song), die Randnotiz ist der Text über dem
 * Schlag. Wann ein Pattern gespielt wird, steht im Freitext; Zusammenhänge erkennt der Generator.
 *
 * Gespeichert wird in score.json (NoteEditor.sheet, zusammen mit den Noten; api/leadsheet.php).
 */

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
 * @returns {import('../../types/alphatab').model.Track[]}
 */
function stringedTracks(score, six = false, wip = true) {
    return score.tracks.filter(t => hasStrings(t.staves[0]) && (six ? t.staves[0].tuning.length === 6
        : t.staves[0].tuning.length > 0) && (wip || !isWip(t)));
}

/**
 * Ändert ein Pattern nach einem Klick ins Raster der Vorschau: Strumming Patterns wechseln je Klick nichts → ab → auf →
 * gedämpft. Picking Patterns setzen bzw. nehmen den Finger auf dieser Saite. Die Zählzeit schaltet bei einem Anschlag die
 * Betonung (Großbuchstaben), beim Picking Pattern an leerer Stelle die Pause (x).
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
 * Öffnet einen Dialog der Leadsheet-Werkzeuge: aus dem Dialog "Leadsheet" heraus gelegt über ihn (Schließen zeigt ihn wieder),
 * sonst allein (Menü der Werkzeugleiste).
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
     * @param {import('./editor.js').NoteEditor} editor Bearbeitungsmodus
     */
    constructor(editor) {
        this.editor = editor;
        /**
         * Pattern-Katalog, leer bis geladen.
         * @type {Pattern[]}
         */
        this.catalog = [];
        /**
         * In wie vielen Songs ein Pattern vorkommt (aus api/patterns.php).
         * @type {Object<string, number>}
         */
        this.usage = {};
        /**
         * Akkordkatalog (Standardgriffe, für die Regel der Griffbilder), null bis geladen bzw. ohne.
         * @type {?import('./base.js').ChordLibrary}
         */
        this.library = null;
        /** Zeitgeber für die Vorschau beim Tippen der Hinweise zur Spielweise. */
        this.instructionsTimer = 0;
    }

    /**
     * Inhalt des Dialogs "Leadsheet" (editor.js), null, solange er nicht zu sehen ist.
     * @returns {?HTMLElement}
     */
    get tab() {
        return /** @type {?HTMLElement} */ (document.querySelector('.sheet .etab-leadsheet'));
    }

    /**
     * Lädt Pattern-Katalog und Akkordkatalog und zeichnet danach neu.
     * @returns {Promise<void>}
     */
    async loadCatalog() {
        try {
            const data = await loadPatterns();
            this.catalog = data.patterns;
            this.usage = data.usage ?? {};
        } catch (err) {
            this.editor.toast(err.message);
        }
        this.library = await loadChordLibrary().catch(() => null);
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
        const byId = new Map(this.catalog.map(p => [p.id, p]));
        const signatures = new Set(score.masterBars.map(mb => `${mb.timeSignatureNumerator}/${mb.timeSignatureDenominator}`));
        const button = (action, k, label, title, disabled = false) => `<button type="button" class="ebtn"
      data-ls-action="${action}" data-ls-index="${k}" title="${title}" aria-label="${title}"${disabled ? ' disabled' : ''}>
      ${label}</button>`;
        const patterns = sheet.patterns.map((entry, k) => {
            const p = byId.get(entry.id);
            const name = escapeHtml(p?.name ?? entry.id);
            return `
        <div class="els-item">
          <div class="els-grid">${p ? patternGridHtml(p) : ''}</div>
          <div class="els-meta">
            <div><strong>${name}</strong> <span class="efield-hint">${p ? `${TECHNIQUES[p.technique]}, ${
                escapeHtml(p.timeSignature)}` : this.catalog.length ? 'nicht im Katalog' : ''}</span></div>
            <input type="text" data-ls="when" data-ls-index="${k}" value="${escapeHtml(entry.when)}"
              placeholder="${WHEN_PLACEHOLDER}" aria-label="Wann wird ${name} gespielt?">
          </div>
          <div class="els-btns">
            ${button('patternUp', k, '↑', 'Nach oben', k === 0)}
            ${button('patternDown', k, '↓', 'Nach unten', k === sheet.patterns.length - 1)}
            ${button('patternRemove', k, '×', 'Aus dem Song nehmen (bleibt im Katalog)')}
          </div>
        </div>`;
        }).join('');
        // Angeboten werden Patterns mit einer Taktart des Songs, die er noch nicht hat.
        const options = Object.entries(TECHNIQUES).map(([technique, label]) => {
            const group = this.catalog.filter(p => p.technique === technique && signatures.has(p.timeSignature)
                && !sheet.patterns.some(e => e.id === p.id));
            return group.length ? `<optgroup label="${label}">${group.map(p => `<option value="${escapeHtml(p.id)}">
        ${escapeHtml(p.name)} (${escapeHtml(p.timeSignature)})</option>`).join('')}</optgroup>` : '';
        }).join('');
        const tracks = stringedTracks(score);
        const count = score.masterBars.length;
        const tabs = sheet.tabs.map((tab, k) => {
            const known = tracks.some(t => t.name === tab.track);
            const number = (field, value, label) => `<input type="number" min="1" max="${count}" value="${value + 1}"
        data-ls="${field}" data-ls-index="${k}" aria-label="${label}" class="els-num">`;
            return `
        <div class="els-tab">
          <button type="button" class="ebtn ebtn-text" data-bar-goto="${tab.from}"
            title="Cursor auf Takt ${tab.from + 1}">Takt</button>
          ${number('tabFrom', tab.from, 'Erster Takt')}<span>–</span>${number('tabTo', tab.to, 'Letzter Takt')}
          <select data-ls="tabTrack" data-ls-index="${k}" aria-label="Spur">
            ${tracks.map(t => `<option value="${escapeHtml(t.name)}"${t.name === tab.track ? ' selected' : ''}>
              ${escapeHtml(isWip(t) ? `${trackName(t)} ${WIP_MARK} (Baustelle, nicht auf dem Blatt)`
                : trackName(t))}</option>`).join('')}
            ${known ? '' : `<option value="${escapeHtml(tab.track)}" selected>${escapeHtml(tab.track || '–')} (fehlt)
              </option>`}
          </select>
          <input type="text" data-ls="tabLabel" data-ls-index="${k}" value="${escapeHtml(tab.label)}"
            placeholder="z. B. Intro, Lick nach der Strophe" aria-label="Beschriftung">
          ${button('tabRemove', k, '×', 'Tab-Stelle entfernen')}
        </div>`;
        }).join('');
        // Takte, die in "Text & Akkorde" durch einen Hinweis ersetzt sind.
        const cuts = sheet.cuts.map((cut, k) => {
            const number = (field, value, label) => `<input type="number" min="1" max="${count}" value="${value + 1}"
        data-ls="${field}" data-ls-index="${k}" aria-label="${label}" class="els-num">`;
            return `
        <div class="els-tab">
          <button type="button" class="ebtn ebtn-text" data-bar-goto="${cut.from}"
            title="Cursor auf Takt ${cut.from + 1}">Takt</button>
          ${number('cutFrom', cut.from, 'Erster Takt')}<span>–</span>${number('cutTo', cut.to, 'Letzter Takt')}
          <input type="text" data-ls="cutText" data-ls-index="${k}" value="${escapeHtml(cut.text)}"
            placeholder="z. B. 2 mal spielen, wiederholen und leiser werden" aria-label="Hinweis statt der Takte">
          ${button('cutRemove', k, '×', 'Takte wieder ausschreiben')}
        </div>`;
        }).join('');
        const chords = sheetChords(score, sheet, this.library).map(c => `
      <label class="els-chord${c.shown ? '' : ' els-off'}" title="${c.auto ? 'Selten oder eigener Griff: vorgeschlagen'
            : 'Gängiger Akkord: nicht vorgeschlagen'}">
        ${chordDiagramSvg(c.name, c.grip)}
        <input type="checkbox" data-ls="chordShown" data-ls-chord="${escapeHtml(c.name)}"${c.shown ? ' checked' : ''}
          aria-label="Griffbild ${escapeHtml(c.name)} auf dem Blatt">
      </label>`).join('');
        const youtube = findSong(ed.player.slug)?.sources?.youtube ?? '';
        const links = sheet.links.map((link, k) => `
      <div class="els-link">
        <input type="text" data-ls="linkLabel" data-ls-index="${k}" value="${escapeHtml(link.label)}"
          placeholder="Bezeichnung, z. B. Original" aria-label="Bezeichnung" class="els-link-label">
        <input type="url" data-ls="linkUrl" data-ls-index="${k}" value="${escapeHtml(link.url)}"
          placeholder="https://…" aria-label="Adresse" class="els-link-url">
        <label class="efield-check"><input type="checkbox" data-ls="linkQr" data-ls-index="${k}"${link.qr ? ' checked' : ''}>
          QR-Code</label>
        ${button('linkRemove', k, '×', 'Link entfernen')}
      </div>`).join('');
        // Layout: Kontrollkästchen, gespeichert in den Angaben (das Blatt passt sich nicht von allein an).
        const check = (key, label, title) => `<label class="efield-check" title="${title}"><input type="checkbox"
      data-ls="layout" data-ls-key="${key}"${sheet.layout[key] ? ' checked' : ''}> ${label}</label>`;
        const layout = `<div class="els-layout">
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
    </div>`;
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
      ${cuts || '<p class="efield-hint">Takte auf dem Blatt durch einen Hinweis ersetzen, z. B. „2 mal spielen“ statt '
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
     * Zeichnet die Vorschau rechts neu, nur bei offenem Dialog: Der Generator erzeugt das Blatt und setzt es nach
     * dem Layout (generateLeadsheet(), layoutLeadsheet() in sheet.js), darunter steht, ob es passt; wenn nicht,
     * rot und mit dem, was hilft.
     * Haben die Spuren verschiedenen Capo, steht das auch rot da: Auf dem Blatt steht der Capo der Akkordspur.
     * @param {Partial<Sheet>} [draft] Angaben, die noch nicht übernommen sind (Hinweise zur
     *   Spielweise beim Tippen)
     * Die Tabs zeichnet alphaTab nachträglich (fillSheetTabs() in sheet.js); gemessen wird, wenn sie stehen.
     * Ruft jemand inzwischen neu auf, gilt nur der letzte Aufruf.
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
        const parts = generateLeadsheet(ed.alphaTab, ed.score, sheet, this.catalog, this.library,
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
        const compare = parts.differ.map(d => `<button type="button" class="ebtn ebtn-text" data-ls-action="compare"
      data-ls-a="${d.like}" data-ls-b="${d.index}">${escapeHtml(d.name)} vergleichen …</button>`).join(' ');
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
                const auto = sheetChords(ed.score, ed.sheet, this.library).find(c => c.name === name)?.auto;
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
                /** @type {?HTMLInputElement} */ (this.tab?.querySelector(`[data-ls="cutText"][data-ls-index="${at}"]`))?.focus();
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
                /** @type {?HTMLInputElement} */ ([...this.tab?.querySelectorAll('[data-ls="linkLabel"]') ?? []].at(-1))?.focus();
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
     * Dialog "Patterns aus Spur vorschlagen": leitet je Abschnitt das häufigste Pattern einer Begleitspur ab, fasst gleiche
     * zusammen (mit den Abschnitten, in denen sie vorkommen, als Vorschlag für "wann") und zeigt das ähnlichste
     * Katalog-Pattern. Übernommen werden sie in die Patterns des Songs; Patterns ohne Gegenstück kommen gleich in den Katalog.
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
            ${escapeHtml(trackName(t))}</option>`).join('')}</select></div>
        <div id="patternSuggestions"></div>
        <div class="struct-actions">
          <button class="btn btn-primary" type="button" id="patternApply">Übernehmen</button>
          <button class="btn" type="button" id="patternCancel">Abbrechen</button>
        </div>
      </div>`);
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
            for (const s of suggestPatterns(score, Number(source.value), this.catalog)) {
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
                    const candidates = this.catalog.filter(p => p.technique === g.derived.technique
                        && p.timeSignature === g.derived.timeSignature);
                    const n = fresh.indexOf(g);
                    return `<tr>
              <td>${patternGridHtml(g.derived)}
                <span class="efield-hint">${TECHNIQUES[g.derived.technique]}: ${escapeHtml(g.names.join(', '))},
                  ${g.matching} von ${g.bars} Takten</span></td>
              <td><select data-suggest="${k}">
                <option value="">nicht übernehmen</option>
                ${g.exact ? '' : '<option value="+" selected>neu in den Katalog …</option>'}
                ${candidates.map(p => `<option value="${escapeHtml(p.id)}"${g.exact && p === g.best ? ' selected' : ''}>
                  ${escapeHtml(p.name)}${p === g.best ? ` (${Math.round(g.score * 100)} %)` : ''}${
                        inSong.has(p.id) ? ', schon im Song' : ''}</option>`).join('')}
              </select>
              ${g.exact ? '' : `<input type="text" data-suggest-name="${k}" placeholder="Name des neuen Patterns"
                value="${escapeHtml(n ? `${title} ${n + 1}` : title)}">`}</td>
              <td><input type="text" data-suggest-when="${k}" placeholder="${WHEN_PLACEHOLDER}"
                value="${escapeHtml(groups.length === 1 ? 'ganzer Song' : g.names.join(', '))}"></td>
            </tr>`;
                }).join('')}</tbody>
        </table>
        <p class="hint">Je Abschnitt zählt das häufigste Pattern; gleiche Patterns stehen in einer Zeile. „Wann“ ist ein
          Vorschlag aus den Abschnitten und lässt sich ändern.</p>`
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
                    id: patternId(name, [...this.catalog, ...added]), name, technique: d.technique,
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
                    const data = await savePatterns([...this.catalog, ...added]);
                    this.catalog = data.patterns;
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
     * Dialog "Abschnitte vergleichen", wie ein Diff-Editor: oben die beiden Abschnitte (Auswahl),* darunter nur die
     * Taktpaare, die sich unterscheiden (compareSectionBars() in sheet.js: der erste Takt des einen mit dem ersten
     * des anderen usw.), je Spur links und rechts der Takt als Tab mit Akkorden und Text, Unterschiede rot.
     * Dazwischen → (linken Takt rechts übernehmen) und ← (umgekehrt): Übernommen wird der ganze Takt der Spur mit
     * Noten, Text und Akkorden (copyBars() in notation.js), je Spur, je Taktpaar oder alle auf einmal, je ein Schritt
     * für "Rückgängig". Danach zeigt der Dialog den neuen Stand; gleicht der Abschnitt dem anderen auf dem Blatt (Text
     * und Akkorde), steht er dort nur einmal (collapseSections()).
     *
     * Eine erste Fassung hatte darüber Text und Akkorde nebeneinander mit eigenen Knöpfen ("Akkorde | Text | Beides");
     * entfallen, der Taktvergleich reicht. Ohne Erklärtexte, der Dialog ist selbsterklärend.
     *
     * Geöffnet aus der Meldung unter der Vorschau (ungleiches Vorkommen und erstes seiner Gruppe) oder mit dem Knopf
     * daneben; dann sind die ersten ungleichen Vorkommen einer Gruppe vorausgewählt, sonst die ersten zwei einer Gruppe.
     * Vergleichen lässt sich jedes Paar.
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
        // Übernahmen in diesem Dialog: so oft geht "Rückgängig" hier (Strg+Z wirkt nicht, solange ein Dialog offen ist).
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
        const arrows = (attrs, what) => `<span class="cmp-arrows">
      <button type="button" class="ebtn" data-cmp-bars="right" ${attrs} title="${what} links nach rechts übernehmen"
        aria-label="${what} links nach rechts übernehmen">→</button>
      <button type="button" class="ebtn" data-cmp-bars="left" ${attrs} title="${what} rechts nach links übernehmen"
        aria-label="${what} rechts nach links übernehmen">←</button></span>`;
        const draw = () => {
            const pick = [a, b].map(i => list[Math.min(i, list.length - 1)]);
            const one = a === b;
            const diff = compareSectionBars(ed.score, pick[0], pick[1]);
            barRows = one ? [] : diff.rows;
            const differing = barRows.filter(r => r.tracks.length);
            const options = sel => list.map((s, i) => `<option value="${i}"${i === sel ? ' selected' : ''}>${
                escapeHtml(s.name || 'Anfang')} · ${barsOf(s)}</option>`).join('');
            const label = side => side ? `Takt ${side.index + 1}` : '–';
            const cell = (t, side, other) => `<div class="cmp-bar-cell"><div class="cmp-bar-track">${
                escapeHtml(trackName(ed.score.tracks[t]))}</div>${barCellHtml(ed.score.tracks[t], side.index, side.pass,
                other.index)}</div>`;
            const rows = barRows.map((r, n) => {
                if (!r.tracks.length) return `<div class="cmp-bar-head"><span>${label(r.left)}</span><span class="efield-hint">
          ohne Gegenüber</span><span>${label(r.right)}</span></div>`;
                return `<div class="cmp-bar-head"><span>${label(r.left)}</span>${arrows(`data-cmp-row="${n}"`,
                        r.tracks.length > 1 ? 'Takt in allen Spuren' : 'Takt')}<span>${label(r.right)}</span></div>`
                    + r.tracks.map(t => `<div class="cmp-bar-row">${cell(t, r.left, r.right)}${r.tracks.length > 1
                        ? arrows(`data-cmp-row="${n}" data-cmp-track="${t}"`, 'Takt dieser Spur') : '<span class="cmp-arrows"></span>'}${
                        cell(t, r.right, r.left)}</div>`).join('');
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
        ${rows.includes('data-cmp-bar=') ? creditHtml('cmp-credit') : ''}`;
            // Die Takte zeichnet alphaTab nachträglich (fillCompareTabs() in sheet.js).
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
            });
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
     * sheet.js), in den gewählten Abschnitten bzw. der Auswahl in den Noten. Vorausgewählt sind die Abschnitte, die
     * im Feld "wann" genannt sind (sonst alle). Takte, die nicht nach Pattern aussehen (Break, Schluss), bleiben, außer
     * mit Häkchen.
     * @returns {void}
     */
    rollOut() {
        const ed = this.editor;
        const score = ed.score;
        const byId = new Map(this.catalog.map(p => [p.id, p]));
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
          <div id="rollSections">${parts.map((s, k) => `<label class="check-field"><input type="checkbox"
            data-roll-section="${k}"> ${escapeHtml(s.name || 'Anfang')} <span class="efield-hint">Takt ${s.from + 1}–${
            s.to + 1}</span></label>`).join('')}</div>
        </fieldset>
        <label class="check-field"><input type="checkbox" id="rollForce"> Auch Takte überschreiben, die von den
          Pattern abweichen (Breaks, Schluss …)</label>
        <p class="hint">Vorausgewählt sind die Abschnitte, die im Feld „wann“ genannt sind, sonst alle. Je Anschlag der
          Griff des Akkords, der dann klingt (aus den Noten, sonst aus dem Akkordkatalog). Überschrieben werden nur
          leere Takte und Takte, die einem Katalog-Pattern entsprechen; Takte mit anderer Taktart als das Pattern bleiben.
        </p>
        <div class="struct-actions">
          <button class="btn btn-primary" type="submit">Ausrollen</button>
          <button class="btn" type="button" id="rollCancel">Abbrechen</button>
        </div>
      </form>`);
        const select = /** @type {HTMLSelectElement} */ (document.getElementById('rollPattern'));
        const target = /** @type {HTMLSelectElement} */ (document.getElementById('rollTarget'));
        const selection = /** @type {?HTMLInputElement} */ (document.getElementById('rollSelection'));
        const boxes = /** @type {HTMLInputElement[]} */ ([...document.querySelectorAll('[data-roll-section]')]);
        const fill = () => {
            const {entry, pattern} = usable[Number(select.value)];
            const preferred = tracks.find(t => t.name.trim().toLowerCase() === pattern.technique);
            target.innerHTML = tracks.map(t => `<option value="${t.index}"${t === preferred ? ' selected' : ''}>
        ${escapeHtml(trackName(t))}</option>`).join('')
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
            const library = await loadChordLibraryOrEmpty();
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
                result = rollOut(ed.alphaTab, score, index, perBar, this.catalog, library, force);
            });

            const list = numbers => numbers.slice(0, 8).map(i => i + 1).join(', ') + (numbers.length > 8 ? ' …' : '');
            ed.toast(`${result.written.length} Takte geschrieben`
                + (result.kept.length ? `; nicht geändert (weichen vom Pattern ab): Takt ${list(result.kept)}` : '')
                + (result.misfit.length ? `; andere Taktart: Takt ${list(result.misfit)}` : '')
                + (result.chordless.length ? `; ohne Akkord (Pausen): Takt ${list(result.chordless)}` : '')
                + (result.gripless.length ? `; ohne Griff (Pausen): ${result.gripless.join(', ')}` : '') + '.');
        });
    }

    /**
     * Dialog "Pattern-Katalog": alle Patterns mit Verwendung; neu aufnehmen, ändern, löschen. Gespeichert wird der ganze
     * Katalog (PUT api/patterns.php); eine Änderung wirkt auf alle Songs, die das Pattern verwenden.
     * @param {?string} [editId] Pattern, das im Formular stehen soll
     * @returns {void}
     */
    catalogDialog(editId = null) {
        const ed = this.editor;
        const current = this.catalog.find(p => p.id === editId) ?? null;
        const rows = Object.entries(TECHNIQUES).map(([technique, label]) => {
            const group = this.catalog.filter(p => p.technique === technique)
                .sort((a, b) => a.timeSignature.localeCompare(b.timeSignature) || a.name.localeCompare(b.name));
            return `<tr><th colspan="5">${label}</th></tr>` + group.map(p => `
        <tr${p.id === editId ? ' class="ebar-cursor"' : ''}>
          <td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.timeSignature)}</td>
          <td>${patternGridHtml(p)}</td>
          <td class="efield-hint">${this.usage[p.id] ? `${this.usage[p.id]} Song${this.usage[p.id] === 1 ? '' : 's'}`
                : ''}</td>
          <td><button type="button" class="ebtn ebtn-text" data-pattern-edit="${escapeHtml(p.id)}">Ändern</button></td>
        </tr>`).join('');
        }).join('');
        const p = current ?? {id: '', name: '', technique: 'strumming', timeSignature: '4/4', grid: 8};
        openDialog(`
      <h2>Pattern-Katalog</h2>
      <table class="ebar-table ebar-catalog"><tbody>${rows}</tbody></table>
      <form class="struct-form" id="patternForm">
        <fieldset>
          <legend>${current ? `„${escapeHtml(current.name)}“ ändern` : 'Neues Pattern'}</legend>
          <div class="form-field"><label for="patName">Name</label>
            <input type="text" id="patName" value="${escapeHtml(p.name)}" required maxlength="80"></div>
          <div class="form-field"><label for="patTechnique">Technik</label>
            <select id="patTechnique">${Object.entries(TECHNIQUES).map(([t, label]) =>
            `<option value="${t}"${t === p.technique ? ' selected' : ''}>${label}</option>`).join('')}</select></div>
          <div class="form-field"><label for="patTs">Taktart</label>
            <input type="text" id="patTs" list="patSignatures" value="${escapeHtml(p.timeSignature)}">
            <datalist id="patSignatures">${TIME_SIGNATURES.map(t => `<option value="${t}">`).join('')}</datalist></div>
          <div class="form-field"><label for="patGrid">Raster</label>
            <select id="patGrid"><option value="8"${p.grid === 8 ? ' selected' : ''}>Achtel</option>
              <option value="16"${p.grid === 16 ? ' selected' : ''}>Sechzehntel</option></select></div>
          <div class="form-field"><label for="patTokens">Pattern</label>
            <input type="text" id="patTokens" value="${escapeHtml(patternTokens(p).length ? patternNotation(p) : '')}"
              spellcheck="false" autocapitalize="off"></div>
          <div class="form-field"><label>Raster (zum Anklicken; Zählzeiten aus Taktart und Raster)</label>
            <div id="patPreview" class="pgrid-preview"></div></div>
          <p class="hint">Eingabe im Feld oder per Klick ins Raster. Großbuchstabe = betont.
            Strumming Patterns, je Rasterplatz ein Zeichen: d Plektrum abwärts (${glyph(GLYPHS.pickDown, true)}), u Plektrum
            aufwärts (${glyph(GLYPHS.pickUp, true)}), x gedämpft (×), . klingen lassen; z. B. d.du.udu oder D.duD.du; im
            Raster wechselt ein Klick auf das Zeichen nichts → abwärts → aufwärts → gedämpft, ein Klick auf die Zählzeit betont
            (fett).
            Picking Patterns als Fingersatz, je Rasterplatz ein Schritt, durch Leerzeichen getrennt: p Daumen auf dem tiefen
            Bass, q Daumen auf dem zweiten Bass, i g-Saite, m b-Saite, a e-Saite; ohne Leerzeichen zugleich (pa, ima),
            . klingen lassen, x Pause; z. B. p i q m p i q m. Im Raster: Klick auf die Saite setzt den Finger, Klick
            auf die Zählzeit betont (fett) bzw. setzt eine Pause (x auf den zuletzt gespielten Saiten).${current && this.usage[current.id] ? ` Eine Änderung wirkt auf ${this.usage[current.id]}
            Song${this.usage[current.id] === 1 ? '' : 's'}.` : ''}</p>
        </fieldset>
        <div class="struct-actions">
          <button class="btn btn-primary" type="submit">${current ? 'Speichern' : 'Aufnehmen'}</button>
          ${current ? '<button class="btn" type="button" id="patNew">Neues Pattern</button>' : ''}
          ${current ? '<button class="btn btn-danger" type="button" id="patDelete">Löschen</button>' : ''}
          <button class="btn" type="button" id="patClose">Schließen</button>
        </div>
      </form>`);
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
                id: current?.id ?? patternId(name, this.catalog), name, technique,
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
                : `<span class="efield-hint">${escapeHtml(error || (tooLong ? `Nur ${slots} Rasterplätze.`
                    : 'Raster passt nicht zur Taktart.'))}</span>`;
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
            button.addEventListener('click', () => this.catalogDialog(/** @type {HTMLElement} */ (button).dataset.patternEdit));
        }
        document.getElementById('patClose').addEventListener('click', () => {
            closeOverlay();
            this.render();
        });
        document.getElementById('patNew')?.addEventListener('click', () => this.catalogDialog());
        const store = async (patterns, message) => {
            try {
                const data = await savePatterns(patterns);
                this.catalog = data.patterns;
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
            if (await store(this.catalog.filter(x => x !== current), `„${current.name}“ gelöscht.`)) this.catalogDialog();
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
            const patterns = current ? this.catalog.map(x => x === current ? pattern : x) : [...this.catalog, pattern];
            if (await store(patterns, current ? `„${name}“ gespeichert.` : `„${name}“ in den Katalog aufgenommen.`)) {
                this.catalogDialog(pattern.id);
            }
        });
    }
}
