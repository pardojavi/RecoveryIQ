/* RecoveryIQ — calendario: desplegable de actividades e informe de rendimiento.
   Comprueba que al pulsar un día se ven las métricas de sus sesiones, que el
   botón de informe llama a la IA con el contexto completo (vatios, FC, HRV,
   sueño, FC nocturna, peso…) y que se pueden hacer preguntas de seguimiento. */
import fs from 'fs';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';

const APP = fileURLToPath(new URL('../recovery-app.html', import.meta.url));
const html = fs.readFileSync(APP, 'utf8');

let pass = 0, fail = 0;
const ok = (c, l, x) => {
  if (c) { pass++; console.log('  ok   ' + l); }
  else   { fail++; console.log('  FAIL ' + l + (x !== undefined ? '  → ' + x : '')); }
};
const eq = (a, b, l) => ok(a === b, l, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));

const wait = ms => new Promise(r => setTimeout(r, ms));
const aiCalls = [];
let aiReply = 'Veredicto: has rendido bien.\nVatios: 245 W, por encima de tu media.\nPulso: esfuerzo eficiente.\nRecuperación: HRV y sueño correctos.\nDónde mejorar: hidratación y cadencia.';

const dom = new JSDOM(html, {
  url: 'https://example.com/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  beforeParse(window) {
    window.fetch = function (url, opts) {
      const body = JSON.parse((opts && opts.body) || '{}');
      aiCalls.push({ url: String(url), opts: opts || {}, body });
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ content: [{ type: 'text', text: aiReply }] })
      });
    };
  }
});

const w = dom.window;
const run = c => w.eval(c);
const $ = id => w.document.getElementById(id);
const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

console.log('\n== Arranque y datos de prueba ==');
ok(!$('js-err') || !$('js-err').classList.contains('show'), 'sin errores JS al arrancar',
   $('js-err') && $('js-err').textContent);

// Dos sesiones hoy (ciclismo con potencia + caminata) y otra de ciclismo
// anterior para que haya una media de vatios contra la que contrastar.
const setup = `
  S.logs = [];
  S.isDemo = true;
  var data = buildDemo();
  var tk = todayKey();
  var yesterday = ymd(shiftDays(parseYmd(tk), -1));
  var ride = {
    id:'ride-hoy', type:'Ride', name:'Rodaje con series',
    start_date_local: tk + ' 08:15:00',
    moving_time: 5400, distance: 42000,
    average_heartrate: 148, max_heartrate: 172,
    avg_power: 245, normalized_power: 258, max_power: 410,
    peak_power_1m: 410, peak_power_5m: 330, peak_power_8m: 310,
    peak_power_10m: 300, peak_power_20m: 280, peak_power_1h: 255,
    avg_cadence: 88, average_speed: 7.8, total_elevation_gain: 320,
    calories: 760, kj: 1980, icu_training_load: 82
  };
  var walk = { id:'walk-hoy', type:'walking', name:'Paseo',
               start_date_local: tk + ' 19:00:00', moving_time: 1800,
               distance: 2400, average_heartrate: 98 };
  data.dailyMap[tk].acts = [ride, walk];
  data.dailyMap[tk].body = {weight:72};
  data.dailyMap[tk].minHR = 47;
  data.today.weight = 72;
  data.dailyMap[yesterday].acts = [{
    id:'ride-ayer', type:'Ride', name:'Rodaje suave',
    start_date_local: yesterday + ' 09:00:00', moving_time: 3600,
    avg_power: 205, normalized_power: 210, average_heartrate: 132
  }];
  data.activities = [ride, data.dailyMap[yesterday].acts[0], walk];
  data.today.acts = [ride, walk];
  initApp(data);
  showTab('calendar');
  window.__tk = tk;
`;
run(setup);

console.log('\n== Calendario: semana de lunes a domingo ==');
const dows = [...w.document.querySelectorAll('#cal-grid .cal-dow')].map(e => e.textContent);
eq(dows.join(''), 'LMXJVSD', 'la semana empieza en lunes y acaba en domingo');
const firstDow = new Date(run('S.calY'), run('S.calM'), 1).getDay();
eq($('cal-grid').querySelectorAll('.cal-day.empty').length, (firstDow + 6) % 7,
   'el hueco inicial corresponde a esa semana');

