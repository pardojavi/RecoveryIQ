/**
 * RecoveryIQ — worker.js
 * Proxy unificado (Intervals.icu + Garmin Connect + IA) para desplegar en
 * Cloudflare Workers.
 *
 * GitHub Pages sirve HTML estático pero NO ejecuta PHP, así que si quieres que
 * la app conecte con tus cuentas desde Pages, usa este worker.
 *
 * Rutas:
 *   GET  /?url=https://intervals.icu/api/…&auth=Basic…   → proxy de Intervals.icu
 *   POST /ai          → Workers AI (gratis) o Anthropic si hay secreto
 *   POST /garmin      → Garmin Connect (vía no oficial, ver README §4.5/§4.6)
 *
 * Despliegue (tier gratuito, HTTPS automático):
 *   npx wrangler login
 *   npx wrangler deploy
 *   npx wrangler secret put ANTHROPIC_API_KEY      # solo si usas el chat de pago
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

    if (url.pathname.endsWith('/garmin')) {
      if (request.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
      return handleGarmin(request);
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

/* ==================================================================
 * 3. GARMIN CONNECT  (vía NO OFICIAL — ver README §4.5 y §4.6)
 * ------------------------------------------------------------------
 * No confundir con la "Garmin Health API" oficial (§4.6), que exige
 * ser partner. Esto reproduce el mismo flujo OAuth que hace la app
 * oficial de Garmin Connect en el móvil:
 *
 *   POST sso.garmin.com/mobile/api/login        → serviceTicketId
 *   POST diauth.garmin.com/…/oauth/token        → access + refresh
 *   GET  connectapi.garmin.com/…                → datos
 *
 * El refresh token lo guarda el NAVEGADOR (mismo sitio donde ya vive
 * tu API key de Intervals.icu); el worker solo lo refresca y hace de
 * puente. Si alguna vez te lo roban, se revoca desde la cuenta Garmin.
 * ================================================================== */

const G = {
  sso: 'https://sso.garmin.com',
  api: 'https://connectapi.garmin.com',
  diauth: 'https://diauth.garmin.com',

  // Flujo móvil (iOS): un único POST, sin retardo anti-WAF (que solo
  // aplica al flujo "portal", que necesita GET + espera de 10-20 s).
  ssoClientId: 'GCM_IOS_DARK',
  ssoService: 'https://mobile.integration.garmin.com/gcm/ios',
  loginUA:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) ' +
    'AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',

  // Cabeceras "nativas" que espera el nivel API.
  apiUA: 'GCM-Android-5.23',
  xGarminUA:
    'com.garmin.android.apps.connectmobile/5.23; ; ' +
    'Google/sdk_gphone64_arm64/google; Android/33; Dalvik/2.1.0',

  diTokenUrl: 'https://diauth.garmin.com/di-oauth2-service/oauth/token',
  diGrant: 'https://connectapi.garmin.com/di-oauth2-service/oauth/grant/service_ticket',
  // Se prueban en orden; el que acepte manda (varía por región/cuenta).
  diClientIds: [
    'GARMIN_CONNECT_MOBILE_IOS_DI',
    'GARMIN_CONNECT_MOBILE_ANDROID_DI_2025Q2',
    'GARMIN_CONNECT_MOBILE_ANDROID_DI_2024Q4',
    'GARMIN_CONNECT_MOBILE_ANDROID_DI',
  ],
};

const basic = (id) => 'Basic ' + btoa(id + ':');

function ymdUTC(d) {
  return d.toISOString().slice(0, 10);
}

