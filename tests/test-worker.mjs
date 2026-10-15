/* RecoveryIQ — worker: la temperatura de la muñeca no puede tumbar la
   sincronización con Garmin.
   El endpoint de temperatura (/sleep-service/sleep/dailySleepData?date=) hay
   que pedirlo día a día y Garmin lo limita o lo bloquea con facilidad. Antes
   todas las peticiones iban en un solo Promise.all: si UNA caía, caía todo y
   el usuario veía "Garmin ha dejado de funcionar". Aquí se comprueba que la
   temperatura va en una segunda tanda, aislada y limitada en concurrencia. */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

let pass = 0, fail = 0;
const ok = (c, l, x) => {
  if (c) { pass++; console.log('  ok   ' + l); }
  else   { fail++; console.log('  FAIL ' + l + (x !== undefined ? '  → ' + x : '')); }
};
const eq = (a, b, l) => ok(a === b, l, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));

/* ---------- Node 16 no trae Request/Response: shim mínimo ---------- */
class ShimHeaders {
  constructor(map) { this.m = {}; for (const k in (map || {})) this.m[String(k).toLowerCase()] = String(map[k]); }
  get(n) { const v = this.m[String(n).toLowerCase()]; return v === undefined ? null : v; }
  set(n, v) { this.m[String(n).toLowerCase()] = String(v); }
  has(n) { return this.m[String(n).toLowerCase()] !== undefined; }
}
class ShimResponse {
  constructor(body, init) {
    init = init || {};
    this.status = init.status === undefined ? 200 : init.status;
    this.headers = new ShimHeaders(init.headers || {});
    this._body = body === null || body === undefined ? '' : String(body);
  }
  get ok() { return this.status >= 200 && this.status < 300; }
  json() { return Promise.resolve(this._body ? JSON.parse(this._body) : null); }
  text() { return Promise.resolve(this._body); }
}
class ShimRequest {
  constructor(url, init) {
    init = init || {};
    this.url = url;
    this.method = init.method || 'GET';
    this.headers = new ShimHeaders(init.headers || {});
    this._body = init.body === undefined ? null : init.body;
  }
  json() { const b = this._body; return Promise.resolve(b ? JSON.parse(b) : null); }
}
globalThis.Response = ShimResponse;
globalThis.Request = ShimRequest;

/* ---------- carga el worker desde disco ---------- */
const ROOT = '/Users/javier.pardo/RecoveryIQ';
const tmp = path.join(os.tmpdir(), 'riq-worker-' + process.pid + '.mjs');
fs.copyFileSync(path.join(ROOT, 'worker.js'), tmp);
const worker = (await import(pathToFileURL(tmp).href)).default;
fs.unlinkSync(tmp);

/* ---------- doble de la API de Garmin ---------- */
const J = (obj, status) => new ShimResponse(JSON.stringify(obj), {
  status: status || 200, headers: { 'content-type': 'application/json' },
});

