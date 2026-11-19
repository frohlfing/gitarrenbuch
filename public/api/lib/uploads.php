<?php

require_once __DIR__ . '/file_store.php';

/**
 * Endungen, die als Upload angenommen werden: Noten (Guitar Pro, Power Tab, MusicXML, MIDI), Akkorddateien (ChordPro,
 * Text), PDF und Bilder.
 *
 * @var string[]
 */
const UPLOAD_EXTENSIONS = [
    'gp', 'gp3', 'gp4', 'gp5', 'gp7', 'gp8', 'gpx', 'ptb', 'musicxml', 'mxl', 'xml', 'mid', 'midi',
    'cho', 'chopro', 'crd', 'pro', 'txt', 'pdf', 'png', 'jpg', 'jpeg',
];

/**
 * Name der Datei mit den Angaben zu den Uploads eines Lieds (liegt im Upload-Ordner).
 *
 * @var string
 */
const UPLOAD_INDEX = 'uploads.json';

/**
 * Höchstlänge der Quelle und der Beschreibung eines Uploads.
 *
 * @var int
 */
const UPLOAD_TEXT_MAX = 2000;

/**
 * Wie oft ein Direktlink weiterleiten darf.
 *
 * @var int
 */
const UPLOAD_MAX_REDIRECTS = 3;

/**
 * Höchstdauer des Downloads von einem Direktlink.
 *
 * @var int Sekunden
 */
const UPLOAD_DOWNLOAD_TIMEOUT = 60;

/**
 * Liest die Angaben zu den Uploads eines Lieds.
 *
 * @param string $slug Slug des Lieds
 * @return array<string, array{source: string, description: string, added: string}> Dateiname → Angaben
 */
function read_upload_index(string $slug): array
{
    $path = upload_dir($slug) . '/' . UPLOAD_INDEX;
    $data = is_file($path) ? json_decode((string) file_get_contents($path), true) : null;
    return is_array($data) ? $data : [];
}

/**
 * Schreibt die Angaben zu den Uploads eines Lieds. Erst daneben schreiben, dann umbenennen: Es entsteht nie eine halbe
 * Datei.
 *
 * @param string $slug Slug des Lieds, der Upload-Ordner muss existieren
 * @param array $index Dateiname → Angaben
 * @return void
 * @throws RuntimeException wenn die Datei nicht geschrieben werden kann
 */
function write_upload_index(string $slug, array $index): void
{
    $path = upload_dir($slug) . '/' . UPLOAD_INDEX;
    $tmp = "$path.tmp";
    $json = json_encode($index, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false || file_put_contents($tmp, $json) === false || !rename($tmp, $path)) {
        @unlink($tmp);
        throw new RuntimeException('Angaben zum Upload konnten nicht gespeichert werden');
    }
}

/**
 * Hält Quelle und Beschreibung einer Datei im Upload-Ordner fest. Das Datum der ersten Aufnahme bleibt erhalten.
 *
 * @param string $slug Slug des Lieds
 * @param string $file Dateiname im Upload-Ordner
 * @param string|null $source Quelle (meist eine URL); null lässt die gespeicherte, wie sie ist
 * @param string|null $description Beschreibung; null lässt die gespeicherte, wie sie ist
 * @return void
 * @throws FileValidationException wenn ein Text zu lang ist
 * @throws RuntimeException wenn die Angaben nicht gespeichert werden können
 */
function record_upload(string $slug, string $file, ?string $source = null, ?string $description = null): void
{
    foreach ([$source, $description] as $text) {
        if ($text !== null && mb_strlen($text) > UPLOAD_TEXT_MAX) {
            throw new FileValidationException('Quelle und Beschreibung dürfen höchstens ' . UPLOAD_TEXT_MAX
                . ' Zeichen lang sein');
        }
    }
    $index = read_upload_index($slug);
    $old = $index[$file] ?? [];
    $path = upload_dir($slug) . "/$file";
    $index[$file] = [
        'source' => $source !== null ? trim($source) : (string) ($old['source'] ?? ''),
        'description' => $description !== null ? trim($description) : (string) ($old['description'] ?? ''),
        'added' => (string) ($old['added'] ?? date('c', (int) filemtime($path))),
    ];
    write_upload_index($slug, $index);
}