/** Devuelve [['2026-09-01','2026-09-28'], …] troceando el rango (límite de Garmin: 28 días). */
function chunkRange(start, end, size) {
  const out = [];
  let cur = new Date(start + 'T00:00:00Z');
  const last = new Date(end + 'T00:00:00Z');
  while (cur <= last) {
    const next = new Date(cur.getTime());
    next.setUTCDate(next.getUTCDate() + size - 1);
    const chunkEnd = next > last ? last : next;
    out.push([ymdUTC(cur), ymdUTC(chunkEnd)]);
    cur = new Date(chunkEnd.getTime());
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

function readCookies(res) {
  const out = [];
  try {
    if (typeof res.headers.getSetCookie === 'function') {
      const all = res.headers.getSetCookie() || [];
      for (const c of all) out.push(String(c).split(';')[0]);
      if (out.length) return out;
    }
  } catch (e) { /* seguimos */ }
  const single = res.headers.get('set-cookie');
  if (single) {
    for (const part of String(single).split(/,(?=[^;]+=)/)) out.push(part.split(';')[0]);
  }
  return out;
}

const encodeState = (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o))));
function decodeState(s) {
  try {
    return JSON.parse(decodeURIComponent(escape(atob(String(s)))));
  } catch (e) {
    return null;
  }
}

/** Autenticación: credenciales → ticket → tokens DI. */
async function garminLogin(body) {
  const email = String(body.email || '').trim();
  const password = String(body.password || '');
  if (!email || !password) {
    return json({ ok: false, code: 'MISSING', error: 'Faltan el email o la contraseña de Garmin.' }, 400);
  }

  let res;
  try {
    const qs = new URLSearchParams({
      clientId: G.ssoClientId, locale: 'en-US', service: G.ssoService,
    });
    res = await fetch(G.sso + '/mobile/api/login?' + qs.toString(), {
      method: 'POST',
      headers: {
        'User-Agent': G.loginUA,
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        Origin: G.sso,
        'Accept-Language': 'en-US,en;q=0.9',
      },
      body: JSON.stringify({ username: email, password, rememberMe: true, captchaToken: '' }),
    });
  } catch (e) {
    return json({ ok: false, code: 'NETWORK', error: 'No se pudo conectar con los servidores de Garmin.' }, 502);
  }

  if (res.status === 429) {
    return json({ ok: false, code: 'RATE_LIMIT',
      error: 'Garmin ha limitado los intentos de acceso. Espera unos minutos y vuelve a probar.' }, 429);
  }
  if (res.status === 403) {
    return json({ ok: false, code: 'BLOCKED',
      error: 'Garmin bloqueó la petición con desafío anti-bots. Prueba desde otra red o más tarde.' }, 403);
  }

  let data;
  try {
    data = await res.json();
  } catch (e) {
    return json({ ok: false, code: 'BLOCKED',
      error: 'Respuesta no válida de Garmin (HTTP ' + res.status + ').' }, 403);
  }

  const status = (data.responseStatus && data.responseStatus.type) || '';

  if (status === 'MFA_REQUIRED') {
    const method = (data.customerMfaInfo && data.customerMfaInfo.mfaLastMethodUsed) || 'email';
    return json({
      ok: false, code: 'MFA_REQUIRED', mfaMethod: method,
      mfaState: encodeState({ cookies: readCookies(res) }),
      error: 'Garmin pide verificación en dos pasos.',
    }, 401);
  }
  if (status === 'INVALID_USERNAME_PASSWORD') {
    return json({ ok: false, code: 'BAD_CREDENTIALS', error: 'Email o contraseña de Garmin incorrectos.' }, 401);
  }
  if (status === 'CAPTCHA_REQUIRED') {
    return json({ ok: false, code: 'CAPTCHA',
      error: 'Garmin exige una verificación de humanidad. Entra una vez en connect.garmin.com desde tu navegador y reintenta.' }, 403);
  }
  if (status !== 'SUCCESSFUL' || !data.serviceTicketId) {
    return json({ ok: false, code: 'DENIED',
      error: 'Garmin no aceptó el acceso (estado: ' + (status || 'desconocido') + ').' }, 401);
  }

  return finishLogin(data.serviceTicketId, readCookies(res));
}

