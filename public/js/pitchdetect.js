/**
 * Tonhöhe der Melodie aus der Audiospur erkennen (für Dialog "Melodie ableiten").
 * Der Rhythmus kommt aus der Melodiespur (eine Silbe je Note), die Tonhöhe je Silbe aus dem Gesang:
 *
 * 1. Zeit jeder Silbe über die Sync-Punkte (erster Durchgang eines Takts), vom Anschlag bis zum Ende ihrer gebundenen
 *    Note; Gesangspausen sind Stellen ohne Melodienote (mindestens PAUSE_MS).
 * 2. Gemitteltes Betragsspektrum über die Silbe (FFT, Mitte von linkem und rechtem Kanal), davon abgezogen das der
 *    nächsten Gesangspause, möglichst mit demselben Akkord (zwei gleich weit entfernte gemittelt): übrig bleibt vor
 *    allem die Stimme.
 * 3. Oberton-Summe je Ton im Stimmumfang (Grundton und Obertöne, gewichtet); der stärkste ist der Kandidat.
 * 4. Nachbearbeitung: Im Chorus stimmen alle Durchgänge an derselben Stelle über die Tonklasse ab. Sonst bleibt ein Ton
 *    der Tonart in der Lage seiner Zeile; ein Ton außerhalb der Tonart oder ein Oktav-Ausreißer (eher Rauschen) wird
 *    neu bestimmt aus seinen Kandidaten und denen derselben Stelle in den anderen Durchgängen des Abschnitts (Verse 1
 *    und Verse 2). Dabei zählen Töne der Tonart voll, andere weniger, Akkordtöne etwas mehr. Die Oktave folgt der Lage
 *    der Zeile.
 * 5. Lage auf der Gitarre: die ganze Melodie um Oktaven so, dass ihre Mitte bei den hohen Saiten liegt (MELODY_LOW bis
 *    MELODY_HIGH), jeder Ton auf der Saite mit dem kleinsten Bund.
 *
 * Reines JavaScript ohne Bibliothek; dekodiert wird mit decodeAudioData().
 */

import {parseChord} from './chordtheory.js';
import {chordsTrack, playbackSyncPoints, playedBars, scalePitchClasses, syncedAudioMs} from './notation.js';
import {chordTimeline, sectionGroup, sectionName} from './sheet.js';

/** @typedef {import('../../types/alphatab').model.Score} Score */
/** @typedef {import('../../types/alphatab').model.Track} Track */
/** @typedef {import('../../types/alphatab').model.Beat} Beat */

/** Abtastrate für die Auswertung (Hz): reicht für Gesang und Obertöne, spart Rechenzeit. */
const RATE = 16000;

/** Fenster der FFT (Samples), mit Nullen auf FFT_SIZE aufgefüllt (feinere Frequenzauflösung). */
const WINDOW = 2048;

/** Größe der FFT (Zweierpotenz). */
const FFT_SIZE = 8192;

/** Abstand der Fenster (Samples). */
const HOP = 256;

/** Stimmumfang, in dem gesucht wird (MIDI): A2 bis E5. */
const VOICE_LOW = 45;
const VOICE_HIGH = 76;

/** So viele Obertöne zählen je Ton, jeder um HARMONIC_WEIGHT schwächer als der davor. */
const HARMONICS = 10;
const HARMONIC_WEIGHT = 0.85;

/** Spielraum um jeden Oberton (Anteil der Frequenz). */
const HARMONIC_TOLERANCE = 0.015;

/** Gesangspausen gelten ab dieser Länge (ms) und so weit von der Silbe entfernt (ms). */
const PAUSE_MS = 250;
const PAUSE_REACH_MS = 12000;

/** Gewichte der Kandidaten: außerhalb der Tonart, Akkordton. */
const OUT_OF_SCALE = 0.75;
const CHORD_TONE = 1.1;

/** Weiter als so viele Halbtöne von der Lage der Zeile entfernt ist ein Ton ein Oktav-Ausreißer. */
const OCTAVE_OUTLIER = 7;

/** Lage der Melodie auf der Gitarre: Ihre Mitte (Median) liegt in diesem Bereich (MIDI, H3 bis H4). */
const MELODY_LOW = 59;
const MELODY_HIGH = 71;

/** Höchster Bund für die Melodie. */
const MAX_FRET = 24;

