<?php

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
 * Löst eine eingebettete Audiospur aus einer GP7/GP8-Datei heraus und speichert die MP3 unverändert als audio.mp3
 * (auf dem Server gibt es kein ffmpeg zum Umwandeln). Die Sync-Punkte übernimmt der Browser beim Umwandeln der
 * Noten nach alphaTex, die Datei selbst bleibt unverändert. Ohne eingeschaltete, lokal eingebettete MP3, in anderen
 * Formaten oder wenn audio.mp3 schon existiert, passiert nichts.
 *
 * @param string $path GP-Datei, wird nur gelesen
 * @param string $dir Ordner, in den audio.mp3 geschrieben wird
 * @return bool true, wenn eine Audiospur herausgelöst wurde
 * @throws RuntimeException wenn das Archiv nicht gelesen oder audio.mp3 nicht geschrieben werden kann
 */
function extract_gp_audio(string $path, string $dir): bool
{
    if (detect_gp_format($path) !== 'gp' || is_file("$dir/audio.mp3")) {
        return false;
    }
    $zip = new ZipArchive();
    if ($zip->open($path, ZipArchive::RDONLY) !== true) {
        throw new RuntimeException('GP-Datei konnte nicht als ZIP geöffnet werden');
    }
    $xml = $zip->getFromName('Content/score.gpif');
    // Inhalt des ersten Elements $name in $in (mit oder ohne CDATA), null wenn es fehlt.
    $tag = fn(string $name, string $in): ?string
        => preg_match("#<$name>(?:<!\[CDATA\[)?(.*?)(?:]]>)?</$name>#s", $in, $m) ? $m[1] : null;

    $backing = $xml !== false && preg_match('#<BackingTrack>.*?</BackingTrack>#s', $xml, $b) ? $b[0] : '';
    $assetId = $tag('AssetId', $backing);
    $asset = $assetId !== null && preg_match('#<Asset id="' . preg_quote($assetId, '#') . '">.*?</Asset>#s', $xml, $a)
        ? $a[0] : '';
    $assetPath = (string) $tag('EmbeddedFilePath', $asset);
    if ($tag('Enabled', $backing) !== 'true' || $tag('Source', $backing) !== 'Local'
        || strtolower(pathinfo($assetPath, PATHINFO_EXTENSION)) !== 'mp3') {
        $zip->close();
        return false;
    }
    $audio = $zip->getFromName($assetPath);
    $zip->close();
    if ($audio === false) {
        throw new RuntimeException('Audiospur fehlt im GP-Archiv');
    }
    if (file_put_contents("$dir/audio.mp3", $audio) === false) {
        throw new RuntimeException('audio.mp3 konnte nicht gespeichert werden');
    }
    return true;
}
