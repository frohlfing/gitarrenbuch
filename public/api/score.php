<?php

/**
 * Noten eines Lieds (score.atex, für alphaTab): ausliefern und ersetzen.
 * Ausliefern über die API ist nötig, weil DATA_DIR bewusst außerhalb des Document Root liegt.
 *
 * GET /api/score.php?slug=xyz   -> alphaTex als text/plain (UTF-8), 404, falls Lied oder Datei fehlt. Kein Token nötig.
 * GET /api/score.php?slug=xyz&history=1
 *                               -> JSON-Liste der aufgehobenen Fassungen, die neueste zuerst: id, time, size (siehe
 *                                  list_score_history()). Kein Token nötig.
 * GET /api/score.php?slug=xyz&version=<id>
 *                               -> alphaTex dieser Fassung (id aus der Liste) als text/plain, 404, falls es sie nicht gibt.
 * DELETE /api/score.php?slug=xyz&version=<id>
 *                               -> löscht diesen Stand (Noten und Angaben für das Leadsheet). Antwort: die Liste wie
 *                                  mit history=1. Token nötig.
 * PUT /api/score.php?slug=xyz   -> ersetzt score.atex. Body: alphaTex (text/plain, UTF-8), höchstens SCORE_MAX_BYTES.
 *                                  Antwort: das aktualisierte Lied. Token nötig. Nur für Lieder, die schon Noten
 *                                  haben (neue Noten kommen mit dem Import bzw. dem Gerüst über api/import.php). Der
 *                                  bisherige Stand kommt in den Verlauf.
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
            if (isset($_GET['history'])) {
                json_response(200, list_score_history($slug));
            }
            if (isset($_GET['version'])) {
                send_file(score_history_path($slug, (string) $_GET['version']), 'text/plain; charset=utf-8');
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

        case 'DELETE':
            require_token();
            delete_score_history($slug, (string) ($_GET['version'] ?? ''));
            json_response(200, list_score_history($slug));

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
