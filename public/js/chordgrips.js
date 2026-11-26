/**
 * Griffe zu einem Akkordnamen: sucht alle spielbaren Griffe, deren Töne zu den Tönen des Akkords passen (parseChord()
 * in chordtheory.js), gibt ihnen eine Priorität (FoundGrip.priority) und ordnet sie (compareGrips()). Zu jedem Namen
 * wird immer mindestens ein Griff gefunden (RELAXATIONS). Die Regeln stehen in docs/Akkorddialog.md: Spanne, Finger
 * und Barré (Abschnitt 3, barreOf()), Prioritäten (Abschnitt 4) und Reihenfolge innerhalb einer Prio (Abschnitt 5).
 *
 * Griffe sind Bünde von der tiefen Saite aus, -1 = nicht gespielt, als Text wie im Katalog ("x32010").
 */

import {nameChord, parseChord} from './chordtheory.js';

/** Standard-Tuning als MIDI-Tonhöhen von der tiefen Saite aus (E2 A2 D3 G3 B3 E4). */
export const STANDARD_TUNING = [40, 45, 50, 55, 59, 64];

/** Größte Spanne in Bünden (höchster minus tiefster gegriffener Bund): drei Bünde (Bund 2 bis 4), siehe docs/Akkorddialog.md. */
const MAX_SPAN = 2;

/**
 * Die Suche lockert ihre Bedingungen schrittweise und nimmt die erste Lockerung, die Griffe liefert (docs/Akkorddialog.md,
 * Abschnitt 3): maxSpan ist die größte Spanne, essentialOnly lässt die Töne weg, die den Akkord nicht bestimmen.
 */
const RELAXATIONS = [
    {maxSpan: MAX_SPAN, essentialOnly: false},
    {maxSpan: MAX_SPAN + 1, essentialOnly: false},
    {maxSpan: MAX_SPAN + 2, essentialOnly: false},
    {maxSpan: MAX_SPAN, essentialOnly: true},
    {maxSpan: MAX_SPAN + 2, essentialOnly: true},
];

/** So viele Saiten muss ein Griff mindestens spielen, um Priorität 1 zu haben (docs/Akkorddialog.md, Abschnitt 4). */
const PREFERRED_MIN_STRINGS = 4;

/** Höchste Zahl an Fingern (der Daumen am Hals zählt nicht). */
const MAX_FINGERS = 4;

/** Tonnamen für die Meldungen von checkGrip(). */
const TONE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];

/**
 * Merkmale eines Griffs.
 * @typedef {Object} GripFeatures
 * @property {number} fingers Zahl der Finger, bei Barré mit dem Barré als einem Finger
 * @property {number} barre 1, wenn der Griff mit einem Barré gegriffen wird (barreOf()), sonst 0
 * @property {number} span Spanne in Bünden zwischen dem tiefsten und höchsten gegriffenen Bund
 * @property {number} position tiefster gegriffener Bund (0 ohne gegriffene Saite)
 * @property {number} played Zahl der gespielten Saiten
 * @property {number} ascending 1, wenn die Tonhöhe von der tiefsten zur höchsten gespielten Saite nie fällt (gleiche Töne sind erlaubt)
 * @property {number} inversion 1, wenn die tiefste gespielte Saite nicht den Grundton (bei Slash-Akkord den Basston) spielt
 * @property {number} strummable 1, wenn von der tiefsten gespielten Saite bis zur hohen e-Saite jede Saite gespielt wird (durchschlagbar)
 * @property {number} contiguous 1, wenn zwischen der tiefsten und der höchsten gespielten Saite keine Saite fehlt
 */

/**
 * Schreibt einen Griff als Text.
 * @param {number[]} frets Bünde von der tiefen Saite aus, -1 = nicht gespielt
 * @returns {string} z. B. "x32010", ab Bund 10 mit "-" getrennt
 */
export function gripText(frets) {
    return frets.map(f => f < 0 ? 'x' : String(f)).join(frets.some(f => f > 9) ? '-' : '');
}

