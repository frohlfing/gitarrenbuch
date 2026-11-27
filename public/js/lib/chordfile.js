/**
 * Liedtext und Akkorde aus einer Chord-Datei lesen. Unterstütztes Format:
 *   - ChordPro (.cho, Akkorde in eckigen Klammern im Text)
 *   - Text mit den Akkorden über den Zeilen (z. B. von einer Tab-Seite kopiert).
 */

import {chordKey} from './chords.js';
import {findGrips} from './chordgrips.js';
import {parseChord} from './chordtheory.js';

/** Zeile mit einem Abschnittsnamen, z. B. "[Verse]" (wie im Panel "Liedtext", siehe SECTION_LINE in notation.js). */
const SECTION_LINE = /^\s*\[([^\]]+)]\s*$/;

/**
 * Ob ein Text ein Akkordname ist, z. B. "Am", "C7", "F#m7b5", "Dsus4", "G/B": Er beginnt mit einem großen Buchstaben A
 * bis G, den Rest versteht parseChord() (chordtheory.js).
 * @param {string} text Text
 * @returns {boolean}
 */
function isChordName(text) {
    return /^[A-G]/.test(text) && parseChord(text) !== null;
}

/** Angaben in Akkordzeilen, die keine Akkorde sind: Pause ("N.C.") und Wiederholungen ("x2", "(2x)"). */
const CHORD_FILLER = /^(?:N\.?C\.?|\(?[x×]\d+\)?|\(?\d+[x×]\)?)$/;

/**
 * Ein Akkord oder Taktstrich an einer Stelle im Text.
 * @typedef {Object} FileChord
 * @property {number} at Zeichen im Text, über bzw. vor dem er steht; bei end der Zeilenumbruch seiner Zeile
 * @property {string} name Akkordname, leer bei einem Taktstrich ohne Akkord
 * @property {boolean} bar ob ein Taktstrich "|" davor steht (dort beginnt ein Takt)
 * @property {boolean} end ob er hinter der letzten Silbe seiner Zeile steht oder die Akkordzeile keinen Text hat (ein
 *   Takt bzw. Akkord ohne eigene Silbe)
 */

/**
 * Inhalt einer Akkorddatei als Liedtext mit den Akkorden.
 * @typedef {Object} ChordFileContent
 * @property {string} text Liedtext, Abschnitte durch eine Leerzeile getrennt, ohne Akkorde
 * @property {FileChord[]} chords Akkorde und Taktstriche mit ihrer Stelle im Text, in Textreihenfolge
 */

/** Zeile, die den Abschnitt davor wiederholt ("-/-" in Leadsheets). */
const REPEAT_LINE = /^\s*-\/-\s*$/;

/**
 * Ob eine Zeile nur aus Akkorden besteht (Akkordzeile über dem Text); Taktstriche "|" zählen nicht.
 * @param {string} line Zeile
 * @returns {boolean} true bei mindestens einem Akkord und sonst nichts
 */
function isChordLine(line) {
    const tokens = line.split(/[\s|]+/).filter(Boolean);
    return tokens.length > 0 && tokens.every(t => isChordName(t) || CHORD_FILLER.test(t));
}

/**
 * Akkorde und Taktstriche einer Akkordzeile mit ihrer Spalte: "|D" ist ein Taktstrich mit Akkord (Spalte des
 * Strichs), "|" allein ein Taktstrich ohne Akkord.
 * @param {string} line Akkordzeile
 * @returns {{col: number, name: string, bar: boolean}[]} ohne Wiederholungsangaben
 */
function chordsOfLine(line) {
    return [...line.matchAll(/\|[^\s|]*|[^\s|]+/g)].flatMap(m => {
        const bar = m[0].startsWith('|');
        const name = bar ? m[0].slice(1) : m[0];
        if (isChordName(name)) return [{col: m.index, name, bar}];
        return bar ? [{col: m.index, name: '', bar}] : [];
    });
}

/**
 * Schreibt Wiederholungen aus: "-/-" und ein leerer Abschnitt, dessen Name schon mit Inhalt vorkam, bekommen die
 * Zeilen des letzten Abschnitts mit diesem Namen.
 * @param {string[]} lines Zeilen der Datei
 * @returns {string[]}
 */
