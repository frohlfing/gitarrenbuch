/**
 * Akkorde aus einer Spur ableiten (Schalter im Dialog "Rhythmus ableiten"), wie der Knopf "Passenden Akkord erkennen
 * und einfügen", nur für den ganzen Song:
 *
 * 1. Raster: je Zählzeit ein Platz (Nenner der Taktart; bei Dreiergruppen wie 6/8 die punktierte Viertel).
 * 2. Kandidaten: Dreiklänge der Tonart und Akkorde des Songs (Griffnamen; die Töne klingen um den Capo der Spur höher).
 * 3. Je Platz und Kandidat eine Bewertung:
 *    - Noten: die Töne der Spur, die dort klingen (gewichtet nach Klingdauer), bewertet mit rankChords()
 *      (chordtheory.js), die Akkorde des Songs bevorzugt. In einer einstimmigen Spur (z. B. der Melodie) zählt das
 *      weniger (MELODY_WEIGHT): Melodietöne sind oft keine Akkordtöne.
 *    - Audiospur (wenn gewollt): Ähnlichkeit ihres Tonklassen-Spektrums (chroma() in pitchdetect.js) mit der Schablone
 *      des Akkords (Kosinus; Grundton und Terz voll, Quinte etwas weniger), mal AUDIO_WEIGHT.
 * 4. Folge: die Akkordfolge mit der höchsten Summe über alle Plätze, wobei jeder Wechsel einen Abzug kostet, auf der
 *    Eins weniger als mitten im Takt (Viterbi). So wechselt ein Akkord auch auf Schlag 4, aber nur, wenn die Töne dort
 *    klar dafür sprechen. Plätze ohne Töne behalten den Akkord davor.
 *
 * Proben (je Viertel richtig, gleiche Töne = gleich): mehrstimmige Begleitspuren 90 bis 100 %; nur die Melodie ohne
 * Audiospur 24 bis 42 %, deshalb ohne Audiospur abgelehnt (hasHarmony()).
 */

import {parseChord, rankChords, scaleTriads} from './chordtheory.js';
import {chroma} from './pitchdetect.js';

/** @typedef {import('../../../types/alphatab').model.Score} Score */
/** @typedef {import('../../../types/alphatab').model.Track} Track */
/** @typedef {import('../../../types/alphatab').model.MasterBar} MasterBar */

/** Abzug für einen Akkordwechsel auf der Eins bzw. mitten im Takt (in Punkten der Bewertung je Platz). */
const CHANGE_ON_ONE = 0.15;
const CHANGE_IN_BAR = 0.6;

/** Gewicht der Audiospur (Kosinus 0 bis 1) gegenüber den Noten (rankChords(), etwa 0 bis 1,2). */
const AUDIO_WEIGHT = 2;

/** Gewicht der Noten einer einstimmigen Spur. */
const MELODY_WEIGHT = 0.3;

/** Gewicht der Quinte in der Schablone (Grundton und Terz 1): Sie steckt auch als Oberton in jedem Ton. */
const TEMPLATE_FIFTH = 0.8;

/**
 * Ein Platz des Rasters.
 * @typedef {Object} ChordSlot
 * @property {number} tick Anfang (Ticks in Notenreihenfolge)
 * @property {number} end Ende
 * @property {boolean} one ob der Platz auf der Eins liegt
 * @property {MasterBar} mb Takt
 */

/** Ab diesem Anteil der Schläge mit mehreren Tönen zugleich gilt eine Spur als mehrstimmig. */
const HARMONY_SHARE = 0.2;

/**
 * Ob eine Spur mehrstimmig ist: Bei mindestens HARMONY_SHARE ihrer Schläge mit Tönen klingen mehrere zugleich (im
 * Schlag selbst oder in einer anderen Stimme). Eine Melodie mit einzelnen Doppelgriffen bleibt so einstimmig.
 * @param {Track} track Spur
 * @returns {boolean}
 */
export function hasHarmony(track) {
    let beats = 0, together = 0;
    for (const staff of track.staves) for (const bar of staff.bars) {
        /** @type {{from: number, to: number, notes: number}[]} */
        const spans = [];
        for (const voice of bar.voices) for (const beat of voice.beats) {
            const notes = beat.notes.filter(n => !n.isDead).length;
            if (notes) spans.push({from: beat.playbackStart, to: beat.playbackStart + beat.playbackDuration, notes});
        }
        for (const [i, s] of spans.entries()) {
            beats++;
            if (s.notes > 1 || spans.some((o, j) => i !== j && s.from < o.to && o.from < s.to)) together++;
        }
    }
    return beats > 0 && together / beats >= HARMONY_SHARE;
}

/**
 * Raster der Zählzeiten über den ganzen Song.
 * @param {Score} score Noten
 * @returns {ChordSlot[]}
 */
function chordSlots(score) {
    /** @type {ChordSlot[]} */
    const slots = [];
    for (const mb of score.masterBars) {
        // Dreiergruppen (6/8, 9/8, 12/8 …): eine Zählzeit ist die punktierte Viertel.
        const num = mb.timeSignatureNumerator;
        const unit = 3840 / mb.timeSignatureDenominator * (num > 3 && num % 3 === 0 ? 3 : 1);
        const length = mb.calculateDuration();
        for (let at = 0; at < length; at += unit) {
            slots.push({tick: mb.start + at, end: mb.start + Math.min(at + unit, length), one: at === 0, mb});
        }
    }
    return slots;
}

