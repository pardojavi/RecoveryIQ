/**
 * RecoveryIQ — worker.js
 * Proxy unificado (Intervals.icu + Claude) para desplegar en Cloudflare Workers.
 *
 * GitHub Pages sirve HTML estático pero NO ejecuta PHP, así que si quieres que
 * la app conecte con tu cuenta de Intervals.icu desde Pages, usa este worker.
 *
 * Despliegue (tier gratuito, HTTPS automático):
 *   npx wrangler login
 *   npx wrangler deploy
 *   npx wrangler secret put ANTHROPIC_API_KEY      # solo si usas el chat IA
 *
 * y en recovery-app.html:
 *   var MY_PROXY    = 'https://recoveryiq-proxy.<tu-subdomino>.workers.dev';
 *   var MY_AI_PROXY = 'https://recoveryiq-proxy.<tu-subdomino>.workers.dev/ai';
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 200, headers: CORS });
    }

    if (url.pathname.endsWith('/ai')) {
      if (request.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
      return handleAI(request, env);
    }

    if (request.method !== 'GET') return json({ error: 'Método no permitido' }, 405);
    return handleIntervals(url);
  },
};

/* ------------------------------------------------------------------
 * 1. Proxy de Intervals.icu
 *    GET /?url=https://intervals.icu/api/...&auth=Basic%20...
 * ---------------------------------------------------------------- */
async function handleIntervals(incoming) {
  const target = incoming.searchParams.get('url') || '';
  const auth = incoming.searchParams.get('auth') || '';

  // Whitelist estricta: este worker no puede usarse como proxy abierto.
  if (!target.startsWith('https://intervals.icu/api/')) {
    return json({ error: 'URL no permitida' }, 403);
  }

  let res;
  try {
    res = await fetch(target, {
      method: 'GET',
      headers: {
        Authorization: auth,
        Accept: 'application/json',
      },
    });
  } catch (e) {
    return json({ error: 'No se pudo conectar con Intervals.icu' }, 502);
  }

  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/* ------------------------------------------------------------------
 * 2. Proxy de Claude (Anthropic)
 *    POST /ai   body = payload de /v1/messages
 *    La key vive en el secreto ANTHROPIC_API_KEY (nunca en el repo).
 * ---------------------------------------------------------------- */
async function handleAI(request, env) {
  // OJO: en workers con sintaxis de ES module los secretos llegan en `env`,
  // NO como variables globales (eso solo ocurre en el formato service worker).
  const apiKey = (env && env.ANTHROPIC_API_KEY) || '';
  if (!apiKey) {
    return json({ error: 'Falta el secreto ANTHROPIC_API_KEY. Ejecuta: npx wrangler secret put ANTHROPIC_API_KEY' }, 500);
  }

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return json({ error: 'Body vacío o JSON inválido' }, 400);
  }
  if (!payload || typeof payload !== 'object') return json({ error: 'JSON inválido' }, 400);

  if (!payload.model) payload.model = 'claude-sonnet-4-20250514';
  if (!payload.max_tokens) payload.max_tokens = 600;

  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return json({ error: 'Error de conexión con Anthropic' }, 502);
  }

  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}
