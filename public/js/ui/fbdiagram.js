/**
 * Griffbrett als SVG bis zum 15. Bund: markiert, wo gewählte Töne, Akkorde oder Tonleitern liegen; die Punkte tragen
 * Notennamen oder Intervalle und sind je Intervall eingefärbt. Bei Akkorden und Tonleitern kommen Klammern um die
 * Griffe bzw. Lagen dazu. Standard-Tuning. Den Dialog "Griffbrett" baut dialogs/fretboard.js.
 */

/** @typedef {import('../../../types/alphatab').model.Chord} Chord */

/** Zahl der Bünde. */
export const FRETS = 15;

/** Leere Saiten im Standard-Tuning, die hohe e-Saite zuerst (oben gezeichnet, wie im Tab): MIDI-Tonhöhen. */
const STRINGS = [64, 59, 55, 50, 45, 40];

/** Leere Saiten, die tiefste zuerst (Zählung der Griffe und Lagen: 0 = tiefe E-Saite). */
const LOW_FIRST = [...STRINGS].reverse();

/** Breite des Bereichs, in dem ein Griff bzw. eine Lage liegen darf: vier Bünde (die Greifhand bleibt stehen). */
const HAND_SPAN = 3;

/** Namen der zwölf Töne (wie in den Akkordnamen des Katalogs). */
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];

/** Beschriftung der Auswahl (mit der anderen Schreibweise). */
export const NOTE_LABELS = ['C', 'C#/Db', 'D', 'D#/Eb', 'E', 'F', 'F#/Gb', 'G', 'G#/Ab', 'A', 'A#/Bb', 'B'];

/** Kurzschreibweise der Intervalle nach Halbtönen vom Grundton (siehe docs/Musiktheorie.md). */
const INTERVAL_LABELS = ['1', 'b2', '2', 'b3', '3', '4', 'b5', '5', 'b6', '6', 'b7', '7'];

/** Namen der Intervalle nach Kurzschreibweise, auch der anderen Schreibweisen (#5, 9 …). */
const INTERVAL_NAMES = {
    '1': 'Prime (Grundton, Oktave)',
    'b2': 'kleine Sekunde',
    '2': 'große Sekunde',
    'b3': 'kleine Terz',
    '3': 'große Terz',
    '4': 'Quarte',
    '#4': 'übermäßige Quarte',
    'b5': 'verminderte Quinte',
    '5': 'Quinte',
    '#5': 'übermäßige Quinte',
    'b6': 'kleine Sexte',
    '6': 'große Sexte',
    'b7': 'kleine Septime',
    '7': 'große Septime',
    'b9': 'kleine None',
    '9': 'None',
    '#9': 'übermäßige None',
};

/**
 * Farbe je Intervall (nach Halbtönen vom Grundton), weiße Schrift darauf gut lesbar.
 * @type {string[]}
 */
export const INTERVAL_COLORS = ['#2f6fdc', '#7b4bb3', '#1b9ac4', '#e0832d', '#d6453d', '#4f9a45', '#8a6d3b', '#b8860b',
    '#c2549a', '#1f8f7a', '#6c7280', '#8b2d2d'];

/**
 * @typedef {Object} FretPosition Eine Stelle auf dem Griffbrett.
 * @property {number} s Saite, 0 = tiefe E-Saite … 5 = hohe e-Saite
 * @property {number} fret Bund, 0 = leere Saite
 */

/**
 * @typedef {Object} Structure Ein Eintrag der Auswahl.
 * @property {string} id Kennung
 * @property {string} label Beschriftung in der Auswahlliste
 * @property {string} [suffix] Akkordzeichen nach dem Grundton ("C" + suffix), nur bei Akkorden
 * @property {number[]} intervals Abstände der Töne vom Grundton in Halbtönen, aufsteigend
 * @property {Object<number, string>} [alt] andere Schreibweise einzelner Intervalle (Halbtöne -> Kurzschreibweise), z.
 *   B. {8: '#5'} im übermäßigen Akkord
 */

