<?php

require_once __DIR__ . '/file_store.php';

/**
 * Endungen, die als Akkorddatei angenommen werden: ChordPro und reiner Text (z. B. Akkorde über den Zeilen).
 *
 * @var string[]
 */
const CHORD_FILE_EXTENSIONS = ['cho', 'chopro', 'crd', 'pro', 'txt'];

/**
 * Höchstgröße einer Akkorddatei.
 *
 * @var int Bytes
 */
const CHORD_FILE_MAX_BYTES = 1024 * 1024;

/**
 * Legt eine hochgeladene Akkorddatei (ChordPro oder Text) als Rohmaterial unter orig/ ab (siehe store_original():
 * gleicher Inhalt nur einmal, nie überschrieben). Text und Akkorde haben ihre einzige Quelle in den Noten
 * (score.atex); dort arbeitet der geplante Editor die Datei ein, wobei vorhandener Text Vorrang hat.
 *
 * @param string $slug Lied, zu dem die Datei gehört
 * @param string $localPath lokale Datei; wird nur gelesen, Aufräumen bleibt Sache des Aufrufers
 * @param string $originalName ursprünglicher Dateiname, bestimmt Endung und Namen unter orig/
 * @return array das aktualisierte Lied
 * @throws FileValidationException|NotFoundException|RuntimeException
 */
function store_chord_file(string $slug, string $localPath, string $originalName): array
{
    if (read_song_json($slug) === null) {
        throw new NotFoundException("Song '$slug' nicht gefunden");
    }
    $ext = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));
    if (!in_array($ext, CHORD_FILE_EXTENSIONS, true)) {
        $allowed = implode(', .', CHORD_FILE_EXTENSIONS);
        throw new FileValidationException("Nur ChordPro- oder Textdateien (.$allowed)");
    }
    if (filesize($localPath) > CHORD_FILE_MAX_BYTES) {
        throw new FileValidationException('Datei ist zu groß (Limit: 1 MB)');
    }
    if (str_contains((string) file_get_contents($localPath), "\0")) {
        throw new FileValidationException('Keine Textdatei');
    }
    store_original($slug, $localPath, $originalName, $ext);
    return touch_song($slug);
}
