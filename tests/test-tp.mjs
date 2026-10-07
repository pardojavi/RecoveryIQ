/* RecoveryIQ — pruebas de la 3ª vía de datos (TrainingPeaks) */
import fs from 'fs';
import { JSDOM } from 'jsdom';

const APP = '/Users/javier.pardo/RecoveryIQ/recovery-app.html';
const html = fs.readFileSync(APP, 'utf8');
const MYPROXY = (html.match(/var MY_PROXY = '([^']+)'/) || [])[1] || '';

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else      { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  → ' + extra : '')); }
};
const eq = (a, b, label) =>
  ok(a === b, label, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));

/* ---------- payloads con la forma real de tpapi.trainingpeaks.com ---------- */
const p2 = n => (n < 10 ? '0' : '') + n;
const keyOf = d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
const dayKey = i => { const d = new Date(); d.setDate(d.getDate() - i); return keyOf(d); };

/* metrics/v3/athletes/{id}/consolidatedtimedmetrics/{start}/{end}
   → [{timeStamp, details:[{type,value}]}] con type 5=Pulse 6=sueño 9=peso 60=HRV */
function makeMetrics(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const det = [
      { type: 60, value: 58 + (i % 9) },
      { type: 5,  value: 48 + (i % 5) },
      { type: 6,  value: 7.2 + ((i % 4) * 0.2) }
    ];
    if (i % 3 === 0) det.push({ type: 9, value: 70.5 + (i % 5) * 0.2 });
    out.push({ timeStamp: dayKey(i) + 'T06:' + p2(i % 60) + ':00', details: det });
  }
  return out;
}

/* POST /fitness/v1/athletes/{id}/reporting/performancedata/{start}/{end}
   → [{workoutDay, tssActual, ctl, atl, tsb}]  ← CTL/ATL/TSB ya calculados */
function makeFitness(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      workoutDay: dayKey(i),
      tssActual: 60 + i,
      ctl: 60 + (i * 0.3),
      atl: 65 + (i * 0.3),
      tsb: -5
    });
  }
  return out;
}

/* GET /fitness/v6/athletes/{id}/workouts/{start}/{end}
   → totalTime en HORAS DECIMALES */
function makeWorkouts(n) {
  const out = [];
  for (let i = 0; i < n; i += 2) {
    out.push({
      id: 1000 + i, workoutDay: dayKey(i), title: 'Ciclismo ' + i,
      totalTime: 1.5, distance: 45000, tssActual: 95,
      completed: i > 0, workoutTypeName: 'Cycling', workoutTypeValueId: 4
    });
  }
  // Entreno planificado a futuro: NO debe salir como «última actividad»
  out.push({
    id: 9999, workoutDay: dayKey(-3), title: 'Planificado el lunes',
    totalTime: 2, distance: 60000, completed: false, workoutTypeName: 'Cycling'
  });
  return out;
}

const makePayload = opts => {
  const n = (opts && opts.days) || 60;
  return {
    metrics:  (opts && opts.noMetrics) ? [] : makeMetrics(n),
    fitness:  (opts && opts.noFitness) ? [] : makeFitness(n),
    workouts: (opts && opts.noWorkouts) ? [] : makeWorkouts(n)
  };
};

const TP_OK = payload => ({
  ok: true, cookie: 'ck-NEW', refreshToken: 'rf-NEW', accessToken: 'at-NEW',
  expires: Date.now() + 3600000, athleteId: '4242', displayName: 'Javier Pardo',
  start: dayKey(60), end: dayKey(0),
  diag: {
    metrics:  { s: 200, k: 'array(60){timeStamp,details}', n: 60 },
    fitness:  { s: 200, k: 'array(60){workoutDay,tssActual,ctl,atl,tsb}', n: 60 },
    workouts: { s: 200, k: 'array(31){id,workoutDay,title}', n: 31 }
  },
  data: payload
});
const LOGIN_OK = {
  ok: true, cookie: 'ck-1', refreshToken: 'rf-1', accessToken: 'at-1',
  expires: Date.now() + 3600000, athleteId: '4242', displayName: 'Javier Pardo',
  email: 'javier@example.com'
};
const COOKIE_OK = {
  ok: true, cookie: 'ck-1', refreshToken: 'rf-1', accessToken: 'at-1',
  expires: Date.now() + 3600000, athleteId: '4242', displayName: 'Javier Pardo',
  email: ''
};

