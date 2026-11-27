/**
 * Hinweis auf alphaTab (Lizenz) mit dem offiziellen Logo in der Fußzeile, statt "rendered by alphaTab" unter jedem
 * Tab. Daniel Kuschny, Autor von alphaTab, hat genau diese Form gutgeheißen (siehe
 * https://github.com/CoderLine/alphaTab/discussions/1608).
 */

/** Text des Vermerks, den alphaTab unter jede Zeichnung setzt. */
export const ATTRIBUTION_TEXT = 'rendered by alphaTab';

/** Offizielles Logo von alphaTab: lokal abgelegt (zuerst) und von alphatab.net (falls die Datei fehlt). */
export const ALPHATAB_LOGO = {
    local: new URL('../../vendor/alphatab/alphatab-official-logo.svg', import.meta.url).href,
    remote: 'https://alphatab.net/img/brand/alphatab-official-logo.svg',
};

/**
 * Fußzeile mit dem Hinweis auf alphaTab.
 * @param {string} place Klasse für die Lage (ls-credit: Leadsheet, player-credit, cmp-credit)
 * @param {string} [what] was alphaTab gezeichnet hat
 * @returns {string} HTML
 */
export function creditHtml(place, what = 'Tabs') {
    return `
        <p class="credit ${place}">${what} rendered by
            <a href="https://alphatab.net" target="_blank" rel="noopener" title="alphatab.net">
                <img class="credit-logo" alt="alphaTab" src="${ALPHATAB_LOGO.local}">
                <span class="credit-name">alphaTab</span>
            </a>
        </p>
    `;
}

/**
 * Logos in den Fußzeilen unter root: Fehlt die lokale Datei, kommt das Logo von alphatab.net; geht auch das nicht,
 * wird es entfernt, und der Name steht als Text da.
 * @param {ParentNode} root Bereich mit Fußzeilen
 * @returns {void}
 */
export function useCreditLogos(root) {
    for (const logo of /** @type {NodeListOf<HTMLImageElement>} */ (root.querySelectorAll('.credit-logo'))) {
        if (logo.dataset.creditWatched) continue;
        logo.dataset.creditWatched = '1';
        const failed = () => {
            if (logo.src !== ALPHATAB_LOGO.remote) logo.src = ALPHATAB_LOGO.remote;
            else logo.remove();
        };
        if (logo.complete && !logo.naturalWidth) failed();
        logo.addEventListener('error', failed);
    }
}

/**
 * Ist das Element der Vermerk "rendered by alphaTab" (ein Stück der Zeichnung mit nur diesem Text)?
 * @param {Element} element Stück der Zeichnung (SVG bzw. dessen Behälter)
 * @returns {boolean}
 */
export function isAttribution(element) {
    return element.textContent?.trim() === ATTRIBUTION_TEXT;
}

/**
 * Blendet im Player den Hinweis auf alphaTab aus (wird stattdessen in der Fußzeile angezeigt).
 * AlphaTab zeichnet ihn später nach (beim Scrollen oder Größenänderung).
 * (creditHtml()) unter den Noten.
 * @param {HTMLElement} host Element, in das alphaTab zeichnet
 * @returns {() => void} beendet das Beobachten
 */
export function hideAttribution(host) {
    /** @param {ParentNode} root neu eingefügter Teil */
    const sweep = root => {
        const list = root instanceof SVGSVGElement ? [root] : root.querySelectorAll?.('svg') ?? [];
        for (const svg of list) {
            // Der Vermerk ist ein kleines Stück mit einem Text; große Stücke (Notenzeilen) gar nicht erst lesen.
            if (svg.childElementCount > 3 || !isAttribution(svg)) continue;
            const piece = /** @type {HTMLElement} */ (svg.closest('.at-surface > *') ?? svg);
            piece.style.display = 'none';
        }
    };
    const observer = new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) {
            if (node instanceof Element) sweep(node);
        }
    });
    observer.observe(host, {childList: true, subtree: true});
    sweep(host);
    return () => observer.disconnect();
}
