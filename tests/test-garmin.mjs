/* RecoveryIQ — pruebas de la 2ª vía de datos (Garmin Connect) + regresión */
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

/* ---------- payloads con la forma real de la API de Garmin ---------- */
const p2 = n => (n < 10 ? '0' : '') + n;
const keyOf = d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
const dayKey = i => { const d = new Date(); d.setDate(d.getDate() - i); return keyOf(d); };

function makePayload(opts) {
  opts = opts || {};
  const hrv = [], rhr = [], sleep = [], load = [], activities = [], weightList = [];
  const n = opts.days || 60;
  for (let i = 0; i < n; i++) {
    const key = dayKey(i);
    hrv.push({ hrvSummary: { calendarDate: key, lastNightAvg: 55 + (i % 10) } });
    rhr.push({ calendarDate: key, metricId: 60, value: 50 + (i % 6) });
    sleep.push({
      calendarDate: key,
      sleepTimeSeconds: opts.sleepSecs !== undefined ? opts.sleepSecs : 27000,
      deepSleepSeconds: 5400, lightSleepSeconds: 12600,
      remSleepSeconds: 7200, awakeSleepSeconds: 1800
    });
    // Peso real de weight-service: TODO en gramos, porcentajes 0-100.
    if (!opts.noWeight) {
      weightList.push({
        samplePk: 1749996902851 + i,
        date: Date.now() - i * 86400000,
        calendarDate: key,
        weight: 70000 + (i % 7) * 500,
        bmi: 22.4,
        bodyFat: 18.5,
        bodyWater: 58.9,
        boneMass: 3400,
        muscleMass: 33000,
        physiqueRating: null,
        visceralFat: 1.2,
        metabolicAge: 31,
        sourceType: 'INDEX_SCALE',
        timestampGMT: Date.now() - i * 86400000,
        weightDelta: 500
      });
    }
    if (i % 2 === 0 && !opts.noLoad) {
      load.push({ startDateLocal: key + ' 08:00:00', activityTrainingLoad: 80 });
      activities.push({
        activityName: 'Ciclismo ' + i, startTimeLocal: key + ' 08:00:00',
        activityType: { typeKey: 'cycling' }, duration: 3600, distance: 30000
      });
    }
  }
  return {
    hrv,
    rhr: { allMetrics: { metricsMap: { WELLNESS_RESTING_HEART_RATE: rhr } } },
    load, sleep, activities,
    weight: {
      startDate: dayKey(n - 1),
      endDate: dayKey(0),
      dateWeightList: weightList,
      totalAverage: {
        from: Date.now() - n * 86400000, until: Date.now(),
        weight: 70400, bmi: 22.4, bodyFat: 18.5, bodyWater: 58.9,
        boneMass: 3400, muscleMass: 33000, physiqueRating: null,
        visceralFat: 1.2, metabolicAge: 31
      }
    }
  };
}

const SYNC_OK = payload => ({
  ok: true, refreshToken: 'refresh-NEW', clientId: 'GARMIN_CONNECT_MOBILE_IOS_DI',
  displayName: 'pardojavi', start: 'x', end: 'y', data: payload
});
const LOGIN_OK = { ok: true, refreshToken: 'refresh-1', clientId: 'CID', displayName: 'pardojavi' };

let syncPayload = makePayload();
let lastFetch = null;