let tpPayload = makePayload();
let syncFail = null;
let loginFail = null;
let lastFetch = null;
let sentActions = [];

const dom = new JSDOM(html, {
  url: 'https://example.com/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  beforeParse(window) {
    window.fetch = function (url, opts) {
      lastFetch = { url: String(url), opts: opts || {} };
      const u = String(url);
      if (u.indexOf('/trainingpeaks') < 0) return Promise.reject(new Error('sin red en tests: ' + u));
      let b = {};
      try { b = JSON.parse((opts && opts.body) || '{}'); } catch (e) { b = {}; }
      sentActions.push(b.action || '');
      const send = (code, obj) =>
        Promise.resolve({ ok: code < 300, status: code, json: () => Promise.resolve(obj) });
      if (b.action === 'login') {
        if (loginFail) return send(loginFail.status, loginFail.body);
        return send(200, LOGIN_OK);
      }
      if (b.action === 'cookie') return send(200, COOKIE_OK);
      if (b.action === 'sync') {
        if (syncFail) return send(syncFail.status, syncFail.body);
        const r = TP_OK(tpPayload);
        // El worker real devuelve la cookie/credentials con las que trabajó
        if (b.cookie) r.cookie = b.cookie;
        if (b.refreshToken) r.refreshToken = b.refreshToken;
        if (b.accessToken) r.accessToken = b.accessToken;
        return send(200, r);
      }
      return send(400, { ok: false, code: 'BAD_ACTION', error: 'x' });
    };
  }
});

const w = dom.window;
const run = code => w.eval(code);
const wait = ms => new Promise(r => setTimeout(r, ms));
const $ = id => w.document.getElementById(id);

console.log('\n== Arranque ==');
ok(!$('js-err') || !$('js-err').classList.contains('show'), 'sin errores JS al arrancar',
   $('js-err') && $('js-err').textContent);
eq(MYPROXY.indexOf('workers.dev') >= 0, true, 'el proxy de producción está fijado');

console.log('\n== TrainingPeaks: la 3ª vía existe en la UI ==');
eq($('src-switch').querySelectorAll('.src-opt').length, 3, 'tres botones de fuente');
eq($('src-switch').querySelectorAll('.src-opt[data-src="trainingpeaks"]').length, 1,
   'botón TrainingPeaks presente');
eq(run('SOURCE_FORMS.trainingpeaks'), 'form-tp', 'SOURCE_FORMS tiene la 3ª vía');
ok($('form-tp'), '#form-tp existe');
eq(run('sourceName("trainingpeaks")'), 'TrainingPeaks', 'sourceName de la 3ª vía');
eq(run('sourceName("garmin")'), 'Garmin Connect', 'sourceName de Garmin sigue intacto');
eq(run('sourceName("intervals")'), 'Intervals.icu', 'sourceName de Intervals sigue intacto');

run('pickSource("trainingpeaks")');
eq($('form-tp').style.display, '', 'pickSource muestra el formulario TP');
eq($('form-intervals').style.display, 'none', 'pickSource oculta Intervals');
eq($('form-garmin').style.display, 'none', 'pickSource oculta Garmin');
eq($('src-switch').querySelector('.src-opt.active').getAttribute('data-src'), 'trainingpeaks',
   'el botón TP queda activo');
run('pickSource("intervals")');
eq($('form-tp').style.display, 'none', 'volver a Intervals oculta TP');

console.log('\n== TrainingPeaks: tpField() traduce los type numéricos ==');
eq(run('tpField(5)'), 'restingHR', 'type 5 = Pulse (FC reposo)');
eq(run('tpField(6)'), 'sleep', 'type 6 = horas de sueño');
eq(run('tpField(9)'), 'weight', 'type 9 = peso');
eq(run('tpField(60)'), 'hrv', 'type 60 = HRV');
eq(run('tpField("60")'), 'hrv', 'type "60" (cadena) también');
eq(run('tpField("SleepHours")'), 'sleep', 'nombre literal también');
eq(run('tpField("WeightInKilograms")'), 'weight', 'nombre literal de peso');
eq(run('tpField(42)'), '', 'type desconocido → vacío');

