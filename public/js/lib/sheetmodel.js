/**
 * Angaben für das Leadsheet (score.json): Aufbau (Typ Sheet), Normalisieren, Tab-Stellen beim Ändern der Takte
 * mitführen, Abschnitte der Noten. Das Blatt daraus setzt ui/sheetview.js.
 *
 * score.json hält nur, was nicht in den Noten steht. Der Ablauf und die Randnotizen (beat.text) stehen in den Noten,
 * damit es sie nur an einer Stelle gibt; deshalb gibt es auch keine Zuordnung von Patterns zu Takten.
 */

import {chordsTrack, hasStrings, isWip} from './notation.js';

/** @typedef {import('../../../types/alphatab').model.Track} Track */
/** @typedef {import('../../../types/alphatab').model.Score} Score */
/** @typedef {import('../../../types/alphatab').model.MasterBar} MasterBar */

/**
 * Tab-Stellen, ersetzte Takte und Baustellen als Objekte des Modells (captureTabs()).
 * @typedef {Object} SheetCapture
 * @property {{tab: SheetTab, bars: MasterBar[], track: ?Track}[]} tabs Tab-Stellen
 * @property {{cut: SheetCut, bars: MasterBar[]}[]} cuts ersetzte Takte
 * @property {Track[]} wip Spuren, die Baustelle sind
 */

/**
 * Ein Pattern des Songs.
 * @typedef {{id: string, when: string}} SheetPattern
 */

/**
 * Takte, die als Tab auf das Blatt kommen.
 * @typedef {{from: number, to: number, track: string, label: string}} SheetTab
 */

/**
 * Link auf dem Blatt.
 * @typedef {{label: string, url: string, qr: boolean}} SheetLink
 */

/**
 * Takte, die auf dem Blatt nicht ausgeschrieben werden, weder in "Text & Akkorde" noch in den Tabs (tabPieces());
 * an ihrer Stelle steht der Hinweis .
 * from/to sind Indizes der Takte wie bei SheetTab; text leer: Die Takte fallen ohne Hinweis weg. Geändert wird nur das
 * Blatt, nicht die Noten.
 * @typedef {{from: number, to: number, text: string}} SheetCut
 */

/**
 * Angaben für das Leadsheet (score.json).
 * @typedef {Object} Sheet
 * @property {SheetPattern[]} patterns Patterns des Songs
 * @property {SheetTab[]} tabs Tab-Stellen
 * @property {SheetCut[]} cuts Takte, die in Text & Akkorde durch einen Hinweis ersetzt sind
 * @property {Object<string, boolean>} chords Griffbilder: Abweichungen von der Regel (Akkordname → zeigen)
 * @property {SheetLink[]} links Links
 * @property {string} instructions Hinweise zur Spielweise (Markdown)
 * @property {SheetLayout} layout wie das Blatt gesetzt wird
 * @property {number} barsPerRow Takte pro Zeile in den Noten, gezählt ab jedem Abschnitt (rowBreaks()); 0 ohne
 * @property {string[]} wip Spuren der Baustelle (aus song.json, nicht in score.json): Der Editor führt sie hier mit,
 *   damit Umbenennen und Löschen sie nachziehen
 */

/**
 * Wie das Blatt gesetzt wird (Kontrollkästchen im Dialog "Leadsheet").
 * @typedef {Object} SheetLayout
 * @property {boolean} twoPages Spielanleitung und Text & Akkorde je auf einer eigenen Seite
 * @property {boolean} columns Text & Akkorde zweispaltig
 * @property {number} font Grundschrift in pt (einer aus FONT_SIZES)
 * @property {boolean} compactTabs Wiederholungen in den Tabs zusammenfassen (tabUnits())
 * @property {boolean} smallChords Griffbilder kleiner
 * @property {boolean} tabCounts Zählzeiten unter den Tabs
 * @property {boolean} mergeSections gleiche Abschnitte nur einmal ausschreiben (collapseSections())
 */

/** Wählbare Grundschrift auf dem Blatt in pt, größte zuerst (Überschriften und Akkorde sind relativ dazu). */
export const FONT_SIZES = [12, 11, 10, 9];

/**
 * Layout ohne Angabe: alles auf einer Seite, einspaltig, größte Schrift; gleiche Abschnitte stehen nur einmal da
 * (das verliert nichts und war schon immer so).
 * @type {SheetLayout}
 */
export const DEFAULT_LAYOUT = {
    twoPages: false, columns: false, font: FONT_SIZES[0], compactTabs: false,
    smallChords: false, tabCounts: false, mergeSections: true
};