/**
 * Töne einer Spur auf einem Platz: Gewicht je Tonhöhenklasse (Griffnamen, also um den Capo zurück) und tiefster Ton.
 * @param {Track} track Spur
 * @param {ChordSlot} slot Platz
 * @returns {{weights: number[], bass: ?number}}
 */
function slotNotes(track, slot) {
    const {mb} = slot;
    const capo = track.staves[0].capo;
    const weights = new Array(12).fill(0);
    let low = Infinity;
    for (const staff of track.staves) for (const voice of staff.bars[mb.index]?.voices ?? []) for (const beat of voice.beats) {
        const start = mb.start + beat.playbackStart;
        const overlap = Math.min(start + beat.playbackDuration, slot.end) - Math.max(start, slot.tick);
        if (overlap <= 0 || beat.isRest) continue;
        for (const note of beat.notes) {
            if (note.isDead) continue;
            weights[((note.realValue - capo) % 12 + 12) % 12] += overlap;
            low = Math.min(low, note.realValue - capo);
        }
    }
    return {weights, bass: Number.isFinite(low) ? ((low % 12) + 12) % 12 : null};
}

/**
 * Schablone eines Akkords für den Vergleich mit dem Tonklassen-Spektrum: seine Töne, wie sie klingen, Länge 1.
 * @param {string} name Akkordname (Griffname)
 * @param {number} capo Capo der Spur
 * @returns {number[]} zwölf Werte (0 = C)
 */
function template(name, capo) {
    const out = new Array(12).fill(0);
    for (const step of parseChord(name)?.steps ?? []) {
        if (step.role === 'bass') continue;
        out[(step.pitchClass + capo) % 12] = step.role === 'fifth' ? TEMPLATE_FIFTH : 1;
    }
    const length = Math.hypot(...out) || 1;
    return out.map(v => v / length);
}

/**
 * Leitet die Akkorde des ganzen Songs aus einer Spur ab (Ablauf im Kopf der Datei).
 * @param {Score} score Noten (frisch eingelesen)
 * @param {Track} track Spur, aus der abgeleitet wird
 * @param {Set<string>} used Akkorde, die im Song schon vorkommen (werden bevorzugt)
 * @param {?{samples: Float32Array, msAt: function(MasterBar, number): number}} audio Audiospur und Zeit zu einer
 *   Stelle (audioClock() in pitchdetect.js); null ohne
 * @returns {{tick: number, name: string}[]} Akkordwechsel nach Zeit (Ticks in Notenreihenfolge)
 */
export function deriveChords(score, track, used, audio) {
    const capo = track.staves[0].capo;
    const slots = chordSlots(score);
    const keys = new Set(score.tracks[0].staves[0].bars.map(bar => bar.keySignature));
    const names = [...new Set([...[...keys].flatMap(ks => scaleTriads(7 * ks - capo)), ...used])]
        .filter(name => parseChord(name));
    if (!names.length) return [];
    const templates = names.map(name => template(name, capo));
    const noteWeight = hasHarmony(track) ? 1 : MELODY_WEIGHT;
    let sounding = false;

    /** @type {number[][]} Bewertung je Platz und Kandidat */
    const scores = slots.map(slot => {
        const {weights, bass} = slotNotes(track, slot);
        const out = new Array(names.length).fill(0);
        if (weights.some(Boolean)) {
            sounding = true;
            const ranked = new Map(rankChords(weights, bass, names, used).map(r => [r.name, r.score]));
            names.forEach((name, c) => {
                out[c] += noteWeight * (ranked.get(name) ?? 0);
            });
        }
        if (audio) {
            const sound = chroma(audio.samples, audio.msAt(slot.mb, slot.tick), audio.msAt(slot.mb, slot.end));
            if (sound.some(Boolean)) {
                sounding = true;
                templates.forEach((t, c) => {
                    out[c] += AUDIO_WEIGHT * t.reduce((sum, v, pc) => sum + v * sound[pc], 0);
                });
            }
        }
        return out;
    });
    if (!sounding) return [];
    // Viterbi: beste Summe bis zu jedem Platz je Akkord, mit Abzug je Wechsel.
    let best = scores[0].slice();

    /** @type {number[][]} je Platz: Index des Akkords davor */
    const back = [];
    for (let s = 1; s < slots.length; s++) {
        const penalty = slots[s].one ? CHANGE_ON_ONE : CHANGE_IN_BAR;
        const top = best.indexOf(Math.max(...best));
        const from = [];
        best = best.map((stay, c) => {
            const change = best[top] - penalty;
            from.push(stay >= change ? c : top);
            return Math.max(stay, change) + scores[s][c];
        });
        back.push(from);
    }
    const path = [best.indexOf(Math.max(...best))];
    for (let s = back.length - 1; s >= 0; s--) path.unshift(back[s][path[0]]);

    /** @type {{tick: number, name: string}[]} */
    const chords = [];
    path.forEach((c, s) => {
        if (!s || c !== path[s - 1]) chords.push({tick: slots[s].tick, name: names[c]});
    });
    // Vor den ersten Tönen (Auftakt, Pausen) kein Akkord: Der erste kommt auf den ersten Platz mit Tönen.
    const first = slots.findIndex((_, s) => scores[s].some(Boolean));
    if (first > 0) {
        const tick = slots[first].tick;
        const name = chords.findLast(c => c.tick <= tick)?.name ?? names[path[first]];
        return [{tick, name}, ...chords.filter(c => c.tick > tick)];
    }
    return chords;
}
