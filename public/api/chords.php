<?php

/**
 * Akkordkatalog: Akkordname (klein) → Griffe im Standard-Tuning, der häufigste Griff aus den Liedern zuerst.
 * Er baut sich aus den Noten der Lieder von allein auf (lib/chords.php) und liegt als Zwischenspeicher in
 * data/chords.json. Ausliefern über die API ist nötig, weil DATA_DIR bewusst außerhalb des Document Root liegt.
 *
 * GET /api/chords.php             -> JSON-Objekt, z. B. {"c": ["x32010", "xxx553"], ...}. Kein Token nötig.
 * GET /api/chords.php?usage=1     -> wie oft die Griffe in den Liedern vorkommen, z. B. {"c": {"x32010": 41}, ...}; ein
 *                                    Griff, der in keinem Lied steht, fehlt.
 */

require_once __DIR__ . '/../../config.php';
require_once __DIR__ . '/lib/http.php';
require_once __DIR__ . '/lib/chords.php';

$method = $_SERVER['REQUEST_METHOD'];

if ($method !== 'GET') {
    json_error(405, "Methode '$method' nicht erlaubt");
}
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-cache');
if (($_GET['usage'] ?? '') !== '') {
    echo json_encode((object)array_map(fn(array $g) => (object)$g, chord_usage()), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
echo chord_library_json();