function expandRepeats(lines) {
    /** @type {Map<string, string[]>} */
    const known = new Map();

    /** @type {string[]} */
    const out = [];
    let name = '';

    /** @type {string[]} */
    let body = [];
    const close = () => {
        const content = body.slice(0, body.findLastIndex(l => l.trim()) + 1);
        if (!name) return;
        if (content.length) known.set(name, content);
        else if (known.has(name)) out.push(...known.get(name), '');
    };
    for (const line of lines) {
        const section = line.match(SECTION_LINE);
        if (section && !isChordName(section[1])) {
            close();
            name = section[1].trim().toLowerCase();
            body = [];
            out.push(line);
        } else if (REPEAT_LINE.test(line)) {
            const copy = known.get(name) ?? [];
            out.push(...copy);
            body.push(...copy);
        } else {
            out.push(line);
            body.push(line);
        }
    }
    close();
    return out;
}

/**
 * Liest den Inhalt einer Akkorddatei.
 *
 * - ChordPro: Angaben in geschweiften Klammern (`{title: …}`, `{comment: …}`, `{capo: 2}`) fallen weg;
 *   `{start_of_verse: Strophe 1}` und `{start_of_chorus}` werden zu einer Abschnittszeile "[Strophe 1]" bzw.
 *   "[Chorus]". Die Akkorde im
 *   Text ("[Am]Hallo") stehen vor ihrer Silbe; Kommentarzeilen mit "#" fallen weg.
 * - Text mit Akkorden über den Zeilen: Eine Akkordzeile gehört zur Textzeile darunter, jeder Akkord zur Silbe an seiner
 *   Spalte, ein Taktstrich "|" ebenso (dort beginnt ein Takt). Was hinter dem Text steht oder in einer Akkordzeile
 *   ohne Text, ist ein Takt bzw. Akkord ohne eigene Silbe (end). Abschnittszeilen ("[Verse]") bleiben; "-/-"
 *   wiederholt den Abschnitt (expandRepeats()). Was vor dem ersten Abschnitt steht (Capo, Tuning, Titel), fällt weg.
 *
 * Mehrsilbige Wörter sind in der Datei mit Bindestrich getrennt oder gehen beim Verteilen auf einen Schlag (der Editor
 * markiert, wo der Text nicht aufgeht).
 * @param {string} content Inhalt der Datei
 * @returns {ChordFileContent}
 */