/** Completa el MFA con el código de 6 dígitos. */
async function garminMfa(body) {
  const state = decodeState(body.mfaState || '');
  if (!state) {
    return json({ ok: false, code: 'STATE_LOST', error: 'La verificación caducó. Conecta de nuevo.' }, 400);
  }
  const code = String(body.code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(code)) {
    return json({ ok: false, code: 'BAD_CODE', error: 'El código de verificación debe tener 6 dígitos.' }, 400);
  }

  let res;
  try {
    const qs = new URLSearchParams({ clientId: G.ssoClientId, locale: 'en-US', service: G.ssoService });
    const cookie = (state.cookies || []).join('; ');
    res = await fetch(G.sso + '/mobile/api/mfa/verifyCode?' + qs.toString(), {
      method: 'POST',
      headers: {
        'User-Agent': G.loginUA,
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        Origin: G.sso,
        Cookie: cookie,
      },
      body: JSON.stringify({
        mfaMethod: body.mfaMethod || 'email',
        mfaVerificationCode: code,
        rememberMyBrowser: true,
        reconsentList: [],
        mfaSetup: false,
      }),
    });
  } catch (e) {
    return json({ ok: false, code: 'NETWORK', error: 'No se pudo conectar con Garmin.' }, 502);
  }

  let data;
  try {
    data = await res.json();
  } catch (e) {
    return json({ ok: false, code: 'BLOCKED', error: 'Respuesta no válida de Garmin (HTTP ' + res.status + ').' }, 403);
  }

  const status = (data.responseStatus && data.responseStatus.type) || '';
  if (status !== 'SUCCESSFUL' || !data.serviceTicketId) {
    const err = (data.error && data.error.message) || '';
    return json({ ok: false, code: 'BAD_CODE',
      error: 'Código incorrecto o caducado. ' + err }, 401);
  }
  // El ticket CAS cuelga de la sesión SSO: se reenvían las cookies del login
  // original (sin ellas Garmin rechaza el intercambio).
  const cookies = (state.cookies || []).concat(readCookies(res)).join('; ');
  return finishLogin(data.serviceTicketId, cookies);
}

/** Intercambia el ticket CAS por tokens DI (prueba varios client_id). */
async function finishLogin(ticket, cookies) {
  let lastStatus = 0;
  for (const clientId of G.diClientIds) {
    let r;
    try {
      r = await fetch(G.diTokenUrl, {
        method: 'POST',
        headers: {
          Authorization: basic(clientId),
          Accept: 'application/json,text/html;q=0.9,*/*;q=0.8',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cache-Control': 'no-cache',
          ...(cookies ? { Cookie: cookies } : {}),
        },
        body: new URLSearchParams({
          client_id: clientId,
          service_ticket: ticket,
          grant_type: G.diGrant,
          service_url: G.ssoService,
        }).toString(),
      });
    } catch (e) {
      return json({ ok: false, code: 'NETWORK', error: 'No se pudo intercambiar el ticket con Garmin.' }, 502);
    }
    lastStatus = r.status;
    if (!r.ok) continue;
    let d;
    try { d = await r.json(); } catch (e) { continue; }
    if (!d || !d.access_token) continue;

    const used = extractJwtClient(d.access_token) || clientId;
    const who = await garminWhoami(d.access_token);
    return json({
      ok: true,
      refreshToken: d.refresh_token || '',
      clientId: used,
      displayName: who.displayName || '',
      expiresInSeconds: d.expires_in || 0,
    });
  }
  return json({ ok: false, code: 'TOKEN_EXCHANGE',
    error: 'Garmin no emitió el token de acceso (HTTP ' + lastStatus + ').' }, 401);
}