/**
 * Was das Griffbrett zeigen kann: ein Ton, Akkorde, Tonleitern (je ein Kartenreiter im Dialog).
 * @type {Array<{id: 'note'|'chord'|'scale', group: string, items: Structure[]}>}
 */
export const STRUCTURES = [
    {id: 'note', group: 'Ton', items: [{id: 'note', label: 'Einzelner Ton', suffix: '', intervals: [0]}]},
    {
        id: 'chord', group: 'Akkord', items: [
            {id: 'major', label: 'Dur-Akkord', suffix: '', intervals: [0, 4, 7]},
            {id: 'minor', label: 'Moll-Akkord', suffix: 'm', intervals: [0, 3, 7]},
            {id: 'dim', label: 'Verminderter Akkord (dim)', suffix: 'dim', intervals: [0, 3, 6]},
            {id: 'aug', label: 'Übermäßiger Akkord (aug)', suffix: 'aug', intervals: [0, 4, 8], alt: {8: '#5'}},
            {id: 'sus2', label: 'Sus2-Akkord', suffix: 'sus2', intervals: [0, 2, 7]},
            {id: 'sus4', label: 'Sus4-Akkord', suffix: 'sus4', intervals: [0, 5, 7]},
            {id: '5', label: 'Powerchord (5)', suffix: '5', intervals: [0, 7]},
            {id: '7', label: 'Dominantseptakkord (7)', suffix: '7', intervals: [0, 4, 7, 10]},
            {id: 'maj7', label: 'Major-Septakkord (maj7)', suffix: 'maj7', intervals: [0, 4, 7, 11]},
            {id: 'm7', label: 'Moll-Septakkord (m7)', suffix: 'm7', intervals: [0, 3, 7, 10]},
            {id: 'mmaj7', label: 'Moll mit großer Septime (mmaj7)', suffix: 'mmaj7', intervals: [0, 3, 7, 11]},
            {id: 'm7b5', label: 'Halbvermindert (m7b5)', suffix: 'm7b5', intervals: [0, 3, 6, 10]},
            {id: 'dim7', label: 'Vollvermindert (dim7)', suffix: 'dim7', intervals: [0, 3, 6, 9]},
            {id: '7sus4', label: 'Septakkord mit Quarte (7sus4)', suffix: '7sus4', intervals: [0, 5, 7, 10]},
            {id: '7#5', label: 'Septakkord übermäßig (7#5)', suffix: '7#5', intervals: [0, 4, 8, 10], alt: {8: '#5'}},
            {id: '7b5', label: 'Septakkord mit b5 (7b5)', suffix: '7b5', intervals: [0, 4, 6, 10]},
            {id: '6', label: 'Dur-Sextakkord (6)', suffix: '6', intervals: [0, 4, 7, 9]},
            {id: 'm6', label: 'Moll-Sextakkord (m6)', suffix: 'm6', intervals: [0, 3, 7, 9]},
            {id: 'add9', label: 'Dur mit None (add9)', suffix: 'add9', intervals: [0, 2, 4, 7], alt: {2: '9'}},
            {id: '9', label: 'Dominantnonakkord (9)', suffix: '9', intervals: [0, 2, 4, 7, 10], alt: {2: '9'}},
            {id: 'maj9', label: 'Major-Nonakkord (maj9)', suffix: 'maj9', intervals: [0, 2, 4, 7, 11], alt: {2: '9'}},
            {id: 'm9', label: 'Moll-Nonakkord (m9)', suffix: 'm9', intervals: [0, 2, 3, 7, 10], alt: {2: '9'}},
            {id: '6/9', label: 'Sext-Non-Akkord (6/9)', suffix: '6/9', intervals: [0, 2, 4, 7, 9], alt: {2: '9'}},
            {id: '7b9', label: 'Septakkord mit b9 (7b9)', suffix: '7b9', intervals: [0, 1, 4, 7, 10], alt: {1: 'b9'}},
            {id: '7#9', label: 'Septakkord mit #9 (7#9)', suffix: '7#9', intervals: [0, 3, 4, 7, 10], alt: {3: '#9'}},
        ]
    },
    {
        id: 'scale', group: 'Tonleiter', items: [
            {id: 'scale-major', label: 'Dur-Tonleiter', intervals: [0, 2, 4, 5, 7, 9, 11]},
            {id: 'scale-minor', label: 'Moll-Tonleiter (natürlich)', intervals: [0, 2, 3, 5, 7, 8, 10]},
            {id: 'scale-harm', label: 'Moll-Tonleiter (harmonisch)', intervals: [0, 2, 3, 5, 7, 8, 11]},
            {id: 'scale-melodic', label: 'Moll-Tonleiter (melodisch)', intervals: [0, 2, 3, 5, 7, 9, 11]},
            {id: 'scale-pent-major', label: 'Dur-Pentatonik', intervals: [0, 2, 4, 7, 9]},
            {id: 'scale-pent-minor', label: 'Moll-Pentatonik', intervals: [0, 3, 5, 7, 10]},
            {id: 'scale-blues', label: 'Blues-Tonleiter', intervals: [0, 3, 5, 6, 7, 10]},
            {id: 'scale-dorian', label: 'Dorisch', intervals: [0, 2, 3, 5, 7, 9, 10]},
            {id: 'scale-phrygian', label: 'Phrygisch', intervals: [0, 1, 3, 5, 7, 8, 10]},
            {id: 'scale-lydian', label: 'Lydisch', intervals: [0, 2, 4, 6, 7, 9, 11], alt: {6: '#4'}},
            {id: 'scale-mixolydian', label: 'Mixolydisch', intervals: [0, 2, 4, 5, 7, 9, 10]},
            {id: 'scale-locrian', label: 'Lokrisch', intervals: [0, 1, 3, 5, 6, 8, 10]},
        ]
    },
];

