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
  const anthropicKey = (env && env.ANTHROPIC_API_KEY) || '';
  const hasWorkersAI = !!(env && env.AI);

  // Si no hay NINGUNA IA disponible, avisamos.
  if (!anthropicKey && !hasWorkersAI) {
    return json({ error: 'No hay IA configurada. Añade el binding [ai] en wrangler.toml o el secreto ANTHROPIC_API_KEY.' }, 500);
  }

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return json({ error: 'Body vacío o JSON inválido' }, 400);
  }
  if (!payload || typeof payload !== 'object') return json({ error: 'JSON inválido' }, 400);

  if (!Array.isArray(payload.messages) || !payload.messages.length) {
    return json({ error: 'Falta el campo "messages"' }, 400);
  }

  // La API key de Anthropic tiene prioridad si existe; si no, Workers AI.
  if (anthropicKey) return callAnthropic(anthropicKey, payload);
  return callWorkersAI(env.AI, payload);
}

/* ------------------------------------------------------------------
 * 2a. Workers AI (GRATIS: 10.000 neurons/día en el plan Free,
 *     sin tarjeta y sin posibilidad de facturación en ese plan).
 *     Devuelve el MISMO formato que la API de Anthropic, así que la app
 *     no necesita ningún cambio.
 * ---------------------------------------------------------------- */
const WORKERS_AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
// Alternativas (misma cuota gratuita, ver README §4.4):
//   '@cf/qwen/qwen3-30b-a3b-fp8'      ~778 msg/día
//   '@cf/meta/llama-4-scout-17b-16e-instruct'  ~233 msg/día
//   '@cf/mistralai/mistral-small-3.1-24b-instruct'  ~245 msg/día

async function callWorkersAI(ai, payload) {
  // Workers AI no tiene parámetro `system` universal: se manda como primer
  // mensaje de rol system, que es lo que entienden todos los modelos.
  var msgs = [];
  if (payload.system) msgs.push({ role: 'system', content: String(payload.system) });
  for (var i = 0; i < payload.messages.length; i++) {
    var m = payload.messages[i];
    if (m && m.role && typeof m.content === 'string') msgs.push({ role: m.role, content: m.content });
  }

  var out;
  try {
    out = await ai.run(WORKERS_AI_MODEL, {
      messages: msgs,
      max_tokens: payload.max_tokens || 600,
    });
  } catch (e) {
    var m = String((e && e.message) || e);
    if (/limit|quota|neuron|capacity|exceeded/i.test(m)) {
      return json({ error: 'Límite gratuito diario de Workers AI superado. Se reinicia a las 00:00 UTC.' }, 429);
    }
    return json({ error: 'Error con el modelo de IA: ' + m }, 502);
  }

  var text = '';
  if (typeof out === 'string') text = out;
  else if (out) {
    text = out.response || (out.result && out.result.response) || '';
    if (!text && Array.isArray(out.choices) && out.choices[0] && out.choices[0].message) {
      text = out.choices[0].message.content || '';
    }
  }
  if (!text) return json({ error: 'El modelo devolvió una respuesta vacía' }, 502);

  // Formato Anthropic: la app lee data.content[n].type === 'text'
  return json({
    id: 'wai_' + Date.now(),
    type: 'message',
    role: 'assistant',
    model: WORKERS_AI_MODEL,
    content: [{ type: 'text', text: text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 0, output_tokens: 0 },
  }, 200);
}

/* ------------------------------------------------------------------
 * 2b. Claude (Anthropic) — opcional, si prefieres pagarlo tú.
 *     Se activa automáticamente si existe el secreto ANTHROPIC_API_KEY.
 * ---------------------------------------------------------------- */
async function callAnthropic(apiKey, payload) {
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