/**
 * Das Barré eines Griffs (Regeln: docs/Akkorddialog.md, Abschnitt 3).
 * @param {number[]} frets Bünde von der tiefen Saite aus, -1 = nicht gespielt
 * @returns {?{fret: number, from: number, to: number}} Bund und die Saiten (Index von der tiefen aus; to ist die e-Saite),
 *   null ohne Barré
 */
export function barreOf(frets) {
    const pressed = frets.filter(f => f > 0);
    if (pressed.length < MAX_FINGERS) return null;
    const fret = Math.min(...pressed);
    const from = frets.indexOf(fret);
    const to = frets.length - 1;
    for (let i = from; i <= to; i++) if (frets[i] < fret) return null;
    if (frets.filter(f => f === fret).length < 2) return null;
    return {fret, from, to};
}

/**
 * Prüft nur die Töne eines Griffs gegen einen Akkord (nicht, ob er sich greifen lässt): gespielt werden nur Töne des Akkords,
 * alle nötigen Töne kommen vor, und bei einem Slash-Akkord ist der Basston der Ton der tiefsten gespielten Saite.
 * @param {import('./chordtheory.js').ParsedChord} chord zerlegter Akkordname
 * @param {number[]} frets Bünde von der tiefen Saite aus, -1 = nicht gespielt
 * @param {number[]} [tuning] Tonhöhen der leeren Saiten von der tiefen Saite aus
 * @param {boolean} [essentialOnly] nur Grundton, Terz (bzw. Sekunde/Quarte bei sus) und Septime sind nötig
 * @returns {?string} null, wenn die Töne passen, sonst der Grund
 */
export function gripToneProblem(chord, frets, tuning = STANDARD_TUNING, essentialOnly = false) {
    const strings = frets.map((f, i) => i).filter(i => frets[i] >= 0);
    if (!strings.length) return 'Keine Saite gespielt';
    const pitch = i => (tuning[i] + frets[i]) % 12;
    const played = new Set(strings.map(pitch));
    const allowed = new Set(chord.tones);
    const foreign = [...played].filter(pc => !allowed.has(pc));
    if (foreign.length) return `Töne, die nicht zum Akkord gehören: ${foreign.map(pc => TONE_NAMES[pc]).join(' ')}`;
    const essential = ['root', 'second', 'third', 'fourth', 'seventh'];
    const required = chord.steps.filter(s => !s.optional && s.role !== 'bass' && (!essentialOnly || essential.includes(s.role)));
    const missing = required.filter(s => !played.has(s.pitchClass));
    if (missing.length) return `Nötige Töne fehlen: ${missing.map(s => TONE_NAMES[s.pitchClass]).join(' ')}`;
    if (chord.bass !== null && pitch(strings[0]) !== chord.bass) return `Der tiefste Ton muss ${TONE_NAMES[chord.bass]} sein`;
    return null;
}

/**
 * Akkordnamen, zu denen ein Griff passt (Griff zu Name): siehe nameChord() in chordtheory.js.
 * @param {number[]} frets Bünde von der tiefen Saite aus, -1 = nicht gespielt
 * @param {number[]} [tuning] Tonhöhen der leeren Saiten von der tiefen Saite aus
 * @param {number} [limit] höchstens so viele Namen
 * @returns {string[]} bester Name zuerst; leer, wenn es weniger als zwei verschiedene Töne sind oder nichts passt
 */
export function nameGrip(frets, tuning = STANDARD_TUNING, limit = 6) {
    const tones = frets.map((f, i) => f < 0 ? null : (tuning[i] + f) % 12).filter(t => t !== null);
    return tones.length ? nameChord(tones, tones[0], limit) : [];
}

/**
 * Prüft, ob ein Griff zum Akkord passt und spielbar ist, und ermittelt seine Merkmale.
 * @param {import('./chordtheory.js').ParsedChord} chord zerlegter Akkordname
 * @param {number[]} frets Bünde von der tiefen Saite aus, -1 = nicht gespielt
 * @param {number[]} [tuning] Tonhöhen der leeren Saiten von der tiefen Saite aus
 * @param {{maxSpan?: number, essentialOnly?: boolean}} [limits] Lockerung der Suche (RELAXATIONS); Standard: die Regel
 * @returns {{features: GripFeatures}|{problem: string}} die Merkmale oder der Grund, warum der Griff nicht passt
 */
