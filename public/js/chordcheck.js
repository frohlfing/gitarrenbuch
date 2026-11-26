/**
 * Bereinigen → "Griffe prüfen" im Bearbeitungsmodus: Passen die Noten der Akkordspur zu ihren Akkorden?
 *
 * - Je Akkord der Akkordspur gelten die Schläge bis zum nächsten Akkord oder bis zum Taktende (ein Takt mit fremden
 *   Tönen macht die davor nicht falsch). Gemeldet wird, wenn dort ein Ton erklingt, der
 *   nicht zum Akkord gehört, oder wenn bei einem vollen Anschlag (ab FULL_STRINGS Saiten) ein nötiger Ton fehlt
 *   (gripToneProblem() in chordgrips.js). Gleiche Funde (Akkord und wie es klingt) stehen in einer Zeile.
 * - Griffe vergleicht der Editor wie "Rhythmus ableiten" (fillBar() in sheet.js) ohne Capo: Bund 0 ist die leere
 *   Saite, der Akkordname gilt für den Griff.
 * - Ersetzen setzt den Griff des Akkords (gripFor() in sheet.js: Griffbild aus den Noten, sonst Katalog): Angeschlagene
 *   Griffe (ab STRUM_STRINGS Saiten) bekommen ihn über dieselben Saiten, einzelne Töne den Bund des Griffs auf ihrer
 *   Saite; Haltebögen ziehen mit.
 */

import {gripText, gripToneProblem, nameGrip} from './chordgrips.js';
import {nameChord, parseChord} from './chordtheory.js';
import {timeline} from './notation.js';
import {gripFor} from './sheet.js';

/** @typedef {import('../../types/alphatab').model.Score} Score */
/** @typedef {import('../../types/alphatab').model.Beat} Beat */
/** @typedef {import('../../types/alphatab').model.Staff} Staff */

/** Ab so vielen Saiten ist ein Anschlag ein voller Griff, bei dem auch fehlende Töne zählen. */
const FULL_STRINGS = 4;

/** Namen der zwölf Töne für die Anzeige gespielter Töne. */
const TONE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];

/** Ab so vielen Saiten ist ein Schlag angeschlagen (Ersetzen über dieselben Saiten statt Ton für Ton). */
const STRUM_STRINGS = 3;

/**
 * Ein Akkord der Akkordspur mit seinen Schlägen in einem Takt (bis zum nächsten Akkord bzw. Taktende).
 * @typedef {Object} ChordRegion
 * @property {number} bar Takt des Akkords
 * @property {{name: string, chord: import('../../types/alphatab').model.Chord}} event Akkord
 * @property {Beat[]} beats Schläge mit Tönen (auch übergebundene)
 */

/**
 * Funde in gleicher Art: ein Akkord, der gleich klingt.
 * @typedef {Object} ChordNoteProblem
 * @property {string} name notierter Akkord
 * @property {string} played gespielter Griff (gripText()) bzw. die gespielten Töne
 * @property {string} sounds wie es klingt (Akkordname), leer, wenn sich keiner ergibt
 * @property {string} reason was nicht passt (gripToneProblem())
 * @property {ChordRegion[]} regions Stellen
 * @property {?number[]} grip Griff des Akkords zum Ersetzen, null ohne
 */

/**
 * Tonhöhen der leeren Saiten von der tiefen aus (wie in chordgrips.js).
 * @param {Staff} staff Notensystem
 * @returns {number[]}
 */
function lowToHigh(staff) {
    return [...staff.tuning].reverse();
}

/**
 * Schläge der ersten Stimme eines Notensystems der Reihe nach, mit Takt.
 * @param {Staff} staff Notensystem
 * @returns {{beat: Beat, bar: number, tick: number}[]} tick ab Songanfang
 */
function staffBeats(staff) {
    return staff.bars.flatMap(bar => (bar.voices[0] ? timeline(bar.voices[0]) : [])
        .map(e => ({beat: e.beat, bar: bar.index, tick: bar.masterBar.start + e.start})));
}

/**
 * Akkorde der Akkordspur mit ihren Schlägen, je Takt; ein Akkord, der in den nächsten Takt hineinklingt, beginnt dort
 * einen neuen Abschnitt.
 * @param {Staff} staff Notensystem der Akkordspur
 * @returns {ChordRegion[]}
 */
export function chordRegions(staff) {
    /** @type {ChordRegion[]} */
    const regions = [];
    /** @type {?{name: string, chord: import('../../types/alphatab').model.Chord}} */
    let current = null;
    let lastBar = -1;
    for (const {beat, bar} of staffBeats(staff)) {
        const chord = beat.chordId ? staff.chords?.get(beat.chordId) ?? null : null;
        if (chord) current = {name: chord.name, chord};
        if (current && (chord || bar !== lastBar)) regions.push({bar, event: current, beats: []});
        lastBar = bar;
        if (beat.notes.length && regions.length) regions[regions.length - 1].beats.push(beat);
    }
    return regions;
}

/**
 * Griff eines Schlags: Bünde von der tiefen Saite aus, -1 = nicht gespielt (gedämpfte Töne zählen nicht).
 * @param {Beat} beat Schlag
 * @param {number} strings Zahl der Saiten
 * @returns {number[]}
 */
function beatGrip(beat, strings) {
    const frets = Array(strings).fill(-1);
    for (const note of beat.notes) if (!note.isDead) frets[note.string - 1] = note.fret;
    return frets;
}

/**
 * Prüft die Akkorde der Akkordspur gegen ihre Noten.
 * @param {Staff} staff Notensystem der Akkordspur (sechs Saiten)
 * @param {Object<string, string[]>} library Akkordkatalog (Griffe zum Ersetzen)
 * @returns {ChordNoteProblem[]} nach dem ersten Takt sortiert
 */
