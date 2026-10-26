<?php

require_once __DIR__ . '/crud.php';

/** Die Datei ist keine (unterstützte) Guitar-Pro-Datei (geprüft am Dateiinhalt, nicht an der Endung). */
class FileValidationException extends RuntimeException
{
}

/**
 * Erkennt das Guitar-Pro-Format am Dateianfang.
 * - GP3–GP5: Längenbyte + "FICHIER GUITAR PRO v…"
 * - GP6 (.gpx): komprimiertes Containerformat mit "BCFZ"/"BCFS"
 * - GP7/GP8 (.gp): ZIP-Archiv
 *
 * @param string $path Pfad der zu prüfenden Datei
 * @return string|null Dateiendung ("gp3", "gp4", "gp5", "gpx", "gp") oder null, wenn es keine GP-Datei ist
 */
function detect_gp_format(string $path): ?string
{
    $head = (string) file_get_contents($path, false, null, 0, 32);
    if (str_starts_with(substr($head, 1), 'FICHIER GUITAR PRO v')) {
        return match (substr($head, 21, 1)) {
            '3' => 'gp3',
            '4' => 'gp4',
            default => 'gp5',
        };
    }
    if (str_starts_with($head, 'BCFZ') || str_starts_with($head, 'BCFS')) {
        return 'gpx';
    }
    if (str_starts_with($head, "PK\x03\x04")) {
        return 'gp';
    }
    return null;
}

/**
 * Sucht einen freien Dateinamen, damit Rohmaterial nie überschrieben wird.
 *
 * @param string $dir Zielordner
 * @param string $baseName Dateiname ohne Endung
 * @param string $ext Endung ohne Punkt
 * @return string "$baseName.$ext", bei Kollision "$baseName-2.$ext", "$baseName-3.$ext", ...
 */
function unique_filename(string $dir, string $baseName, string $ext): string
{
    $name = "$baseName.$ext";
    $n = 2;
    while (file_exists("$dir/$name")) {
        $name = "$baseName-$n.$ext";
        $n++;
    }
    return $name;
}

/**
 * Legt eine GP-Datei beim Import als Rohmaterial unter orig/ ab und kopiert sie als Arbeitsversion score.gp.
 * Nur einmal je Lied möglich: Gibt es score.gp schon, wird abgelehnt. Bis der Editor score.gp selbst als GP7
 * schreibt (Phase 3), ist score.gp eine unveränderte Kopie in deren Originalformat – alphaTab erkennt das Format
 * am Inhalt, nicht an der Endung.
 *
 * @param string $slug Lied, zu dem die Datei gehört
 * @param string $localPath lokale GP-Datei; wird nur gelesen, Aufräumen bleibt Sache des Aufrufers
 * @param string $originalName Ursprünglicher Dateiname, daraus wird der Name unter orig/ gebildet
 * @return array das aktualisierte Lied
 * @throws FileValidationException|NotFoundException|ConflictException
 */
function store_gp_file(string $slug, string $localPath, string $originalName): array
{
    if (read_song_json($slug) === null) {
        throw new NotFoundException("Lied '$slug' nicht gefunden");
    }

    $ext = detect_gp_format($localPath);
    if ($ext === null) {
        throw new FileValidationException('Keine Guitar-Pro-Datei (unterstützt: GP3 bis GP8)');
    }

    $dir = song_dir($slug);
    if (is_file("$dir/score.gp")) {
        throw new ConflictException('Das Lied hat bereits Noten');
    }
    $origDir = "$dir/orig";
    if (!is_dir($origDir) && !mkdir($origDir, 0775, true) && !is_dir($origDir)) {
        throw new RuntimeException('Ordner orig/ konnte nicht angelegt werden');
    }

    $baseName = slugify(pathinfo($originalName, PATHINFO_FILENAME)) ?: 'score';
    $stored = unique_filename($origDir, $baseName, $ext);
    if (!copy($localPath, "$origDir/$stored")) {
        throw new RuntimeException('GP-Datei konnte nicht gespeichert werden');
    }

    if (!copy($localPath, "$dir/score.gp")) {
        throw new RuntimeException('Arbeitsversion score.gp konnte nicht angelegt werden');
    }

    return touch_song($slug);
}

/**
 * Liefert eine Datei aus data/ mit ETag aus (beantwortet unveränderte Anfragen mit 304) und beendet das Skript.
 * "private": Die Seite ist per Basic Auth geschützt, Proxys dürfen die Antwort nicht für andere zwischenspeichern.
 * "no-cache": Der Browser darf cachen, muss aber jedes Mal nachfragen, weil sich die Datei beim Speichern ändert.
 *
 * @param string $path auszuliefernde Datei
 * @param string $mime Content-Type der Antwort
 * @return never
 */
function send_file(string $path, string $mime): never
{
    $etag = '"' . dechex(filemtime($path)) . '-' . dechex(filesize($path)) . '"';
    header('Cache-Control: private, no-cache');
    header('ETag: ' . $etag);
    if (trim($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) {
        http_response_code(304);
        exit;
    }
    header('Content-Type: ' . $mime);
    header('Content-Length: ' . filesize($path));
    readfile($path);
    exit;
}