/**
 * Listet die Uploads eines Lieds: alle Dateien im Upload-Ordner, auch solche ohne Angaben.
 *
 * @param string $slug Slug des Lieds
 * @return array[] file, size (Bytes), source, description, added (ISO 8601); die ältesten zuerst
 */
function list_uploads(string $slug): array
{
    $index = read_upload_index($slug);
    $uploads = [];
    foreach (glob(upload_dir($slug) . '/*') ?: [] as $path) {
        $name = basename($path);
        if (!is_file($path) || $name === UPLOAD_INDEX || str_ends_with($name, '.tmp')) {
            continue;
        }
        $uploads[] = [
            'file' => $name,
            'size' => (int) filesize($path),
            'source' => (string) ($index[$name]['source'] ?? ''),
            'description' => (string) ($index[$name]['description'] ?? ''),
            'added' => (string) ($index[$name]['added'] ?? date('c', (int) filemtime($path))),
        ];
    }
    usort($uploads, fn(array $a, array $b) => [$a['added'], $a['file']] <=> [$b['added'], $b['file']]);
    return $uploads;
}

/**
 * Pfad einer Datei im Upload-Ordner.
 *
 * @param string $slug Slug des Lieds
 * @param string $file Dateiname, wie ihn list_uploads() nennt
 * @return string|null Pfad; null, wenn es die Datei nicht gibt (auch bei Pfadangaben im Namen)
 */
function upload_path(string $slug, string $file): ?string
{
    if (!is_valid_slug($slug) || $file === '' || $file !== basename($file) || $file === UPLOAD_INDEX) {
        return null;
    }
    $path = upload_dir($slug) . "/$file";
    return is_file($path) ? $path : null;
}

/**
 * Legt eine Datei als Upload ab (siehe store_original()) und hält Quelle und Beschreibung fest.
 *
 * @param string $slug Lied, zu dem die Datei gehört
 * @param string $localPath lokale Datei; wird nur gelesen, Aufräumen bleibt Sache des Aufrufers
 * @param string $originalName ursprünglicher Dateiname, bestimmt Endung und Namen
 * @param string $source Quelle (meist eine URL)
 * @param string $description Beschreibung
 * @return array das Upload mit den Angaben aus list_uploads()
 * @throws FileValidationException|NotFoundException|RuntimeException
 */
function store_upload(string $slug, string $localPath, string $originalName, string $source, string $description): array
{
    if (read_song_json($slug) === null) {
        throw new NotFoundException("Song '$slug' nicht gefunden");
    }
    $ext = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));
    if (!in_array($ext, UPLOAD_EXTENSIONS, true)) {
        throw new FileValidationException('Dateityp .' . ($ext ?: '?') . ' wird nicht angenommen (erlaubt: .'
            . implode(', .', UPLOAD_EXTENSIONS) . ')');
    }
    $size = (int) filesize($localPath);
    if ($size === 0 || $size > MAX_UPLOAD_BYTES) {
        throw new FileValidationException(
            'Datei leer oder größer als ' . intdiv(MAX_UPLOAD_BYTES, 1024 * 1024) . ' MB'
        );
    }
    foreach ([$source, $description] as $text) {
        if (mb_strlen($text) > UPLOAD_TEXT_MAX) {
            throw new FileValidationException('Quelle und Beschreibung dürfen höchstens ' . UPLOAD_TEXT_MAX
                . ' Zeichen lang sein');
        }
    }
    $name = store_original($slug, $localPath, $originalName, $ext);
    $old = read_upload_index($slug)[$name] ?? [];
    // Gleicher Inhalt noch einmal: Die vorhandenen Angaben bleiben, leere werden ergänzt.
    record_upload($slug, $name, $source !== '' ? $source : ($old['source'] ?? ''),
        $description !== '' ? $description : ($old['description'] ?? ''));
    return array_values(array_filter(list_uploads($slug), fn(array $u) => $u['file'] === $name))[0];
}