export function chordNoteProblems(staff, library) {
    const tuning = lowToHigh(staff);
    const strings = tuning.length;
    /** @type {Map<string, ChordNoteProblem>} */
    const found = new Map();
    for (const region of chordRegions(staff)) {
        const chord = parseChord(region.event.name);
        if (!chord) continue;
        const attacks = region.beats.filter(b => b.notes.some(n => !n.isDead && !n.isTieDestination));
        if (!attacks.length) continue;
        const grips = attacks.map(b => beatGrip(b, strings));
        const full = grips.filter(g => g.filter(f => f >= 0).length >= FULL_STRINGS);
        const tones = grips.flatMap(g => g.flatMap((f, i) => f >= 0 ? [(tuning[i] + f) % 12] : []));
        const allowed = new Set(chord.tones);
        let reason = '';
        let shown = null;
        const foreign = full.find(g => gripToneProblem(chord, g, tuning) !== null);
        if (foreign) {
            reason = gripToneProblem(chord, foreign, tuning);
            shown = foreign;
        } else if (tones.some(t => !allowed.has(t))) {
            // Einzelne Töne (Zupfen, Bass): nur fremde Töne zählen, fehlende ergeben sich aus dem Rest des Takts.
            reason = gripToneProblem(chord, grips.reduce((all, g) => all.map((f, i) => g[i] >= 0 ? g[i] : f)), tuning) ?? '';
            if (!reason.startsWith('Töne')) reason = 'Töne, die nicht zum Akkord gehören';
        }
        if (!reason) continue;
        const played = shown ? gripText(shown) : [...new Set(tones)].map(t => TONE_NAMES[t]).join(' ');
        const sounds = shown ? nameGrip(shown, tuning, 1)[0] ?? ''
            : nameChord(tones, tones[0], 1)[0] ?? '';
        const key = `${region.event.name}|${sounds}`;
        const known = found.get(key);
        if (known) {
            known.regions.push(region);
        } else {
            const grip = gripFor(region.event, library);
            found.set(key, {
                name: region.event.name, played, sounds, reason, regions: [region],
                grip: grip?.length === strings ? grip : null
            });
        }
    }
    return [...found.values()].sort((a, b) => a.regions[0].bar - b.regions[0].bar);
}

/**
 * Ersetzt die Noten an den Stellen der gewählten Funde durch den Griff ihres Akkords (siehe Kopf der Datei).
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Staff} staff Notensystem der Akkordspur
 * @param {ChordNoteProblem[]} problems Funde mit Griff
 * @returns {number} geänderte Schläge
 */
export function replaceChordNotes(alphaTab, staff, problems) {
    const strings = staff.tuning.length;
    /** @type {Set<Beat>} */
    const changed = new Set();
    for (const problem of problems) {
        if (!problem.grip) continue;
        const grip = problem.grip;
        for (const region of problem.regions) {
            for (const beat of region.beats) {
                const played = beat.notes.filter(n => !n.isDead);
                if (!played.length || played.every(n => n.isTieDestination)) continue;
                if (played.length >= STRUM_STRINGS) {
                    // Angeschlagen: der Griff über dieselben Saiten (von der tiefsten bis zur höchsten).
                    const low = Math.min(...played.map(n => n.string));
                    const high = Math.max(...played.map(n => n.string));
                    const accent = played.some(n => n.accentuated);
                    for (const note of played) beat.removeNote(note);
                    for (let s = low; s <= high; s++) {
                        if (grip[s - 1] < 0) continue;
                        const note = new alphaTab.model.Note();
                        note.string = s;
                        note.fret = grip[s - 1];
                        if (accent) note.accentuated = alphaTab.model.AccentuationType.Normal;
                        beat.addNote(note);
                    }
                } else {
                    for (const note of played) {
                        if (!note.isTieDestination && grip[note.string - 1] >= 0) note.fret = grip[note.string - 1];
                    }
                }
                changed.add(beat);
            }
        }
    }
    followTies(alphaTab, staff, strings, changed);
    return changed.size;
}

/**
 * Lässt übergebundene Töne nach geänderten Schlägen folgen: ein ganz übergebundener Schlag bekommt die Töne des Schlags
 * davor, sonst jeder übergebundene Ton den Bund des Tons davor auf seiner Saite (auch über mehrere Schläge).
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Staff} staff Notensystem
 * @param {number} strings Zahl der Saiten
 * @param {Set<Beat>} changed geänderte Schläge, wird um die nachgezogenen ergänzt
 * @returns {void}
 */
function followTies(alphaTab, staff, strings, changed) {
    /** @type {?Beat} */
    let previous = null;
    for (const {beat} of staffBeats(staff)) {
        const tied = beat.notes.filter(n => n.isTieDestination);
        if (!previous || !changed.has(previous) || !tied.length) {
            if (beat.notes.length) previous = beat;
            continue;
        }
        changed.add(beat);
        if (tied.length === beat.notes.length) {
            for (const note of [...beat.notes]) beat.removeNote(note);
            for (const origin of previous.notes.filter(n => !n.isDead)) {
                const note = new alphaTab.model.Note();
                note.string = origin.string;
                note.fret = origin.fret;
                note.isTieDestination = true;
                beat.addNote(note);
            }
        } else {
            const frets = beatGrip(previous, strings);
            for (const note of tied) if (frets[note.string - 1] >= 0) note.fret = frets[note.string - 1];
        }
        if (beat.notes.length) previous = beat;
    }
}