/**
 * Dekodiert die Audiospur für die Auswertung: Mitte von linkem und rechtem Kanal mit RATE.
 * @param {Uint8Array} bytes Audiodatei (MP3)
 * @returns {Promise<Float32Array>} Samples
 * @throws {Error} wenn die Datei nicht zu lesen ist
 */
export async function decodeAudio(bytes) {
    const context = new OfflineAudioContext(2, 1, RATE);
    let buffer;
    try {
        buffer = await context.decodeAudioData(bytes.slice().buffer);
    } catch {
        throw new Error('Audiospur nicht lesbar');
    }
    const channels = [...Array(buffer.numberOfChannels).keys()].map(c => buffer.getChannelData(c));
    const mid = new Float32Array(buffer.length);
    for (const data of channels) for (let i = 0; i < data.length; i++) mid[i] += data[i] / channels.length;
    return mid;
}

/**
 * FFT (Radix 2, an Ort und Stelle).
 * @param {Float32Array} re Realteil
 * @param {Float32Array} im Imaginärteil
 * @returns {void}
 */
function fft(re, im) {
    const size = re.length;
    for (let i = 1, j = 0; i < size; i++) {
        let bit = size >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            [re[i], re[j]] = [re[j], re[i]];
            [im[i], im[j]] = [im[j], im[i]];
        }
    }
    for (let len = 2; len <= size; len <<= 1) {
        const angle = -2 * Math.PI / len;
        const wr = Math.cos(angle), wi = Math.sin(angle);
        for (let i = 0; i < size; i += len) {
            let cr = 1, ci = 0;
            for (let k = 0; k < len / 2; k++) {
                const a = i + k, b = a + len / 2;
                const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
                re[b] = re[a] - tr;
                im[b] = im[a] - ti;
                re[a] += tr;
                im[a] += ti;
                [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
            }
        }
    }
}

/** Hann-Fenster je Länge. @type {Map<number, Float32Array>} */
const HANN = new Map();

/**
 * Gemitteltes Betragsspektrum eines Zeitbereichs (mindestens ein Fenster).
 * @param {Float32Array} samples Audio
 * @param {number} fromMs Anfang
 * @param {number} toMs Ende
 * @param {number} [window] Länge des Fensters (Samples, höchstens FFT_SIZE)
 * @returns {Float32Array} Betrag je Frequenz (FFT_SIZE / 2)
 */
function spectrum(samples, fromMs, toMs, window = WINDOW) {
    if (!HANN.has(window)) {
        HANN.set(window, Float32Array.from({length: window}, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (window - 1))));
    }
    const hann = /** @type {Float32Array} */ (HANN.get(window));
    const hop = HOP * window / WINDOW;
    const a = Math.max(0, Math.floor(fromMs / 1000 * RATE));
    const b = Math.max(a + window, Math.floor(toMs / 1000 * RATE));
    const mag = new Float32Array(FFT_SIZE / 2);
    const re = new Float32Array(FFT_SIZE), im = new Float32Array(FFT_SIZE);
    let frames = 0;
    for (let s = a; s + window <= b; s += hop) {
        re.fill(0);
        im.fill(0);
        for (let i = 0; i < window; i++) re[i] = (samples[s + i] ?? 0) * hann[i];
        fft(re, im);
        for (let k = 0; k < FFT_SIZE / 2; k++) mag[k] += Math.hypot(re[k], im[k]);
        frames++;
    }
    return frames ? mag.map(v => v / frames) : mag;
}

/**
 * Oberton-Summe je Ton im Stimmumfang: die Spitzen bei Grundton und Obertönen, gewichtet.
 * @param {Float32Array} mag Betragsspektrum
 * @returns {{m: number, s: number}[]} Kandidaten, stärkster zuerst
 */
function salience(mag) {
    const out = [];
    for (let m = VOICE_LOW; m <= VOICE_HIGH; m++) {
        const f0 = 440 * 2 ** ((m - 69) / 12);
        let s = 0;
        for (let h = 1; h <= HARMONICS; h++) {
            const f = f0 * h;
            if (f > RATE / 2 - 200) break;
            const lo = Math.floor(f * (1 - HARMONIC_TOLERANCE) / RATE * FFT_SIZE);
            const hi = Math.ceil(f * (1 + HARMONIC_TOLERANCE) / RATE * FFT_SIZE);
            let peak = 0;
            for (let k = lo; k <= hi; k++) peak = Math.max(peak, mag[k]);
            s += HARMONIC_WEIGHT ** (h - 1) * Math.sqrt(peak);
        }
        out.push({m, s});
    }
    return out.sort((x, y) => y.s - x.s);
}

