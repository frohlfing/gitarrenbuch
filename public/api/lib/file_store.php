<?php

require_once __DIR__ . '/crud.php';
require_once __DIR__ . '/gp_file.php';

/** Eine hochgeladene Datei ist ungültig (geprüft am Inhalt, nicht an der Endung), z. B. keine GP-Datei. */
class FileValidationException extends RuntimeException
{
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
 * Legt eine hochgeladene Datei als Rohmaterial unter orig/ ab. Liegt dort schon eine Datei mit gleichem Inhalt
 * (MD5), wird nichts abgelegt. Ist der Name belegt, wird ein Zähler angehängt (siehe unique_filename()): In orig/
 * wird nie etwas überschrieben oder verändert.
 *
 * @param string $slug Lied, zu dem die Datei gehört (der Ordner muss existieren)
 * @param string $localPath lokale Datei; wird nur gelesen
 * @param string $originalName ursprünglicher Dateiname, daraus wird der Name unter orig/ gebildet
 * @param string|null $ext Endung ohne Punkt, sonst die des ursprünglichen Namens (z. B. nach Erkennung am Inhalt)
 * @return string Dateiname unter orig/ (bei gleichem Inhalt der bereits vorhandene)
 * @throws RuntimeException wenn orig/ nicht angelegt oder die Datei nicht kopiert werden kann
 */
function store_original(string $slug, string $localPath, string $originalName, ?string $ext = null): string
{
    $origDir = song_dir($slug) . '/orig';
    if (!is_dir($origDir) && !mkdir($origDir, 0775, true) && !is_dir($origDir)) {
        throw new RuntimeException('Ordner orig/ konnte nicht angelegt werden');
    }
    $hash = md5_file($localPath);
    foreach (glob("$origDir/*") ?: [] as $existing) {
        if (is_file($existing) && md5_file($existing) === $hash) {
            return basename($existing);
        }
    }
    $ext ??= strtolower(pathinfo($originalName, PATHINFO_EXTENSION)) ?: 'bin';
    $baseName = slugify(pathinfo($originalName, PATHINFO_FILENAME)) ?: 'datei';
    $name = unique_filename($origDir, $baseName, $ext);
    if (!copy($localPath, "$origDir/$name")) {
        throw new RuntimeException("$originalName konnte nicht unter orig/ gespeichert werden");
    }
    return $name;
}

/**
 * Höchstgröße der Noten (score.atex). Die größten Songs im Archiv kommen auf rund 300 KB.
 *
 * @var int Bytes
 */
const SCORE_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Prüft Noten im Format alphaTex, bevor sie gespeichert werden. Den Inhalt selbst kann nur alphaTab im Browser
 * auswerten; geprüft werden deshalb nur Größe und dass es Text in UTF-8 ist.
 *
 * @param string $tex Noten als alphaTex
 * @return void
 * @throws FileValidationException wenn die Noten leer, zu groß oder kein Text sind
 */
function validate_score(string $tex): void
{
    if (trim($tex) === '') {
        throw new FileValidationException('Keine Noten übermittelt');
    }
    if (strlen($tex) > SCORE_MAX_BYTES) {
        throw new FileValidationException(
            'Noten sind zu groß (Limit: ' . (int) (SCORE_MAX_BYTES / 1024 / 1024) . ' MB)'
        );
    }
    if (!mb_check_encoding($tex, 'UTF-8') || str_contains($tex, "\0")) {
        throw new FileValidationException('Noten sind kein Text in UTF-8');
    }
}

/**
 * Speichert die Noten eines neuen Lieds als score.atex, beim Import zusammen mit der Original-GP-Datei: Diese
 * kommt unverändert als Rohmaterial nach orig/ (siehe store_original()), eine eingebettete Audiospur wird zu
 * audio.mp3 (siehe extract_gp_audio()). Die Noten wandelt der Browser vorher mit alphaTab um, ohne Titel, Interpret
 * und die übrigen Angaben (die stehen nur in song.json). Nur einmal je Lied möglich: Gibt es schon Noten, wird
 * abgelehnt.
 *
 * @param string $slug Lied, zu dem die Noten gehören
 * @param string $tex Noten als alphaTex
 * @param string|null $gpPath lokale Original-GP-Datei; wird nur gelesen, Aufräumen bleibt Sache des Aufrufers.
 *                            null, wenn die Noten im Formular entstanden sind
 * @param string $gpName ursprünglicher Dateiname der GP-Datei, daraus wird der Name unter orig/ gebildet
 * @return array das aktualisierte Lied
 * @throws FileValidationException|NotFoundException|ConflictException|RuntimeException
 */
function store_new_score(string $slug, string $tex, ?string $gpPath = null, string $gpName = ''): array
{
    if (read_song_json($slug) === null) {
        throw new NotFoundException("Song '$slug' nicht gefunden");
    }
    validate_score($tex);
    $ext = $gpPath !== null ? detect_gp_format($gpPath) : null;
    if ($gpPath !== null && $ext === null) {
        throw new FileValidationException('Keine Guitar-Pro-Datei (unterstützt: GP3 bis GP8)');
    }

    $dir = song_dir($slug);
    $scorePath = "$dir/" . SONG_FILES['score'];
    if (is_file($scorePath)) {
        throw new ConflictException('Der Song hat bereits Noten');
    }
    if ($gpPath !== null) {
        $original = store_original($slug, $gpPath, $gpName, $ext);
        extract_gp_audio("$dir/orig/$original", $dir);
    }
    if (file_put_contents($scorePath, $tex) === false) {
        throw new RuntimeException('Noten konnten nicht gespeichert werden');
    }

    return touch_song($slug);
}

/**
 * Ersetzt die Noten eines Lieds (score.atex), z. B. aus dem Sync-Editor. Nur für Lieder, die schon Noten haben; neue
 * Noten kommen über store_new_score(). Geschrieben wird erst daneben und dann umbenannt, damit nie eine halbe Datei
 * entsteht.
 *
 * @param string $slug Slug des Lieds
 * @param string $tex Noten als alphaTex
 * @return array das aktualisierte Lied
 * @throws FileValidationException|NotFoundException|RuntimeException
 */
function store_score(string $slug, string $tex): array
{
    if (read_song_json($slug) === null) {
        throw new NotFoundException("Song '$slug' nicht gefunden");
    }
    validate_score($tex);
    $target = song_dir($slug) . '/' . SONG_FILES['score'];
    if (!is_file($target)) {
        throw new NotFoundException('Der Song hat noch keine Noten');
    }
    $tmp = "$target.tmp";
    if (file_put_contents($tmp, $tex) === false || !rename($tmp, $target)) {
        @unlink($tmp);
        throw new RuntimeException('Noten konnten nicht gespeichert werden');
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

/**
 * Legt eine MP3 als audio.mp3 eines Lieds ab (ersetzt eine vorhandene). Geprüft wird nur der Anfang der Datei
 * (ID3-Kopf oder MP3-Frame); Länge und Qualität bestimmt bin/audio.php beim Umwandeln.
 *
 * @param string $slug Slug des Lieds
 * @param string $localPath lokale MP3-Datei; wird nur gelesen, Aufräumen bleibt Sache des Aufrufers
 * @return array das aktualisierte Lied
 * @throws FileValidationException|NotFoundException|RuntimeException
 */
function store_audio(string $slug, string $localPath): array
{
    if (read_song_json($slug) === null) {
        throw new NotFoundException("Song '$slug' nicht gefunden");
    }
    $size = (int) filesize($localPath);
    if ($size === 0 || $size > MAX_UPLOAD_BYTES) {
        throw new FileValidationException(
            'Audiodatei leer oder größer als ' . intdiv(MAX_UPLOAD_BYTES, 1024 * 1024) . ' MB'
        );
    }
    $head = (string) file_get_contents($localPath, false, null, 0, 3);
    $isMp3 = str_starts_with($head, 'ID3')
        || (strlen($head) > 1 && ord($head[0]) === 0xFF && (ord($head[1]) & 0xE0) === 0xE0);
    if (!$isMp3) {
        throw new FileValidationException('Keine MP3-Datei');
    }
    // Erst daneben schreiben, dann umbenennen: Wer gerade abspielt, bekommt nie eine halbe Datei.
    $target = song_dir($slug) . '/' . SONG_FILES['audio'];
    $tmp = "$target.tmp";
    if (!copy($localPath, $tmp) || !rename($tmp, $target)) {
        @unlink($tmp);
        throw new RuntimeException('Audiodatei konnte nicht gespeichert werden');
    }
    return touch_song($slug);
}
