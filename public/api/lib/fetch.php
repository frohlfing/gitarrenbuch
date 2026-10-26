<?php

/**
 * User-Agent, den http_get() mitschickt (Browser-ähnlich, da manche Seiten Standard-Agents blocken).
 *
 * @var string
 */
const HTTP_FETCH_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/**
 * Lädt $url per GET und gibt den Response-Body zurück. Nutzt die curl-Extension, falls
 * verfügbar (realistischerer Browser-Fingerprint, manche Seiten blocken PHPs file_get_contents()-
 * Stream-Wrapper sonst als Bot), sonst file_get_contents() mit Stream-Context als Fallback
 * (allow_url_fopen ist praktisch überall aktiviert, curl dagegen nicht garantiert vorhanden).
 * Folgt Redirects. $headers sind zusätzliche Request-Header ("Name: Wert"), z. B. ein API-Schlüssel.
 *
 * Bekanntes lokales Problem (dieses XAMPP, nicht der Code hier): Unter Apache (nicht CLI!) schlägt
 * das Laden von php_curl.dll fehl, extension_loaded('curl') liefert dort false, der Fallback auf
 * file_get_contents() greift automatisch. Sichtbar in C:\xampp\php\logs\php_error_log als
 * "PHP Startup: Unable to load dynamic library 'php_curl.dll' (Das angegebene Modul/die angegebene
 * Prozedur wurde nicht gefunden)" – ein DLL-Versionskonflikt einer curl-Abhängigkeit (vermutlich
 * OpenSSL/libssh2) speziell im apache2handler-SAPI dieser XAMPP-Installation. php -m (CLI) zeigt
 * curl fälschlich als geladen an, das täuscht leicht. Auswirkung: file_get_contents() wird von
 * manchen Seiten mit aggressiver Bot-Erkennung blockiert (typisch: HTTP 401/402/403). Auf dem
 * Ziel-Webspace (Linux) ist curl mit hoher Wahrscheinlichkeit intakt; vor dem Verlassen auf den
 * Fallback dort prüfen, z. B. mit einer kurzen Testdatei <?php var_dump(extension_loaded('curl'));.
 *
 * @param string $url Absolute http(s)-URL
 * @param int $timeoutSeconds Timeout für Verbindungsaufbau und Gesamtdauer in Sekunden
 * @param int $maxBytes Maximal gelesene Antwortgröße in Bytes
 * @param array $headers Zusätzliche Request-Header ("Name: Wert")
 * @return string Der Response-Body (bei gzip/deflate bereits dekomprimiert)
 * @throws RuntimeException bei ungültigem Schema, Netzwerkfehler oder HTTP-Fehlerstatus
 */
function http_get(string $url, int $timeoutSeconds = 10, int $maxBytes = 8 * 1024 * 1024, array $headers = []): string
{
    $scheme = parse_url($url, PHP_URL_SCHEME);
    if (!in_array($scheme, ['http', 'https'], true)) {
        throw new RuntimeException('Nur http/https-URLs werden unterstützt');
    }

    return extension_loaded('curl')
        ? http_get_curl($url, $timeoutSeconds, $maxBytes, $headers)
        : http_get_stream($url, $timeoutSeconds, $maxBytes, $headers);
}

/**
 * Variante von http_get() auf Basis der curl-Extension.
 *
 * @param string $url Absolute http(s)-URL
 * @param int $timeoutSeconds Timeout in Sekunden
 * @param int $maxBytes Maximal gelesene Antwortgröße in Bytes
 * @param array $headers Zusätzliche Request-Header ("Name: Wert")
 * @return string Der Response-Body
 * @throws RuntimeException bei Netzwerkfehler oder HTTP-Fehlerstatus (>= 400)
 */
