<?php

/**
 * Holt für Lieder ohne Audiospur die Audiospur von YouTube und lädt sie als audio.mp3 auf den Server.
 *
 * Läuft lokal, weil dem Server yt-dlp und ffmpeg fehlen. Bearbeitet werden Lieder mit YouTube-URL in "Quelle für
 * Audio-Datei" und ohne audio.mp3 auf dem Server. Lieder, die schon eine audio.mp3 haben, bleiben unberührt, auch wenn
 * sie mit anderen Einstellungen (AUDIO_ARGS) entstanden sind; neu erzeugen lassen sie sich mit --override (alle) bzw. --only=SLUG --override.
 *
 * Wird im Formular ein anderer Clip eingetragen, entfernt der Server die bisherige audio.mp3, und der nächste Lauf holt
 * die neue; ein Backup der alten gibt es auf dem Server nicht, das YouTube-Original bleibt aber hier im Backup-Ordner.
 * Wird die URL nur gelöscht, bleibt die Audiospur.
 *
 * Ablauf je Lied:
 *   1. yt-dlp lädt die beste Audiospur nach <data>/backup/<slug>/youtube-<Video-ID>.<ext> (meist .webm; liegt sie
 *      dort schon, wird nicht erneut geladen).
 *   2. ffmpeg misst die Lautheit und wandelt in MP3 um (AUDIO_ARGS: Stereo, 16 kHz, 56 kbit/s). Die
 *      Lautstärke wird nur als Ganzes auf TARGET_LUFS gebracht, höchstens bis TARGET_PEAK; die Dynamik bleibt.
 *   3. Die MP3 geht per PUT api/audio.php an den Server (lokal bleibt sie nicht liegen).
 *
 * Mit --transponieren=N wird die Audiospur um N Halbtöne verschoben (0 = Original). Eine vorhandene audio.mp3 wird nur
 * mit --override ersetzt, sonst nie.
 * ffmpeg benötigt für Das Transponieren den Filter `rubberband`. Fallback ist ein einfacherer Ersatz (asetrate+atempo),
 * der bei großen Verschiebungen schlechter klingt.
 * Prüfung, ob `rubberband` vorhanden ist: `ffmpeg -filters` (sollte `--enable-librubberband` anzeigen).
 *
 * <data> ist --data, sonst DATA_DIR aus config.php, sonst der Ordner data/ neben bin/ (wird bei Bedarf angelegt).
 *
 * Weicht die Länge um mehr als `MAX_LENGTH_DIFF` von der des Clips ab, wird trotzdem hochgeladen und gewarnt.
 *
 * Das portable Paket für einen anderen Windows-PC baut `build_audio_portable.cmd`.
 */

if (isset($_SERVER['REQUEST_METHOD'])) {
    http_response_code(403);
    exit("Nur für die Kommandozeile.\n");
}

if (function_exists('sapi_windows_cp_set')) {
    sapi_windows_cp_set(65001);
}

/**
 * Projektordner.
 */
$root = dirname(__DIR__);
// config.php (API_TOKEN, DATA_DIR) nur, wenn vorhanden; im portablen Paket ist sie optional
if (is_file("$root/config.php")) {
    require_once "$root/config.php";
}
require_once "$root/public/api/lib/youtube.php"; // youtube_id()

/**
 * Adresse des Gitarrenbuchs (ohne "/" am Ende); mit --remote=… abweichend.
 *
 * @var string
 */
// const REMOTE_URL = 'https://gitarrenbuch.frank-rohlfing.de'; // Hetzner-Server
const REMOTE_URL = 'http://gitarrenbuch.test';

/**
 * Basic-Auth-Benutzer, wenn --user fehlt.
 *
 * @var string
 */
const REMOTE_DEFAULT_USER = 'frank';

/**
 * Anfang des Dateinamens der Audiospur, wie yt-dlp sie lädt; dahinter folgen "-<Video-ID>" und die Endung (die
 * bestimmt das Format auf YouTube, meist .webm).
 *
 * @var string
 */
