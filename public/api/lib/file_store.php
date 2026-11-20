<?php

require_once __DIR__ . '/crud.php';
require_once __DIR__ . '/gp_file.php';
require_once __DIR__ . '/uploads.php';

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
 * Legt eine hochgeladene Datei als Rohmaterial unter data/songs/<slug>/upload/ ab (siehe upload_dir()). Liegt dort schon
 * eine Datei mit gleichem Inhalt (MD5), wird nichts abgelegt. Ist der Name belegt, wird ein Zähler angehängt (siehe
 * unique_filename()): Im Upload-Ordner wird nie etwas überschrieben oder verändert.
 *
 * @param string $slug Lied, zu dem die Datei gehört (der Ordner muss existieren)
 * @param string $localPath lokale Datei; wird nur gelesen
 * @param string $originalName ursprünglicher Dateiname, daraus wird der Name im Upload-Ordner gebildet
 * @param string|null $ext Endung ohne Punkt, sonst die des ursprünglichen Namens (z. B. nach Erkennung am Inhalt)
 * @return string Dateiname im Upload-Ordner (bei gleichem Inhalt der bereits vorhandene)
 * @throws RuntimeException wenn der Upload-Ordner nicht angelegt oder die Datei nicht kopiert werden kann
 */
function store_original(string $slug, string $localPath, string $originalName, ?string $ext = null): string
{
    $origDir = upload_dir($slug);
    if (!is_dir($origDir) && !mkdir($origDir, 0775, true) && !is_dir($origDir)) {
        throw new RuntimeException('Upload-Ordner konnte nicht angelegt werden');
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
        throw new RuntimeException("$originalName konnte nicht im Upload-Ordner gespeichert werden");
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
 * kommt unverändert als Rohmaterial in den Upload-Ordner (siehe store_original()), eine eingebettete Audiospur wird zu
 * audio.mp3 (siehe extract_gp_audio()). Die Noten wandelt der Browser vorher mit alphaTab um, ohne Titel, Interpret
 * und die übrigen Angaben (die stehen nur in song.json). Nur einmal je Lied möglich: Gibt es schon Noten, wird
 * abgelehnt.
 *
 * @param string $slug Lied, zu dem die Noten gehören
 * @param string $tex Noten als alphaTex
 * @param string|null $gpPath lokale Original-GP-Datei; wird nur gelesen, Aufräumen bleibt Sache des Aufrufers.
 *                            null, wenn die Noten im Formular entstanden sind
 * @param string $gpName ursprünglicher Dateiname der GP-Datei, daraus wird der Name im Upload-Ordner gebildet
 * @param string $gpSource Quelle der GP-Datei (meist die Seite des Tabs), wird beim Upload festgehalten
 * @return array das aktualisierte Lied
 * @throws FileValidationException|NotFoundException|ConflictException|RuntimeException
 */
function store_new_score(
    string $slug,
    string $tex,
    ?string $gpPath = null,
    string $gpName = '',
    string $gpSource = ''
): array
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
        record_upload($slug, $original, $gpSource !== '' ? $gpSource : null);
        extract_gp_audio(upload_dir($slug) . "/$original", $dir);
    }
    if (file_put_contents($scorePath, $tex) === false) {
        throw new RuntimeException('Noten konnten nicht gespeichert werden');
    }

    return touch_song($slug);
}

/**
 * Hebt den Stand eines Lieds vor dem Überschreiben auf, damit sich ein missglücktes Speichern rückgängig machen lässt
 * (im Bearbeitungsmodus der Knopf "Verlauf", siehe list_score_history()): die aktuelle score.atex als
 * history/score-<Zeitstempel>.atex und, daneben als score-<Zeitstempel>.json, die Angaben für das Leadsheet (Feld
 * leadsheet aus song.json), weil sie an den Takten der Noten hängen. Es bleiben die letzten SCORE_HISTORY_KEEP Stände.
 * Importierte Noten (store_new_score()) sind kein Stand, der Verlauf beginnt mit dem ersten Überschreiben.
 *
 * @param string $slug Slug des Lieds (score.atex muss existieren)
 * @return void
 * @throws RuntimeException wenn history/ nicht angelegt oder die Datei nicht kopiert werden kann
 */