const dom = new JSDOM(html, {
  url: 'https://example.com/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  beforeParse(window) {
    window.fetch = function (url, opts) {
      lastFetch = { url: String(url), opts: opts || {} };
      const u = String(url);
      if (u.indexOf('/garmin') < 0) return Promise.reject(new Error('sin red en tests: ' + u));
      let b = {};
      try { b = JSON.parse((opts && opts.body) || '{}'); } catch (e) { b = {}; }
      const send = (code, obj) => Promise.resolve({ ok: code < 300, status: code, json: () => Promise.resolve(obj) });
      if (b.action === 'login' || b.action === 'mfa') return send(200, LOGIN_OK);
      if (b.action === 'sync') return send(200, SYNC_OK(syncPayload));
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

console.log('\n== Regresión: modo demo ==');
const demo = run('buildDemo()');
eq(demo.today.recoveryScore, 78, 'demo score 78');
eq(demo.today.hrv, 64, 'demo HRV 64');
eq(demo.today.restingHR, 52, 'demo FC 52');
eq(demo.today.sleep, 7.5, 'demo sueño 7.5');
eq(demo.today.tsb, -4, 'demo TSB -4');
eq(demo.week.length, 7, 'demo semana de 7 días');

console.log('\n== Regresión: fmtSleep (1 decimal, sin .0) ==');
eq(run('fmtSleep(7.483333333333333)'), '7.5', '7.483… → "7.5"');
eq(run('fmtSleep(7)'), '7', '7 → "7"');
eq(run('fmtSleep(6.04)'), '6', '6.04 → "6"');
eq(run('fmtSleep(5.55)'), '5.6', '5.55 → "5.6"');
eq(run('fmtSleep(0)'), '&#8211;', '0 = sin datos');
eq(run('fmtSleep(null)'), '&#8211;', 'null = sin datos');

console.log('\n== Garmin: normalizador garminToRows() ==');
w.__payload = makePayload();
const rows = run('garminToRows(window.__payload)');
ok(Array.isArray(rows) && rows.length === 60, '60 filas', rows.length);
const last = rows[rows.length - 1];
eq(last.hrv, 55, 'HRV de hoy');
eq(last.restingHR, 50, 'FC en reposo de hoy');
eq(last.sleep, 7.5, 'sueño en horas, 1 decimal');
eq(last.stages.deep, 1.5, 'fase profundo 1.5 h');
eq(last.stages.light, 3.5, 'fase ligero 3.5 h');
eq(last.stages.rem, 2, 'fase REM 2 h');
eq(last.stages.awake, 0.5, 'fase despierto 0.5 h');
eq(Math.round((last.stages.deep + last.stages.light + last.stages.rem + last.stages.awake) * 10) / 10,
   last.sleep, 'las 4 fases suman exactamente el total');
ok(last.ctl > 0 && last.atl > 0, 'CTL/ATL calculados desde activityTrainingLoad',
   last.ctl + '/' + last.atl);

console.log('\n== Garmin: redondeo de horas ==');
eq(run('sec2h(27600)'), 7.7, '27600 s → 7.7 h');
eq(run('sec2h(27000)'), 7.5, '27000 s → 7.5 h');
eq(run('sec2h(14400)'), 4, '14400 s → 4');
w.__payload2 = makePayload({ sleepSecs: 27600 });
eq(run('garminToRows(window.__payload2)[0].sleep'), 7.7, '27600 s en filas → 7.7 h');

console.log('\n== Garmin: garminFitness() (Banister 42/7) ==');
const fmap = {};
for (let i = 0; i < 60; i++) fmap[dayKey(i)] = 100;
w.__fm = fmap;
w.__fmStart = dayKey(59);
w.__fmEnd = dayKey(0);
const fit = run('garminFitness(window.__fmStart, window.__fmEnd, window.__fm)');
ok(fit && Object.keys(fit).length === 60, '60 días de EMA', fit && Object.keys(fit).length);
const fk = Object.keys(fit).sort().pop();
eq(fit[fk].ctl, 100, 'carga constante → CTL = carga');
eq(fit[fk].atl, 100, 'carga constante → ATL = carga');

console.log('\n== Garmin: actividad al formato de la app ==');
const acts = run('garminActivities(window.__payload)');
ok(acts.length > 0, 'hay actividades', acts.length);
eq(acts[0].name.indexOf('Ciclismo'), 0, 'nombre de la actividad');
ok(/^\d{4}-\d{2}-\d{2} /.test(acts[0].start_date), 'start_date con fecha', acts[0].start_date);

console.log('\n== Garmin: assembleData() con fases REALES ==');
const gd = run('(function(){var r=garminToRows(window.__payload); return assembleData(r, garminActivities(window.__payload));})()');
ok(!!gd, 'assembleData no devuelve null');
eq(gd.today.sleep, 7.5, 'hoy: sueño 7.5');
ok(gd.today.sleepDetail && gd.today.sleepDetail.estimated === false, 'fases NO estimadas',
   gd.today.sleepDetail && gd.today.sleepDetail.estimated);
eq(gd.today.sleepDetail.deep, 1.5, 'detalle: profundo 1.5');
ok(typeof gd.today.recoveryScore === 'number' && gd.today.recoveryScore >= 0 && gd.today.recoveryScore <= 100,
   'score dentro de 0-100', gd.today.recoveryScore);
eq(gd.today.tsb, Math.round((gd.today.ctl - gd.today.atl) * 10) / 10, 'TSB = CTL − ATL');
ok(!!gd.lastActivity, 'última actividad presente');
ok(String(gd.lastActivity.start_date).length >= 10, 'fecha de última actividad', gd.lastActivity.start_date);
eq(Object.keys(gd.dailyMap).length, 60, 'mapa diario completo');

console.log('\n== Garmin: cuenta sin carga (CTL/ATL 0, sin romper) ==');
w.__payload3 = makePayload({ noLoad: true });
const noLoad = run('(function(){var r=garminToRows(window.__payload3); return assembleData(r, garminActivities(window.__payload3));})()');
ok(!!noLoad && noLoad.today.ctl === 0 && noLoad.today.atl === 0, 'CTL/ATL = 0 sin carga',
   noLoad && noLoad.today.ctl);
ok(noLoad.today.sleepDetail.estimated === false, 'las fases siguen siendo reales');

console.log('\n== Garmin: datos basura no lanzan excepción ==');
w.__payload4 = { hrv: [null, {}, { hrvSummary: null }], rhr: {}, sleep: [null], load: [], activities: [] };
eq(run('garminToRows(window.__payload4).length'), 0, 'payload basura → 0 filas');
eq(run('(function(){try{garminToRows({hrv:[{hrvSummary:null}],sleep:[null]});return "no-throw";}catch(e){return "THROW: "+e.message;}})()'),
   'no-throw', 'valores nulos tolerados');

console.log('\n== Garmin: tolerancia a la cápsula de cada endpoint ==');
// HRV envuelto en {hrvData:[{hrvSummary:{…}}]}
w.__sh1 = { hrv: { hrvData: [{ hrvSummary: { calendarDate: dayKey(0), lastNightAvg: 61 } }] } };
eq(run('garminToRows(window.__sh1)[0].hrv'), 61, 'HRV en {hrvData:[…]}');
// HRV como único objeto suelto (un solo día)
w.__sh2 = { hrv: { calendarDate: dayKey(0), hrvSummary: { calendarDate: dayKey(0), lastNightAvg: 59 } } };
eq(run('garminToRows(window.__sh2)[0].hrv'), 59, 'HRV como objeto suelto');
// Sueño en los JSON crudos de cada trozo: [{individualStats:[…]}] (forma del worker)
w.__sh3 = { sleep: [{ individualStats: [{ calendarDate: dayKey(0), sleepTimeSeconds: 28800,
  deepSleepSeconds: 5400, lightSleepSeconds: 14400, remSleepSeconds: 7200, awakeSleepSeconds: 1800 }] }] };
eq(run('garminToRows(window.__sh3)[0].sleep'), 8, 'sueño desde JSON crudo {individualStats:[…]}');
eq(run('garminToRows(window.__sh3)[0].stages.deep'), 1.5, 'fases desde JSON crudo');
// Sueño como único objeto (un solo día) y HRV de respaldo avgSleepHRV
w.__sh4 = { hrv: null, sleep: { individualStats: [{ calendarDate: dayKey(0), sleepTimeSeconds: 27000,
  avgSleepHRV: 63, deepSleepSeconds: 5400, lightSleepSeconds: 12600,
  remSleepSeconds: 7200, awakeSleepSeconds: 1800 }] } };
eq(run('garminToRows(window.__sh4)[0].sleep'), 7.5, 'sueño como objeto único');
eq(run('garminToRows(window.__sh4)[0].hrv'), 63, 'HRV de respaldo = avgSleepHRV');
// FC en reposo como array plano
w.__sh5 = { rhr: [{ calendarDate: dayKey(0), value: 49 }] };
eq(run('garminToRows(window.__sh5)[0].restingHR'), 49, 'FC reposo en array plano');

console.log('\n== Garmin: garminWarn() diagnostica qué endpoint falló ==');
eq(run('garminWarn(null)'), '', 'sin diag → sin aviso');
eq(run('garminWarn({sleepDays:60, hrvDays:60, todaySleep:7.5})'), '', 'todo presente → sin aviso');
const wn = run('garminWarn({sleepDays:0, hrvDays:60, todaySleep:null,' +
               ' hrv:{s:200,k:"array(60)"}, sleep:{s:404,k:"sin-cuerpo"}})');
ok(wn.indexOf('sue') >= 0, 'avisa de que falta sueño', wn);
ok(wn.indexOf('404') >= 0, 'incluye el estado HTTP', wn);
ok(wn.indexOf('HRV') < 0, 'no avisa de HRV si ya hay datos', wn);
const wt = run('garminWarn({sleepDays:59, hrvDays:60, todaySleep:null,' +
               ' sleep:{s:200,k:"individualStats(59)"}})');
ok(wt.indexOf('hoy sin sue') >= 0, 'días previos con sueño pero hoy no → aviso específico', wt);
ok(wt.indexOf('59') >= 0, 'cuenta los días que sí hay', wt);

console.log('\n== Garmin: la noche se atribuye al día en que amaneciste ==');
const todayKey = dayKey(0), ystKey = dayKey(1);
const tparts = todayKey.split('-');
const wakeMs = Date.UTC(+tparts[0], +tparts[1] - 1, +tparts[2], 7, 12, 0);
w.__sh6 = { sleep: [{ individualStats: [{
  calendarDate: ystKey, sleepEndTimestampLocal: wakeMs, sleepTimeSeconds: 27000,
  deepSleepSeconds: 5400, lightSleepSeconds: 12600,
  remSleepSeconds: 7200, awakeSleepSeconds: 1800
}] }] };
const r6 = run('garminToRows(window.__sh6)');
eq(r6.length, 1, 'una sola fila');
eq(r6[0].id, todayKey, 'la noche de anoche cuenta para HOY, no para ayer');
eq(r6[0].sleep, 7.5, 'y con su duración');
w.__sh7 = { sleep: [{ individualStats: [{
  calendarDate: ystKey, sleepEndTimestampLocal: Math.floor(wakeMs / 1000), sleepTimeSeconds: 27000,
  deepSleepSeconds: 5400, lightSleepSeconds: 12600,
  remSleepSeconds: 7200, awakeSleepSeconds: 1800
}] }] };
eq(run('garminToRows(window.__sh7)[0].id'), todayKey, 'timestamp en segundos también vale');
w.__sh8 = { sleep: [{ individualStats: [{
  calendarDate: todayKey, sleepTimeSeconds: 27000,
  deepSleepSeconds: 5400, lightSleepSeconds: 12600,
  remSleepSeconds: 7200, awakeSleepSeconds: 1800
}] }] };
eq(run('garminToRows(window.__sh8)[0].id'), todayKey, 'sin timestamp usa calendarDate');

console.log('\n== Garmin: forma REAL de individualStats (datos dentro de values) ==');
function realSleepRows(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const key = dayKey(i), p = key.split('-');
    // Fin de la noche a las 07:12 hora local (ms cuya lectura UTC ya es local)
    const endMs = Date.UTC(+p[0], +p[1] - 1, +p[2], 7, 12, 0);
    out.push({
      calendarDate: key,
      values: {
        totalSleepTimeInSeconds: 24600,          // = deep+light+rem (sin awake)
        deepTime: 5400, lightTime: 14400, remTime: 4800, awakeTime: 600,
        localSleepEndTimeInMillis: endMs,
        gmtSleepEndTimeInMillis: endMs,
        restingHeartRate: 51, sleepScore: 81, sleepScoreQuality: 'GOOD'
      }
    });
  }
  return out;
}
w.__real = { sleep: [{ calendarDate: 'x',
                       overallStats: { averageSleepScore: 80 },
                       individualStats: realSleepRows(10) }] };
const rreal = run('garminToRows(window.__real)');
eq(rreal.length, 10, '10 noches desde individualStats + values');
eq(rreal[9].sleep, 6.8, 'sueño = values.totalSleepTimeInSeconds (24600 s → 6.8 h)');
eq(rreal[9].id, dayKey(0), 'fechado por localSleepEndTimeInMillis');
eq(rreal[9].stages.deep, 1.5, 'profundo desde values.deepTime');
eq(rreal[9].stages.light, 3.8, 'ligero desde values.lightTime (residual)');
eq(rreal[9].stages.rem, 1.3, 'REM desde values.remTime');
eq(rreal[9].stages.awake, 0.2, 'despierto desde values.awakeTime');
eq(Math.round((rreal[9].stages.deep + rreal[9].stages.light +
               rreal[9].stages.rem + rreal[9].stages.awake) * 10) / 10,
   rreal[9].sleep, 'las 4 fases suman exactamente el total');
eq(rreal[9].restingHR, 51, 'FC reposo desde values.restingHeartRate');
ok(rreal[9].sleep > 0 && rreal.every(r => r.sleep > 0), 'todas las noches con sueño');
w.__fl = run('flattenObj({calendarDate:"2026-10-05", values:{deepTime:100, sleepScore:80}})');
eq(w.__fl.deepTime, 100, 'flattenObj aplanta values');
eq(w.__fl.calendarDate, '2026-10-05', 'flattenObj conserva lo propio');
eq(w.__fl.values.deepTime, 100, 'flattenObj no borra el original');
eq(run('flattenObj({a:1}).a'), 1, 'sin anidados devuelve el mismo objeto');
eq(run('flattenObj([1,2]).length'), 2, 'los arrays no se tocan');
eq(run('flattenObj({a:"propia", n:{a:"anidada", b:"extra"}}).a'), 'propia',
   'lo propio manda sobre lo anidado');
eq(run('flattenObj({a:"propia", n:{a:"anidada", b:"extra"}}).b'), 'extra',
   'lo anidado se a&#241;ade solo si no existe');

console.log('\n== Garmin: garminDiag() resume la sincronización ==');
w.__dg = run('(function(){' +
  'var r=garminToRows(window.__payload); var a=garminActivities(window.__payload);' +
  'return garminDiag({start:"2026-08-01", end:"2026-09-30", diag:{' +
  ' hrv:{s:200,k:"array(60)"}, rhr:{s:200,k:"allMetrics"},' +
  ' acts:{s:200,k:"array(30)"}, load:{s:200,k:"array(30)"},' +
  ' sleep:[{s:200,k:"individualStats(60)"}]}}, r, a);})()');
eq(w.__dg.days, 60, '60 días con dato');
eq(w.__dg.hrvDays, 60, '60 días con HRV');
eq(w.__dg.sleepDays, 60, '60 días con sueño');
eq(w.__dg.rhrDays, 60, '60 días con FC reposo');
eq(w.__dg.todaySleep, 7.5, 'sueño de hoy');
eq(w.__dg.todayHrv, 55, 'HRV de hoy');
ok(String(w.__dg.sleep.k).indexOf('individualStats(60)') >= 0, 'claves del endpoint de sueño',
   w.__dg.sleep.k);
eq(w.__dg.sleep.s, 200, 'HTTP del endpoint de sueño');
eq(run('sleepDiagCell(null, null).k'), 'sin peticiones', 'sin peticiones → aviso explícito');

console.log('\n== UI: selector de fuente ==');
run("pickSource('garmin')");
eq($('form-garmin').style.display, '', 'form Garmin visible');
eq($('form-intervals').style.display, 'none', 'form Intervals oculto');
eq($('src-switch').querySelector('.src-opt.active').getAttribute('data-src'), 'garmin',
   'pestaña Garmin activa');
run("pickSource('intervals')");
eq($('form-garmin').style.display, 'none', 'form Garmin oculto de vuelta');
eq($('form-intervals').style.display, '', 'form Intervals visible de vuelta');

console.log('\n== UI: Ajustes refleja la fuente ==');
run('S.source = "garmin"; S.garmin = {refreshToken:"t", clientId:"c", displayName:"pardojavi"}; renderSettings();');
eq($('display-mode').textContent, 'Garmin Connect', 'Modo = Garmin Connect');
eq($('display-athlete').textContent, 'pardojavi', 'Atleta = displayName de Garmin');
run('S.source = "intervals"; S.athleteId = "i1234567"; renderSettings();');
eq($('display-mode').textContent, 'Intervals.icu', 'Modo = Intervals.icu');
eq($('display-athlete').textContent, 'i1234567', 'Athlete ID');

console.log('\n== UI: panel de diagnóstico Garmin en Ajustes ==');
eq($('diag-card').style.display, 'none', 'oculto si no hay diagnóstico');
eq($('diag-title').style.display, 'none', 'título oculto si no hay diagnóstico');
run('S.source = "garmin"; S.garmin = {refreshToken:"t", clientId:"c",' +
    ' displayName:"pardojavi", diag:' + JSON.stringify(w.__dg) + '}; renderSettings();');
eq($('diag-card').style.display, '', 'visible cuando hay diagnóstico');
ok($('diag-window').textContent.indexOf('2026-08-01') >= 0,
   'muestra la ventana sincronizada', $('diag-window').textContent);
ok($('diag-counts').textContent.indexOf('60') >= 0,
   'muestra los recuentos por señal', $('diag-counts').textContent);
ok($('diag-sleep').innerHTML.indexOf('individualStats(60)') >= 0,
   'muestra estado y claves del endpoint de sueño', $('diag-sleep').innerHTML);
ok($('diag-sleep').innerHTML.indexOf('hoy <b>7.5 h</b>') >= 0,
   'muestra el sueño de HOY', $('diag-sleep').innerHTML);
ok($('diag-hrv').innerHTML.indexOf('hoy <b>55</b>') >= 0,
   'muestra el HRV de HOY', $('diag-hrv').innerHTML);
run('S.source = "intervals"; S.athleteId = "i1234567"; renderSettings();');
eq($('diag-card').style.display, 'none', 'se oculta al volver a Intervals');

console.log('\n== UI: el rótulo de sincronización sigue la fuente ==');
run('(function(){var r=garminToRows(window.__payload);' +
    'S.source="garmin"; S.isDemo=false;' +
    'initApp(assembleData(r, garminActivities(window.__payload)));})()');
ok($('sync-label').textContent.indexOf('Garmin Connect') >= 0,
   'con Garmin dice «Garmin Connect»', $('sync-label').textContent);
run('S.source="intervals"; renderDashboard();');
ok($('sync-label').textContent.indexOf('Intervals.icu') >= 0,
   'con Intervals dice «Intervals.icu»', $('sync-label').textContent);
run('S.source="garmin"; S.isDemo=true; renderDashboard();');
ok($('sync-label').textContent.indexOf('Modo demo') >= 0,
   'en modo demo dice «Modo demo»', $('sync-label').textContent);
run('S.isDemo=false;');

console.log('\n== Errores amables con códigos de Garmin ==');
[['BAD_CREDENTIALS', 'incorrectos'],
 ['RATE_LIMIT', 'limitado'],
 ['CAPTCHA', 'control'],
 ['BLOCKED', 'control'],
 ['REFRESH_FAILED', 'caducado'],
 ['TOKEN_EXCHANGE', 'token de acceso']].forEach(c => {
  const out = run('friendlyError({message:"x", gCode:"' + c[0] + '"})');
  ok(out.indexOf(c[1]) >= 0, c[0] + ' → mensaje amable', out.slice(0, 70));
});
ok(run('friendlyError({message:"NO_DATA_GARMIN"})').indexOf('Garmin') > 0, 'NO_DATA_GARMIN habla de Garmin');
ok(run('friendlyError({message:"Sin proxy: prueba"})').indexOf('wrangler') > 0, 'sin proxy → indica worker');

console.log('\n== UI: hoja de detalle del sueño con datos de Garmin ==');
run('(function(){var r=garminToRows(window.__payload); var d=assembleData(r, garminActivities(window.__payload)); S.logs=[]; initApp(d);})()');
run('showSleepDetail()');
const note = w.document.querySelector('.sl-note');
ok(!!note, 'la hoja se abre y tiene .sl-note');
ok(note && note.textContent.indexOf('informado por tu dispositivo') >= 0,
   'usa fases REALES del dispositivo', note && note.textContent.trim());
ok(note && note.textContent.indexOf('estimaci') < 0, 'NO dice estimación',
   note && note.textContent.trim());
const st = w.document.querySelector('.sheet-title');
ok(st && st.textContent.indexOf('Detalle del sue') >= 0, 'título de la hoja', st && st.textContent);
w.document.querySelectorAll('.sheet-overlay').forEach(el => el.remove());

console.log('\n== fetchGarminData() contra el worker (stub) ==');
run('S.source="garmin"; S.garmin={refreshToken:"refresh-OLD", clientId:"CID", displayName:""};');
syncPayload = makePayload({ days: 45 });
run('window.__fd = null; window.__fdErr = null;');
run('fetchGarminData().then(function(d){ window.__fd = d; }).catch(function(e){ window.__fdErr = String(e && e.message); });');
await wait(60);
eq(run('window.__fdErr'), null, 'sin error en fetchGarminData');
const fd = run('window.__fd');
ok(!!fd && fd.source === 'garmin', 'los datos llevan source=garmin', fd && fd.source);
ok(!!fd && fd.today, 'hay datos de hoy');
ok(!!fd && fd.today.sleepDetail && fd.today.sleepDetail.estimated === false, 'sueño con fases reales vía fetch');
eq(run('S.garmin.refreshToken'), 'refresh-NEW', 'refresh token rotado en memoria');
eq(run('JSON.parse(localStorage.getItem("riq_config")).garmin.refreshToken'), 'refresh-NEW',
   'refresh token rotado en localStorage');
eq(run('JSON.parse(localStorage.getItem("riq_config")).source'), 'garmin', 'config persiste la fuente');
ok(!!lastFetch && lastFetch.url.indexOf(MYPROXY) === 0, 'va a MY_PROXY', lastFetch && lastFetch.url);
ok(!!lastFetch && lastFetch.url.indexOf('/garmin') > 0, 'ruta /garmin', lastFetch && lastFetch.url);
eq(lastFetch.opts.method, 'POST', 'es POST');
const sent = JSON.parse(lastFetch.opts.body);
eq(sent.action, 'sync', 'acción sync');
ok(/^\d{4}-\d{2}-\d{2}$/.test(sent.start) && /^\d{4}-\d{2}-\d{2}$/.test(sent.end),
   'rango de fechas válido', sent.start + ' → ' + sent.end);
ok(run('!!(JSON.parse(localStorage.getItem("riq_config")).garmin || {}).diag'),
   'el diagnóstico queda guardado en localStorage');
eq(run('S.garmin.diag.days'), 45, 'diagnóstico con los 45 días sincronizados');
eq(run('S.garmin.diag.sleepDays'), 45, '45 días con sueño');

console.log('\n== Conexión Garmin (login) ==');
run('S.source="intervals"; S.mfaState=""; S.mfaMethod="";');
$('inp-g-email').value = 'yo@ejemplo.com';
$('inp-g-pass').value = 'secreta';
run('doConnectGarmin()');
await wait(60);
eq(run('S.source'), 'garmin', 'tras conectar, fuente = garmin');
eq(run('S.garmin.displayName'), 'pardojavi', 'displayName guardado');
ok($('app-screen').classList.contains('active'), 'entra en la app');
eq($('inp-g-pass').value, '', 'la contraseña se limpia al conectar');

console.log('\n== MFA: pide código y no conecta hasta recibirlo ==');
run('doLogout();');
eq(run('S.source'), 'intervals', 'cerrar sesión vuelve al valor por defecto');
ok($('setup-screen').classList.contains('active'), 'vuelve a la pantalla de setup');
ok($('form-intervals').style.display === '', 'form Intervals activo tras logout');

w.__mfaOnce = false;
w.fetch = function (url, opts) {
  lastFetch = { url: String(url), opts: opts || {} };
  if (String(url).indexOf('/garmin') < 0) return Promise.reject(new Error('sin red en tests'));
  let b = {};
  try { b = JSON.parse((opts && opts.body) || '{}'); } catch (e) { b = {}; }
  const send = (code, obj) => Promise.resolve({ ok: code < 300, status: code, json: () => Promise.resolve(obj) });
  if (b.action === 'login' && !w.__mfaOnce) {
    w.__mfaOnce = true;
    return send(401, { ok: false, code: 'MFA_REQUIRED', mfaMethod: 'email', mfaState: 'STATE123', error: 'MFA' });
  }
  if (b.action === 'login' || b.action === 'mfa') return send(200, LOGIN_OK);
  if (b.action === 'sync') return send(200, SYNC_OK(makePayload()));
  return send(400, { ok: false, code: 'BAD_ACTION', error: 'x' });
};

run("pickSource('garmin')");
$('inp-g-email').value = 'yo@ejemplo.com';
$('inp-g-pass').value = 'secreta';
run('doConnectGarmin()');
await wait(60);
eq(run('S.mfaState'), 'STATE123', 'guarda el estado MFA');
eq($('field-g-mfa').style.display, '', 'muestra el campo del código');
ok($('hint-g-mfa').textContent.indexOf('email') >= 0, 'indica el método de envío',
   $('hint-g-mfa').textContent);
eq(run('S.source'), 'intervals', 'aún no ha conectado');
$('inp-g-mfa').value = '123456';
run('doConnectGarmin()');
await wait(80);
eq(run('S.source'), 'garmin', 'completado el MFA conecta');
eq(run('S.garmin.refreshToken'), 'refresh-NEW', 'token final tras MFA + sync (rotado)');
eq($('field-g-mfa').style.display, 'none', 'el campo MFA se oculta al terminar');

console.log('\n== restoreSession con config de Garmin ==');
run('doLogout();');
run('localStorage.setItem("riq_config", JSON.stringify({source:"garmin", garmin:{refreshToken:"rt", clientId:"cc", displayName:"pardojavi"}}));');
run('window.__rs = restoreSession();');
await wait(80);
eq(run('window.__rs'), true, 'restoreSession acepta la config Garmin');
eq(run('S.source'), 'garmin', 'fuente restaurada');
ok($('app-screen').classList.contains('active'), 'entra en la app tras restaurar');

console.log('\n== restoreSession con configs inválidas ==');
run('doLogout();');
run('localStorage.setItem("riq_config", JSON.stringify({source:"garmin"}));');
eq(run('restoreSession()'), false, 'config Garmin sin token → false');
run('localStorage.setItem("riq_config", JSON.stringify({source:"intervals", athleteId:"i1"}));');
eq(run('restoreSession()'), false, 'config Intervals sin API key → false');
run('localStorage.setItem("riq_config", JSON.stringify({source:"intervals", athleteId:"i1", apiKey:"k"}));');
eq(run('restoreSession()'), true, 'config Intervals válida → true');
await wait(60);
run('doLogout();');

console.log('\n== Garmin: peso y composición corporal ==');
eq(last.body.weight, 70, 'peso de hoy en kg (la API lo da en gramos)');
eq(last.body.bodyFat, 18.5, 'grasa corporal en %');
eq(last.body.muscle, 33, 'masa magra pasada a kg');
eq(last.body.bone, 3.4, 'masa ósea pasada a kg');
eq(last.body.water, 58.9, 'agua corporal en %');
eq(last.body.bmi, 22.4, 'IMC');
eq(last.body.metAge, 31, 'edad metabólica');
eq(last.body.visceral, 1.2, 'grasa visceral en kg');
eq(run('pickBody({weight:72500, bodyFat:21.9, muscleMass:32800, boneMass:3539, bodyWater:57.1}).weight'),
   72.5, 'pickBody convierte gramos → kg');
eq(run('pickBody({weight:72500}).bodyFat'), undefined, 'pickBody admite campos incompletos');
eq(run('pickBody({bodyFat:0.219}).bodyFat'), 21.9, 'porcentaje en fracción → 0-100');
eq(run('isBodyWrap({dateWeightList:[], totalAverage:{weight:70000}})'), true,
   'el envoltorio con totalAverage se descarta');
eq(run('isBodyWrap({calendarDate:"2026-10-05", weight:70000})'), false,
   'un registro plano sí se acepta');
ok(/^\d{4}-\d{2}-\d{2}$/.test(run('bodyDate({date:1749975276000})')),
   'bodyDate acepta epoch en ms', run('bodyDate({date:1749975276000})'));
eq(run('bodyDate({calendarDate:"2026-10-05", weight:70000})'), '2026-10-05',
   'bodyDate usa calendarDate');

const wBody = run('(function(){' +
  'var d = assembleData(garminToRows(window.__payload), ' +
  'garminActivities(window.__payload)); return d;})()');
ok(wBody.today.weight === 70, 'assembleData expone el peso de hoy',
   wBody.today.weight);
ok(wBody.today.weightBaseline >= 70 && wBody.today.weightBaseline <= 73,
   'baseline = media de la ventana', wBody.today.weightBaseline);
const wKeys = Object.keys(wBody.dailyMap).sort();
const oldest = wBody.dailyMap[wKeys[0]];
eq(oldest.body.weight, 71.5, 'el día más antiguo conserva SU peso (no el totalAverage)');
ok(!wBody.today.body || wBody.today.body.weight !== 70.4,
   'totalAverage NO se cuela como dato de un día');
eq(run('(function(){var g=window.__payload.weight;' +
       'return isBodyWrap(flattenObj(g)) ? 1 : 0;})()'), 1,
   'la respuesta completa se trata como envoltorio');

console.log('\n== UI: tarjeta de Peso en la portada ==');
run('(function(){var r=garminToRows(window.__payload);' +
    'var d=assembleData(r, garminActivities(window.__payload));' +
    'window.__data=d; S.logs=[]; initApp(d); showTab("dashboard");})()');
eq($('metrics-grid').querySelectorAll('.metric').length, 5, '5 tarjetas cuando hay peso');
const wCard = $('metrics-grid').querySelector('[data-metric="weight"]');
ok(!!wCard, 'la tarjeta Peso es pulsable');
ok(wCard && wCard.className.indexOf('span2') >= 0, 'la tarjeta Peso ocupa los dos anchos');
ok($('metrics-grid').textContent.indexOf('Peso') >= 0, 'etiqueta Peso visible');

// Se limpian los overlays anteriores (los tests de restoreSession dejan uno)
w.document.querySelectorAll('.sheet-overlay').forEach(el => el.remove());
run('showWeightDetail()');
const wSheet = w.document.querySelector('.sheet-overlay');
ok(!!wSheet, 'la hoja de Peso se abre');
ok(wSheet && wSheet.textContent.indexOf('Composici') >= 0, 'título de la hoja',
   wSheet && wSheet.textContent.slice(0, 60));
ok(wSheet && wSheet.textContent.indexOf('Masa magra') >= 0, 'desglose de masa magra');
ok(wSheet && wSheet.textContent.indexOf('Grasa corporal') >= 0, 'desglose de grasa');
ok(!!w.document.querySelector('.spark'), 'gráfico de evolución del peso');
ok(!!w.document.querySelector('.spark-legend'), 'mín/media/máx del peso');
w.document.querySelectorAll('.sheet-overlay').forEach(el => el.remove());

console.log('\n== UI: el peso aparece en el detalle del día del calendario ==');
run('showDayDetail(todayKey())');
ok($('day-detail').textContent.indexOf('Peso') >= 0, 'fila Peso en el día',
   $('day-detail').textContent.slice(0, 160));
ok($('day-detail').textContent.indexOf('Grasa corporal') >= 0, 'fila Grasa corporal en el día');
ok($('day-detail').textContent.indexOf('Masa magra') >= 0, 'fila Masa magra en el día');

console.log('\n== UI: Ajustes informa del peso sincronizado ==');
run('S.source="garmin"; S.garmin={refreshToken:"t", clientId:"c",' +
    ' displayName:"pardojavi"}; S.garmin.diag=' +
    JSON.stringify(run('(function(){var r=garminToRows(window.__payload);' +
      'var a=garminActivities(window.__payload);' +
      'return garminDiag({start:"2026-08-01", end:"2026-09-30", diag:{' +
      'weight:{s:200,k:"filas(60){calendarDate,weight,bmi,bodyFat}",n:60}}}, r, a);})()')) +
    '; renderSettings();');
eq(run('S.garmin.diag.bodyDays'), 60, '60 días con peso');
ok($('diag-weight').innerHTML.indexOf('HTTP 200') >= 0, 'fila Peso con estado',
   $('diag-weight').innerHTML);
ok($('diag-counts').textContent.indexOf('peso 60') >= 0,
   'los recuentos incluyen el peso', $('diag-counts').textContent);

console.log('\n== Errores JS tardíos ==');
ok(!$('js-err') || !$('js-err').classList.contains('show'), 'ningún error JS en toda la ejecución',
   $('js-err') && $('js-err').textContent);

console.log('\n---------------------------------------');
console.log('Garmin: ' + pass + ' OK, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
