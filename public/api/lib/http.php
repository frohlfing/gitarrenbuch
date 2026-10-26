<?php

/**
 * Sendet $data als JSON mit dem angegebenen HTTP-Status und beendet die Ausführung.
 *
 * @param int $status HTTP-Statuscode
 * @param array $data Antwort-Body
 * @return never
 */
function json_response(int $status, array $data): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/**
 * Kurzform für json_response() mit einem einzelnen {"error": $message}-Body.
 *
 * @param int $status HTTP-Statuscode
 * @param string $message Fehlermeldung
 * @return never
 */
function json_error(int $status, string $message): never
{
    json_response($status, ['error' => $message]);
}

/**
 * Liest den JSON-Body der Request. Bricht mit 400 ab, wenn kein gültiges JSON-Objekt vorliegt.
 *
 * @return array der dekodierte Body
 */
function read_json_body(): array
{
    $raw = file_get_contents('php://input');
    $data = json_decode($raw ?: '', true);
    if (!is_array($data)) {
        json_error(400, 'Ungültiger oder fehlender JSON-Body');
    }
    return $data;
}

/**
 * Bricht mit 401 ab, wenn der X-API-Token Header fehlt oder falsch ist.
 *
 * @return void
 */
function require_token(): void
{
    $header = $_SERVER['HTTP_X_API_TOKEN'] ?? '';
    if ($header === '' || !hash_equals(API_TOKEN, $header)) {
        json_error(401, 'Ungültiges oder fehlendes API-Token');
    }
}