console.log('\n== Desplegable de actividades del día ==');
const cell = w.document.querySelector('.cal-day[data-has="1"][data-key="' + run('window.__tk') + '"]');
ok(!!cell, 'el día de hoy es clicable');
click(cell);
const detail = $('day-detail');
const drop = detail.querySelector('.act-drop');
ok(!!drop, 'aparece el desplegable de actividades');
ok(drop && drop.textContent.indexOf('Actividades de este d') >= 0, 'el título indica cuántas hay');
const items = detail.querySelectorAll('.act-item');
eq(items.length, 2, 'una entrada por actividad');
const text = detail.textContent;
ok(text.indexOf('Rodaje con series') >= 0, 'muestra el nombre de la sesión');
ok(text.indexOf('Potencia media') >= 0 && text.indexOf('245 W') >= 0, 'vatios medios');
ok(text.indexOf('Potencia normalizada') >= 0 && text.indexOf('258 W') >= 0, 'vatios normalizados');
ok(text.indexOf('Watios / kg') >= 0, 'vatios por kilo');
ok(text.indexOf('FC media') >= 0 && text.indexOf('148 bpm') >= 0, 'pulso medio');
ok(text.indexOf('88 rpm') >= 0, 'cadencia');
ok(text.indexOf('42 km') >= 0, 'distancia');
ok(text.indexOf('320 m') >= 0, 'desnivel');
ok(text.indexOf('82') >= 0, 'carga TSS');
ok(text.indexOf('Pico 1 min') >= 0 && text.indexOf('410 W') >= 0, 'pico de 1 minuto');
ok(text.indexOf('Pico 5 min') >= 0 && text.indexOf('330 W') >= 0, 'pico de 5 minutos');
ok(text.indexOf('Pico 8 min') >= 0 && text.indexOf('310 W') >= 0, 'pico de 8 minutos');
ok(text.indexOf('Pico 10 min') >= 0 && text.indexOf('300 W') >= 0, 'pico de 10 minutos');
ok(text.indexOf('Pico 20 min') >= 0 && text.indexOf('280 W') >= 0, 'pico de 20 minutos');
ok(text.indexOf('Pico 1 h') >= 0 && text.indexOf('255 W') >= 0, 'pico de 1 hora');
ok(text.indexOf('Paseo') >= 0, 'la segunda actividad también está');

console.log('\n== Contexto que recibe la IA ==');
const btn = detail.querySelector('.btn-ai');
ok(!!btn, 'hay botón de informe de rendimiento');
click(btn);
await wait(30);
eq(aiCalls.length, 1, 'se ha llamado al proxy de IA');
const call = aiCalls[0];
ok(call.url.indexOf('/ai') >= 0, 'usa el proxy /ai');
eq(call.opts.method, 'POST', 'petición POST');
eq(call.body.max_tokens, 900, 'informe completo con más tokens');
const sys = call.body.system;
ok(sys.indexOf('VATIOS') >= 0, 'pide valorar los vatios');
ok(sys.indexOf('DÓNDE MEJORAR') >= 0, 'pide dónde mejorar');
ok(sys.indexOf('245 W') >= 0, 'incluye la potencia media de la sesión');
ok(sys.indexOf('258 W') >= 0, 'incluye la potencia normalizada');
ok(sys.indexOf('234 W') >= 0, 'incluye la media habitual de ciclismo (258 y 210 → 234)');
ok(sys.indexOf('HRV') >= 0, 'incluye la HRV del día');
ok(sys.indexOf('FC nocturna') >= 0, 'incluye la FC nocturna');
ok(sys.indexOf('FC mínima registrada') >= 0 && sys.indexOf('47 bpm') >= 0,
   'incluye el pulso mínimo');
ok(sys.indexOf('Estado de recuperación') >= 0, 'incluye el estado de recuperación');
ok(sys.indexOf('Picos de potencia') >= 0, 'incluye los picos de potencia');
ok(sys.indexOf('8 min: 310 W') >= 0 && sys.indexOf('1 h: 255 W') >= 0,
   'pasa todos los picos (8 min y 1 h)');