const DOWNLOAD_NAME = 'youtube';

/**
 * Lautheit, auf die jede Audiospur gebracht wird (wie Streamingdienste).
 *
 * @var float LUFS
 */
const TARGET_LUFS = -16.0;

/**
 * Höchster Spitzenpegel nach dem Anheben; leise Lieder bleiben lieber unter TARGET_LUFS, als übersteuert zu werden.
 *
 * @var float dBTP
 */
const TARGET_PEAK = -1.5;

/**
 * Format von audio.mp3 für ffmpeg: Stereo, 16 kHz, 56 kbit/s (rund 2 MB für 5 Minuten), wie bei den Audiospuren in
 * Guitar-Pro-Dateien.
 *
 * @var string[]
 */
const AUDIO_ARGS = ['-ac', '2', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '56k'];

/**
 * Größte Verschiebung bei --transponieren.
 *
 * @var int Halbtöne
 */
const MAX_SHIFT = 11;

/**
 * Erlaubte Abweichung der Länge von audio.mp3 zur Länge des Clips (youtubeSeconds).
 *
 * @var float Sekunden
 */
const MAX_LENGTH_DIFF = 2.0;

/**
 * Hilfetext für --help und bei unbekannten Optionen.
 *
 * @var string
 */
const HELP = <<<'TXT'
Audiospuren von YouTube holen und ins Gitarrenbuch laden

  Bearbeitet alle Songs mit YouTube-URL ("Quelle für Audio-Datei"), die noch keine audio.mp3 haben (nach dem
  Eintragen eines anderen Clips hat der Server die alte entfernt):
  YouTube -> DATA\backup\<slug>\youtube-<ID>.<ext> -> MP3 -> Upload (DATA: --data).

    php bin/audio.php --password=… --dry-run     nur zeigen, was zu tun ist
    php bin/audio.php --password=…               holen, umwandeln, hochladen
    php bin/audio.php --update                   yt-dlp aktualisieren (YouTube ändert sich häufig)
    php bin/audio.php --password=… --only=SLUG --transponieren=+2
                                                 Audiospur um 2 Halbtöne höher (0 = Original); hat das
                                                 Lied schon eine, nur zusammen mit --override

  Optionen
    --password=…    Basic-Auth-Passwort des Servers (oder Umgebungsvariable GITARRENBUCH_PASSWORD)
    --api-token=…   API-Token des Servers (oder GITARRENBUCH_API_TOKEN; Vorgabe: API_TOKEN aus config.php)
    --user=NAME     Basic-Auth-Benutzer, Vorgabe "frank"
    --remote=URL    Adresse des Gitarrenbuchs, Vorgabe https://gitarrenbuch.frank-rohlfing.de
    --data=DIR      Datenordner für backup\, wird bei Bedarf angelegt (Vorgabe: DATA_DIR aus config.php, sonst der
                    Ordner data\ neben bin\)
    --only=a,b      nur Songs, deren Slug so anfängt
    --transponieren=N  Audiospur um N Halbtöne verschieben (-11 … +11, 0 = Original), Tempo und Länge bleiben;
                    verlangt --only
    --override      vorhandene audio.mp3 ersetzen
    --dry-run       nur zeigen, was zu tun ist
    --yes           ohne Rückfrage
    --update        yt-dlp aktualisieren und beenden

  Abbruch mit Strg+C, erneuter Start setzt fort.

TXT;

// ---------------------------------------------------------------- Optionen

/**
 * Optionen der Kommandozeile (Vorgaben siehe HELP).
 *
 * @var array<string, string|bool> $opt
 */
$opt = ['remote' => REMOTE_URL, 'user' => REMOTE_DEFAULT_USER, 'password' => (string) getenv('GITARRENBUCH_PASSWORD'),
    'api-token' => (string) getenv('GITARRENBUCH_API_TOKEN') ?: (defined('API_TOKEN') ? API_TOKEN : ''),
    'data' => defined('DATA_DIR') ? DATA_DIR : "$root/data", 'only' => '', 'transponieren' => '', 'override' => false, 'dry-run' => false, 'yes' => false,
    'update' => false];
