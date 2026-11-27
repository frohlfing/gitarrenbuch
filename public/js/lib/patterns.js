/**
 * Strumming und Picking Patterns: Schreibweise, Raster und Zählzeiten, Katalog (data/patterns.json, api/patterns.php),
 * Ableiten aus den Noten, Vorschläge aus einer Begleitspur, Ausrollen auf eine Spur.
 *
 * Ein Pattern beschreibt einen Takt im Raster (Achtel oder Sechzehntel), ein Zeichen bzw. Schritt je Rasterplatz. Die
 * Zählzeiten werden nicht eingegeben, sondern aus Taktart und Raster berechnet (countLabels()). Betont wird mit
 * Großbuchstaben: So steht alles in einem Feld und kann nicht auseinanderlaufen (üblich wäre ein ">" über dem Schlag,
 * so zeigt es das Raster).
 * - Strumming Patterns (strumming), `strokes`: d = Plektrum abwärts, u = Plektrum aufwärts, x = gedämpfter Anschlag, .
 *   = nichts (der vorige Anschlag klingt weiter, am Anfang Pause); groß (D, U, X) = betont. Beispiel Folk in 4/4,
 *   Achtel: "d.du.udu",
 *   mit Betonung auf 1 und 3 "D.duD.du".
 * - Picking Patterns (picking), `steps`, ein Schritt je Rasterplatz, durch Leerzeichen getrennt, als Fingersatz.
 *   Die Saite folgt aus dem Finger wie in Gitarrenschulen üblich: p = Daumen auf dem tiefen Bass
 *   (tiefste gegriffene Saite des Akkords), q = Daumen auf dem zweiten Bass (Wechselbass), i = g-Saite, m = b-Saite,
 *   a = hohe e-Saite. Mehrere Buchstaben ohne Leerzeichen klingen zugleich ("pa", "ima"), groß = betont, . = klingen
 *   lassen, x = Pause. Beispiel Travis in 4/4, Achtel: "p i q m p i q m". Mit p und q gilt ein Pattern für jeden
 *   Akkord (pickString()); einen Finger auf einer anderen Saite gibt es deshalb nicht.
 *
 * Eine Änderung an einem Pattern des Katalogs gilt für alle Songs, die es verwenden. Pattern und Spur sind nicht
 * gekoppelt: Die Spur ist die genaue Ausführung, das Pattern die verallgemeinerte Beschreibung für das Blatt.
 */

import {chordsTrack, splitTicks, timeline, WHOLE_TICKS} from './notation.js';
import {chordKey, parseGrip} from './chords.js';

/** @typedef {import('../../../types/alphatab').model.Bar} Bar */
/** @typedef {import('../../../types/alphatab').model.Beat} Beat */
/** @typedef {import('../../../types/alphatab').model.Score} Score */
/** @typedef {import('../../../types/alphatab').model.Chord} Chord */
/** @typedef {typeof import('../../../types/alphatab')} AlphaTabModule */

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
 * @property {boolean} accent betont (Buchstabe großgeschrieben)
 */

/**
 * Kopie eines Tons mit anderer Betonung.
 * @param {PickNote} note Ton
 * @param {boolean} accent betont
 * @returns {PickNote} Kopie
 */
export function withAccent(note, accent) {
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
 * @param {Pattern[]} patternCatalog Katalog
 * @returns {string}
 */
export function patternId(name, patternCatalog) {
    const base = name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'pattern';
    const taken = new Set(patternCatalog.map(p => p.id));
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
            // Richtung nur aus dem Anschlagzeichen (sd/su): Ein Brush (Arpeggio) sagt, wie der Akkord aufgefächert
            // klingt, nicht, wohin die Schlaghand geht (Guitar-Pro-Transkriptionen haben z. B. Brush ab auf einem
            // "und").
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
 * @param {Object<string, string[]>} chordCatalog Akkord-Katalog
 * @returns {?number[]} Bünde von der tiefen E-Saite aus (-1 = nicht gespielt); null ohne sechssaitigen Griff
 */
export function gripFor(event, chordCatalog) {
    const own = event.chord.strings;
    if (own.length === 6 && own.some(f => f >= 0)) return [...own].reverse();
    const grip = chordCatalog?.[chordKey(event.name)]?.[0];
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
 * klingenden Akkords, so lange bis zum nächsten Anschlag (bei krummen Längen angebunden). Ohne Akkord Pausen.
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
 * Rollt Patterns auf eine Spur aus (Patterns × Akkorde). Überschrieben werden nur Takte, die leer sind (nur Pausen)
 * oder selbst einem Katalog-Pattern entsprechen; andere gelten als bewusste Ausnahme (Break, Schluss) und bleiben,
 * außer mit force. Takte mit anderer Taktart als das Pattern bleiben unverändert.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Score} score Noten (frisch eingelesen), werden geändert
 * @param {number} trackIndex Zielspur (sechs Saiten)
 * @param {Array<?Pattern>} perBar Patterns je Takt, null für Takte, die bleiben sollen
 * @param {Pattern[]} patternCatalog Katalog (für "entspricht einem Pattern")
 * @param {Object<string, string[]>} chordCatalog Akkord-Katalog
 * @param {boolean} force auch abweichende Takte überschreiben
 * @returns {{written: number[], kept: number[], misfit: number[], chordless: number[], gripless: string[]}}
 *   Takt-Indizes; gripless: Akkorde ohne Griff (weder in den Noten noch im Katalog), dort Pausen
 */
export function rollOut(alphaTab, score, trackIndex, perBar, patternCatalog, chordCatalog, force) {
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
            if (!derived || !patternCatalog.some(p => similarity(p, derived) === 1)) {
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
            const grip = gripFor(event, chordCatalog);
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
 * @param {Pattern[]} patternCatalog Katalog
 * @returns {{from: number, to: number, section: string, derived: ?DerivedPattern, matching: number, bars: number,
 *   best: ?Pattern, score: number}[]} je Abschnitt; best null, wenn der Katalog nichts mit Technik und Taktart hat
 */
export function suggestPatterns(score, trackIndex, patternCatalog) {
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
        for (const pattern of top ? patternCatalog : []) {
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
