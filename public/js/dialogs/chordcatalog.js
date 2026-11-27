/**
 * Dialog "Akkorde" aus dem Menü ☰ der Übersichtsseite: alle Griffbilder des Akkord-Katalogs, zum Ausdrucken gedacht.
 */

import {chordDiagramSvg} from '../ui/chorddiagram.js';
import {escapeHtml} from '../lib/format.js';
import {loadChordCatalog} from '../lib/api.js';
import {openOverlay} from '../ui/overlay.js';

/**
 * Akkordname zum Anzeigen: Der Katalog schreibt klein ("f#m", "d/f#").
 * @param {string} key Schlüssel des Katalogs
 * @returns {string} z. B. "F#m", "D/F#"
 */
function chordDisplayName(key) {
    return key.replace(/^[a-h]|\/[a-h]/g, s => s.toUpperCase());
}

/**
 * Zeigt alle Griffbilder des Akkord-Katalogs, je Akkord der häufigste Griff zuerst; zum Ausdrucken gedacht.
 * @returns {Promise<void>}
 */
export async function showChordCatalog() {
    openOverlay(`
        <h2>Akkorde</h2>
        <p class="ov-meta">Die Akkorde der Songs nach Grundton, häufigster Griff zuerst</p>
        <div class="ov-tools">
            <button class="btn" type="button" id="toggleChords">Alle zuklappen</button>
            <button class="btn" type="button" id="printChords">Drucken</button>
        </div>
        <div class="catalog-list" id="catalogList"><p class="empty">wird geladen &hellip;</p></div>
    `, false, false, true);
    document.getElementById('printChords').addEventListener('click', () => window.print());
    const list = document.getElementById('catalogList');
    const toggle = document.getElementById('toggleChords');
    const groupsOf = () => [...list.querySelectorAll('details.chord-root')];
    // Ist noch eine Gruppe offen, klappt der Button alle zu, sonst alle auf.
    const updateToggle = () => {
        toggle.textContent = groupsOf().some(d => d.open) ? 'Alle zuklappen' : 'Alle aufklappen';
    };
    toggle.addEventListener('click', () => {
        const open = !groupsOf().some(d => d.open);
        for (const group of groupsOf()) group.open = open;
        updateToggle();
    });
    // "toggle" steigt nicht auf, deshalb in der Capture-Phase.
    list.addEventListener('toggle', updateToggle, true);
    try {
        const chordCatalog = await loadChordCatalog();
        // Nach Grundton gruppieren; der Katalog ist schon nach Grundton sortiert.

        /** @type {Map<string, string>} */
        const groups = new Map();
        for (const [key, grips] of Object.entries(chordCatalog)) {
            const name = chordDisplayName(key);
            const root = name.match(/^[A-H][#b]?/)?.[0] ?? name;
            groups.set(root, (groups.get(root) ?? '') + `
                <section class="chord-group">
                    ${grips.map(grip => `
                    <figure>
                        ${chordDiagramSvg(name, grip)}
                        <figcaption>${escapeHtml(grip)}</figcaption>
                    </figure>`).join('')}
                </section>
            `);
        }
        list.innerHTML = [...groups].map(([root, html]) => `
            <details class="chord-root" open>
                <summary>${escapeHtml(root)}</summary>
                <div class="chord-root-list">${html}</div>
            </details>
        `).join('') || '<p class="empty">Noch keine Akkorde: Sie erscheinen, sobald ein Song Noten mit Akkorden hat.</p>';
    } catch (err) {
        list.innerHTML = `<p class="empty">${escapeHtml(err.message)}</p>`;
    }
}