/**
 * Bringt die Angaben in die feste Form (fehlende Felder leer, Tab-Stellen nach Takt sortiert).
 * @param {*} data dekodiertes JSON
 * @returns {Sheet}
 */
export function normalizeSheet(data) {
    const patterns = Array.isArray(data?.patterns) ? data.patterns
        .filter(p => typeof p?.id === 'string' && p.id)
        .map(p => ({id: p.id, when: String(p.when ?? '')})) : [];
    const tabs = Array.isArray(data?.tabs) ? data.tabs
        .filter(t => Number.isInteger(t?.from) && Number.isInteger(t?.to) && t.from >= 0 && t.to >= t.from)
        .map(t => ({from: t.from, to: t.to, track: String(t.track ?? ''), label: String(t.label ?? '')}))
        .sort((a, b) => a.from - b.from || a.to - b.to) : [];
    const cuts = Array.isArray(data?.cuts) ? data.cuts
        .filter(c => Number.isInteger(c?.from) && Number.isInteger(c?.to) && c.from >= 0 && c.to >= c.from)
        .map(c => ({from: c.from, to: c.to, text: String(c.text ?? '')}))
        .sort((a, b) => a.from - b.from || a.to - b.to) : [];

    /** @type {Object<string, boolean>} */
    const chords = {};
    if (data?.chords && typeof data.chords === 'object' && !Array.isArray(data.chords)) {
        for (const [name, shown] of Object.entries(data.chords)) if (typeof shown === 'boolean') chords[name] = shown;
    }
    const links = Array.isArray(data?.links) ? data.links
        .filter(l => typeof l?.url === 'string')
        .map(l => ({label: String(l.label ?? ''), url: l.url, qr: l.qr !== false})) : [];
    const instructions = typeof data?.instructions === 'string' ? data.instructions : '';

    /** @type {SheetLayout} */
    const layout = {...DEFAULT_LAYOUT};
    for (const [key, preset] of Object.entries(DEFAULT_LAYOUT)) {
        const value = data?.layout?.[key];
        if (key === 'font' ? FONT_SIZES.includes(value) : typeof value === typeof preset) layout[key] = value;
    }
    const wip = Array.isArray(data?.wip) ? [...new Set(data.wip.filter(n => typeof n === 'string' && n))] : [];
    const barsPerRow = Number.isInteger(data?.barsPerRow) && data.barsPerRow > 0 ? data.barsPerRow : 0;
    return {patterns, tabs, cuts, chords, links, instructions, layout, wip, barsPerRow};
}

/**
 * Hält die Tab-Stellen fest, bevor sich Takte oder Spuren ändern: Takte und Spur als Objekte des Modells. Die bleiben
 * bei Änderungen am Modell dieselben (eingefügte sind neue, gelöschte fehlen danach), so findet remapTabs() die
 * neuen Indizes und Namen. Ersetzte Takte hängen genauso am Index, Baustellen am Namen der Spur.
 * @param {Sheet} sheet Angaben
 * @param {Score} score Noten vor der Änderung
 * @returns {SheetCapture} Stand vor der Änderung
 */
export function captureTabs(sheet, score) {
    return {
        tabs: sheet.tabs.map(tab => ({
            tab, bars: score.masterBars.slice(tab.from, tab.to + 1),
            track: score.tracks.find(t => t.name === tab.track) ?? null
        })),
        cuts: sheet.cuts.map(cut => ({cut, bars: score.masterBars.slice(cut.from, cut.to + 1)})),
        wip: score.tracks.filter(t => sheet.wip.includes(t.name)),
    };
}

/**
 * Zieht die Tab-Stellen nach einer Änderung am Modell nach (siehe captureTabs()): Anfang und Ende sind der erste
 * bzw. letzte Takt des Bereichs, der noch da ist; ist keiner mehr da, fällt die Stelle weg. Die Spur behält ihren
 * Platz in der Angabe auch umbenannt; gelöscht bleibt ihr Name stehen (der Generator nimmt dann die Akkordspur).
 * Baustellen folgen ihrer Spur; mit ihr gelöscht fallen sie weg, außer eine andere Spur trägt danach ihren Namen.
 * @param {Sheet} sheet Angaben, werden geändert
 * @param {Score} score Noten nach der Änderung (dasselbe Modell)
 * @param {SheetCapture} captured Stand davor
 * @returns {void}
 */