function respond(u, o) {
  if (u.indexOf('diauth.garmin.com') >= 0) {
    return J({ access_token: 'aaa.bbb.ccc', refresh_token: 'rt-nuevo' });
  }
  if (u.indexOf('userprofile-service') >= 0) return J({ displayName: 'atleta' });

  if (u.indexOf('dailySleepData') >= 0) {            // temperatura: configurable
    if (o.tempStatus !== 200) return J({ message: 'denied' }, o.tempStatus);
    return J({ avgSkinTempDeviationC: 0.4, skinTempCalibrationDays: 30,
               dailySleepDTO: { calendarDate: '2026-10-10' } });
  }
  if (u.indexOf('hrv-service') >= 0) {               // núcleo: configurable
    if (o.flaky === 'hrv') throw new Error('network');
    if (o.coreStatus !== 200) return J({ message: 'denied' }, o.coreStatus);
    return J({ hrvData: [{ hrvSummary: { avgHrv: 61 } }] });
  }
  if (u.indexOf('userstats-service') >= 0) return o.coreStatus !== 200 ? J({}, o.coreStatus) : J({ metricList: [{}] });
  if (u.indexOf('fitnessstats-service') >= 0) return o.coreStatus !== 200 ? J({}, o.coreStatus) : J({ activityTrainingLoad: [{}] });
  if (u.indexOf('activitylist-service') >= 0) return o.coreStatus !== 200 ? J([], o.coreStatus) : J([]);
  if (u.indexOf('weight-service') >= 0) return o.coreStatus !== 200 ? J({}, o.coreStatus) : J({ dateWeightList: [] });
  if (u.indexOf('/sleep-service/stats/sleep/daily/') >= 0) {
    // Filas REALES: si el rango no trae ninguna, el worker cae en el fallback
    // de un solo día (+14 peticiones) y los recuentos dejan de cuadrar.
    return o.coreStatus !== 200
      ? J({}, o.coreStatus)
      : J({ individualStats: [{ deepSleepSeconds: 5400, sleepTimeSeconds: 25200 }] });
  }
  return J({}, 404);
}

function harness(o) {
  const st = { calls: [], corePending: 0, tempInflight: 0, maxTempInflight: 0, tempOverlap: 0, total: 0 };
  globalThis.fetch = (url) => {
    const u = String(url);
    const isTemp = u.indexOf('dailySleepData') >= 0;
    // "núcleo" = las peticiones que la app necesita: las 5 + los trozos de sueño.
    // Se excluyen el token de Garmin y el perfil, que van por su cuenta.
    const isCore = !isTemp &&
      u.indexOf('diauth.garmin.com') < 0 &&
      u.indexOf('userprofile-service') < 0;
    st.calls.push(u);
    st.total++;
    if (isCore) st.corePending++;
    if (isTemp) {
      st.tempInflight++;
      if (st.tempInflight > st.maxTempInflight) st.maxTempInflight = st.tempInflight;
      if (st.corePending > 0) st.tempOverlap++;     // ¡orden violado!
    }
    const delay = isCore ? 6 : 0;
    return new Promise((res, rej) => setTimeout(() => {
      if (isCore) st.corePending--;
      if (isTemp) st.tempInflight--;
      try { res(respond(u, o)); } catch (e) { rej(e); }
    }, delay));
  };
  return st;
}

async function sync(opts) {
  // Normaliza: sin esto, `o.coreStatus !== 200` sería cierto cuando la opción
  // no existe y los fixtures devolverían cuerpos vacíos.
  const o = Object.assign({ coreStatus: 200, tempStatus: 200 }, opts || {});
  const st = harness(o);
  const r = await worker.fetch(new ShimRequest('https://proxy.example/garmin', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'sync', refreshToken: 'rt', clientId: 'cid', displayName: 'atleta',
      start: '2026-08-16', end: '2026-10-15',      // 60 días, como la app
    }),
  }));
  return { status: r.status, body: await r.json(), st };
}

const TEMP_CALLS = (st) => st.calls.filter(u => u.indexOf('dailySleepData') >= 0).length;
// Núcleo = las 5 peticiones fijas + los trozos de sueño. El token de Garmin y
// el perfil van aparte: no son datos del índice.
const CORE_CALLS = (st) => st.calls.filter(u =>
  u.indexOf('dailySleepData') < 0 &&
  u.indexOf('diauth.garmin.com') < 0 &&
  u.indexOf('userprofile-service') < 0).length;
const AUTH_CALLS = (st) => st.calls.filter(u =>
  u.indexOf('diauth.garmin.com') >= 0 || u.indexOf('userprofile-service') >= 0).length;

