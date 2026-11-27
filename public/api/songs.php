<?php

/**
 * Songs lesen, bearbeiten und löschen (Logik: api/lib/crud.php). Angelegt wird ein Song nur über import.php, weil
 * jeder Song Noten hat. Jeder Song enthält dazu die berechneten Felder files (SONG_FILES) und tracks (Spurnamen).
 *
 * GET    /api/songs.php            -> {"songs": [...]}, nach Titel sortiert
 * GET    /api/songs.php?slug=xyz   -> ein Song, 404, falls unbekannt
 * PUT    /api/songs.php?slug=xyz   -> Stammdaten (JSON, title Pflicht); fehlende optionale Felder bleiben.
 *                                     Ändert sich der Slug, wird der Ordner umbenannt. Token nötig.
 * DELETE /api/songs.php?slug=xyz   -> löscht den Song samt Ordner. Token nötig.
 */

require_once __DIR__ . '/../../config.php';
require_once __DIR__ . '/lib/http.php';
require_once __DIR__ . '/lib/crud.php';

$method = $_SERVER['REQUEST_METHOD'];
$slug = isset($_GET['slug']) ? (string)$_GET['slug'] : null;

try {
    switch ($method) {
        case 'GET':
            if ($slug !== null) {
                $song = get_song($slug);
                if ($song === null) {
                    json_error(404, "Song '$slug' nicht gefunden");
                }
                json_response(200, $song);
            }
            json_response(200, ['songs' => list_songs()]);

        case 'PUT':
            require_token();
            if ($slug === null) {
                json_error(400, 'slug-Parameter erforderlich');
            }
            $data = read_json_body();
            $song = update_song($slug, $data);
            json_response(200, $song);

        case 'DELETE':
            require_token();
            if ($slug === null) {
                json_error(400, 'slug-Parameter erforderlich');
            }
            delete_song($slug);
            json_response(200, ['deleted' => $slug]);

        default:
            json_error(405, "Methode '$method' nicht erlaubt");
    }
} catch (ValidationException $e) {
    json_response(400, ['error' => 'Validierung fehlgeschlagen', 'details' => $e->errors]);
} catch (NotFoundException $e) {
    json_error(404, $e->getMessage());
} catch (ConflictException $e) {
    json_error(409, $e->getMessage());
} catch (RuntimeException $e) {
    // Fängt u. a. fehlgeschlagenes mkdir()/rename() und unlink()/rmdir() ab, statt eines rohen PHP-Fatals
    // mit kaputtem JSON-Body (siehe Kommentar an remove_directory_recursive() in crud.php).
    json_error(500, $e->getMessage());
}
