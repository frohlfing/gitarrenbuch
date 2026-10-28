<?php

/**
 * JSON-API für Lieder: Listen/Lesen, Bearbeiten (inkl. Rename bei Titeländerung) und Löschen.
 * Angelegt wird ein Lied nur über import.php, weil jedes Lied Noten hat (beim manuellen Anlegen erzeugt der
 * Browser ein Gerüst, siehe createScore() in js/score.js).
 *
 * GET    /api/songs.php            -> {"songs": [...]}, alle Lieder, alphabetisch nach Titel sortiert. Kein Token nötig.
 * GET    /api/songs.php?slug=xyz   -> einzelnes Lied. Kein Token nötig. 404, falls unbekannt.
 * PUT    /api/songs.php?slug=xyz   -> aktualisiert ein Lied. Body: JSON-Objekt mit title (Pflicht), artist,
 *                                     technique, tags, subtitle, album, words, music, copyright, tab, instructions,
 *                                     notes, sources, youtubeSeconds. Fehlen subtitle bis instructions, bleiben die
 *                                     gespeicherten; fehlt youtubeSeconds, bleibt die gespeicherte Länge, solange
 *                                     die YouTube-URL gleich ist.
 *                                     Ändert sich durch Interpret oder Titel der Slug, wird der Ordner umbenannt.
 *                                     Token nötig.
 * DELETE /api/songs.php?slug=xyz   -> löscht das Lied samt Ordner (Rohmaterial inklusive). Token nötig.
 *
 * Jedes Lied enthält zusätzlich die berechneten Felder files (welche Dateien vorhanden sind, siehe SONG_FILES) und
 * tracks (Spurnamen aus score.atex, siehe read_track_names()).
 * Token wird per Header X-API-Token erwartet (siehe api/lib/http.php: require_token()).
 * Die eigentliche Lese-/Schreib-/Rename-/Delete-Logik steckt in api/lib/crud.php.
 */

require_once __DIR__ . '/../../config.php';
require_once __DIR__ . '/lib/http.php';
require_once __DIR__ . '/lib/crud.php';

$method = $_SERVER['REQUEST_METHOD'];
$slug = isset($_GET['slug']) ? (string) $_GET['slug'] : null;

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