function keep_score_history(string $slug): void
{
    $dir = song_dir($slug) . '/history';
    if (!is_dir($dir) && !mkdir($dir, 0775) && !is_dir($dir)) {
        throw new RuntimeException('history/ konnte nicht angelegt werden');
    }
    $name = unique_filename($dir, 'score-' . date('Ymd-His'), 'atex');
    if (!copy(song_dir($slug) . '/' . SONG_FILES['score'], "$dir/$name")) {
        throw new RuntimeException('Die bisherigen Noten konnten nicht gesichert werden');
    }
    $leadsheet = read_leadsheet($slug);
    if (is_array($leadsheet['chords'] ?? null)) {
        // Leeres chords muss {} bleiben (wie in write_song_json()).
        $leadsheet['chords'] = (object) $leadsheet['chords'];
    }
    $json = json_encode(['leadsheet' => (object) $leadsheet], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if (file_put_contents("$dir/" . basename($name, '.atex') . '.json', $json) === false) {
        throw new RuntimeException('Die bisherigen Angaben für das Leadsheet konnten nicht gesichert werden');
    }
    // Zeitstempel im Namen: alphabetisch = zeitlich sortiert.
    $versions = glob("$dir/score-*.atex") ?: [];
    sort($versions);
    foreach (array_slice($versions, 0, max(0, count($versions) - SCORE_HISTORY_KEEP)) as $old) {
        @unlink($old);
        @unlink(substr($old, 0, -5) . '.json');
    }
}

/**
 * Listet die aufgehobenen Fassungen der Noten eines Lieds (siehe keep_score_history()), die neueste zuerst.
 *
 * @param string $slug Slug des Lieds
 * @return array[] je Fassung id (Dateiname ohne .atex, z. B. "score-20261031-224255"), time (Zeitpunkt des
 *                 Überschreibens, "2026-10-31 22:42:55") und size (Bytes)
 */
function list_score_history(string $slug): array
{
    $files = glob(song_dir($slug) . '/history/score-*.atex') ?: [];
    rsort($files);
    $list = [];
    foreach ($files as $file) {
        $id = basename($file, '.atex');
        if (!preg_match('/^score-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:-\d+)?$/', $id, $m)) {
            continue;
        }
        $list[] = ['id' => $id, 'time' => "$m[1]-$m[2]-$m[3] $m[4]:$m[5]:$m[6]", 'size' => (int) filesize($file)];
    }
    return $list;
}

/**
 * Pfad einer aufgehobenen Fassung der Noten.
 *
 * @param string $slug Slug des Lieds
 * @param string $id Kennung aus list_score_history()
 * @return string Pfad der Datei
 * @throws NotFoundException wenn es die Fassung nicht gibt (auch bei einer Kennung, die keine ist)
 */
function score_history_path(string $slug, string $id): string
{
    if (!array_any(list_score_history($slug), static fn(array $version): bool => $version['id'] === $id)) {
        throw new NotFoundException('Fassung nicht gefunden');
    }
    return song_dir($slug) . "/history/$id.atex";
}

/**
 * Angaben für das Leadsheet eines aufgehobenen Stands (siehe keep_score_history()).
 *
 * @param string $slug Slug des Lieds
 * @param string $id Kennung aus list_score_history()
 * @return array das Feld leadsheet von damals, leer ohne Angaben
 * @throws NotFoundException wenn es den Stand nicht gibt
 */
function score_history_leadsheet(string $slug, string $id): array
{
    $json = substr(score_history_path($slug, $id), 0, -5) . '.json';
    $data = is_file($json) ? json_decode((string) file_get_contents($json), true) : null;
    return is_array($data['leadsheet'] ?? null) ? $data['leadsheet'] : [];
}

/**
 * Löscht einen aufgehobenen Stand (Noten und Angaben für das Leadsheet).
 *
 * @param string $slug Slug des Lieds
 * @param string $id Kennung aus list_score_history()
 * @return void
 * @throws NotFoundException wenn es den Stand nicht gibt
 */
function delete_score_history(string $slug, string $id): void
{
    $path = score_history_path($slug, $id);
    @unlink(substr($path, 0, -5) . '.json');
    if (!unlink($path)) {
        throw new RuntimeException('Der Stand konnte nicht gelöscht werden');
    }
}

/**
 * Ersetzt die Noten eines Lieds (score.atex), z. B. aus dem Sync-Editor oder dem Editor. Nur für Lieder, die schon
 * Noten haben; neue Noten kommen über store_new_score(). Die bisherige Fassung kommt vorher nach history/ (siehe
 * keep_score_history()). Geschrieben wird erst daneben und dann umbenannt, damit nie eine halbe Datei
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
    keep_score_history($slug);
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