ok(sys.indexOf('picos de 1 min, 5 min, 8 min, 10 min, 20 min y 1 hora') >= 0,
   'el prompt pide analizar los picos');
ok(sys.indexOf('Sueño') >= 0, 'incluye el sueño');
ok(sys.indexOf('Peso registrado') >= 0, 'incluye el peso');
ok(sys.indexOf('W/kg') >= 0, 'incluye vatios por kilo');
eq(call.body.messages[0].role, 'user', 'el historial empieza con usuario');
ok(sys.indexOf('<') < 0, 'el system prompt es texto plano, sin HTML');

console.log('\n== Informe pintado y guardado en caché ==');
await wait(10);
const box = $('day-detail').querySelector('.ai-report');
ok(box && box.textContent.indexOf('has rendido bien') >= 0, 'el informe se muestra en el desplegable');
ok(box && !!box.querySelector('.ai-ask-input'), ' aparece el campo para preguntar');
ok(box && box.querySelectorAll('.ai-quick button').length === 3, 'preguntas rápidas');
ok(run('Object.keys(S.activityReports).length'), 1, 'informe guardado en la sesión');

console.log('\n== Preguntas de seguimiento ==');
const input = box.querySelector('.ai-ask-input');
input.value = '¿Dónde puedo mejorar la potencia?';
click(box.querySelector('.ai-ask-btn'));
await wait(30);
eq(aiCalls.length, 2, 'segunda llamada a la IA');
eq(aiCalls[1].body.max_tokens, 600, 'la pregunta usa menos tokens');
ok(aiCalls[1].body.system.indexOf('ÚLTIMA pregunta') >= 0, 'el prompt pasa a modo pregunta');
const msgs = aiCalls[1].body.messages;
ok(msgs[msgs.length - 1].content.indexOf('Dónde puedo mejorar la potencia') >= 0,
   'la última pregunta llega como mensaje');
ok(msgs.some(m => m.role === 'assistant' && m.content.indexOf('has rendido bien') >= 0),
   'el informe anterior se manda como contexto');
await wait(10);
const box2 = $('day-detail').querySelector('.ai-report');
ok(box2.textContent.indexOf('Tú:') >= 0, 'la pregunta se muestra en el hilo');
ok(box2.textContent.indexOf('has rendido bien') >= 0, 'la respuesta se añade al hilo');

// Pregunta rápida + Enter
const quick = box2.querySelector('.ai-quick button');
click(quick);
await wait(30);
eq(aiCalls.length, 3, 'la pregunta rápida también consulta a la IA');
ok(aiCalls[2].body.messages.slice(-1)[0].content.indexOf('mejorar') >= 0,
   'la pregunta rápida se envía');
await wait(10);
const input2 = $('day-detail').querySelector('.ai-ask-input');
input2.value = '¿Y si hubiera dormido más?';
input2.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
await wait(30);
eq(aiCalls.length, 4, 'Enter en el campo también pregunta');

console.log('\n== El informe sobrevive a repintar el calendario ==');
run('renderCalendar(); showDayDetail(window.__tk);');
const box3 = $('day-detail').querySelector('.ai-report');
ok(box3 && box3.textContent.indexOf('has rendido bien') >= 0, 'el informe sigue visible');
ok(box3 && box3.textContent.indexOf('¿Y si hubiera dormido más?') >= 0,
   'y se conservan las preguntas');

console.log('\n== Datos de Garmin también llegan a la IA ==');
const g = run(`(function(){
  var a = garminActivities({activities:[{
    activityId: 99, activityName:'Ciclismo', startTimeLocal: todayKey()+' 10:00:00',
    activityType:{typeKey:'cycling'}, distance:30000, duration:3600000,
    averageHR:140, maxHR:165, avgPower:230, normalizedPower:238,
    maxPower:380, averageCadence:85, totalElevationGain:120, calories:640,
    trainingLoad:70
  }]});
  var p = actPerf(a[0]);
  return [p.powerAvg, p.powerNp, p.hrAvg, p.cadence, p.elevation, p.calories, p.load];
})()`);
eq(g[0], 230, 'potencia media de Garmin');
eq(g[1], 238, 'potencia normalizada de Garmin');
eq(g[2], 140, 'FC media de Garmin');
eq(g[3], 85, 'cadencia de Garmin');
eq(g[4], 120, 'desnivel de Garmin');
eq(g[5], 640, 'calorías de Garmin');
eq(g[6], 70, 'carga de Garmin');

