/**
 * Regelwerk für Rhythmushinweis-Generierung: Der Rhythmushinweis sagt, wo ein Rhythmus gespielt wird (Dialog
 * "Rhythmus ableiten"). Die Regeln gelten in dieser Reihenfolge, die erste, die genau die Takte
 * des Rhythmus trifft, liefert den Text (die Nummern stehen auch an den Regeln im Code). Ist der Rhythmus vereinfacht
 * (Anschläge neben dem Sechzehntelraster weggelassen), steht "vereinfacht" fett dabei:
 *
 * 1. Ganzer Song – "ganzer Song"
 * 2. Abschnittsgruppen – alle Abschnitte der Gruppen ganz ("Verse 1" und "Verse 2" sind "Verse"): "Verse, Chorus"
 * 3. Taktmerkmale – alle, die in den Takten gleich sind: Akkord am Taktanfang, Akkordwechsel mit Stelle (und Akkord,
 *    wenn gleich), nur wenn nötig die Taktart; ohne Wechsel nicht eigens erwähnt: "Takte mit C, Akkordwechsel zu G/B
 *    auf 3", "Takte mit G"
 * 4. Abschnittsrand – erster bzw. letzter Takt der Abschnitte einer Gruppe: "letzter Takt jedes Abschnitts Chorus"
 * 5. Grundrhythmus – der häufigste von mehreren Rhythmen mit Anschlägen
 * 6. Anteile – die Gruppen mit Anteil, wo er nur in einem Teil der Takte gilt: "Verse (12 von 48 Takten), Chorus"
 *
 * Mit dem Schalter "Rhythmen anhand der Abschnitte unterscheiden" gelten die Regeln je Abschnittsgruppe: Ihr
 * häufigster Rhythmus mit Anschlägen heißt zuerst "Grundrhythmus für Verse" (auch als einziger); sonst "ganzer
 * Abschnitt" statt 1 und 2, der Rand als "letzter Takt jedes Durchgangs" bzw. "letzter Takt", Anteile als "12 von 48
 * Takten".
 */

import {WHOLE_TICKS} from './notation.js';
import {sectionGroup, sections} from './sheetmodel.js';

/** @typedef {import('../../../types/alphatab').model.Score} Score */

/**
 * Ob zwei Mengen von Takten gleich sind.
 * @param {Set<number>} a Takte
 * @param {Set<number>} b Takte
 * @returns {boolean}
 */
function sameBars(a, b) {
    return a.size === b.size && [...a].every(i => b.has(i));
}

/**
 * Abschnitte in der Reihenfolge der Noten mit Gruppe (sectionGroup(): "Verse 1" und "Verse 2" sind "verse") und Namen
 * ohne Nummer; Takte vor dem ersten Abschnitt heißen "Anfang".
 * @param {Score} score Noten
 * @returns {{name: string, from: number, to: number, label: string, group: string}[]}
 */
