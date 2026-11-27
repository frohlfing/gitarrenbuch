/**
 * Akkordtheorie: Zerlegt einen Akkordnamen in seine Töne. Die Regeln stehen in docs/Musiktheorie.md; jeder Name aus den
 * Tabellen dort ergibt sich aus diesen Regeln (Dreiklang aus Terz und Quinte, dazu ein vierter Ton, Erweiterungen,
 * Alterationen, Auslassungen und Basston).
 *
 * Der Name wird von links nach rechts in Bausteine zerlegt (Moll, vermindert, sus, Septime, add9 …); die Reihenfolge
 * der Bausteine ist egal ("C7sus4" wie "Csus47"), Klammern und Leerzeichen zählen nicht ("C7(b5)" wie "C7b5").
 */

/** Tonhöhenklasse der Stammtöne (H gilt als B). */
const NOTE_CLASSES = {c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11, h: 11};

/**
 * Ein Ton des Akkords.
 * @typedef {Object} ChordStep
 * @property {number} semitones Halbtöne über dem Grundton; über 12 für None, Undezime und Tredezime (14, 17, 21)
 * @property {number} pitchClass Tonhöhenklasse, 0 = C
 * @property {'root'|'third'|'second'|'fourth'|'fifth'|'sixth'|'seventh'|'extension'|'added'|'bass'} role Aufgabe im
 *   Akkord
 * @property {boolean} optional ob der Ton auf der Gitarre entfallen darf (Quinte, tiefere Erweiterungen, bei fünf und
 *   mehr Tönen auch der Grundton), ohne dass der Name seinen Sinn verliert
 */

/**
 * Zerlegter Akkordname.
 * @typedef {Object} ParsedChord
 * @property {string} name Name, wie er übergeben wurde
 * @property {number} root Tonhöhenklasse des Grundtons
 * @property {string} rootName Grundton, wie er geschrieben wurde, mit großem Buchstaben und # bzw. b (z. B. "Bb")
 * @property {?number} bass Tonhöhenklasse des Basstons (Slash-Akkord), sonst null
 * @property {ChordStep[]} steps Töne aufsteigend nach Halbtönen; der Basston steht zuletzt, wenn er nicht zum Akkord
 *   gehört
 * @property {number[]} tones verschiedene Tonhöhenklassen, Grundton zuerst (bei Basston der Basston zuletzt)
 * @property {boolean} minor ob die Terz klein ist (Moll, vermindert, halbvermindert)
 */

/**
 * Tonhöhenklasse eines Tons.
 * @param {string} letter Stammton, A bis H (klein oder groß)
 * @param {string} sign "#", "b", "♯", "♭" oder ""
 * @returns {number} 0 bis 11
 */
function pitchClassOf(letter, sign) {
    const shift = sign === '#' || sign === '♯' ? 1 : sign === 'b' || sign === '♭' ? -1 : 0;
    return (NOTE_CLASSES[letter.toLowerCase()] + shift + 12) % 12;
}