/**
 * Kurzschreibweise eines Intervalls in einer Auswahl.
 * @param {Structure} item Eintrag der Auswahl
 * @param {number} semitones Halbtöne vom Grundton (0–11)
 * @returns {string} z. B. "b3"
 */
function intervalLabel(item, semitones) {
    return item.alt?.[semitones] ?? INTERVAL_LABELS[semitones];
}

/**
 * Griffe eines Akkords in Grundstellung: je Ton eine Saite, auf benachbarten Saiten, der tiefste Ton ist der Grundton,
 * die übrigen Töne liegen in beliebiger Reihenfolge darüber. Alle Töne liegen innerhalb von vier Bünden (leere Saiten
 * zählen als Bund 0). Der Akkord C ergibt z. B. A3 + D2 + G0.
 * @param {number} root Grundton (0 = C … 11 = H)
 * @param {number[]} intervals Abstände der Töne vom Grundton in Halbtönen, aufsteigend
 * @returns {FretPosition[][]} Griffe, je Griff die Töne vom Grundton an
 */
export function chordShapes(root, intervals) {
    const count = intervals.length;
    if (count < 2 || count > 5) return [];
    const pitchClasses = intervals.map(i => (root + i) % 12);

    /** @type {FretPosition[][]} */
    const shapes = [];
    for (let first = 0; first + count <= STRINGS.length; first++) {
        /**
         * @param {number} k Index der Saite im Griff (0 = tiefste, spielt den Grundton)
         * @param {FretPosition[]} chosen bisher gewählte Stellen
         * @param {number[]} left Töne (Indizes in pitchClasses), die noch fehlen
         * @returns {void}
         */
        const pick = (k, chosen, left) => {
            if (k === count) {
                shapes.push(chosen);
                return;
            }
            const s = first + k;
            for (const tone of k === 0 ? [0] : left) {
                for (let fret = 0; fret <= FRETS; fret++) {
                    if ((LOW_FIRST[s] + fret) % 12 !== pitchClasses[tone]) continue;
                    const next = [...chosen, {s, fret}];
                    const frets = next.map(p => p.fret);
                    if (Math.max(...frets) - Math.min(...frets) > HAND_SPAN) continue;
                    pick(k + 1, next, left.filter(t => t !== tone));
                }
            }
        };
        pick(0, [], pitchClasses.map((_, i) => i).slice(1));
    }
    return shapes.sort((a, b) => Math.min(...a.map(p => p.fret)) - Math.min(...b.map(p => p.fret)));
}