/**
 * Ob eine IP-Adresse öffentlich ist (nicht privat, nicht reserviert, nicht Loopback oder Link-Local).
 *
 * @param string $ip IPv4- oder IPv6-Adresse
 * @return bool
 */
function is_public_ip(string $ip): bool
{
    return filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) !== false;
}

/**
 * Lädt eine Datei von einem Direktlink in eine lokale Datei. Der Server ruft damit fremde Adressen auf, deshalb gilt:
 * nur http und https, nur öffentliche IP-Adressen (auch nach Weiterleitungen; die geprüfte Adresse wird für die
 * Verbindung festgelegt), höchstens UPLOAD_MAX_REDIRECTS Weiterleitungen, höchstens MAX_UPLOAD_BYTES und
 * UPLOAD_DOWNLOAD_TIMEOUT Sekunden.
 *
 * @param string $url Direktlink zur Datei
 * @param string $target Zieldatei (lokal, wird angelegt)
 * @return string Dateiname laut Server (Content-Disposition) oder Adresse; leer, wenn keiner zu erkennen ist
 * @throws FileValidationException wenn die Adresse nicht erlaubt ist, der Server nicht antwortet oder die Datei zu
 *                                 groß ist
 */
function download_to_file(string $url, string $target): string
{
    for ($hop = 0; $hop <= UPLOAD_MAX_REDIRECTS; $hop++) {
        $parts = parse_url($url);
        $scheme = strtolower((string) ($parts['scheme'] ?? ''));
        $host = (string) ($parts['host'] ?? '');
        if (!in_array($scheme, ['http', 'https'], true) || $host === '' || isset($parts['user'])) {
            /** @noinspection HttpUrlsUsage */
            throw new FileValidationException('Der Link muss mit http:// oder https:// beginnen');
        }
        $port = (int) ($parts['port'] ?? ($scheme === 'https' ? 443 : 80));
        $ips = filter_var($host, FILTER_VALIDATE_IP) ? [$host] : (gethostbynamel($host) ?: []);
        if (!$ips || array_filter($ips, fn(string $ip) => !is_public_ip($ip))) {
            throw new FileValidationException('Der Link verweist auf keine öffentliche Adresse');
        }

        $out = fopen($target, 'wb');
        $headers = [];
        $written = 0;
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RESOLVE => ["$host:$port:$ips[0]"],
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_TIMEOUT => UPLOAD_DOWNLOAD_TIMEOUT,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_USERAGENT => 'Gitarrenbuch',
            CURLOPT_HEADERFUNCTION => function ($ch, string $line) use (&$headers): int {
                if (str_contains($line, ':')) {
                    [$key, $value] = explode(':', $line, 2);
                    $headers[strtolower(trim($key))] = trim($value);
                }
                return strlen($line);
            },
            CURLOPT_WRITEFUNCTION => function ($ch, string $data) use ($out, &$written): int {
                $written += strlen($data);
                // Ein Rückgabewert unter der Länge bricht den Download ab.
                return $written > MAX_UPLOAD_BYTES ? 0 : (int) fwrite($out, $data);
            },
        ]);
        $ok = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        fclose($out);

        if ($status >= 300 && $status < 400 && isset($headers['location'])) {
            $url = (string) (parse_url($headers['location'], PHP_URL_SCHEME) !== null
                ? $headers['location']
                : $scheme . '://' . $host . ($headers['location'][0] === '/' ? '' : '/') . $headers['location']);
            $headers = [];
            continue;
        }
        if ($written > MAX_UPLOAD_BYTES) {
            throw new FileValidationException(
                'Die Datei ist größer als ' . intdiv(MAX_UPLOAD_BYTES, 1024 * 1024) . ' MB'
            );
        }
        if ($ok === false || $status !== 200) {
            throw new FileValidationException('Der Download ist fehlgeschlagen (HTTP ' . ($status ?: '–') . ')');
        }
        if (preg_match('/filename\*?=(?:UTF-8\'\')?"?([^";]+)"?/i', $headers['content-disposition'] ?? '', $m)) {
            return rawurldecode($m[1]);
        }
        return rawurldecode(basename((string) parse_url($url, PHP_URL_PATH)));
    }
    throw new FileValidationException('Zu viele Weiterleitungen');
}