console.log('\n== Picos desde la curva de potencia ==');
const curvePeaks = run(`(function(){
  var a = {avg_power:200, powerCurve:{
    secs:[60,300,480,600,1200,3600], watts:[400,320,300,290,270,240]
  }};
  return actPerf(a).peaks;
})()`);
eq(curvePeaks[60], 400, 'pico de 1 min desde la curva');
eq(curvePeaks[480], 300, 'pico de 8 min desde la curva');
eq(curvePeaks[3600], 240, 'pico de 1 h desde la curva');
eq(run('peakAtSecs({secs:[60,600],watts:[400,300]}, 300)'), 356,
   'interpolación cuando la curva no trae el punto exacto');
eq(run('peakAtSecs({secs:[60],watts:[400]}, 3600)'), null,
   'sin dato si la sesión duró menos de una hora');
eq(run('curveArrays([{secs:[60],watts:[123]}]).watts[0]'), 123,
   'acepta también una lista de curvas');
eq(run('actPerf({norm_power:222}).powerNp'), 222,
   'normalizada de Intervals.icu (norm_power)');
eq(run('actPerf({icu_weighted_avg_watts:231}).powerNp'), 231,
   'normalizada como icu_weighted_avg_watts');

console.log('\n== Curvas se piden a Intervals.icu ==');
run(`
  window.__curveUrls = [];
  window.__origApiFetch = apiFetch;
  apiFetch = function(url){
    window.__curveUrls.push(url);
    return Promise.resolve({secs:[60,300,480,600,1200,3600],
                            watts:[390,315,295,285,265,235]});
  };
  fetchPeakPowers(S.data, 'Basic prueba').then(function(){ window.__curveDone = true; });
`);
await wait(30);
const curveUrls = run('window.__curveUrls');
eq(run('window.__curveDone'), true, 'termina la carga de curvas');
ok(curveUrls.length === 2, 'pide una curva por sesión de ciclismo (2)', curveUrls.length);
ok(curveUrls[0].indexOf('/activity/ride-hoy/power-curve') >= 0,
   'usa el endpoint de potencia de la actividad');
eq(run('actPerf(S.data.activities[1]).peaks[300]'), 315,
   'la curva descargada se usa en el desplegable y en la IA');
ok(!run('actPerf(S.data.dailyMap[window.__tk].acts[1]).peaks[480]'),
   'la caminata no recibe picos de potencia');
run('apiFetch = window.__origApiFetch');

console.log('\n== Pulso mínimo y picos de Garmin ==');
eq(run(`normalizeRows([{id:todayKey(), min_hr:46, hrv:50}])[0].minHR`), 46,
   'normalizeRows lee min_hr de Intervals.icu');
const gmin = run(`(function(){
  var rows = garminToRows({sleep:[{calendarDate:todayKey(),
    sleepTimeSeconds:28800, minHeartRate:44}]});
  return rows[0].minHR;
})()`);
eq(gmin, 44, 'garminToRows lee la FC mínima del sueño');
const gpeak = run(`(function(){
  var a = garminActivities({activities:[{
    activityId:101, activityName:'Ciclismo', startTimeLocal: todayKey()+' 10:00:00',
    activityType:{typeKey:'cycling'}, avgPower:230, peakPower8m:318
  }]});
  return actPerf(a[0]).peaks[480];
})()`);
eq(gpeak, 318, 'Garmin: pico de 8 minutos normalizado');

console.log('\n== Errores JS ==');
ok(!$('js-err') || !$('js-err').classList.contains('show'), 'ningún error JS',
   $('js-err') && $('js-err').textContent);

console.log('\n---------------------------------------');
console.log('Calendario + IA: ' + pass + ' OK, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
