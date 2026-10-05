<?php
/**
 * RecoveryIQ — proxy.php
 * Proxy servidor-a-servidor para la API de Intervals.icu (evita CORS).
 *
 * Requisitos: PHP 8.0 o superior (usa str_starts_with).
 * Sube este archivo junto a recovery-app.html.
 *
 * Uso desde el cliente:
 *   GET proxy.php?url=https://intervals.icu/api/v1/...&auth=Basic%20...
 */

declare(strict_types=1);

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'Método no permitido']);
    exit;
}

$url  = (string)($_GET['url']  ?? '');
$auth = (string)($_GET['auth'] ?? '');
$key  = (string)($_GET['key']  ?? '');

// Seguridad: solo se permite proxyar URLs de Intervals.icu
if (!str_starts_with($url, 'https://intervals.icu/api/')) {
    http_response_code(403);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'URL no permitida']);
    exit;
}

// Si llega la API key en lugar de la cabecera Authorization completa
if ($key !== '' && $auth === '') {
    $auth = 'Basic ' . base64_encode('API_KEY:' . $key);
}

$opts = [
    'http' => [
        'method'        => 'GET',
        'header'        => 'Authorization: ' . $auth . "\r\n" .
                           'Accept: application/json' . "\r\n",
        'timeout'       => 20,
        'ignore_errors' => true,   // devolvemos el status real de Intervals.icu
    ],
    'ssl' => [
        'verify_peer'      => true,
        'verify_peer_name' => true,
    ],
];

$ctx      = stream_context_create($opts);
$response = @file_get_contents($url, false, $ctx);

// Extraer el código HTTP devuelto por Intervals.icu
$status = 200;
if (isset($http_response_header) && is_array($http_response_header) && $http_response_header !== []) {
    if (preg_match('/HTTP\/\d(?:\.\d)?\s+(\d{3})/', $http_response_header[0], $m)) {
        $status = (int)$m[1];
    }
}

header('Content-Type: application/json; charset=utf-8');

if ($response === false) {
    http_response_code(502);
    echo json_encode(['error' => 'No se pudo conectar con Intervals.icu']);
    exit;
}

http_response_code($status);
echo $response;
exit;