/** Lee el `client_id` de un JWT sin validar la firma (solo para saber con qué refreshar). */
function extractJwtClient(jwt) {
  try {
    const parts = String(jwt).split('.');
    if (parts.length < 2) return null;
    const decoded = decodeURIComponent(
      escape(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    );
    const claim = JSON.parse(decoded);
    return claim.client_id ? String(claim.client_id) : null;
  } catch (e) {
    return null;
  }
}

async function garminWhoami(accessToken) {
  try {
    const r = await fetch(G.api + '/userprofile-service/socialProfile', {
      headers: apiHeaders(accessToken),
    });
    if (!r.ok) return { displayName: '' };
    const d = await r.json();
    return { displayName: (d && (d.displayName || d.profileName)) || '' };
  } catch (e) {
    return { displayName: '' };
  }
}

function apiHeaders(token) {
  return {
    Authorization: 'Bearer ' + token,
    Accept: 'application/json',
    'User-Agent': G.apiUA,
    'X-Garmin-User-Agent': G.xGarminUA,
    'X-Garmin-Paired-App-Version': '10861',
    'X-Garmin-Client-Platform': 'Android',
    'X-App-Ver': '10861',
    'X-Lang': 'en',
    'X-GCExperience': 'GC5',
    'Accept-Language': 'en-US,en;q=0.9',
  };
}

async function garminRefresh(refreshToken, clientId) {
  if (!refreshToken) return { error: 'TOKEN_MISSING' };
  const ids = [];
  if (clientId) ids.push(clientId);
  for (const id of G.diClientIds) if (ids.indexOf(id) < 0) ids.push(id);

  for (const id of ids) {
    let r;
    try {
      r = await fetch(G.diTokenUrl, {
        method: 'POST',
        headers: {
          Authorization: basic(id),
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cache-Control': 'no-cache',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: id,
          refresh_token: refreshToken,
        }).toString(),
      });
    } catch (e) {
      return { error: 'NETWORK' };
    }
    if (!r.ok) continue;
    let d;
    try { d = await r.json(); } catch (e) { continue; }
    if (!d || !d.access_token) continue;
    return {
      accessToken: d.access_token,
      refreshToken: d.refresh_token || refreshToken,
      clientId: extractJwtClient(d.access_token) || id,
    };
  }
  return { error: 'REFRESH_FAILED' };
}