console.log('\n== TrainingPeaks: tpToRows() con la forma real ==');
w.__tp = makePayload();
let rows = run('tpToRows(window.__tp)');
eq(rows.length, 60, '60 filas', rows.length);
let todayRow = rows[rows.length - 1];
eq(todayRow.id, dayKey(0), 'la última fila es hoy');
eq(todayRow.hrv, 58, 'HRV de hoy');
eq(todayRow.restingHR, 48, 'FC en reposo de hoy');
eq(todayRow.sleep, 7.2, 'sueño en horas con 1 decimal');
eq(todayRow.body.weight, 70.5, 'peso de hoy en kg');
ok(todayRow.ctl === 60 && todayRow.atl === 65, 'CTL 60 / ATL 65 del PMC',
   JSON.stringify([todayRow.ctl, todayRow.atl]));
eq(rows[59 - 3].hrv, 58 + 3, 'HRV de hace 3 días');
eq(rows[1].body, null, 'los días sin type 9 no tienen peso');

console.log('\n== TrainingPeaks: tpActivities() ==');
let acts = run('tpActivities(window.__tp)');
ok(acts.length > 0, 'hay actividades', acts.length);
ok(!acts.some(a => a.name === 'Planificado el lunes'),
   'el entrenamiento futuro no cuenta', JSON.stringify(acts.map(a => a.name)));
eq(acts[0].duration, 5400, 'totalTime 1,5 h → 5400 s');
eq(acts[0].moving_time, 5400, 'moving_time también en segundos');
eq(acts[0].start_date, dayKey(0), 'start_date en formato día');
eq(acts[0].type, 'Cycling', 'tipo del entreno');
eq(acts[0].distance, 45000, 'distancia en metros');

console.log('\n== TrainingPeaks: tpDiag() resume la sincronización ==');
const diag = run('tpDiag({start:"2026-08-01", end:"2026-10-06", diag:{' +
                 'metrics:{s:200,k:"array(60)",n:60},' +
                 'fitness:{s:200,k:"array(60)",n:60},' +
                 'workouts:{s:200,k:"array(31)",n:31}}}, ' +
                 'tpToRows(window.__tp), tpActivities(window.__tp))');
eq(diag.days, 60, '60 días');
eq(diag.hrvDays, 60, '60 días con HRV');
eq(diag.sleepDays, 60, '60 días con sueño');
eq(diag.rhrDays, 60, '60 días con FC en reposo');
eq(diag.bodyDays, 20, 'los días con peso', diag.bodyDays);
eq(diag.fitDays, 60, '60 días con PMC');
eq(diag.pmc.s, 200, 'la fila PMC arrastra el estado HTTP');
eq(diag.act.s, 200, 'la fila de actividades arrastra el estado HTTP');
eq(diag.sleep.s, 200, 'la celda de sueño usa el endpoint de métricas');
eq(diag.todayHrv, 58, 'HRV de hoy en el diagnóstico');

console.log('\n== TrainingPeaks: errores amables ==');
run('S.source = "trainingpeaks"');
ok(run('friendlyError({message:"x", gCode:"TP_BAD_CREDENTIALS"})').indexOf('incorrectos') >= 0,
   'credenciales mal → incorrectos');
ok(run('friendlyError({message:"x", gCode:"TP_BLOCKED"})').indexOf('Production_tpAuth') >= 0,
   'bloqueo → sugiere la cookie');
ok(run('friendlyError({message:"x", gCode:"TP_REAUTH"})').indexOf('caducado') >= 0,
   'sesión caducada → caducado');
ok(run('friendlyError({message:"NO_DATA_TP"})').indexOf('TrainingPeaks') >= 0,
   'sin datos → nombra TrainingPeaks');
ok(run('friendlyError({message:"x", gCode:"RATE_LIMIT"})').indexOf('limitado') >= 0,
   'rate limit sigue diciendo limitado');

console.log('\n== TrainingPeaks: validación del formulario ==');
lastFetch = null;
$('inp-tp-email').value = '';
$('inp-tp-pass').value = 'secreta';
run('doConnectTp()');
eq(lastFetch, null, 'sin email no se llama a la red');
$('inp-tp-email').value = 'javier@example.com';
$('inp-tp-pass').value = '';
run('doConnectTp()');
eq(lastFetch, null, 'sin contraseña no se llama a la red');
$('inp-tp-cookie').value = '';
run('doConnectTpCookie()');
eq(lastFetch, null, 'sin cookie no se llama a la red');

