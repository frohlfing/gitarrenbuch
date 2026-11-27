<?php

/**
 * Akkord-Katalog: je Akkordname (klein) die Griffe im Standard-Tuning mit der Zahl ihrer Schläge in allen Songs, der
 * häufigste zuerst. Er wird bei jedem Aufruf aus den Noten der Songs gezählt (lib/chordcatalog.php). Ausliefern über
 * die API ist nötig, weil DATA_DIR bewusst außerhalb des Document Root liegt.
 *
 * GET /api/chords.php   -> JSON-Objekt, z. B. {"c": [["x32010", 41], ["xxx553", 3]], ...}. Kein Token nötig.
 */

require_once __DIR__ . '/../../config.php';
require_once __DIR__ . '/lib/http.php';
require_once __DIR__ . '/lib/chordcatalog.php';

$method = $_SERVER['REQUEST_METHOD'];

if ($method !== 'GET') {
    json_error(405, "Methode '$method' nicht erlaubt");
}
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-cache');
echo json_encode((object)chord_catalog(), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