/** Bausteine des Namens hinter dem Grundton, in der Reihenfolge, in der sie geprüft werden (längste zuerst). */
const TOKENS = [
    ['sixNine', /^(?:6\/9|69)/],
    ['add', /^add(2|4|6|9|11|13)/],
    ['omit', /^(?:no|omit)(3|5)/],
    ['sus', /^sus(2|4)?/],
    ['major', /^(?:maj|Maj|M(?![a-z])|Δ|△)/],
    ['minor', /^(?:min|m(?!aj)|-)/],
    ['dim', /^(?:dim|°)/],
    ['halfDim', /^ø/],
    ['aug', /^(?:aug|\+)/],
    ['alter', /^([#b♯♭])(5|9|11|13)/],
    ['number', /^(13|11|9|7|6|5|2)/],
];

/**
 * Zerlegt einen Akkordnamen in seine Töne.
 * @param {string} name Akkordname, z. B. "F#m7b5", "Dsus4", "C13", "D/F#"
 * @returns {?ParsedChord} null bei einem Namen, den die Regeln nicht kennen (auch "N.C.")
 */
export function parseChord(name) {
    const head = /^\s*([A-Ha-h])([#b♯♭]?)(.*)$/.exec(name);
    if (!head) return null;
    const root = pitchClassOf(head[1], head[2]);
    const rootName = head[1].toUpperCase().replace('H', 'B') + head[2].replace('♯', '#').replace('♭', 'b');
    // Ein Stern am Ende kennzeichnet eine zweite Griffvariante desselben Akkords ("D7*" in "Kokain"), nicht einen
    // anderen.
    let rest = head[3].replace(/[()\s]/g, '').replace(/\*+$/, '');

    // Basston: "/" mit Tonname am Ende ("6/9" ist keiner)
    let bass = null;
    const slash = /\/([A-Ha-h])([#b♯♭]?)$/.exec(rest);
    if (slash) {
        bass = pitchClassOf(slash[1], slash[2]);
        rest = rest.slice(0, slash.index);
    }

    const flag = {minor: false, dim: false, halfDim: false, aug: false, major: false, delta: false, sixNine: false};

    /** @type {?number} */
    let sus = null;
    const numbers = new Set();
    const added = new Set();
    const omitted = new Set();

    /** @type {Map<number, number>} Alterationen: Stufe (5, 9, 11, 13) → Halbtöne dieser Stufe */
    const altered = new Map();

    while (rest) {
        const hit = TOKENS.map(([kind, re]) => [kind, re.exec(rest)]).find(([, m]) => m);
        if (!hit) return null;
        const [kind, m] = hit;
        rest = rest.slice(m[0].length);
        if (kind === 'sixNine') flag.sixNine = true;
        else if (kind === 'add') added.add(Number(m[1]));
        else if (kind === 'omit') omitted.add(Number(m[1]));
        else if (kind === 'sus') sus = m[1] === '2' ? 2 : 4;
        else if (kind === 'major') {
            flag.major = true;
            flag.delta ||= m[0] === 'Δ' || m[0] === '△';
        } else if (kind === 'alter') {
            const up = m[1] === '#' || m[1] === '♯';
            const degree = Number(m[2]);
            altered.set(degree, {5: 7, 9: 14, 11: 17, 13: 21}[degree] + (up ? 1 : -1));
        } else if (kind === 'number') numbers.add(Number(m[1]));
        else flag[kind] = true;
    }

    const extension = [13, 11, 9].find(n => numbers.has(n)) ?? 0;
    const power = numbers.has(5);
    const seventh = numbers.has(7) || extension > 0 || flag.delta || flag.halfDim;
    const minorThird = flag.minor || flag.dim || flag.halfDim;

    /** @type {Map<number, {role: ChordStep['role'], optional: boolean}>} Halbtöne → Ton (ein Ton je Wert) */
    const steps = new Map();
    const put = (semitones, role, optional = false) => steps.set(semitones, {role, optional});

    put(0, 'root');
    if (sus === 2) put(2, 'second');
    else if (sus === 4) put(5, 'fourth');
    else if (!power && !omitted.has(3)) put(minorThird ? 3 : 4, 'third');

    if (!omitted.has(5)) {
        const fifth = altered.get(5) ?? (flag.dim || flag.halfDim ? 6 : flag.aug ? 8 : 7);
        put(fifth, 'fifth', fifth === 7);
    }
    if (seventh) {
        // Ohne "maj" gilt die kleine Septime; beim verminderten Dreiklang (nicht halbvermindert) die verminderte.
        put(flag.major ? 11 : flag.dim && !flag.halfDim ? 9 : 10, 'seventh');
    }
    if (numbers.has(6) || flag.sixNine) put(9, 'sixth');
    if (numbers.has(2)) added.add(9);
    for (const [level, semitones] of [[9, 14], [11, 17], [13, 21]]) {
        if (extension >= level) put(altered.get(level) ?? semitones, 'extension', extension > level);
        else if (altered.has(level)) put(altered.get(level), 'added');
    }
    if (flag.sixNine) added.add(9);
    for (const n of added) put({2: 14, 9: 14, 4: 17, 11: 17, 6: 9, 13: 21}[n], 'added');

    // Ein Ton, den der Dreiklang schon hat (die 9 bei sus2, die 11 bei sus4), zählt nicht doppelt.
    const classes = new Set();
    const list = [...steps].sort((a, b) => a[0] - b[0]).filter(([semitones]) => {
        const pc = (root + semitones) % 12;
        if (classes.has(pc)) return false;
        classes.add(pc);
        return true;
    }).map(([semitones, {role, optional}]) => ({semitones, pitchClass: (root + semitones) % 12, role, optional}));
    // Ab fünf Tönen darf auch der Grundton fehlen (der Bass spielt ihn oder er entfällt).
    if (list.length >= 5) list[0].optional = true;

    if (bass !== null && !classes.has(bass)) {
        list.push({semitones: (bass - root + 12) % 12, pitchClass: bass, role: 'bass', optional: false});
    }
    return {
        name, root, rootName, bass, steps: list, tones: list.map(s => s.pitchClass), minor: minorThird,
    };
}

/** Stammtöne der Tonleiter in der Reihenfolge der Buchstaben, mit ihrer Tonhöhenklasse. */
const LETTERS = [['C', 0], ['D', 2], ['E', 4], ['F', 5], ['G', 7], ['A', 9], ['B', 11]];

/** Stufe (0 = Prime, 1 = Sekunde …) eines Tons nach seiner Aufgabe im Akkord und seinen Halbtönen; null beim Basston. */
function letterStep(step) {
    const byRole = {root: 0, second: 1, third: 2, fourth: 3, fifth: 4, sixth: 5, seventh: 6};
    if (step.role in byRole) return byRole[step.role];
    if (step.role === 'bass') return null;
    // Erweiterungen und zusätzliche Töne: 9 (13 bis 15 Halbtöne), 11 (17, 18), 13 (20, 21) bzw. Sexte (9)
    const s = step.semitones;
    return s >= 13 && s <= 15 ? 1 : s >= 16 && s <= 18 ? 3 : s >= 19 && s <= 22 ? 5 : 5;
}

/**
 * Namen der Töne eines Akkords, mit der Schreibweise der Stufen (Bb statt A# in F-Dur, Bbb für die verminderte Septime
 * in C).
 * @param {ParsedChord} chord zerlegter Akkordname
 * @returns {string[]} Töne von tief nach hoch, der Basston eines Slash-Akkords zuletzt, wenn er nicht zum Akkord gehört
 */
export function chordNoteNames(chord) {
    const rootIndex = LETTERS.findIndex(([letter]) => letter === chord.rootName[0]);
    return chord.steps.map(step => {
        const degree = letterStep(step);
        if (degree === null) return spellRoot(step.pitchClass, chord.minor);
        const [letter, natural] = LETTERS[(rootIndex + degree) % 7];
        const diff = ((step.pitchClass - natural + 18) % 12) - 6;
        return letter + (diff > 0 ? '#'.repeat(diff) : 'b'.repeat(-diff));
    });
}


// --------------------------------------------------------------------------------------------------------------------
// Namen vorschlagen und Töne benennen
// --------------------------------------------------------------------------------------------------------------------

/**
 * Alle Akkordarten (Endungen hinter dem Grundton) in der Schreibweise, in der sie vorgeschlagen werden: erst die
 * gängigen, dann alle übrigen aus docs/Musiktheorie.md. Jede Endung versteht parseChord().
 */
export const CHORD_SUFFIXES = [
    '', 'm', '7', 'maj7', 'm7', 'sus4', 'sus2', 'dim', 'aug', 'add9', '6', 'm6', '5', '9', 'm9', 'maj9', 'm7b5', 'dim7',
    '7sus4', 'madd9', 'mmaj7', '11', '13', 'm11', 'maj13', 'm13', '6/9', 'm6/9', '7b9', '7#9', '7#11', '7b13', '7b5', '7#5',
    'add4', 'madd4', 'maj7#5', 'maj7b5', 'dimmaj7', 'sus4add9', 'sus2add4', '7sus2', 'maj7sus4', 'maj7sus2', '6sus4', '6sus2',
    'aug6', 'augadd9', 'augadd4', 'dimadd9', 'dimadd4', '6b5', 'add9b5', 'add4b5', 'mmaj9', 'm9b5', 'dim9', '9#5', 'maj9#5',
    '9b5', 'maj9b5', '9sus4', 'maj9sus4', 'maj11', 'mmaj11', 'm11b5', 'dim11', '11#5', 'maj11#5', '11b5', 'maj11b5',
    '11sus2', 'maj11sus2', 'mmaj13', 'm13b5', 'dim13', '13#5', 'maj13#5', '13b5', 'maj13b5', '13sus4', 'maj13sus4',
    '13sus2', 'maj13sus2', 'no5', 'mno5', '7no5', 'maj7no5',
];

/** Grundtöne, wie sie vorgeschlagen werden: erst die Stammtöne, dann die mit Vorzeichen. */
const SUGGEST_ROOTS = ['C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B'];

/** Namen der zwölf Töne für Akkorde mit großer Terz bzw. mit kleiner Terz (C#m, aber Db; Ebm, aber Eb …). */
const SPELL_MAJOR = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const SPELL_MINOR = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];

/**
 * Name eines Tons für einen Akkord.
 * @param {number} pitchClass Tonhöhenklasse, 0 = C
 * @param {boolean} [minor] ob der Akkord Moll ist (dann G#m statt Abm)
 * @returns {string} z. B. "Bb"
 */
export function spellRoot(pitchClass, minor = false) {
    return (minor ? SPELL_MINOR : SPELL_MAJOR)[(pitchClass % 12 + 12) % 12];
}

/**
 * Dreiklänge einer Durtonart (die parallele Molltonart hat dieselben).
 * @param {number} tonic Grundton der Durtonart als Tonhöhenklasse (0 = C)
 * @returns {string[]} Namen von der ersten Stufe an, für D-Dur: D, Em, F#m, G, A, Bm, C#dim
 */
export function scaleTriads(tonic) {
    const steps = [0, 2, 4, 5, 7, 9, 11].map(s => (((tonic + s) % 12) + 12) % 12);
    return steps.map((root, d) => {
        const third = (steps[(d + 2) % 7] - root + 12) % 12;
        const fifth = (steps[(d + 4) % 7] - root + 12) % 12;
        return spellRoot(root, third === 3) + (third === 4 ? '' : fifth === 7 ? 'm' : 'dim');
    });
}

/** Bewertung der Akkorde in rankChords(): Abzug je fehlendem Akkordton und ohne Grundton, Zuschlag für den Bass als
 * Grundton und für einen Akkord, der im Song schon vorkommt. */
const RANK_MISSING = 0.15;
const RANK_NO_ROOT = 0.2;
const RANK_BASS = 0.1;
const RANK_USED = 0.08;

/**
 * Ordnet Akkorde danach, wie gut sie zu den klingenden Tönen passen: Anteil des Klangs, den ihre Töne abdecken, weniger
 * fehlende Akkordtöne (nicht die, die auf der Gitarre entfallen dürfen) und fehlender Grundton; mehr, wenn der Bass der
 * Grundton ist und wenn der Akkord im Song schon vorkommt.
 * @param {number[]} weights Gewicht je Tonhöhenklasse (0 = C), z. B. Klingdauer
 * @param {?number} bass Tonhöhenklasse des tiefsten Tons, null ohne
 * @param {string[]} names Kandidaten
 * @param {Set<string>} used Akkorde, die im Song vorkommen
 * @returns {{name: string, score: number}[]} bester zuerst; ohne Namen, die parseChord() nicht liest
 */
export function rankChords(weights, bass, names, used) {
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    return names.flatMap(name => {
        const chord = parseChord(name);
        if (!chord) return [];
        const covered = chord.tones.reduce((sum, pc) => sum + weights[pc], 0) / total;
        const missing = chord.steps.filter(s => !s.optional && s.role !== 'bass' && !weights[s.pitchClass]).length;
        let score = covered - RANK_MISSING * missing - (weights[chord.root] ? 0 : RANK_NO_ROOT);
        if (bass === chord.root) score += RANK_BASS;
        if (used.has(name)) score += RANK_USED;
        return [{name, score}];
    }).sort((a, b) => b.score - a.score);
}

/**
 * Namen, die mit den bisher getippten Zeichen beginnen, für die Eingabe im Akkord-Dialog. Es kommen alle Akkorde vor,
 * die sich nach den Regeln bilden lassen (CHORD_SUFFIXES), nicht nur die gängigen. Ab einem "/" werden Basstöne
 * vorgeschlagen, die zum Akkord davor passen zuerst.
 * @param {string} prefix bisher eingegebener Anfang des Namens, z. B. "Am" oder "C/"
 * @param {number} [limit] höchstens so viele Namen
 * @returns {string[]} leer bei leerer Eingabe oder wenn nichts passt
 */
export function suggestChordNames(prefix, limit = 60) {
    const text = prefix.trim().replace(/^[a-h]/, c => c.toUpperCase());
    if (!text) return [];
    const slash = /^(.+)\/([A-Ha-h][#b♯♭]?)?$/.exec(text);
    if (slash) {
        const head = parseChord(slash[1]);
        if (!head) return [];
        const typed = (slash[2] ?? '').replace(/^[a-h]/, c => c.toUpperCase());
        const inChord = new Set(head.tones);
        const classOf = name => pitchClassOf(name[0], name.slice(1));
        const candidates = [...SUGGEST_ROOTS].sort((a, b) => Number(inChord.has(classOf(b))) - Number(inChord.has(classOf(a))));
        return candidates.filter(n => n.startsWith(typed) && classOf(n) !== head.root).map(n => `${slash[1]}/${n}`).slice(0, limit);
    }
    const names = [];
    for (const root of SUGGEST_ROOTS) {
        for (const suffix of CHORD_SUFFIXES) {
            const name = root + suffix;
            if (name.startsWith(text)) names.push(name);
            if (names.length >= limit) return names;
        }
    }
    return names;
}

/** Die Akkordarten mit ihren Tönen für den Grundton C, einmal berechnet (für nameChord()). */
const SUFFIX_TABLE = CHORD_SUFFIXES.map((suffix, index) => {
    const chord = parseChord('C' + suffix);
    return {
        suffix, index, minor: chord.minor,
        tones: new Set(chord.tones),
        required: chord.steps.filter(s => !s.optional && s.role !== 'bass').map(s => s.pitchClass),
    };
});

/**
 * Akkordnamen zu gespielten Tönen (Umkehrung von parseChord()): jeder Name, dessen Töne alle gespielten enthalten und
 * dessen nötige Töne (ohne die, die entfallen dürfen) alle gespielt werden. Zuerst die, deren Grundton der Ton der
 * tiefsten gespielten Saite ist, dann die, die die Töne genau treffen, dann die einfacheren Namen. Ist ein anderer Ton
 * der Ton der tiefsten Saite, steht er als Basston dahinter ("C/E").
 * @param {number[]} tones gespielte Töne als Tonhöhenklassen (Doppelte egal)
 * @param {number} bass Tonhöhenklasse des Tons der tiefsten gespielten Saite
 * @param {number} [limit] höchstens so viele Namen
 * @returns {string[]} leer, wenn es weniger als zwei verschiedene Töne sind oder kein Name passt
 */
export function nameChord(tones, bass, limit = 6) {
    const played = new Set(tones.map(t => (t % 12 + 12) % 12));
    if (played.size < 2) return [];
    const found = [];
    for (const root of played) {
        const rel = new Set([...played].map(p => (p - root + 12) % 12));
        for (const row of SUFFIX_TABLE) {
            if (![...rel].every(p => row.tones.has(p)) || !row.required.every(p => rel.has(p))) continue;
            const name = spellRoot(root, row.minor) + row.suffix + (root === bass ? '' : '/' + spellRoot(bass));
            // "no5" nur, wenn nichts anderes passt: meist steht der Name des vollständigen Akkords und nur der Griff
            // lässt die Quinte aus.
            found.push({
                name,
                rank: [root === bass ? 0 : 1, row.suffix.includes('no5') ? 1 : 0, rel.size === row.tones.size ? 0 : 1,
                    row.tones.size - rel.size, row.index]
            });
        }
    }
    found.sort((a, b) => {
        for (let i = 0; i < a.rank.length; i++) if (a.rank[i] !== b.rank[i]) return a.rank[i] - b.rank[i];
        return 0;
    });
    return [...new Set(found.map(f => f.name))].slice(0, limit);
}