/* ================= 1. Garmin bloquea la temperatura ================= */
console.log('\n== La temperatura bloqueada (403) no rompe la sincronización ==');
{
  const { status, body, st } = await sync({ tempStatus: 403 });
  eq(status, 200, 'la sincronización responde 200');
  eq(body.ok, true, 'ok:true');
  ok(!!body.data.hrv, 'trae HRV', JSON.stringify(body.data && body.data.hrv));
  eq(body.data.sleep.length, 3, 'trae los 3 trozos de sueño (60 días / 28)');
  eq(body.diag.temp.s, 403, 'el diagnóstico dice que la temperatura dio 403');
  eq(body.diag.tempRows, 0, 'y que ningún día trae temperatura');
  eq(body.data.temp.length, 14, 'las 14 peticiones se hicieron');
  eq(body.data.temp.every(x => x === null), true, 'todas devolvieron vacío sin romper nada');
  eq(TEMP_CALLS(st), 14, '14 peticiones de temperatura');
  eq(CORE_CALLS(st), 8, '8 peticiones de núcleo (5 + 3 de sueño)');
  eq(st.total, 24, '24 peticiones en total (token + perfil + 8 de núcleo + 14 de temperatura)');
  eq(st.maxTempInflight <= 3, true, 'la temperatura va a ratos de 3 como máximo', st.maxTempInflight);
  eq(st.tempOverlap, 0, 'y NUNCA se lanza mientras el núcleo sigue pendiente');
}

/* ================= 2. La temperatura llega ================= */
console.log('\n== La temperatura correcta se devuelve entera ==');
{
  const { status, body, st } = await sync({ tempStatus: 200 });
  eq(status, 200, 'la sincronización responde 200');
  eq(body.ok, true, 'ok:true');
  eq(body.diag.tempRows, 14, 'los 14 días traen desviación');
  eq(body.diag.temp.s, 200, 'el diagnóstico de la última petición es 200');
  eq(body.data.temp[0].avgSkinTempDeviationC, 0.4, 'la desviación pasa sin tocar');
  ok(!!body.data.temp[13].dailySleepDTO.calendarDate, 'y el día asociado también');
  eq(st.tempOverlap, 0, 'la temperatura sigue esperando al núcleo');
}

/* ================= 3. Una petición del núcleo se cae ================= */
console.log('\n== Una petición del núcleo fallando no mata la sincronización ==');
{
  const { status, body } = await sync({ tempStatus: 200, flaky: 'hrv' });
  eq(status, 200, 'sigue respondiendo 200');
  eq(body.ok, true, 'ok:true');
  eq(body.data.hrv, null, 'el hueco de HRV queda vacío…');
  eq(body.diag.hrv.s, 0, '…y el diagnóstico lo refleja');
  ok(!!body.data.sleep, 'pero el resto de datos llega igual');
}

/* ================= 4. Garmin caído entero ================= */
console.log('\n== Si TODO el núcleo cae, sí se avisa ==');
{
  const { status, body } = await sync({ coreStatus: 500 });
  eq(status, 502, '502');
  eq(body.code, 'NETWORK', 'código NETWORK');
}

/* ================= 5. Sesión caducada ================= */
console.log('\n== 401 del núcleo = sesión caducada ==');
{
  const { status, body } = await sync({ coreStatus: 401 });
  eq(status, 401, '401');
  eq(body.code, 'REFRESH_FAILED', 'código REFRESH_FAILED');
  ok(body.error.indexOf('caducó') >= 0, 'mensaje amable', body.error);
}

/* ================= 6. Presupuesto de peticiones ================= */
console.log('\n== Presupuesto del plan Free (50 peticiones) ==');
{
  const { st } = await sync({ tempStatus: 200 });
  ok(st.total <= 50, 'se queda por debajo de 50', st.total);
  // Núcleo + temperatura + token + perfil = todo lo que se pidió.
  ok(st.total === CORE_CALLS(st) + TEMP_CALLS(st) + AUTH_CALLS(st),
     'sin peticiones fantasma', st.total + ' vs ' +
     (CORE_CALLS(st) + TEMP_CALLS(st) + AUTH_CALLS(st)));
}

/* --------------------------------------- */
console.log('\n' + '-'.repeat(47));
console.log('Worker: ' + pass + ' OK, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
