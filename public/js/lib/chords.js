/**
 * Akkorde und Griffe: Schlüssel und Schreibweise der Griffe, Transponieren von Akkordnamen und Tonarten,
 * Tonart-Erkennung, ein Griffbild je Akkordname (normalizeChords()).
 *
 * Der Akkord-Katalog (api/chords.php) ordnet jedem Akkordnamen (kleingeschrieben, z. B. "c", "f#m", "d/f#") seine
 * Griffe in Standard-Tuning zu. Der erste Griff ist der Standard: der in den Songs häufigste. Ein Griff ist ein
 * String von der tiefen E-Saite aus, "x" für nicht gespielt, z. B. "x32010" (C). Liegt ein Bund über 9, sind die
 * Saiten mit "-" getrennt, z. B. "x-10-12-12-12-10".
 *
 * In den Noten zeigt jede Spur je Akkordname genau ein Griffbild, und zwar das des Katalogs. Nur Akkorde, die
 * der Katalog nicht kennt (oder Spuren in anderem Tuning), behalten ihren Griff aus der Datei.
 */

import {barreOf} from './chordgrips.js';
import {parseChord} from './chordtheory.js';

/** @typedef {import('../../../types/alphatab').model.Score} Score */
/** @typedef {import('../../../types/alphatab').model.Staff} Staff */
/** @typedef {import('../../../types/alphatab').model.Chord} Chord */
/** @typedef {typeof import('../../../types/alphatab')} AlphaTabModule */

/**
 * Akkord-Katalog: Akkordname (klein) → Griffe, Standardgriff zuerst.
 * @typedef {Object<string, string[]>} ChordCatalog
 */

/** Abstände der Saiten zur tiefen E-Saite in Halbtönen bei Standard-Tuning (E A D G H E, tiefe E zuerst). */
const STANDARD_INTERVALS = [0, 5, 10, 15, 19, 24];

/** Ab so vielen gespielten Saiten gilt ein Griff als echter Griff und nicht als Bruchstück einer Melodie. */
const MIN_PLAYED_STRINGS = 3;

/** Höchster Bund, der noch ab dem 1. Bund gezeichnet wird; darüber beginnt das Griffbild beim tiefsten Bund. */
const MAX_FRET_FROM_NUT = 4;

/**
 * Schlüssel eines Akkordnamens im Katalog.
 * @param {string} name Akkordname aus den Noten, z. B. "F#m"
 * @returns {string} z. B. "f#m"
 */
export function chordKey(name) {
    return name.trim().toLowerCase();
}

/**
 * Liest einen Griff.
 * @param {string} grip z. B. "x32010" oder "x-10-12-12-12-10"
 * @returns {number[]} Bünde von der tiefen E-Saite aus, -1 = nicht gespielt
 */
export function parseGrip(grip) {
    const parts = grip.includes('-') ? grip.split('-') : [...grip];
    return parts.map(f => f === 'x' ? -1 : Number(f));
}

/**
 * Schreibt einen Griff.
 * @param {number[]} frets Bünde von der tiefen E-Saite aus, -1 = nicht gespielt
 * @returns {string} z. B. "x32010"
 */
export function formatGrip(frets) {
    const parts = frets.map(f => f < 0 ? 'x' : String(f));
    return parts.join(frets.some(f => f > 9) ? '-' : '');
}

/**
 * Griff eines alphaTab-Akkords. alphaTab zählt die Saiten von der hohen e-Saite aus.
 * @param {Chord} chord Akkord
 * @returns {string} Griff von der tiefen E-Saite aus
 */
export function gripOf(chord) {
    return formatGrip([...chord.strings].reverse());
}

/**
 * Anzahl der gespielten Saiten eines Griffs.
 * @param {string} grip Griff
 * @returns {number} gespielte Saiten
 */
export function playedStrings(grip) {
    return parseGrip(grip).filter(f => f >= 0).length;
}

/**
 * Prüft, ob ein Notensystem sechs Saiten im Standard-Tuning hat (auch eine Oktave versetzt).
 * @param {Staff} staff Notensystem
 * @returns {boolean} true, wenn der Katalog für dieses Notensystem gilt
 */
