/**
 * Dialog "Patterns" aus dem Menü ☰ der Übersichtsseite: Der Pattern-Katalog zum Ansehen und Drucken.
 */

import {escapeHtml} from '../lib/format.js';
import {loadPatterns} from '../lib/api.js';
import {openOverlay} from '../ui/overlay.js';

/**
 * Zeigt den Pattern-Katalog (Strumming und Picking Patterns) zum Ansehen und Drucken, analog zu den Griffbildern.
 * @returns {Promise<void>}
 */
export async function showPatternCatalog() {
    openOverlay(`
        <h2>Patterns</h2>
        <p class="ov-meta">Strumming und Picking Patterns</p>
        <div class="ov-tools">
            <div class="controls pattern-filter" id="patternFilter" hidden>
                <select id="patTsSel" aria-label="Nach Taktart filtern"><option value="">Alle Taktarten</option></select>
                <select id="patGenreSel" aria-label="Nach Genre filtern"><option value="">Alle Genres</option></select>
            </div>
            <button class="btn" type="button" id="toggleChords">Alle zuklappen</button>
            <button class="btn" type="button" id="printChords">Drucken</button>
        </div>
        <div class="catalog-list" id="catalogList"><p class="empty">wird geladen &hellip;</p></div>
    `, false, false, true);
    document.getElementById('printChords').addEventListener('click', () => window.print());
    const list = document.getElementById('catalogList');
    const toggle = document.getElementById('toggleChords');
    const groupsOf = () => [...list.querySelectorAll('details.chord-root')];
    const updateToggle = () => {
        toggle.textContent = groupsOf().some(d => d.open) ? 'Alle zuklappen' : 'Alle aufklappen';
    };
    toggle.addEventListener('click', () => {
        const open = !groupsOf().some(d => d.open);
        for (const group of groupsOf()) group.open = open;
        updateToggle();
    });
    list.addEventListener('toggle', updateToggle, true);
    try {
        const loadingPatterns = import('../lib/patterns.js');
        const loadingSheetView = import('../ui/sheetview.js');
        const {TECHNIQUES} = await loadingPatterns;
        const {patternGridHtml} = await loadingSheetView;
        const {patterns: patternCatalog, usage, genres: genresOf = {}} = await loadPatterns();
        // Genre eines Patterns = Genre der Songs, die es verwenden; ungenutzte Patterns haben keines.
        const patterns = patternCatalog.map(p => ({...p, genres: genresOf[p.id] ?? []}));
        // Filter: "Filter für Taktart und Genre"): nur Werte, die es im Katalog gibt.
        const fill = (select, values, all) => {
            select.innerHTML = `<option value="">${all}</option>` + values.map(v =>
                `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
        };
        const tsSel = /** @type {HTMLSelectElement} */ (document.getElementById('patTsSel'));
        const genreSel = /** @type {HTMLSelectElement} */ (document.getElementById('patGenreSel'));
        fill(tsSel, [...new Set(patterns.map(p => p.timeSignature))].sort((a, b) => a.localeCompare(b, 'de', {numeric: true})),
            'Alle Taktarten');
        const genres = [...new Set(patterns.flatMap(p => p.genres ?? []))].sort((a, b) => a.localeCompare(b, 'de'));
        fill(genreSel, genres, 'Alle Genres');
        genreSel.hidden = !genres.length;
        document.getElementById('patternFilter').hidden = false;
        const draw = () => {
            const shown = patterns.filter(p => (!tsSel.value || p.timeSignature === tsSel.value)
                && (!genreSel.value || (p.genres ?? []).includes(genreSel.value)));
            list.innerHTML = Object.entries(TECHNIQUES).map(([technique, label]) => {
                const group = shown.filter(p => p.technique === technique)
                    .sort((a, b) => a.timeSignature.localeCompare(b.timeSignature) || a.name.localeCompare(b.name));
                if (!group.length) return '';
                // Je Taktart und je Bauart eine Zeile, damit Patterns mit einer Zeile mehr (zweiter Bass beim Picking
                // Pattern) nicht neben Patterns ohne stehen; in der Zeile gleich hohe Karten, das Raster unten, sodass
                // Titel und Zählzeiten auf einer Höhe liegen. Strumming Patterns halten immer Platz für die Betonung
                // frei.

                /** @type {Map<string, import('../lib/patterns.js').Pattern[]>} */
                const byRow = new Map();
                for (const p of group) {
                    const key = `${p.timeSignature}|${technique === 'picking' && /q/i.test(p.steps ?? '')}`;
                    byRow.set(key, [...(byRow.get(key) ?? []), p]);
                }
                return `
                    <details class="chord-root" open>
                        <summary>${escapeHtml(label)}s</summary>
                        ${[...byRow.values()].map(row => `<div class="chord-root-list pattern-list">${row.map(p => `
                        <section class="chord-group pattern-card">
                            <!-- Das Raster steht nur dabei, wenn es nicht der Normalfall (Achtel) ist. -->
                            <h3>${escapeHtml(p.name)}</h3>
                            <div class="pattern-meta">${escapeHtml(p.timeSignature)}${p.grid === 16 ? ' · Sechzehntel' : ''}${
                                usage[p.id] ? ` · ${usage[p.id]} Song${usage[p.id] === 1 ? '' : 's'}` : ''}</div>
                            ${p.genres?.length ? `<div class="pattern-meta">${escapeHtml(p.genres.join(', '))}</div>` : ''}
                            ${patternGridHtml(p, false, true)}
                        </section>`).join('')}</div>`).join('')}
                    </details>
                `;
            }).join('') || `<p class="empty">${patterns.length ? 'Kein Pattern passt zu diesem Filter.' : 'Der Katalog ist noch leer.'}</p>`;
            updateToggle();
        };
        tsSel.addEventListener('change', draw);
        genreSel.addEventListener('change', draw);
        draw();
    } catch (err) {
        list.innerHTML = `<p class="empty">${escapeHtml(err.message)}</p>`;
    }
}