/** Frequenzbereich für das Tonklassen-Spektrum (Hz): Grundtöne und erste Obertöne der Begleitung; darüber füllen
 * Obertöne und Gesang alle Tonklassen auf (Probe an vier Songs). */
const CHROMA_LOW = 80;
const CHROMA_HIGH = 700;

/** Fenster für das Tonklassen-Spektrum (Samples): länger als für die Melodie, Akkorde klingen länger. */
const CHROMA_WINDOW = 4096;

/**
 * Tonklassen-Spektrum eines Zeitbereichs: je Tonhöhenklasse die Spitzen des Spektrums (gewurzelt) im Bereich
 * CHROMA_LOW bis CHROMA_HIGH, für die Akkorderkennung aus der Audiospur (chordsFromAudio() in chorddetect.js).
 * @param {Float32Array} samples Audio (decodeAudio())
 * @param {number} fromMs Anfang
 * @param {number} toMs Ende
 * @returns {number[]} zwölf Werte (0 = C, wie sie klingen), Länge 1; alle 0, wenn dort nichts klingt
 */
export function chroma(samples, fromMs, toMs) {
    const mag = spectrum(samples, fromMs, toMs, CHROMA_WINDOW);
    const out = new Array(12).fill(0);
    for (let k = 1; k < mag.length - 1; k++) {
        const f = k * RATE / FFT_SIZE;
        if (f < CHROMA_LOW || f > CHROMA_HIGH || mag[k] <= mag[k - 1] || mag[k] < mag[k + 1]) continue;
        const pc = ((Math.round(12 * Math.log2(f / 440) + 69) % 12) + 12) % 12;
        out[pc] += Math.sqrt(mag[k]);
    }
    const length = Math.hypot(...out);
    return length ? out.map(v => v / length) : out;
}

/**
 * Zeit in der Audiospur zu einer Stelle der Noten, über die Sync-Punkte (erster Durchgang eines Takts).
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Score} score Noten (frisch eingelesen, mit Sync-Punkten)
 * @returns {?function(import('../../types/alphatab').model.MasterBar, number): number} (Takt, Tick in
 *   Notenreihenfolge) → ms; null ohne Sync-Punkte
 */
export function audioClock(alphaTab, score) {
    const sync = playbackSyncPoints(alphaTab, score);
    if (!sync.length) return null;
    /** @type {Map<number, number>} Takt → Anfang im ersten Durchgang (MIDI-Tick) */
    const played = new Map();
    for (const bar of playedBars(alphaTab, score)) if (!played.has(bar.masterBar.index)) played.set(bar.masterBar.index, bar.start);
    return (mb, tick) => syncedAudioMs(sync, (played.get(mb.index) ?? mb.start) + tick - mb.start);
}

/**
 * Eine Silbe der Melodiespur mit Zeit und Umfeld.
 * @typedef {Object} SungNote
 * @property {Beat} beat Schlag mit der Silbe (Anschlag)
 * @property {Beat[]} tied angebundene Schläge danach
 * @property {string} text Silbe
 * @property {number} from Anfang in der Audiospur (ms)
 * @property {number} to Ende in der Audiospur (ms)
 * @property {string} chord Akkord, der dort klingt (Griffname)
 * @property {number[]} chordTones seine Töne, wie sie klingen (Capo der Akkordspur eingerechnet; Tonhöhenklassen)
 * @property {Set<number>} scale Töne der Tonart (Tonhöhenklassen)
 * @property {string} key Stelle: Abschnittsgruppe und Abstand zum Abschnittsanfang (gleiche Stellen der Durchgänge)
 * @property {boolean} chorus ob die Silbe im Chorus liegt
 */

/**
 * Silben der Melodiespur und Gesangspausen, je mit Zeit in der Audiospur.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Score} score Noten (frisch eingelesen, mit Sync-Punkten)
 * @param {Track} track Melodiespur (eine Silbe je Note)
 * @returns {{notes: SungNote[], pauses: {from: number, to: number, chord: string}[]}}
 */