/**
 * Lagen einer Tonleiter: eine Oktave vom Grundton an, die in vier Bünden ohne Handwechsel greifbar ist. Der Grundton
 * ist der tiefste Ton; jeder weitere Ton liegt auf der tiefsten Saite, die ihn im Bereich hat. Die C-Dur-Tonleiter
 * ergibt z. B. A3 + D0 + D2 + D3 + G0 + G2 + B0.
 * @param {number} root Grundton (0 = C … 11 = H)
 * @param {number[]} intervals Abstände der Töne vom Grundton in Halbtönen, aufsteigend
 * @returns {FretPosition[][]} Lagen, je Lage die Töne vom Grundton an
 */
export function scaleShapes(root, intervals) {
    /** @type {FretPosition[][]} */
    const shapes = [];
    const seen = new Set();
    for (let low = 0; low + HAND_SPAN <= FRETS; low++) {
        for (let first = 0; first < STRINGS.length; first++) {
            for (let rootFret = low; rootFret <= low + HAND_SPAN; rootFret++) {
                const rootPitch = LOW_FIRST[first] + rootFret;
                if (rootPitch % 12 !== root) continue;

                /** @type {FretPosition[]} */
                const shape = [];
                for (const interval of intervals) {
                    const target = rootPitch + interval;
                    let found = null;
                    for (let s = first; s < STRINGS.length && !found; s++) {
                        const fret = target - LOW_FIRST[s];
                        if (fret >= low && fret <= low + HAND_SPAN && fret <= FRETS) found = {s, fret};
                    }
                    if (!found) break;
                    shape.push(found);
                }
                if (shape.length !== intervals.length) continue;
                const key = shape.map(p => `${p.s}:${p.fret}`).join(',');
                if (seen.has(key)) continue;
                seen.add(key);
                shapes.push(shape);
            }
        }
    }
    return shapes.sort((a, b) => Math.min(...a.map(p => p.fret)) - Math.min(...b.map(p => p.fret)));
}

/**
 * Was zu einer Auswahl gehört.
 * @typedef {Object} StructureView
 * @property {number[]} notes Töne (der Grundton zuerst)
 * @property {string} title Überschrift, z. B. "Am: A C E"
 * @property {Object<number, string>} alt andere Schreibweise einzelner Intervalle
 * @property {Array<{semitones: number, label: string, name: string, color: string}>} legend die vorkommenden Intervalle
 * @property {FretPosition[][]} shapes Griffe (Akkord) bzw. Lagen (Tonleiter), leer bei einem Ton
 * @property {'note'|'chord'|'scale'} kind Art der Auswahl
 */

/**
 * Töne, Intervalle und Klammern eines Eintrags der Auswahl.
 * @param {number} root Grundton (0 = C … 11 = H)
 * @param {string} id Eintrag aus STRUCTURES
 * @returns {StructureView} Ansicht der Auswahl
 */