console.log('\n== TrainingPeaks: campo de la cookie (alternativa) ==');
eq($('field-tp-cookie').style.display, 'none', 'oculto por defecto');
$('btn-tp-alt').dispatchEvent(new w.Event('click', { bubbles: true }));
eq($('field-tp-cookie').style.display, '', 'el enlace lo muestra');
$('btn-tp-alt').dispatchEvent(new w.Event('click', { bubbles: true }));
eq($('field-tp-cookie').style.display, 'none', 'y lo vuelve a ocultar');

console.log('\n== TrainingPeaks: conexión con email y contraseña ==');
$('inp-tp-email').value = 'javier@example.com';
$('inp-tp-pass').value = 'secreta';
run('doConnectTp()');
await wait(120);
eq(run('S.source'), 'trainingpeaks', 'la fuente pasa a trainingpeaks');
eq(run('S.tp.cookie'), 'ck-1', 'cookie guardada en estado');
eq(run('S.tp.athleteId'), '4242', 'athleteId guardado');
eq(run('S.tp.displayName'), 'Javier Pardo', 'nombre del atleta guardado');
eq($('inp-tp-pass').value, '', 'la contraseña se borra del formulario');
eq(run('S.isDemo'), false, 'no es modo demo');
ok($('app-screen').classList.contains('active'), 'entra en la app');
const cfg = run('safeGet("riq_config", null)');
eq(cfg.source, 'trainingpeaks', 'la sesión se persiste con la fuente correcta');
eq(cfg.tp.cookie, 'ck-1', 'la cookie se persiste');
ok(lastFetch.url.indexOf('/trainingpeaks') >= 0,
   'la llamada fue al endpoint de TrainingPeaks', lastFetch.url);
ok(!lastFetch.url.endsWith('/garmin'), 'no se usa la ruta de Garmin', lastFetch.url);

console.log('\n== TrainingPeaks: datos en la portada ==');
const d = run('S.data');
eq(d.source, 'trainingpeaks', 'los datos se etiquetan con la fuente');
eq(d.today.hrv, 58, 'HRV de hoy en la portada');
eq(d.today.restingHR, 48, 'FC en reposo de hoy en la portada');
eq(d.today.sleep, 7.2, 'sueño de hoy en la portada');
eq(d.today.ctl, 60, 'CTL en la portada');
eq(d.today.atl, 65, 'ATL en la portada');
eq(d.today.tsb, -5, 'TSB en la portada');
eq(d.today.weight, 70.5, 'peso en la portada');
ok(d.lastActivity && d.lastActivity.name === 'Ciclismo 0',
   'última actividad = la de hoy, no la planificada',
   d.lastActivity && d.lastActivity.name);
eq(d.week.length, 7, 'semana de 7 días');

console.log('\n== TrainingPeaks: diagnóstico en Ajustes ==');
run('renderSettings()');
ok($('diag-card').style.display === '', 'la tarjeta de diagnóstico se muestra',
   $('diag-card').style.display);
ok($('diag-title').textContent.indexOf('TrainingPeaks') >= 0,
   'el título nombra la fuente activa', $('diag-title').textContent);
ok($('diag-counts').textContent.indexOf('PMC 60') >= 0,
   'los recuentos incluyen el PMC', $('diag-counts').textContent);
ok($('diag-hrv').innerHTML.indexOf('HTTP 200') >= 0,
   'fila HRV con estado HTTP', $('diag-hrv').innerHTML);
ok($('diag-pmc').innerHTML.indexOf('HTTP 200') >= 0,
   'fila PMC con estado HTTP', $('diag-pmc').innerHTML);
eq($('row-diag-pmc').style.display, '', 'la fila PMC es visible en TP');
ok($('display-mode').textContent === 'TrainingPeaks',
   'Modo = TrainingPeaks', $('display-mode').textContent);

console.log('\n== TrainingPeaks: el aviso nombraba solo a Garmin ==');
const wn2 = run('garminWarn({sleepDays:0, hrvDays:0, todaySleep:null,' +
                ' hrv:null, sleep:{s:404,k:"sin-cuerpo"}}, "TrainingPeaks")');
ok(wn2.indexOf('TrainingPeaks') >= 0, 'garminWarn acepta la marca de la fuente', wn2);