function sungNotes(alphaTab, score, track) {
    const msAt = /** @type {NonNullable<ReturnType<typeof audioClock>>} */ (audioClock(alphaTab, score));
    const chords = chordTimeline(score);
    const chordAt = tick => chords.findLast(c => c.tick <= tick)?.name ?? '';
    // Akkordnamen sind Griffnamen der Akkordspur: Ihre Töne klingen um deren Capo höher.
    const capo = chordsTrack(score)?.staves[0].capo ?? 0;
    const chordTones = name => (parseChord(name)?.tones ?? []).map(pc => (pc + capo) % 12);
    /** @type {{beat: Beat, tick: number, mb: import('../../types/alphatab').model.MasterBar}[]} */
    const beats = track.staves[0].bars.flatMap(bar => (bar.voices[0]?.beats ?? []).map(beat => ({
        beat, tick: bar.masterBar.start + beat.playbackStart, mb: bar.masterBar,
    })));
    const sectionAt = mb => score.masterBars.slice(0, mb.index + 1).findLast(m => m.section) ?? null;
    /** @type {SungNote[]} */
    const notes = [];
    /** @type {{from: number, to: number, chord: string}[]} */
    const pauses = [];
    beats.forEach((e, i) => {
        if (e.beat.isRest) {
            const from = msAt(e.mb, e.tick);
            const to = msAt(e.mb, e.tick + e.beat.playbackDuration);
            const last = pauses.at(-1);
            if (last && Math.abs(last.to - from) < 1 && last.chord === chordAt(e.tick)) last.to = to;
            else pauses.push({from, to, chord: chordAt(e.tick)});
            return;
        }
        if (!e.beat.lyrics?.[0]?.trim() || e.beat.notes.every(n => n.isTieDestination)) return;
        const tied = [];
        let end = e;
        for (let k = i + 1; k < beats.length && beats[k].beat.notes.some(n => n.isTieDestination); k++) {
            tied.push(beats[k].beat);
            end = beats[k];
        }
        const section = sectionAt(e.mb);
        const group = sectionGroup(sectionName(section?.section ?? null) || 'Anfang');
        notes.push({
            beat: e.beat, tied, text: e.beat.lyrics[0].trim(), from: msAt(e.mb, e.tick),
            to: msAt(end.mb, end.tick + end.beat.playbackDuration), chord: chordAt(e.tick),
            chordTones: chordTones(chordAt(e.tick)),
            scale: scalePitchClasses(e.mb.keySignature), key: `${group}|${e.tick - (section?.start ?? 0)}`,
            chorus: group === 'chorus',
        });
    });
    return {notes, pauses: pauses.filter(p => p.to - p.from >= PAUSE_MS)};
}

/**
 * Erkennt die Tonhöhe jeder Silbe der Melodiespur aus der Audiospur (Ablauf im Kopf der Datei).
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Score} score Noten (frisch eingelesen, mit Sync-Punkten)
 * @param {Track} track Melodiespur (eine Silbe je Note)
 * @param {Float32Array} samples Audiospur (decodeAudio())
 * @returns {{notes: SungNote[], pitches: number[], changed: number, chorus: number, candidates: {m: number, s:
 *   number}[][]}} Silben mit ihrem Ton (MIDI, in der Lage der Gitarre), Zahl der neu bestimmten Töne außerhalb des
 *   Chorus und der Silben im Chorus, je Silbe die Kandidaten (Stimmlage, stärkster zuerst)
 * @throws {Error} ohne Sync-Punkte
 */