export function checkGrip(chord, frets, tuning = STANDARD_TUNING, {maxSpan = MAX_SPAN, essentialOnly = false} = {}) {
    if (frets.length !== tuning.length || frets.some(f => !Number.isInteger(f) || f < -1)) {
        return {problem: `Ein Griff hat ${tuning.length} Angaben (Bund oder x)`};
    }
    const strings = frets.map((f, i) => i).filter(i => frets[i] >= 0);
    const minPlayed = Math.min(3, chord.tones.length);
    if (strings.length < minPlayed) return {problem: `Weniger als ${minPlayed} gespielte Saiten`};

    const toneProblem = gripToneProblem(chord, frets, tuning, essentialOnly);
    if (toneProblem) return {problem: toneProblem};
    const pitch = i => (tuning[i] + frets[i]) % 12;
    const lowest = pitch(strings[0]);

    // Hand: Spanne und Finger
    const fretted = strings.map(i => frets[i]).filter(f => f > 0);
    const min = fretted.length ? Math.min(...fretted) : 0;
    const max = fretted.length ? Math.max(...fretted) : 0;
    if (max - min > maxSpan) return {problem: `Spanne über ${maxSpan + 1} Bünde`};
    let fingers = fretted.length;
    let barre = 0;
    if (barreOf(frets)) {
        fingers = 1 + fretted.filter(f => f > min).length;
        barre = 1;
    }
    if (fingers > MAX_FINGERS) return {problem: `Mehr als ${MAX_FINGERS} Finger nötig`};
    let rising = 1;
    let previous = -Infinity;
    for (const i of strings) {
        const absolute = tuning[i] + frets[i];
        if (absolute < previous) rising = 0;
        previous = absolute;
    }

    const first = strings[0];
    const last = strings[strings.length - 1];
    const inner = frets.filter((f, i) => i > first && i < last && f < 0).length;
    return {
        features: {
            fingers,
            barre,
            span: max - min,
            position: min,
            played: strings.length,
            ascending: rising,
            inversion: lowest === (chord.bass ?? chord.root) ? 0 : 1,
            strummable: last === frets.length - 1 && inner === 0 ? 1 : 0,
            contiguous: inner === 0 ? 1 : 0,
        },
    };
}

/**
 * Merkmale eines Griffs.
 * @param {import('./chordtheory.js').ParsedChord} chord zerlegter Akkordname
 * @param {number[]} frets Bünde von der tiefen Saite aus, -1 = nicht gespielt
 * @param {number[]} [tuning] Tonhöhen der leeren Saiten von der tiefen Saite aus
 * @param {{maxSpan?: number, essentialOnly?: boolean}} [limits] Lockerung der Suche (RELAXATIONS)
 * @returns {?GripFeatures} null, wenn der Griff nicht zum Akkord passt oder nicht spielbar ist (Grund: checkGrip())
 */
export function gripFeatures(chord, frets, tuning = STANDARD_TUNING, limits = {}) {
    const check = checkGrip(chord, frets, tuning, limits);
    return 'features' in check ? check.features : null;
}

/**
 * Schlüssel zum Ordnen von Griffen innerhalb einer Priorität (kleiner = besser); die Reihenfolge steht in docs/Akkorddialog.md,
 * Abschnitt 5.
 * @param {GripFeatures} features Merkmale des Griffs
 * @returns {number[]} Schlüssel, Zahl für Zahl zu vergleichen
 */
export function gripRank(features) {
    const hardFour = features.fingers === 4 && !features.barre ? 1 : 0;
    return [features.position, features.span, hardFour, features.fingers, -features.played];
}

/**
 * Vergleich zweier Griffe für Array.sort(): negativ, wenn a besser ist.
 * @param {GripFeatures} a Merkmale von a
 * @param {GripFeatures} b Merkmale von b
 * @returns {number}
 */
