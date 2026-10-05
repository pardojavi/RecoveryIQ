<?php
/**
 * RecoveryIQ — proxy-ai.php
 * Proxy servidor-a-servidor para la API de Anthropic (Claude).
 *
 * 🔑 LA API KEY NO SE ESCRIBE AQUÍ. Se carga, por este orden:
 *      1. proxy-ai-config.php   (archivo real, está en .gitignore → seguro de subir)
 *      2. variable de entorno ANTHROPIC_API_KEY
 *      3. el placeholder de abajo (la app devolverá un error claro)
 *
 *    Copia proxy-ai-config.example.php → proxy-ai-config.php y pon ahí tu key.
 *
 * Requisitos: PHP 8.0+ con ext-cURL.
 * Una vez subido, pon su ruta en MY_AI_PROXY dentro de recovery-app.html:
 *     var MY_AI_PROXY = 'proxy-ai.php';
 */

declare(strict_types=1);

// Orden de resolución de la API key
$anthropicApiKey = 'TU_API_KEY_DE_ANTHROPIC_AQUI';

$localConfig = __DIR__ . '/proxy-ai-config.php';
if (is_file($localConfig)) {
    $cfg = require $localConfig;
    if (is_array($cfg) && !empty($cfg['anthropic_api_key'])) {
        $anthropicApiKey = (string)$cfg['anthropic_api_key'];
    }
}

$envKey = getenv('ANTHROPIC_API_KEY');
if ($envKey !== false && $envKey !== '') {
    $anthropicApiKey = $envKey;
}

// ⚙️ Modelo por defecto si el cliente no lo indica
const ANTHROPIC_DEFAULT_MODEL = 'claude-sonnet-4-20250514';

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Método no permitido']);
    exit;
}

if ($anthropicApiKey === 'TU_API_KEY_DE_ANTHROPIC_AQUI') {
    http_response_code(500);
    echo json_encode(['error' => 'Falta la API key: crea proxy-ai-config.php (ver proxy-ai-config.example.php) o define la variable de entorno ANTHROPIC_API_KEY.']);
    exit;
}

$body = file_get_contents('php://input');
if ($body === false || trim($body) === '') {
    http_response_code(400);
    echo json_encode(['error' => 'Body vacío']);
    exit;
}

// Asegurar modelo por defecto y límite de tokens
$payload = json_decode($body, true);
if (!is_array($payload)) {
    http_response_code(400);
    echo json_encode(['error' => 'JSON inválido']);
    exit;
}
if (empty($payload['model'])) {
    $payload['model'] = ANTHROPIC_DEFAULT_MODEL;
}
if (empty($payload['max_tokens'])) {
    $payload['max_tokens'] = 600;
}
$encodedBody = json_encode($payload, JSON_UNESCAPED_UNICODE);
if ($encodedBody === false) {
    http_response_code(400);
    echo json_encode(['error' => 'No se pudo codificar el payload']);
    exit;
}

$ch = curl_init('https://api.anthropic.com/v1/messages');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => $encodedBody,
    CURLOPT_TIMEOUT        => 30,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_HTTPHEADER     => [
        'Content-Type: application/json',
        'x-api-key: ' . $anthropicApiKey,
        'anthropic-version: 2023-06-01',
    ],
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_SSL_VERIFYHOST => 2,
]);

$response  = curl_exec($ch);
$httpCode  = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError = curl_error($ch);
curl_close($ch);

if ($response === false) {
    http_response_code(502);
    echo json_encode(['error' => 'Error de conexión con Anthropic: ' . $curlError]);
    exit;
}

http_response_code($httpCode);
echo $response;
exit;