function http_get_curl(string $url, int $timeoutSeconds, int $maxBytes, array $headers = []): string
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 5,
        CURLOPT_TIMEOUT => $timeoutSeconds,
        CURLOPT_CONNECTTIMEOUT => $timeoutSeconds,
        CURLOPT_USERAGENT => HTTP_FETCH_USER_AGENT,
        CURLOPT_HTTPHEADER => ['Accept-Language: de-DE,de;q=0.9,en;q=0.8', ...$headers],
        CURLOPT_RANGE => '0-' . $maxBytes, // Kulanz-Bremse, Server kann Range ignorieren
        CURLOPT_SSL_VERIFYPEER => true,
        // Leerstring = "alle von libcurl unterstützten Kodierungen anbieten und automatisch
        // dekomprimieren". Manche Server liefern gzip auch ohne Nachfrage –
        // ohne das hier kommt nur der komprimierte Rohinhalt zurück, json_decode() scheitert
        // dann (tmdb_get() meldet "keine gültige Antwort").
        CURLOPT_ENCODING => '',
    ]);
    $body = curl_exec($ch);
    $error = curl_error($ch);
    $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);

    // Kein curl_close(): CurlHandle-Objekte (seit PHP 8.0) werden automatisch per GC freigegeben,
    // der Aufruf ist seit PHP 8.5 deprecated.
    if ($body === false) {
        throw new RuntimeException("Abruf fehlgeschlagen: $error");
    }
    if ($status >= 400) {
        throw new RuntimeException("Server antwortete mit HTTP $status");
    }

    return $body;
}

/**
 * Variante von http_get() auf Basis von file_get_contents() (Fallback ohne curl-Extension).
 *
 * @param string $url Absolute http(s)-URL
 * @param int $timeoutSeconds Timeout in Sekunden
 * @param int $maxBytes Maximal gelesene Antwortgröße in Bytes
 * @param array $headers Zusätzliche Request-Header ("Name: Wert")
 * @return string Der Response-Body (bei gzip/deflate bereits dekomprimiert)
 * @throws RuntimeException bei Netzwerkfehler oder HTTP-Fehlerstatus (>= 400)
 */
function http_get_stream(string $url, int $timeoutSeconds, int $maxBytes, array $headers = []): string
{
    $context = stream_context_create([
        'http' => [
            'method' => 'GET',
            'header' => "User-Agent: " . HTTP_FETCH_USER_AGENT . "\r\n"
                . "Accept-Language: de-DE,de;q=0.9,en;q=0.8\r\n"
                . "Accept-Encoding: gzip, deflate\r\n"
                . implode('', array_map(fn(string $h) => "$h\r\n", $headers)),
            'timeout' => $timeoutSeconds,
            'follow_location' => 1,
            'max_redirects' => 5,
            // Damit wir den Status selbst auswerten (und eine sprechende Fehlermeldung geben),
            // statt dass file_get_contents() bei 4xx/5xx nur eine PHP-Warning wirft.
            'ignore_errors' => true,
        ],
        'ssl' => [
            'verify_peer' => true,
            'verify_peer_name' => true,
        ],
    ]);

    $body = @file_get_contents($url, false, $context, 0, $maxBytes);
    if ($body === false) {
        throw new RuntimeException('Abruf fehlgeschlagen (Netzwerkfehler oder ungültige URL)');
    }

    $status = 0;
    $encoding = null;
    foreach ($http_response_header ?? [] as $header) {
        if (preg_match('#^HTTP/\S+\s+(\d+)#', $header, $m)) {
            $status = (int) $m[1];
        }
        if (preg_match('#^Content-Encoding:\s*(\S+)#i', $header, $m)) {
            $encoding = strtolower($m[1]);
        }
    }
    if ($status >= 400) {
        throw new RuntimeException("Server antwortete mit HTTP $status");
    }

    // Anders als curl dekomprimiert der http-Stream-Wrapper die Antwort nicht selbst, obwohl wir
    // oben "Accept-Encoding: gzip, deflate" mitschicken (nötig, weil manche Server ohnehin
    // komprimieren, siehe Hinweis zu CURLOPT_ENCODING oben in http_get_curl()).
    if ($encoding === 'gzip') {
        $decoded = @gzdecode($body);
        return $decoded !== false ? $decoded : $body;
    }
    if ($encoding === 'deflate') {
        $decoded = @gzinflate($body);
        if ($decoded === false) {
            $decoded = @gzuncompress($body);
        }
        return $decoded !== false ? $decoded : $body;
    }

    return $body;
}
