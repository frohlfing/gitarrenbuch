<?php

/**
 * Liefert die Noten eines Lieds aus (score.atex, für alphaTab).
 * Nötig, weil DATA_DIR bewusst außerhalb des Document Root liegt.
 *
 * `GET /api/score.php?slug=xyz`
 * Antwort: alphaTex als text/plain (UTF-8), 404, falls Lied oder Datei fehlt.
 *
 * Schreiben (PUT) kommt mit dem geplanten Editor.
 */

require_once __DIR__ . '/../../config.php';
require_once __DIR__ . '/lib/http.php';
require_once __DIR__ . '/lib/file_store.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_error(405, 'Nur GET erlaubt');
}

$slug = (string) ($_GET['slug'] ?? '');
if (read_song_json($slug) === null) {
    json_error(404, "Song '$slug' nicht gefunden");
}

$path = song_dir($slug) . '/' . SONG_FILES['score'];
if (!is_file($path)) {
    json_error(404, 'Keine Noten vorhanden');
}

send_file($path, 'text/plain; charset=utf-8');