export function readChordFile(content) {
    /** @type {{text: ?string, chords: Omit<FileChord, 'end'>[]}[]} Zeilen; text null: Akkordzeile ohne Text */
    const lines = [];

    /** @type {{col: number, name: string, bar: boolean}[]} */
    let pending = [];
    // Eine Akkordzeile ohne Textzeile darunter: ihre Takte und Akkorde haben keine Silbe.
    const flush = () => {
        if (pending.length) lines.push({text: null, chords: pending.map(c => ({at: 0, name: c.name, bar: c.bar}))});
        pending = [];
    };
    for (const raw of expandRepeats(content.replace(/\r\n?/g, '\n').split('\n'))) {
        const line = raw.replace(/\s+$/, '');
        if (line.trimStart().startsWith('#')) continue;
        const directive = line.trim().match(/^\{\s*([a-z_]+)\s*(?::\s*(.*?))?\s*}$/i);
        if (directive) {
            flush();
            const [, name, value] = directive;
            const kind = {
                start_of_verse: 'Verse', sov: 'Verse', start_of_chorus: 'Chorus', soc: 'Chorus',
                start_of_bridge: 'Bridge', sob: 'Bridge',
            }[name.toLowerCase()];
            if (kind) lines.push({text: '', chords: []}, {text: `[${value || kind}]`, chords: []});
            continue;
        }
        const section = line.match(SECTION_LINE);
        if (section && !isChordName(section[1])) {
            flush();
            lines.push({text: '', chords: []}, {text: `[${section[1].trim()}]`, chords: []});
            continue;
        }
        if (isChordLine(line)) {
            flush();
            pending = chordsOfLine(line);
            continue;
        }
        // ChordPro: Akkorde im Text; was in Klammern steht und kein Akkord ist (z. B. "[2x]"), fällt weg.
        let text = '';
        const chords = [];
        let last = 0;
        for (const m of line.matchAll(/\[([^\]]*)]/g)) {
            text += line.slice(last, m.index);
            if (isChordName(m[1])) chords.push({at: text.length, name: m[1], bar: false});
            last = m.index + m[0].length;
        }
        text += line.slice(last);
        const lead = text.length - text.trimStart().length;
        text = text.trim();
        if (!text) {
            flush();
            continue;
        }
        // Akkordzeile darüber: Die Spalte zählt in der Zeile, wie sie in der Datei steht (mit den Leerzeichen davor).
        const over = pending.map(c => ({
            at: Math.min(text.length, Math.max(0, c.col - lead)), name: c.name, bar: c.bar
        }));
        pending = [];
        lines.push({
            text,
            chords: [...chords.map(c => /** @type {Omit<FileChord, 'end'>} */ ({...c, at: Math.max(0, c.at - lead)})), ...over]
                .sort((a, b) => a.at - b.at),
        });
    }
    flush();
    // Was vor dem ersten Abschnitt steht, ist der Kopf der Datei (Capo, Tuning, Titel), wenn es Abschnitte gibt.
    const first = lines.findIndex(l => SECTION_LINE.test(l.text ?? ''));
    let body = first > 0 ? lines.slice(first) : lines;
    // Keine Leerzeile am Anfang, nie zwei hintereinander.
    body = body.filter((l, i) => !(l.text === '' && (i === 0 || body[i - 1].text === '')));
    let text = '';

    /** @type {FileChord[]} */
    const chords = [];
    for (const l of body) {
        if (l.text === null) {
            // Ohne eigene Zeile: am Zeilenumbruch der Zeile davor.
            for (const c of l.chords) chords.push(/** @type {FileChord} */ ({...c, at: Math.max(0, text.length - 1), end: true}));
            continue;
        }
        for (const c of l.chords) {
            chords.push(/** @type {FileChord} */ ({...c, at: text.length + c.at, end: c.at >= l.text.length}));
        }
        text += l.text + '\n';
    }
    return {text: text.replace(/\n$/, ''), chords};
}

/**
 * Ersetzt einen Akkord, den der Akkord-Katalog nicht kennt, durch einen einfacheren, der bekannt ist: erst ohne Basston
 * ("D/F#" → "D"), dann ohne Erweiterungen ("Am7b5" → "Am7" → "Am", "Cmaj9" → "Cmaj7" → "C"). Bekannt ist ein Akkord,
 * wenn der Katalog einen Griff dafür hat oder findGrips() einen findet.
 * @param {string} name Akkordname aus der Datei
 * @param {import('./chords.js').ChordCatalog} chordCatalog Akkord-Katalog
 * @returns {string} der Name selbst, wenn er bekannt ist; sonst der einfachere; ohne bekannten bleibt der Name
 */
export function simplifyChord(name, chordCatalog) {
    const known = n => !!chordCatalog[chordKey(n)]?.length || findGrips(n, {limit: 1}).length > 0;
    if (known(name)) return name;
    const m = name.match(/^([A-G][#b♯♭]?)([^/]*)(?:\/.*)?$/);
    if (!m) return name;
    const [, root, rest] = m;
    const minor = /^(?:m(?!aj)|min|-)/.test(rest);
    const seventh = /7|9|11|13/.test(rest) && !/maj/i.test(rest);
    const candidates = [
        root + rest,
        ...(minor ? [root + 'm' + (seventh ? '7' : ''), root + 'm'] : []),
        ...(!minor && /maj/i.test(rest) ? [root + 'maj7'] : []),
        ...(!minor && /sus/.test(rest) ? [root + (/sus2/.test(rest) ? 'sus2' : 'sus4')] : []),
        ...(!minor && seventh ? [root + '7'] : []),
        root,
    ];
    return candidates.find(known) ?? name;
}