export function sectionParts(score) {
    return sections(score).map(s => ({
        name: s.name, from: s.from, to: s.to, label: (s.name || 'Anfang').replace(/[\s.#-]*\d+\s*$/, '').trim(),
        group: sectionGroup(s.name || 'Anfang')
    }));
}

/**
 * Rhythmushinweis: wo ein Rhythmus gespielt wird, nach dem Regelwerk (siehe Kopf der Datei); die erste Regel, die genau
 * diese Takte trifft, gilt. Mit scope (Takte einer Abschnittsgruppe, Schalter "Rhythmen anhand der Abschnitte
 * unterscheiden") gilt alles nur darin:
 * zuerst "Grundrhythmus für Verse", sonst "ganzer Abschnitt", keine Abschnittsgruppen, "letzter Takt jedes
 * Durchgangs", Anteile als "12 von 48 Takten".
 * @param {Score} score Noten
 * @param {Set<number>} bars Takte (Index)
 * @param {{tick: number, name: string}[]} events Akkordwechsel (chordTimeline())
 * @param {boolean} [main] der häufigste von mehreren Rhythmen (mit Anschlägen); mit scope der häufigste der Gruppe,
 *   auch als einziger
 * @param {?Set<number>} [scope] nur diese Takte betrachten; null für den ganzen Song
 * @returns {string}
 */
export function rhythmHint(score, bars, events, main = false, scope = null) {
    const all = score.masterBars;
    const parts = sectionParts(score);
    // Je Abschnittsgruppe hat jede einen Grundrhythmus, auch wenn er allein steht.
    if (scope && main) return `Grundrhythmus für ${parts.find(s => scope.has(s.from)).label}`;
    // 1. Ganzer Song bzw. ganzer Abschnitt
    if (bars.size === (scope?.size ?? all.length)) return scope ? 'ganzer Abschnitt' : 'ganzer Song';
    const range = s => Array.from({length: s.to - s.from + 1}, (_, k) => s.from + k);
    // 2. Abschnittsgruppen: alle Gruppen, in denen die Takte liegen, müssen ganz dazugehören.
    const groups = [...new Set(parts.filter(s => range(s).some(i => bars.has(i))).map(s => s.group))];
    const inGroups = new Set(parts.filter(s => groups.includes(s.group)).flatMap(range));
    if (!scope && sameBars(bars, inGroups)) {
        return groups.map(g => parts.find(s => s.group === g).label).join(', ');
    }
    // 3. Taktmerkmale: Akkord am Taktanfang, Akkordwechsel im Takt (Stellen, wenn gleich auch die Akkorde), nur wenn
    // nötig die Taktart. Genannt werden alle, die in diesen Takten gleich sind, wenn sie zusammen genau sie treffen.
    const chordAt = i => events.findLast(e => e.tick <= all[i].start)?.name ?? '';
    const changes = i => {
        const mb = all[i];
        const end = mb.start + mb.calculateDuration();
        let current = chordAt(i);
        const found = [];
        for (const e of events.filter(ev => ev.tick > mb.start && ev.tick < end)) {
            if (e.name !== current) found.push({
                count: countAt(e.tick - mb.start, mb.timeSignatureDenominator),
                name: e.name
            });
            current = e.name;
        }
        return found;
    };

    /** @type {[function(number): string, function(string): string][]} */
    const features = [
        [chordAt, v => v ? `mit ${v}` : 'ohne Akkord'],
        [i => changes(i).map(c => c.count).join(' und '), v => v ? `mit Akkordwechsel auf ${v}` : ''],
        [i => changes(i).map(c => `${c.name} auf ${c.count}`).join(' und '), v => v ? `mit Akkordwechsel zu ${v}` : ''],
    ];
    const signature = [i => `${all[i].timeSignatureNumerator}/${all[i].timeSignatureDenominator}`, v => `in ${v}`];
    const constant = list => list.filter(([valueOf]) => new Set([...bars].map(valueOf)).size === 1);
    const exact = list => list.length > 0 && sameBars(bars, new Set(all.filter(mb => (!scope || scope.has(mb.index))
        && list.every(([valueOf]) => valueOf(mb.index) === valueOf([...bars][0]))).map(mb => mb.index)));
    let traits = constant(features);
    // Die Stellen allein, wenn auch die Akkorde dazu gleich sind, sagen weniger.
    if (traits.includes(features[2]) && changes([...bars][0]).length) traits = traits.filter(t => t !== features[1]);
    if (!exact(traits) && exact([...constant([signature]), ...traits])) traits = [...constant([signature]), ...traits];
    if (exact(traits)) {
        const labels = traits.map(([valueOf, label]) => label(valueOf([...bars][0]))).filter(Boolean);
        // "mit C, Akkordwechsel auf 3" statt "mit C, mit Akkordwechsel auf 3".
        const text = labels.map((l, k) => k && labels.slice(0, k).some(p => p.startsWith('mit '))
            ? l.replace(/^mit /, '') : l);
        return `${bars.size === 1 ? 'Takt' : 'Takte'} ${text.join(', ')}`;
    }
    // 4. Abschnittsrand: erster bzw. letzter Takt der Abschnitte einer Gruppe
    for (const [edge, label] of [['to', 'letzter'], ['from', 'erster']]) {
        const groupsAt = new Set(parts.filter(s => bars.has(s[edge])).map(s => s.group));
        if (groupsAt.size !== 1) continue;
        const g = [...groupsAt][0];
        const edges = new Set(parts.filter(s => s.group === g).map(s => s[edge]));
        if (sameBars(bars, edges)) {
            if (scope) return `${label} Takt${edges.size > 1 ? ' jedes Durchgangs' : ''}`;
            const where = edges.size > 1 ? 'jedes Abschnitts' : 'im Abschnitt';
            return `${label} Takt ${where} ${parts.find(s => s.group === g).label}`;
        }
    }
    // 5. Grundrhythmus
    if (main) return 'Grundrhythmus';
    // 6. Anteile
    if (scope) return `${bars.size} von ${scope.size} Takten`;
    return groups.map(g => {
        const inGroup = parts.filter(s => s.group === g).flatMap(range);
        const hit = inGroup.filter(i => bars.has(i)).length;
        const label = parts.find(s => s.group === g).label;
        return hit === inGroup.length ? label : `${label} (${hit} von ${inGroup.length} Takten)`;
    }).join(', ');
}

/**
 * Zählzeit einer Stelle im Takt, z. B. "1", "2+", "3e" (Viertel-Taktarten) bzw. "4" (Achtel-Taktarten).
 * @param {number} offset Ticks ab Taktanfang
 * @param {number} denominator Nenner der Taktart
 * @returns {string}
 */
export function countAt(offset, denominator) {
    const beat = WHOLE_TICKS / denominator;
    const n = Math.floor(offset / beat) + 1;
    const rest = offset % beat;
    return rest === 0 ? `${n}` : rest === beat / 2 ? `${n}+` : rest === beat / 4 ? `${n}e`
        : rest === beat * 3 / 4 ? `${n}a` : `${n} (krumm)`;
}