console.log('\n== TrainingPeaks: volver a Intervals no arrastra estado TP ==');
run('doLogout()');
eq(run('S.source'), 'intervals', 'la fuente vuelve a intervals');
eq(run('S.tp.cookie'), '', 'S.tp se limpia');
eq($('inp-tp-email').value, '', 'el email se limpia');
eq($('inp-tp-pass').value, '', 'la contraseña se limpia');
eq($('inp-tp-cookie').value, '', 'la cookie se limpia');
eq($('field-tp-cookie').style.display, 'none', 'el campo de la cookie se repliega');
eq($('form-tp').style.display, 'none', 'el formulario TP se oculta');

console.log('\n== TrainingPeaks: doSync sin credenciales ==');
lastFetch = null;
run('S.source = "trainingpeaks"; S.tp = tpBlank(); doSync();');
eq(lastFetch, null, 'doSync no llama a la red sin cookie guardada');

console.log('\n== TrainingPeaks: saveConfig/restoreSession ==');
run('S.source = "trainingpeaks"; S.tp.cookie = "ck-restore"; S.tp.email = "a@b.c"; saveConfig();');
const cfg2 = run('safeGet("riq_config", null)');
eq(cfg2.source, 'trainingpeaks', 'saveConfig guarda la fuente');
eq(cfg2.tp.cookie, 'ck-restore', 'saveConfig guarda la cookie');
eq(run('restoreSession()'), true, 'restoreSession acepta la 3ª vía');
await wait(120);
eq(run('S.source'), 'trainingpeaks', 'la sesión restaurada es de TrainingPeaks');
eq(run('S.tp.cookie'), 'ck-restore', 'la cookie restaurada sobrevive a la sincronización');
eq($('inp-tp-email').value, 'a@b.c', 'el email se rellena al restaurar');
eq($('inp-tp-cookie').value, '', 'la cookie nunca se vuelca en el input');
run('doLogout()');

console.log('\n== TrainingPeaks: sin datos → NO_DATA_TP ==');
tpPayload = { metrics: [], fitness: [], workouts: [] };
$('inp-tp-email').value = 'javier@example.com';
$('inp-tp-pass').value = 'secreta';
run('doConnectTp()');
await wait(120);
eq(run('S.source'), 'trainingpeaks', 'la fuente queda seleccionada');
run('doLogout()');

console.log('\n== TrainingPeaks: sesión caducada → TP_REAUTH limpia el estado ==');
syncFail = { status: 401, body: { ok: false, code: 'TP_REAUTH',
  error: 'La sesión con TrainingPeaks ha caducado.' } };
tpPayload = makePayload();
$('inp-tp-email').value = 'javier@example.com';
$('inp-tp-pass').value = 'secreta';
run('doConnectTp()');
await wait(120);
eq(run('S.tp.cookie'), '', 'TP_REAUTH borra la cookie del estado');
syncFail = null;
run('doLogout()');

console.log('\n== TrainingPeaks: TP_BLOCKED despliega la alternativa por cookie ==');
loginFail = { status: 200, body: { ok: false, code: 'TP_BLOCKED',
  error: 'TrainingPeaks ha exigido una comprobación extra.' } };
$('inp-tp-email').value = 'javier@example.com';
$('inp-tp-pass').value = 'secreta';
run('doConnectTp()');
await wait(120);
eq($('field-tp-cookie').style.display, '',
   'el captcha abre el campo de la cookie', $('field-tp-cookie').style.display);
loginFail = null;

console.log('\n== TrainingPeaks: conexión por cookie pegada ==');
run('pickSource("trainingpeaks")');
$('inp-tp-email').value = 'javier@example.com';
$('inp-tp-cookie').value = 'ck-pegada';
sentActions = [];
run('doConnectTpCookie()');
await wait(120);
eq(run('S.source'), 'trainingpeaks', 'conectado por cookie');
eq(run('S.tp.cookie'), 'ck-1', 'la cookie nueva sustituye a la pegada');
eq($('inp-tp-cookie').value, '', 'el input de la cookie se limpia');
ok(sentActions.indexOf('cookie') >= 0, 'se usó la acción cookie',
   JSON.stringify(sentActions));
ok(sentActions.indexOf('sync') >= 0, 'y después se sincronizó',
   JSON.stringify(sentActions));

console.log('\n== Errores JS tardíos ==');
ok(!$('js-err') || !$('js-err').classList.contains('show'), 'ningún error JS en toda la ejecución',
   $('js-err') && $('js-err').textContent);

console.log('\n---------------------------------------');
console.log('TrainingPeaks: ' + pass + ' OK, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