export function structureOf(root, id) {
    const group = STRUCTURES.find(g => g.items.some(i => i.id === id)) ?? STRUCTURES[0];
    const item = group.items.find(i => i.id === id) ?? group.items[0];
    const notes = item.intervals.map(i => (root + i) % 12);
    const names = notes.map(n => NOTE_NAMES[n]);
    const legend = item.intervals.map(semitones => {
        const label = intervalLabel(item, semitones);
        return {semitones, label, name: INTERVAL_NAMES[label], color: INTERVAL_COLORS[semitones]};
    });
    const shapes = group.id === 'chord' ? chordShapes(root, item.intervals)
        : group.id === 'scale' ? scaleShapes(root, item.intervals) : [];
    const rootName = NOTE_NAMES[root];
    const short = item.label.replace(/ \(.*\)$/, '');
    let name = `Ton ${rootName}`;
    if (group.id === 'chord') name = `${rootName}${item.suffix ?? ''} (${short})`;
    else if (group.id === 'scale') name = `${rootName}-${/Tonleiter|Pentatonik/.test(short) ? short : short + '-Tonleiter'}`;
    return {
        notes,
        title: group.id === 'note' ? name : `${name}: ${names.join(' ')}`,
        alt: item.alt ?? {},
        legend,
        shapes,
        kind: group.id,
    };
}

const WIDTH = 1000;
const NUT_X = 58;
const FIRST_Y = 30;
const BOARD_STRING_GAP = 30;
const BOTTOM = FIRST_Y + BOARD_STRING_GAP * 5;

/** Bünde mit Markierungspunkt. */
const MARKERS = [3, 5, 7, 9, 12, 15];

/**
 * x-Lage des Bundstabs (wie auf einem echten Griffbrett: die Abstände werden nach oben kleiner; das Ende des 15. Bundes
 * liegt am rechten Rand).
 * @param {number} fret Bund (0 = Sattel)
 * @returns {number} x in der Zeichnung
 */
function fretX(fret) {
    const scale = (1 - 2 ** (-fret / 12)) / (1 - 2 ** (-FRETS / 12));
    return NUT_X + (WIDTH - 10 - NUT_X) * scale;
}

/**
 * Mitte eines Punkts: zwischen den Bundstäben, die leere Saite links vom Sattel.
 * @param {FretPosition} position Stelle
 * @returns {{x: number, y: number}} Lage in der Zeichnung
 */
function dotCenter({s, fret}) {
    return {
        x: fret ? (fretX(fret - 1) + fretX(fret)) / 2 : NUT_X - 26,
        y: FIRST_Y + BOARD_STRING_GAP * (STRINGS.length - 1 - s),
    };
}

/**
 * @typedef {Object} FretboardOptions Darstellung des Griffbretts.
 * @property {boolean} [intervals] Intervalle statt Notennamen auf die Punkte schreiben
 * @property {Object<number, string>} [alt] andere Schreibweise einzelner Intervalle (Halbtöne -> Kurzschreibweise)
 * @property {FretPosition[][]} [shapes] Griffe bzw. Lagen; an ihren Grundtönen (data-shapes) lassen sie sich anklicken
 * @property {number} [active] Index des umklammerten Griffs bzw. der Lage in shapes (-1: keiner)
 */

/**
 * Zeichnet das Griffbrett mit den Stellen der gewählten Töne. Die Punkte sind nach dem Intervall zum Grundton
 * eingefärbt.
 * @param {number[]} notes gewählte Töne (0 = C … 11 = H)
 * @param {number} [root] Grundton, wird hervorgehoben (-1: keiner)
 * @param {FretboardOptions} [options] Beschriftung und Klammern
 * @returns {string} SVG
 */