export function detectMelody(alphaTab, score, track, samples) {
    if (!playbackSyncPoints(alphaTab, score).length) throw new Error('Die Noten haben keine Sync-Punkte.');
    const {notes, pauses} = sungNotes(alphaTab, score, track);
    /** @type {Map<object, Float32Array>} */
    const pauseSpectra = new Map();
    const candidates = notes.map(n => {
        let mag = spectrum(samples, n.from + 40, Math.max(n.to - 20, n.from + 140));
        const near = pauses.filter(p => Math.abs(p.from - n.from) < PAUSE_REACH_MS);
        const same = near.filter(p => p.chord === n.chord);
        // Die nächste; liegen zwei gleich weit (auf 10 ms, z. B. davor und danach), beide gemittelt.
        const distance = p => Math.round(Math.abs(p.from - n.from) / 10);
        const pool = same.length ? same : near;
        const nearest = Math.min(...pool.map(distance));
        const chosen = pool.filter(p => distance(p) === nearest);
        if (chosen.length) {
            const background = new Float32Array(FFT_SIZE / 2);
            for (const pause of chosen) {
                if (!pauseSpectra.has(pause)) pauseSpectra.set(pause, spectrum(samples, pause.from + 30, pause.to - 30));
                pauseSpectra.get(pause).forEach((v, k) => {
                    background[k] += v / chosen.length;
                });
            }
            mag = mag.map((v, k) => Math.max(0, v - background[k]));
        }
        return salience(mag);
    });
    const top = i => candidates[i][0].m;

    /** Gewichte je Tonklasse einer Silbe (je Klasse das Maximum über die Oktaven) */
    const pcScores = i => {
        const best = candidates[i][0].s || 1;
        const tones = notes[i].chordTones;
        const out = new Array(12).fill(0);
        for (const c of candidates[i]) {
            let w = c.s / best;
            if (!notes[i].scale.has(c.m % 12)) w *= OUT_OF_SCALE;
            if (tones.includes(c.m % 12)) w *= CHORD_TONE;
            out[c.m % 12] = Math.max(out[c.m % 12], w);
        }
        return out;
    };
    const sum = list => list.map(pcScores).reduce((acc, s) => acc.map((v, k) => v + s[k]), new Array(12).fill(0));
    const argmax = list => list.indexOf(Math.max(...list));
    /** Zeile einer Silbe (bis zum Satzzeichen): Lage = Median der Besten, die in der Tonart liegen */
    const lineMedian = i => {
        let a = i, b = i;
        while (a > 0 && !/[.,!?;:]$/.test(notes[a - 1].text)) a--;
        while (b < notes.length - 1 && !/[.,!?;:]$/.test(notes[b].text)) b++;
        const tones = [];
        for (let k = a; k <= b; k++) if (notes[k].scale.has(top(k) % 12)) tones.push(top(k));
        const list = (tones.length ? tones : [top(i)]).sort((x, y) => x - y);
        return list[Math.floor(list.length / 2)];
    };
    const near = (pc, median) => {
        const m = median - ((median - pc) % 12 + 12) % 12;
        return median - m > 6 ? m + 12 : m;
    };
    /** @type {Map<string, number[]>} gleiche Stellen der Durchgänge */
    const groups = new Map();
    notes.forEach((n, i) => groups.set(n.key, [...groups.get(n.key) ?? [], i]));
    let changed = 0;
    const pitches = notes.map((n, i) => {
        const median = lineMedian(i);
        const members = groups.get(n.key);
        if (n.chorus) {
            const medians = members.map(lineMedian).sort((a, b) => a - b);
            return near(argmax(sum(members)), medians[Math.floor(medians.length / 2)]);
        }
        if (n.scale.has(top(i) % 12) && Math.abs(top(i) - median) <= OCTAVE_OUTLIER) return top(i);
        const others = members.filter(j => j !== i);
        const own = pcScores(i);
        const total = others.length ? own.map((v, k) => v + sum(others)[k]) : own;
        changed++;
        return near(argmax(total), median);
    });
    // Lage auf der Gitarre: ganze Oktaven, bis die Mitte der Melodie bei den hohen Saiten liegt.
    const sorted = pitches.toSorted((a, b) => a - b);
    let shift = 0;
    const middle = sorted[Math.floor(sorted.length / 2)] ?? MELODY_LOW;
    while (middle + shift < MELODY_LOW) shift += 12;
    while (middle + shift >= MELODY_HIGH) shift -= 12;
    return {
        notes, pitches: pitches.map(p => p + shift), changed, chorus: notes.filter(n => n.chorus).length, candidates,
    };
}

/**
 * Setzt die erkannten Töne in die Melodiespur: jede Silbe (und ihre angebundenen Noten) auf die Saite mit dem
 * kleinsten Bund; Ghost Notes werden normale Töne.
 * @param {SungNote[]} notes Silben (detectMelody())
 * @param {number[]} pitches Ton je Silbe (MIDI)
 * @returns {number} gesetzte Töne (ohne Saite, auf der der Ton geht, bleibt die Note)
 */
export function applyMelody(notes, pitches) {
    let set = 0;
    notes.forEach((n, i) => {
        const staff = n.beat.voice.bar.staff;
        const tuning = staff.tuning;
        const options = tuning.map((_, k) => ({string: k + 1, fret: pitches[i] - staff.capo - tuning[tuning.length - 1 - k]}))
            .filter(o => o.fret >= 0 && o.fret <= MAX_FRET).sort((a, b) => a.fret - b.fret);
        if (!options.length) return;
        for (const beat of [n.beat, ...n.tied]) {
            const note = beat.notes[0];
            if (!note) continue;
            note.string = options[0].string;
            note.fret = options[0].fret;
            note.isGhost = false;
        }
        set++;
    });
    return set;
}
