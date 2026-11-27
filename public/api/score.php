<?php

/**
 * Noten eines Songs (score.atex) ausliefern und ersetzen; data/ liegt außerhalb des Document Root.
 *
 * GET    /api/score.php?slug=xyz               -> alphaTex (text/plain)
 * GET    /api/score.php?slug=xyz&history=1     -> Verlauf: [{id, time, size, note}], neueste zuerst
 * GET    /api/score.php?slug=xyz&version=<id>  -> alphaTex dieses Stands
 * DELETE /api/score.php?slug=xyz&version=<id>  -> löscht den Stand (Noten und Leadsheet); Antwort: der Verlauf.
 *                                                 Token nötig.
 * PUT    /api/score.php?slug=xyz               -> ersetzt score.atex (höchstens SCORE_MAX_BYTES), nur für Songs mit
 *                                                 Noten; der bisherige Stand kommt in den Verlauf (&note=…). Antwort:
 *                                                 der Song. Token nötig.
 */

require_once __DIR__ . '/../../config.php';
require_once __DIR__ . '/lib/http.php';
require_once __DIR__ . '/lib/file_store.php';

$method = $_SERVER['REQUEST_METHOD'];
$slug = (string)($_GET['slug'] ?? '');

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
                send_file(score_history_path($slug, (string)$_GET['version']), 'text/plain; charset=utf-8');
            }
            $path = song_dir($slug) . '/' . SONG_FILES['score'];
            if (!is_file($path)) {
                json_error(404, 'Keine Noten vorhanden');
            }
            send_file($path, 'text/plain; charset=utf-8');

        case 'PUT':
            require_token();
            // Ein Byte mehr als erlaubt lesen, damit validate_score() zu große Noten erkennt.
            $tex = (string)file_get_contents('php://input', false, null, 0, SCORE_MAX_BYTES + 1);
            json_response(200, store_score($slug, $tex, history_note()));

        case 'DELETE':
            require_token();
            delete_score_history($slug, (string)($_GET['version'] ?? ''));
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