/** Trae los 6 datos que necesita la app en 8 peticiones (límite free: 50). */
async function garminSync(body) {
  const start = String(body.start || '');
  const end = String(body.end || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return json({ ok: false, code: 'BAD_DATE', error: 'Rango de fechas inválido.' }, 400);
  }

  const fresh = await garminRefresh(body.refreshToken, body.clientId);
  if (fresh.error) {
    const status = fresh.error === 'NETWORK' ? 502 : 401;
    return json({
      ok: false, code: fresh.error,
      error: fresh.error === 'REFRESH_FAILED'
        ? 'La sesión con Garmin caducó. Vuelve a conectar tu cuenta.'
        : 'No se pudo renovar la sesión con Garmin.',
    }, status);
  }

  const H = apiHeaders(fresh.accessToken);
  const get = (path) => fetch(G.api + path, { headers: H });

  let profile;
  try {
    profile = await (await get('/userprofile-service/socialProfile')).json();
  } catch (e) {
    profile = {};
  }
  // El endpoint de FC en reposo va "por nombre". Si el perfil falla se usa el
  // que la app ya guardó al conectar, y si no lo hay, se omite sin romper nada.
  const displayName =
    (profile && (profile.displayName || profile.profileName)) ||
    String(body.displayName || '').trim();

  const sleepChunks = chunkRange(start, end, 28);
  const jobs = [
    get('/hrv-service/hrv/daily/' + start + '/' + end),
    get('/userstats-service/wellness/daily/' + encodeURIComponent(displayName) +
        '?fromDate=' + start + '&untilDate=' + end + '&metricId=60'),
    get('/fitnessstats-service/activity/all?startDate=' + start + '&endDate=' + end +
        '&metric=activityTrainingLoad'),
    get('/activitylist-service/activities/search/activities?start=0&limit=20' +
        '&startDate=' + start + '&endDate=' + end),
    ...sleepChunks.map(([a, b]) => get('/sleep-service/stats/sleep/daily/' + a + '/' + b)),
  ];

  let results;
  try {
    results = await Promise.all(jobs);
  } catch (e) {
    return json({ ok: false, code: 'NETWORK', error: 'Error consultando los datos de Garmin.' }, 502);
  }

  // Si Garmin ha rechazado casi todas las llamadas, avisamos en vez de devolver
  // vacío (que en la app se vería como "no hay datos en tu cuenta").
  const denied = results.filter(r => r && (r.status === 401 || r.status === 403 || r.status === 429));
  if (denied.length && denied.length >= results.length - 1) {
    const s = denied[0].status;
    if (s === 429) {
      return json({ ok: false, code: 'RATE_LIMIT',
        error: 'Garmin ha limitado las peticiones. Espera unos minutos y sincroniza de nuevo.' }, 429);
    }
    if (s === 401) {
      return json({ ok: false, code: 'REFRESH_FAILED',
        error: 'La sesión con Garmin caducó. Vuelve a conectar tu cuenta.' }, 401);
    }
    return json({ ok: false, code: 'BLOCKED',
      error: 'Garmin bloqueó las peticiones con su control anti-bots. Entra una vez en connect.garmin.com desde tu navegador y reintenta.' }, 403);
  }

  const jsonOf = async (r, fb) => {
    if (!r || !r.ok) return fb;
    try { return await r.json(); } catch (e) { return fb; }
  };

  // Se devuelven los JSON SIN tocar. Toda la interpretación de "cápsulas"
  // (array plano, {data:[…]}, {hrvData:[{hrvSummary:{…}}]}, trozos de sueño…)
  // vive en la app, que es donde está cubierta por los tests de normalización.
  const hrv = await jsonOf(results[0], null);
  const rhr = await jsonOf(results[1], null);
  const load = await jsonOf(results[2], null);
  const activities = await jsonOf(results[3], null);
  const sleep = [];
  for (let i = 0; i < sleepChunks.length; i++) sleep.push(await jsonOf(results[4 + i], null));

  // Diagnóstico: qué devolvió cada endpoint. Si falta HRV o sueño, la app lo
  // muestra en un toast para poder corregirlo sin adivinar.
  const kindOf = (x) => x === null ? 'sin-cuerpo'
    : Array.isArray(x) ? 'array(' + x.length + ')'
    : typeof x === 'object' ? (Object.keys(x).slice(0, 6).join(',') || 'objeto-vacío')
    : typeof x;
  const statusOf = (i) => (results[i] && results[i].status) || 0;
  const diag = {
    hrv:  { s: statusOf(0), k: kindOf(hrv) },
    rhr:  { s: statusOf(1), k: kindOf(rhr) },
    load: { s: statusOf(2), k: kindOf(load) },
    acts: { s: statusOf(3), k: kindOf(activities) },
    sleep: sleepChunks.map((c, i) => ({
      c: c[0].slice(5) + '/' + c[1].slice(5),
      s: statusOf(4 + i),
      k: kindOf(sleep[i]),
    })),
  };

  return json({
    ok: true,
    refreshToken: fresh.refreshToken,
    clientId: fresh.clientId,
    displayName,
    start,
    end,
    diag,
    data: { hrv, rhr, load, sleep, activities },
  });
}

async function handleGarmin(request) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, code: 'BAD_JSON', error: 'Body vacío o JSON inválido.' }, 400);
  }
  if (!body || typeof body !== 'object') {
    return json({ ok: false, code: 'BAD_JSON', error: 'JSON inválido.' }, 400);
  }

  if (body.action === 'login') return garminLogin(body);
  if (body.action === 'mfa') return garminMfa(body);
  if (body.action === 'sync') return garminSync(body);
  return json({ ok: false, code: 'BAD_ACTION', error: 'Acción no permitida.' }, 400);
}