export function remapTabs(sheet, score, captured) {
    const index = new Map(score.masterBars.map((mb, i) => [mb, i]));
    sheet.tabs = captured.tabs.flatMap(({tab, bars, track}) => {
        const kept = bars.map(mb => index.get(mb)).filter(i => i !== undefined);
        if (!kept.length) return [];
        const name = track && score.tracks.includes(track) ? track.name : tab.track;
        return [{...tab, from: Math.min(...kept), to: Math.max(...kept), track: name}];
    });
    sheet.cuts = captured.cuts.flatMap(({cut, bars}) => {
        const kept = bars.map(mb => index.get(mb)).filter(i => i !== undefined);
        return kept.length ? [{...cut, from: Math.min(...kept), to: Math.max(...kept)}] : [];
    });
    sheet.wip = [...new Set(captured.wip.map(t => t.name).filter(name => score.tracks.some(t => t.name === name)))];
}

/**
 * Name eines Abschnitts ohne die Klammern der importierten Songs ("[Verse]" → "Verse").
 * @param {?{text: string, marker?: string}} section Abschnitt eines Takts
 * @returns {string} leer ohne Abschnitt
 */
export function sectionName(section) {
    return (section?.text || section?.marker || '').replace(/^\[(.*)]$/, '$1').trim();
}

/**
 * Abschnitte in der Reihenfolge der Noten, je mit Takten. Vor dem ersten Abschnitt (Auftakt, Takte ohne Namen) steht
 * einer ohne Namen.
 * @param {Score} score Noten
 * @returns {{name: string, from: number, to: number}[]}
 */
export function sections(score) {
    const starts = score.masterBars.map((mb, i) => i === 0 || mb.section ? i : -1).filter(i => i >= 0);
    return starts.map((from, k) => ({
        name: sectionName(score.masterBars[from].section), from,
        to: (starts[k + 1] ?? score.masterBars.length) - 1
    }));
}

/**
 * Spur einer Tab-Stelle: die mit dem Namen, sonst die Akkordspur, sonst die erste mit Saiten; nie eine Baustelle.
 * @param {Score} score Noten
 * @param {string} name Name aus den Angaben (tabs[].track)
 * @returns {?Track} null ohne Spur mit Saiten bzw. bei einer Baustelle
 */
export function tabTrack(score, name) {
    const stringed = t => hasStrings(t.staves[0]);
    const named = score.tracks.find(t => t.name === name && stringed(t));
    if (named) return isWip(named) ? null : named;
    const usable = t => stringed(t) && !isWip(t);
    const chords = chordsTrack(score);
    return chords && usable(chords) ? chords : score.tracks.find(usable) ?? null;
}

/**
 * Ob eine Tab-Stelle auf einer Baustelle liegt (dann steht sie nicht auf dem Blatt).
 * @param {Score} score Noten
 * @param {{track: string}} tab Tab-Stelle
 * @returns {boolean}
 */
export function tabOnWip(score, tab) {
    return isWip(score.tracks.find(t => t.name === tab.track));
}

/**
 * Gruppe eines Abschnitts: der Name ohne Nummer, klein; "Refrain" zählt als "Chorus".
 * "Chorus 2" und "Chorus" gehören zusammen, "Verse 2" und "Verse" auch.
 * @param {string} name Name des Abschnitts
 * @returns {string} leer ohne Namen
 */
export function sectionGroup(name) {
    const base = name.toLowerCase().replace(/\s*\(.*\)\s*$/, '').replace(/[\s.#-]*\d+\s*$/, '').trim();
    return /^(chorus|refrain)$/.test(base) ? 'chorus' : base;
}

/** Gruppen, deren Vorkommen verschiedenen Text haben dürfen (Strophen). */
export const VERSE_GROUPS = /^(verse|strophe)$/;

/**
 * Teilt eine Tab-Stelle an den ersetzten Takten (SheetCut): Was ersetzt ist, wird nicht gezeichnet, an der Stelle
 * steht der Hinweis. Die Stücke davor und danach sind eigene Zeichnungen.
 * @param {SheetTab} tab Tab-Stelle
 * @param {SheetCut[]} cuts ersetzte Takte, nach from sortiert
 * @returns {({from: number, to: number} | {hint: string})[]} Stücke in der Reihenfolge des Blatts; hint leer: Die
 *   Takte fallen ohne Hinweis weg
 */
export function tabPieces(tab, cuts) {
    /** @type {({from: number, to: number} | {hint: string})[]} */
    const pieces = [];
    let from = tab.from;
    for (const cut of cuts) {
        if (cut.to < from || cut.from > tab.to) continue;
        if (cut.from > from) pieces.push({from, to: cut.from - 1});
        pieces.push({hint: cut.text.trim()});
        from = cut.to + 1;
    }
    if (from <= tab.to) pieces.push({from, to: tab.to});
    return pieces;
}