export function compareGrips(a, b) {
    const ka = gripRank(a);
    const kb = gripRank(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    return 0;
}

/**
 * Ein gefundener Griff.
 * @typedef {Object} FoundGrip
 * @property {string} grip Griff als Text
 * @property {number[]} frets Bünde von der tiefen Saite aus
 * @property {GripFeatures} features Merkmale
 * @property {boolean} preferred ob der Griff Priorität 1 hat
 * @property {number} priority Priorität 1 bis 4, 1 = höchste (docs/Akkorddialog.md, Abschnitt 4)
 */

/**
 * Sucht Griffe für einen Akkordnamen, beste zuerst.
 * @param {string} name Akkordname, z. B. "Am7" oder "D/F#"
 * @param {Object} [options] Einstellungen
 * @param {number[]} [options.tuning] Tonhöhen der leeren Saiten von der tiefen Saite aus, Standard: Standard-Tuning
 * @param {number} [options.maxFret] höchster Bund, Standard 12
 * @param {number} [options.limit] höchstens so viele Griffe, Standard alle
 * @param {boolean} [options.all] alle Griffe, auch wenn es welche mit Priorität 1 gibt
 * @returns {FoundGrip[]} die Griffe mit Priorität 1, gibt es keine, alle übrigen; mit all immer alle, nach Priorität und
 *   compareGrips() geordnet; leer bei einem unbekannten Namen
 */
export function findGrips(name, {tuning = STANDARD_TUNING, maxFret = 12, limit = Infinity, all = false} = {}) {
    const chord = parseChord(name);
    if (!chord) return [];
    const allowed = new Set(chord.tones);

    /**
     * Alle Griffe einer Lockerung, nach Priorität und compareGrips() geordnet.
     * @param {{maxSpan: number, essentialOnly: boolean}} relaxation Lockerung
     * @returns {FoundGrip[]}
     */
    const search = relaxation => {
        /** @type {Map<string, number[]>} */
        const found = new Map();
        // Je Lage (Fenster aus Bünden) alle Kombinationen, bei denen jede Saite entweder stumm, leer oder ein Akkordton im
        // Fenster ist.
        for (let start = 1; start <= Math.max(1, maxFret - relaxation.maxSpan); start++) {
            const options = tuning.map(open => {
                const list = [-1];
                for (let fret = 0; fret <= maxFret; fret++) {
                    if (fret > 0 && (fret < start || fret > start + relaxation.maxSpan)) continue;
                    if (allowed.has((open + fret) % 12)) list.push(fret);
                }
                return list;
            });
            const frets = Array(tuning.length).fill(-1);
            const walk = i => {
                if (i === tuning.length) {
                    const key = gripText(frets);
                    if (!found.has(key)) found.set(key, [...frets]);
                    return;
                }
                for (const fret of options[i]) {
                    frets[i] = fret;
                    walk(i + 1);
                }
            };
            walk(0);
        }
        /** @type {FoundGrip[]} */
        const result = [];
        for (const [grip, frets] of found) {
            const features = gripFeatures(chord, frets, tuning, relaxation);
            if (!features) continue;
            // Zweiklang: nur zwei verschiedene Töne, die hohen Saiten dürfen schweigen (Powerchord x355xx)
            const twoTones = chord.tones.length <= 2;
            const strummed = twoTones
                ? !!features.contiguous && features.played >= 3
                : !!features.strummable && features.played >= PREFERRED_MIN_STRINGS;
            const preferred = !features.inversion && strummed && !!features.ascending;
            const priority = preferred ? 1
                : !features.inversion && features.contiguous && features.ascending ? 2 : features.contiguous ? 3 : 4;
            result.push({grip, frets, features, preferred, priority});
        }
        result.sort((a, b) => a.priority - b.priority || compareGrips(a.features, b.features) || a.grip.localeCompare(b.grip));
        return result;
    };

    for (const relaxation of RELAXATIONS) {
        const result = search(relaxation);
        if (!result.length) continue;
        const proposals = all || !result.some(g => g.preferred) ? result : result.filter(g => g.preferred);
        return proposals.slice(0, limit);
    }
    return [];
}