export function isStandardTuning(staff) {
    const tuning = [...staff.tuning].reverse();
    return tuning.length === STANDARD_INTERVALS.length
        && tuning.every((pitch, i) => pitch - tuning[0] === STANDARD_INTERVALS[i]);
}

/**
 * Bund, bei dem das Griffbild beginnt.
 * @param {number[]} frets Bünde von der tiefen E-Saite aus
 * @returns {number} 1 für Griffe bis zum 4. Bund, sonst der tiefste gegriffene Bund
 */
export function diagramFirstFret(frets) {
    const fretted = frets.filter(f => f > 0);
    if (!fretted.length || Math.max(...fretted) <= MAX_FRET_FROM_NUT) return 1;
    return Math.min(...fretted);
}

/**
 * Bund eines Barrés (ein Finger über mehrere Saiten), Regeln siehe barreOf() in chordgrips.js (F 133211, Bm x24432,
 * F#m xx4222). alphaTab zeichnet den Balken von der ersten bis zur letzten Saite in diesem Bund.
 * @param {number[]} frets Bünde von der tiefen E-Saite aus
 * @returns {?number} Bund, null ohne Barré
 */
export function barreFret(frets) {
    return barreOf(frets)?.fret ?? null;
}

/**
 * Wählt das Griffbild eines Akkords: den Standardgriff des Katalogs, sonst den meistgenutzten echten Griff aus
 * der Datei; mit preferOwn umgekehrt (auf der Bearbeitungsseite gesetzte Griffe gelten).
 * @param {string} name Akkordname
 * @param {Map<string, number>} ownGrips Griffe aus der Datei mit Anzahl der Schläge
 * @param {?ChordCatalog} chordCatalog Katalog, null für Notensysteme in anderem Tuning
 * @param {boolean} [preferOwn] eigener Griff vor dem des Katalogs
 * @returns {?string} Griff, null, wenn es keinen echten Griff gibt
 */
export function chooseGrip(name, ownGrips, chordCatalog, preferOwn = false) {
    const known = chordCatalog?.[chordKey(name)]?.[0];
    const own = [...ownGrips].filter(([grip]) => playedStrings(grip) >= MIN_PLAYED_STRINGS).sort((a, b) => b[1] - a[1]);
    if (preferOwn && own.length) return own[0][0];
    return known ?? own[0]?.[0] ?? null;
}

/** Tonhöhenklassen der Stammtöne (H und B für die deutsche bzw. englische Schreibweise). */
const NOTE_CLASSES = {c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11, h: 11};

/** Stufen einer Dur-Tonleiter in Halbtönen über dem Grundton. */
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];

/** So viel besser (Anteil passender Töne, Akkorde und Noten zusammen) muss eine Tonart passen, damit sie gilt. */
const KEY_MIN_GAIN = 0.05;

/** So viel schlechter als die beste darf die Tonart des Schlussakkords passen und wird trotzdem genommen. */
const KEY_FINAL_CHORD_TOLERANCE = 0.1;

/**
 * Töne eines Akkordnamens (aus parseChord(), siehe chordtheory.js).
 * @param {string} name Akkordname, z. B. "F#m7" oder "D/F#"
 * @param {number} [transpose=0] Halbtöne nach oben, z. B. der Capo (die Namen sind dann Griffnamen)
 * @returns {?{root: number, minor: boolean, tones: number[]}} Grundton und Töne als Tonhöhenklassen (0 = C),
 *   null bei unlesbarem Namen
 */
export function chordTones(name, transpose = 0) {
    const chord = parseChord(name);
    if (!chord) return null;
    const shift = pc => (pc + transpose % 12 + 12) % 12;
    return {root: shift(chord.root), minor: chord.minor, tones: chord.tones.map(shift)};
}

/** Namen der Grundtöne beim Transponieren, wie sie der Katalog führt (C#, D#, F#, G#, aber Bb). */
const ROOT_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];

/**
 * Transponiert einen Akkordnamen, samt Basston ("D/F#" um 2 → "E/G#").
 * @param {string} name Akkordname, z. B. "F#m7"
 * @param {number} semitones Halbtöne nach oben (negativ nach unten)
 * @returns {string} transponierter Name; unlesbare Namen und 0 Halbtöne unverändert
 */