/**
 * Argumente der Kommandozeile ohne Skriptnamen.
 *
 * @var string[] $args
 */
$args = array_slice($_SERVER['argv'] ?? [], 1);
if (!$args || array_intersect($args, ['-h', '--help', '/?'])) {
    echo HELP;
    exit(0);
}
foreach ($args as $arg) {
    if (preg_match('/^--([a-z-]+)(?:=(.*))?$/', $arg, $m) && array_key_exists($m[1], $opt)) {
        $opt[$m[1]] = is_bool($opt[$m[1]]) ? true : ($m[2] ?? '');
        continue;
    }
    fwrite(STDERR, "Unbekannte Option: $arg\n\n" . HELP);
    exit(1);
}

/**
 * Halbtöne für --transponieren; null = normaler Lauf (Lieder ohne Audiospur holen).
 *
 * @var int|null $SHIFT
 */
$SHIFT = null;
if ($opt['transponieren'] !== '') {
    if (!preg_match('/^[+-]?\d{1,2}$/', $opt['transponieren']) || abs((int) $opt['transponieren']) > MAX_SHIFT) {
        fwrite(STDERR, '--transponieren braucht eine ganze Zahl von -' . MAX_SHIFT . ' bis +' . MAX_SHIFT . ".\n");
        exit(1);
    }
    $SHIFT = (int) $opt['transponieren'];
}
if ($SHIFT !== null && $opt['only'] === '') {
    fwrite(STDERR, "--transponieren verlangt --only=SLUG, damit nicht alle Lieder verschoben werden.\n");
    exit(1);
}

foreach (['yt-dlp', 'deno', 'ffmpeg', 'ffprobe'] as $tool) {
    exec("where $tool 2>NUL", $out, $rc);
    if ($rc !== 0) {
        fwrite(STDERR, "$tool nicht im PATH gefunden (siehe README, Setup).\n");
        exit(1);
    }
}
if ($opt['update']) {
    passthru('yt-dlp -U', $rc);
    exit($rc);
}

/**
 * Adresse des Gitarrenbuchs ohne abschließenden Slash.
 */
$REMOTE = rtrim($opt['remote'], '/');
/**
 * Datenordner (--data) ohne abschließenden Slash.
 */
$DATA = rtrim($opt['data'], '\\/');
/**
 * Slug-Anfänge aus --only; leer = alle Lieder.
 *
 * @var string[] $ONLY
 */
$ONLY = array_values(array_filter(array_map(fn($s) => strtolower(trim($s)), explode(',', $opt['only'])), 'strlen'));
foreach ([
    'Passwort für den Server fehlt (--password=… oder GITARRENBUCH_PASSWORD)' => $opt['password'] === '',
    'API-Token fehlt (--api-token=…, GITARRENBUCH_API_TOKEN oder API_TOKEN in config.php)'
        => $opt['api-token'] === '',
] as $message => $failed) {
    if ($failed) {
        fwrite(STDERR, "$message\n");
        exit(1);
    }
}

// ---------------------------------------------------------------- Hilfsfunktionen

/**
 * Führt ein Programm aus, ohne Shell (Argumente werden nicht von cmd.exe umgedeutet, z. B. "%" bei yt-dlp).
 *
 * @param string[] $cmd Programm und Argumente
 * @return array{int, string, string} Rückgabewert, Standardausgabe, Fehlerausgabe
 */
