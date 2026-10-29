<?php

/**
 * Noten eines Lieds (score.atex, für alphaTab): ausliefern und ersetzen.
 * Ausliefern über die API ist nötig, weil DATA_DIR bewusst außerhalb des Document Root liegt.
 *
 * GET /api/score.php?slug=xyz   -> alphaTex als text/plain (UTF-8), 404, falls Lied oder Datei fehlt. Kein Token nötig.
 * PUT /api/score.php?slug=xyz   -> ersetzt score.atex. Body: alphaTex (text/plain, UTF-8), höchstens SCORE_MAX_BYTES.
 *                                  Antwort: das aktualisierte Lied. Token nötig. Nur für Lieder, die schon Noten
 *                                  haben (neue Noten kommen mit dem Import bzw. dem Gerüst über api/import.php).
 *
 * Token wird per Header X-API-Token erwartet (siehe api/lib/http.php: require_token()).
 */

require_once __DIR__ . '/../../config.php';
require_once __DIR__ . '/lib/http.php';
require_once __DIR__ . '/lib/file_store.php';

$method = $_SERVER['REQUEST_METHOD'];
$slug = (string) ($_GET['slug'] ?? '');

try {
    switch ($method) {
        case 'GET':
            if (read_song_json($slug) === null) {
                json_error(404, "Song '$slug' nicht gefunden");
            }
            $path = song_dir($slug) . '/' . SONG_FILES['score'];
            if (!is_file($path)) {
                json_error(404, 'Keine Noten vorhanden');
            }
            send_file($path, 'text/plain; charset=utf-8');

        case 'PUT':
            require_token();
            // Ein Byte mehr als erlaubt lesen, damit validate_score() zu große Noten erkennt.
            $tex = (string) file_get_contents('php://input', false, null, 0, SCORE_MAX_BYTES + 1);
            json_response(200, store_score($slug, $tex));

        default:
            json_error(405, "Methode '$method' nicht erlaubt");
    }
} catch (FileValidationException $e) {
    json_error(400, $e->getMessage());
} catch (NotFoundException $e) {
    json_error(404, $e->getMessage());
} catch (RuntimeException $e) {
    json_error(500, $e->getMessage());
}