export function fretboardSvg(notes, root = -1, options = {}) {
    const {intervals = false, alt = {}, shapes = [], active = -1} = options;
    const chosen = new Set(notes);
    const parts = [];
    // Markierungspunkte auf dem Griffbrett
    for (const fret of MARKERS) {
        const x = (fretX(fret - 1) + fretX(fret)) / 2;
        const ys = fret === 12 ? [FIRST_Y + BOARD_STRING_GAP * 1.5, FIRST_Y + BOARD_STRING_GAP * 3.5] : [FIRST_Y + BOARD_STRING_GAP * 2.5];
        for (const y of ys) parts.push(`<circle class="fb-marker" cx="${x.toFixed(1)}" cy="${y}" r="7"/>`);
    }
    // Bundstäbe, Sattel, Saiten
    for (let fret = 0; fret <= FRETS; fret++) {
        const x = fretX(fret).toFixed(1);
        parts.push(`<line class="${fret ? 'fb-fret' : 'fb-nut'}" x1="${x}" y1="${FIRST_Y}" x2="${x}" y2="${BOTTOM}"/>`);
    }
    STRINGS.forEach((_, i) => {
        const y = FIRST_Y + BOARD_STRING_GAP * i;
        parts.push(`<line class="fb-string" style="stroke-width:${(1 + i * 0.35).toFixed(2)}" x1="${NUT_X}" y1="${y}" `
            + `x2="${WIDTH - 10}" y2="${y}"/>`);
    });
    // Bundnummern
    for (const fret of MARKERS) {
        const x = ((fretX(fret - 1) + fretX(fret)) / 2).toFixed(1);
        parts.push(`<text class="fb-number" x="${x}" y="${BOTTOM + 22}" text-anchor="middle">${fret}</text>`);
    }
    // Klammer unter den Punkten: ein breiter, halbtransparenter Linienzug durch die Töne des gewählten Griffs bzw. der
    // Lage
    if (shapes[active]) {
        const points = shapes[active].map(p => dotCenter(p)).map(c => `${c.x.toFixed(1)},${c.y}`).join(' ');
        parts.push(`<polyline class="fb-shape" points="${points}"/>`);
    }
    // Grundtöne, an denen ein Griff bzw. eine Lage beginnt: Kennung der Griffe (für den Klick)

    /** @type {Map<string, number[]>} */
    const starts = new Map();
    shapes.forEach((shape, n) => {
        const key = `${shape[0].s}:${shape[0].fret}`;
        starts.set(key, [...(starts.get(key) ?? []), n]);
    });
    // Töne: Leere Saiten links vom Sattel, sonst zwischen den Bundstäben
    STRINGS.forEach((open, i) => {
        const s = STRINGS.length - 1 - i;
        for (let fret = 0; fret <= FRETS; fret++) {
            const pitchClass = (open + fret) % 12;
            if (!chosen.has(pitchClass)) continue;
            const {x, y} = dotCenter({s, fret});
            const semitones = root < 0 ? 0 : (pitchClass - root + 12) % 12;
            const color = INTERVAL_COLORS[semitones];
            const label = intervals && root >= 0 ? alt[semitones] ?? INTERVAL_LABELS[semitones] : NOTE_NAMES[pitchClass];
            const begins = starts.get(`${s}:${fret}`);
            parts.push(`<g class="fb-note${fret ? '' : ' fb-open'}${pitchClass === root ? ' fb-root' : ''}${begins ? ' fb-pick' : ''}" `
                + (begins ? `data-shapes="${begins.join(',')}" ` : '') + `style="--fb-color:${color}"><circle cx="${x.toFixed(1)}" cy="${y}" r="12"/>`
                + `<text x="${x.toFixed(1)}" y="${y + 4}" text-anchor="middle">${label}</text></g>`);
        }
    });
    // Namen der leeren Saiten ganz links
    STRINGS.forEach((open, i) => parts.push(`<text class="fb-string-name" x="6" y="${FIRST_Y + BOARD_STRING_GAP * i + 4}">`
        + `${NOTE_NAMES[open % 12]}</text>`));
    return `<svg class="fretboard" viewBox="0 0 ${WIDTH} ${BOTTOM + 34}" role="img" `
        + `aria-label="Griffbrett bis zum ${FRETS}. Bund">${parts.join('')}</svg>`;
}