function run(array $cmd): array
{
    $proc = proc_open($cmd, [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
    if (!is_resource($proc)) {
        return [-1, '', "$cmd[0] ließ sich nicht starten"];
    }
    $stdout = stream_get_contents($pipes[1]);
    $stderr = stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    return [proc_close($proc), (string) $stdout, (string) $stderr];
}

/**
 * Letzte aussagekräftige Zeile einer Fehlerausgabe, für Meldungen.
 *
 * @param string $stderr Fehlerausgabe eines Programms
 * @return string höchstens 300 Zeichen
 */
function last_line(string $stderr): string
{
    $lines = array_values(array_filter(array_map('trim', explode("\n", $stderr)), 'strlen'));
    return mb_substr(end($lines) ?: 'unbekannter Fehler', 0, 300);
}

/**
 * Anfrage an die API des Gitarrenbuchs (Basic Auth und X-API-Token). Ohne curl, nur mit PHP-Streams.
 *
 * @param string $method HTTP-Methode
 * @param string $endpoint Datei unter api/ samt Query, z. B. "songs.php"
 * @param string|null $body Body (z. B. eine MP3), null = ohne
 * @param string $type Content-Type des Bodys
 * @return array Die dekodierte JSON-Antwort
 * @throws RuntimeException wenn der Server nicht erreichbar ist, die Anmeldung scheitert oder er einen Fehler meldet
 */
function api(string $method, string $endpoint, ?string $body = null, string $type = 'application/json'): array
{
    global $REMOTE, $opt;
    $url = "$REMOTE/api/$endpoint";
    $headers = ['Authorization: Basic ' . base64_encode("{$opt['user']}:{$opt['password']}"),
        'X-API-Token: ' . $opt['api-token']];
    if ($body !== null) {
        $headers[] = "Content-Type: $type";
    }
    $context = stream_context_create(['http' => [
        'method' => $method,
        'header' => implode("\r\n", $headers),
        'content' => $body ?? '',
        'ignore_errors' => true,
        'timeout' => 120,
    ]]);
    $response = @file_get_contents($url, false, $context);
    $responseHeaders = $http_response_header ?? [];
    if ($response === false || !$responseHeaders) {
        throw new RuntimeException("Server nicht erreichbar ($url)");
    }
    $status = preg_match('#^HTTP/\S+\s+(\d{3})#', $responseHeaders[0], $m) ? (int) $m[1] : 0;
    if ($status === 401) {
        throw new RuntimeException(str_contains($response, 'Token')
            ? 'Token abgelehnt: Das API-Token stimmt nicht mit dem des Servers überein.'
            : "Anmeldung abgelehnt: Benutzer '{$opt['user']}' bzw. Passwort stimmt nicht.");
    }
    $data = json_decode($response, true);
    if ($status >= 400 || !is_array($data)) {
        $message = is_array($data) ? (string) ($data['error'] ?? '') : trim(strip_tags($response));
        throw new RuntimeException("$endpoint: HTTP $status " . mb_substr($message, 0, 300));
    }
    return $data;
}

/**
 * Länge einer Audiodatei.
 *
 * @param string $file Audiodatei
 * @return float|null Sekunden; null, wenn ffprobe sie nicht lesen kann
 */
function duration(string $file): ?float
{
    [$rc, $out] = run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', $file]);
    return $rc === 0 && is_numeric(trim($out)) ? (float) trim($out) : null;
}

/**
 * Lautstärkeänderung, die eine Audiodatei auf TARGET_LUFS bringt, ohne TARGET_PEAK zu überschreiten.
 *
 * @param string $file Audiodatei
 * @return float Änderung in dB (negativ = leiser)
 * @throws RuntimeException wenn ffmpeg die Datei nicht messen kann
 */
function loudness_gain(string $file): float
{
    [$rc, , $err] = run(['ffmpeg', '-hide_banner', '-nostdin', '-i', $file, '-vn',
        '-af', 'loudnorm=print_format=json', '-f', 'null', '-']);
    $json = preg_match('/\{[^{}]*"input_i"[^{}]*}/', $err, $m) ? json_decode($m[0], true) : null;
    if ($rc !== 0 || !is_numeric($json['input_i'] ?? null) || !is_numeric($json['input_tp'] ?? null)) {
        throw new RuntimeException('Lautheit nicht messbar: ' . last_line($err));
    }
    // Stille ergibt -inf: dann nichts ändern
    if (!is_finite((float) $json['input_i'])) {
        return 0.0;
    }
    return min(TARGET_LUFS - (float) $json['input_i'], TARGET_PEAK - (float) $json['input_tp']);
}

/**
 * Fertig geladene Audiospur eines Clips im Backup-Ordner eines Lieds (ohne Reste eines abgebrochenen Downloads).
 *
 * @param string $dir Backup-Ordner des Lieds
 * @param string $id Video-ID (siehe youtube_id())
 * @return string|null Pfad; null, wenn dieser Clip noch nicht geladen ist
 */
function downloaded(string $dir, string $id): ?string
{
    $files = glob("$dir/" . DOWNLOAD_NAME . "-$id.*") ?: [];
    $files = array_filter($files, fn($f) => !preg_match('/\.(part|ytdl|temp)$|\.part-/', $f));
    return $files ? reset($files) : null;
}

/**
 * Lädt die Audiospur eines Videos, falls sie noch nicht im Backup-Ordner liegt.
 *
 * @param string $url YouTube-URL
 * @param string $dir Backup-Ordner des Lieds
 * @return string Pfad der geladenen Datei
 * @throws RuntimeException wenn yt-dlp scheitert
 */
function download(string $url, string $dir): string
{
    $id = youtube_id($url);
    if ($id === null) {
        throw new RuntimeException("Keine YouTube-URL: $url");
    }
    $existing = downloaded($dir, $id);
    if ($existing !== null) {
        return $existing;
    }
    if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
        throw new RuntimeException("Ordner $dir konnte nicht angelegt werden");
    }
    [$rc, , $err] = run(['yt-dlp', '--quiet', '--no-warnings', '--no-playlist', '-f', 'bestaudio',
        '-o', "$dir/" . DOWNLOAD_NAME . "-$id.%(ext)s", $url]);
    $file = downloaded($dir, $id);
    if ($rc !== 0 || $file === null) {
        throw new RuntimeException('yt-dlp: ' . last_line($err));
    }
    return $file;
}

/**
 * Audiofilter, der die Tonhöhe um Halbtöne verschiebt, ohne Tempo und Länge zu ändern.
 *
 * Bevorzugt "rubberband" (gute Qualität); hat die ffmpeg-Version ihn nicht, dient asetrate + atempo als Ersatz (klingt
 * bei großen Verschiebungen schlechter).
 *
 * @param int $semitones Halbtöne, 0 = keine Verschiebung
 * @return string Filterkette für -af, leer bei 0
 */
function pitch_filter(int $semitones): string
{
    if ($semitones === 0) {
        return '';
    }
    $factor = 2 ** ($semitones / 12);
    static $rubberband = null;
    $rubberband ??= (function (): bool {
        [, $out] = run(['ffmpeg', '-hide_banner', '-filters']);
        return (bool) preg_match('/\brubberband\b/', $out);
    })();
    if ($rubberband) {
        return sprintf('rubberband=pitch=%.6f', $factor);
    }
    return sprintf('asetrate=%d,aresample=%d,atempo=%.6f', (int) round(44100 * $factor), 44100, 1 / $factor);
}

/**
 * Wandelt die geladene Audiospur in eine MP3 um (AUDIO_ARGS, Lautstärke um $gain dB, ohne Metadaten).
 *
 * @param string $src geladene Audiospur
 * @param string $target Zieldatei, wird überschrieben
 * @param float $gain Lautstärkeänderung in dB (siehe loudness_gain())
 * @param int $semitones Verschiebung der Tonhöhe in Halbtönen (siehe pitch_filter()), 0 = keine
 * @return void
 * @throws RuntimeException wenn ffmpeg scheitert
 */
function encode(string $src, string $target, float $gain, int $semitones = 0): void
{
    [$rc, , $err] = run(['ffmpeg', '-hide_banner', '-nostdin', '-y', '-i', $src, '-vn', '-map_metadata', '-1',
        '-af', implode(',', array_filter([pitch_filter($semitones), sprintf('volume=%.2fdB', $gain)])),
        ...AUDIO_ARGS, '-f', 'mp3', $target]);
    if ($rc !== 0) {
        throw new RuntimeException('ffmpeg: ' . last_line($err));
    }
}

// ---------------------------------------------------------------- Lieder bestimmen

try {
    $songs = api('GET', 'songs.php')['songs'];
} catch (RuntimeException $e) {
    fwrite(STDERR, $e->getMessage() . "\n");
    exit(1);
}
$todo = [];
$noUrl = [];
foreach ($songs as $song) {
    // Eine vorhandene Audiospur wird nur mit --override ersetzt
    if ((in_array('audio', $song['files'] ?? [], true) && !$opt['override'])
        || ($ONLY && !array_filter($ONLY, fn($p) => str_starts_with($song['slug'], $p)))) {
        continue;
    }
    if (empty($song['sources']['youtube'])) {
        $noUrl[] = $song['slug'];
        continue;
    }
    $todo[] = $song;
}

foreach ($todo as $song) {
    $id = youtube_id($song['sources']['youtube']);
    $loaded = $id !== null && downloaded("$DATA/backup/{$song['slug']}", $id) !== null ? ' (schon geladen)' : '';
    echo "  {$song['slug']}  <=  {$song['sources']['youtube']}$loaded\n";
}
if ($noUrl) {
    echo "\nOhne Audio und ohne YouTube-URL (" . count($noUrl) . '): ' . implode(', ', $noUrl) . "\n";
}
echo "\n" . count($todo) . ' Songs zu bearbeiten'
    . ($SHIFT !== null ? sprintf(' (Audiospur um %+d Halbtöne)', $SHIFT) : '') . ".\n";
if (!$todo || $opt['dry-run']) {
    exit(0);
}
if (!$opt['yes']) {
    echo "Jetzt holen, umwandeln und nach $REMOTE hochladen? [j/N] ";
    if (!in_array(strtolower(trim((string) fgets(STDIN))), ['j', 'ja', 'y', 'yes'], true)) {
        echo "Abgebrochen.\n";
        exit(0);
    }
}

// ---------------------------------------------------------------- Ausführen, Lied für Lied

$ok = $failed = 0;
$warnings = [];
foreach ($todo as $song) {
    $slug = $song['slug'];
    $target = (string) tempnam(sys_get_temp_dir(), 'gitarrenbuch-audio');
    try {
        $src = download($song['sources']['youtube'], "$DATA/backup/$slug");
        $gain = loudness_gain($src);
        encode($src, $target, $gain, $SHIFT ?? 0);
        $length = duration($target);
        $clip = $song['youtubeSeconds'] ?? null;
        if ($length !== null && $clip !== null && abs($length - $clip) > MAX_LENGTH_DIFF) {
            $warnings[] = sprintf('%s: audio.mp3 %.1f s, Clip laut YouTube %d s', $slug, $length, $clip);
        }
        $size = (int) filesize($target);
        api('PUT', 'audio.php?slug=' . rawurlencode($slug), (string) file_get_contents($target), 'audio/mpeg');
        printf("  ✓ %-55s %s, %+.1f dB, %.0f KB\n", $slug, $length !== null ? gmdate('i:s', (int) round($length)) : '?',
            $gain, $size / 1024);
        $ok++;
    } catch (RuntimeException $e) {
        echo "  ✗ $slug: {$e->getMessage()}\n";
        $failed++;
    } finally {
        @unlink($target);
    }
}

echo "Fertig: $ok hochgeladen, $failed fehlgeschlagen.\n";
if ($warnings) {
    echo count($warnings) . " mit abweichender Länge (hochgeladen, bitte prüfen):\n  "
        . implode("\n  ", $warnings) . "\n";
}
exit($failed > 0 ? 2 : 0);