export function transposeChordName(name, semitones) {
    if (!(semitones % 12)) return name;
    const shift = (letter, sign) => {
        const pc = NOTE_CLASSES[letter.toLowerCase()] + (sign === '#' ? 1 : sign === 'b' ? -1 : 0);
        return ROOT_NAMES[((pc + semitones) % 12 + 24) % 12];
    };
    return name.replace(/^(\s*)([A-Ha-h])([#b]?)([^/]*)(?:\/([A-Ha-h])([#b]?))?/,
        (all, space, root, sign, quality, bass, bassSign) => space + shift(root, sign) + quality
            + (bass ? '/' + shift(bass, bassSign) : ''));
}

/**
 * Grundton der Dur-Tonart zu einer Vorzeichenzahl.
 * @param {number} keySignature Kreuze positiv, Bes negativ (wie bar.keySignature)
 * @returns {number} Tonhöhenklasse
 */
function majorTonic(keySignature) {
    return ((keySignature * 7) % 12 + 12) % 12;
}

/**
 * Verschiebt Vorzeichen um Halbtöne (D-Dur mit 2 Kreuzen um 2 nach oben: E-Dur mit 4). Dur und Moll verschieben sich
 * gleich, die Zahl gilt für die Dur-Tonart gleicher Vorzeichen.
 * @param {number} keySignature Kreuze positiv, Bes negativ (wie bar.keySignature)
 * @param {number} semitones Halbtöne nach oben (negativ nach unten)
 * @returns {number} neue Vorzeichenzahl mit möglichst wenigen Vorzeichen
 */
export function transposeKeySignature(keySignature, semitones) {
    return keySignatureOf(((majorTonic(keySignature) + semitones) % 12 + 12) % 12, false);
}

/**
 * Vorzeichenzahl einer Tonart, möglichst wenige Vorzeichen (Fis-Dur statt Ges-Dur nur bei Gleichstand nicht).
 * @param {number} tonic Grundton als Tonhöhenklasse
 * @param {boolean} minor Moll
 * @returns {number} -6 bis 6
 */
function keySignatureOf(tonic, minor) {
    const major = minor ? (tonic + 3) % 12 : tonic;
    for (let s = 0; s <= 6; s++) {
        if (majorTonic(s) === major) return s;
        if (majorTonic(-s) === major) return -s;
    }
    return 0;
}

/**
 * Erkennt die Tonart aus den Akkorden (klingend, also mit Capo gerechnet) und den gespielten Tönen und vergleicht
 * sie mit den notierten Vorzeichen. Viele GP-Dateien haben gar keine Vorzeichen, obwohl der Song etwa in A steht.
 * Gewählt wird die Tonleiter, in die Akkorde und Töne am besten passen; Grundton ist der Schlussakkord, wenn seine
 * Tonart kaum schlechter passt (A-Dur mit G-Akkord, also A-Mixolydisch, wird A-Dur, nicht D-Dur). Gedacht für
 * Vorschläge im Editor (rotes "!" am Feld "Tonart"); der Import ändert die Vorzeichen nicht. Eine Abweichung ist kein
 * Konflikt, denn die notierte Tonart muss nicht zu allen Akkorden passen: Zwischendominanten (D7 in C), entlehnte
 * Akkorde (Bb in C), Blues (A7, D7, E7 in A), die Dur-Dominante in Moll (E in a-Moll), modale Songs, Rückungen.
 * @param {Score} score Noten
 * @returns {?{keySignature: number, minor: boolean}} bessere Vorzeichen, null, wenn die notierten passen, die
 *   Vorzeichen im Song wechseln oder es keine Akkorde gibt
 */
export function detectKeySignature(score) {
    /** @type {Staff[]} */
    const staves = [];
    for (const track of score.tracks) staves.push(...track.staves);
    const signatures = new Set(staves.flatMap(st => st.bars.map(bar => `${bar.keySignature}/${bar.keySignatureType}`)));
    if (signatures.size !== 1) return null;
    const current = staves[0].bars[0].keySignature;

    const chords = [];
    let last = null;
    const notes = Array(12).fill(0);
    for (const staff of staves) for (const bar of staff.bars) for (const voice of bar.voices) for (const beat of voice.beats) {
        for (const note of beat.notes) notes[note.realValue % 12] += beat.playbackDuration;
        const chord = beat.chordId ? staff.chords?.get(beat.chordId) : null;
        const tones = chord ? chordTones(chord.name, staff.capo) : null;
        if (!tones) continue;
        chords.push(tones);
        if (staff === staves.find(st => st.chords?.size)) last = tones;
    }
    if (!chords.length || !last) return null;
    const allNotes = notes.reduce((a, b) => a + b, 0) || 1;
    const fit = s => {
        const inScale = pc => MAJOR_SCALE.includes((pc - majorTonic(s) + 12) % 12);
        const chordFit = chords.reduce((sum, c) => sum + c.tones.filter(inScale).length / c.tones.length, 0) / chords.length;
        const noteFit = notes.reduce((sum, d, pc) => sum + (inScale(pc) ? d : 0), 0) / allNotes;
        return chordFit + noteFit;
    };

    let best = current;
    for (let s = -6; s <= 6; s++) if (fit(s) > fit(best) + 1e-9) best = s;
    const final = keySignatureOf(last.root, last.minor);
    const chosen = fit(final) >= fit(best) - KEY_FINAL_CHORD_TOLERANCE ? final : best;
    if (fit(chosen) < fit(current) + KEY_MIN_GAIN) return null;
    // Moll, wenn der Schlussakkord Moll ist und auf der Moll-Tonika der gewählten Vorzeichen steht.
    const minor = last.minor && (last.root + 3) % 12 === majorTonic(chosen);
    return {keySignature: chosen, minor};
}

/**
 * Vereinheitlicht die Griffbilder: Jede Spur bekommt je angeschlagenem Akkordnamen genau einen Akkord mit
 * sichtbarem Griffbild (siehe chooseGrip()), samt Barré (siehe barreFret()); ungenutzte Akkorde fallen weg. Aus GP
 * kommen oft mehrere Akkorde gleichen Namens, teils Bruchstücke oder ausgeblendet; alphaTex unterscheidet sie ohnehin
 * nur nach dem Namen.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Score} score Noten, werden geändert
 * @param {ChordCatalog} chordCatalog Akkord-Katalog
 * @param {boolean} [preferOwn] eigene Griffe vor denen des Katalogs (Bearbeitungsseite, siehe chooseGrip())
 * @returns {void}
 */
export function normalizeChords(alphaTab, score, chordCatalog, preferOwn = false) {
    for (const track of score.tracks) for (const staff of track.staves) {
        /** @type {Map<string, Map<string, number>>} */
        const used = new Map();
        const beats = [];
        for (const bar of staff.bars) for (const voice of bar.voices) for (const beat of voice.beats) {
            const chord = beat.chordId ? staff.chords?.get(beat.chordId) : null;
            if (!chord) continue;
            const grips = used.get(chord.name) ?? new Map();
            used.set(chord.name, grips);
            if (chord.strings.length) grips.set(gripOf(chord), (grips.get(gripOf(chord)) ?? 0) + 1);
            beats.push([beat, chord.name]);
        }
        staff.chords = new Map();
        for (const [name, grips] of used) {
            const chord = new alphaTab.model.Chord();
            chord.name = name;
            const grip = chooseGrip(name, grips, isStandardTuning(staff) ? chordCatalog : null, preferOwn);
            const frets = grip ? parseGrip(grip) : [];
            chord.strings = [...frets].reverse();
            chord.firstFret = diagramFirstFret(frets);
            const barre = barreFret(frets);
            chord.barreFrets = barre === null ? [] : [barre];
            chord.showDiagram = frets.length > 0;
            chord.showFingering = false;
            staff.addChord(name, chord);
        }
        for (const [beat, name] of beats) beat.chordId = name;
    }
}

/**
 * Gängige Akkorde (offene Akkorde und ihre 7er): Für sie gibt es auf dem Leadsheet kein Griffbild, außer der Song
 * greift sie anders als der Akkord-Katalog. Das Transponieren in notation.js nutzt sie nicht.
 */
export const COMMON_CHORDS = ['C', 'D', 'E', 'G', 'A', 'Am', 'Dm', 'Em', 'C7', 'D7', 'E7', 'G7', 'A7', 'Am7', 'Dm7',
    'Em7'];
