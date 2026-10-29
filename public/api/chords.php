<?php

/**
 * Akkordbibliothek (data/chords.json): Akkordname (klein) → Griffe in Standardstimmung, Standardgriff zuerst.
 * Ausliefern über die API ist nötig, weil DATA_DIR bewusst außerhalb des Document Root liegt.
 *
 * GET /api/chords.php   -> JSON-Objekt, z. B. {"c": ["x32010", "xxx553"], ...}. Kein Token nötig.
 *
 * Schreiben (PUT, für den Editor) kommt später.
 */

require_once __DIR__ . '/../../config.php';
require_once __DIR__ . '/lib/http.php';
require_once __DIR__ . '/lib/file_store.php';

/**
 * Pfad der Akkordbibliothek.
 *
 * @var string
 */
const CHORDS_FILE = DATA_DIR . '/chords.json';

$method = $_SERVER['REQUEST_METHOD'];

if ($method !== 'GET') {
    json_error(405, "Methode '$method' nicht erlaubt");
}
if (!is_file(CHORDS_FILE)) {
    json_error(404, 'Keine Akkordbibliothek vorhanden');
}
send_file(CHORDS_FILE, 'application/json; charset=utf-8');
