/* RecoveryIQ — suite de humo: demo, dashboard, calendario, informe, IA, registro */
import fs from 'fs';
import { JSDOM } from 'jsdom';

const APP = '/Users/javier.pardo/RecoveryIQ/recovery-app.html';
const html = fs.readFileSync(APP, 'utf8');

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else      { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  → ' + extra : '')); }
};
const eq = (a, b, label) =>
  ok(a === b, label, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));

let aiCall = null;

const dom = new JSDOM(html, {
  url: 'https://example.com/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  beforeParse(window) {
    window.fetch = function (url, opts) {
      if (String(url).indexOf('/ai') >= 0) {
        aiCall = { url: String(url), opts: opts || {}, body: JSON.parse((opts && opts.body) || '{}') };
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ content: [{ type: 'text', text: 'Respuesta de prueba' }] })
        });
      }
      return Promise.reject(new Error('sin red en tests: ' + url));
    };
  }
});

const w = dom.window;
const run = c => w.eval(c);
const wait = ms => new Promise(r => setTimeout(r, ms));
const $ = id => w.document.getElementById(id);
const txt = id => ($(id) ? $(id).textContent : '');

console.log('\n== Arranque ==');
ok(!$('js-err') || !$('js-err').classList.contains('show'), 'sin errores JS al arrancar',
   $('js-err') && $('js-err').textContent);
eq($('setup-screen').classList.contains('active'), true, 'arranca en la pantalla de conexión');

console.log('\n== Datos demo: valores exactos de la spec ==');
const demo = run('buildDemo()');
eq(demo.today.recoveryScore, 78, 'índice 78');
eq(demo.today.hrv, 64, 'HRV 64');
eq(demo.today.hrvBaseline, 58, 'HRV baseline 58');
eq(demo.today.hrvChange, 10.3, 'HRV +10,3 %');
eq(demo.today.restingHR, 52, 'FC 52');
eq(demo.today.restingHRBaseline, 55, 'FC baseline 55');
eq(demo.today.restingHRChange, -5.5, 'FC −5,5 %');
eq(demo.today.sleep, 7.5, 'sueño 7,5 h');
eq(demo.today.sleepChange, 1, 'sueño +1 h');
eq(demo.today.ctl, 68, 'CTL 68');
eq(demo.today.atl, 72, 'ATL 72');
eq(demo.today.tsb, -4, 'TSB −4');
eq(Object.keys(demo.dailyMap).length, 28, '28 días');
eq(demo.week.length, 7, 'semana de 7');

console.log('\n== Etiquetas y colores por umbral ==');
eq(run('scoreLabel(80)'), 'Excelente', '80 → Excelente');
eq(run('scoreLabel(79)'), 'Buena', '79 → Buena');
eq(run('scoreLabel(65)'), 'Buena', '65 → Buena');
eq(run('scoreLabel(64)'), 'Moderada', '64 → Moderada');
eq(run('scoreLabel(50)'), 'Moderada', '50 → Moderada');
eq(run('scoreLabel(49)'), 'Baja', '49 → Baja');
eq(run('scoreColorHex(80)'), '#22d3a0', '80 → verde');
eq(run('scoreColorHex(78)'), '#60a5fa', '78 → azul');
eq(run('scoreColorHex(55)'), '#fbbf24', '55 → amarillo');
eq(run('scoreColorHex(30)'), '#f87171', '30 → rojo');
ok(run('verdictFor(78).text').indexOf('PUEDE ENTRENAR') >= 0, '78 → PUEDE ENTRENAR');
ok(run('verdictFor(85).text').indexOf('LISTO PARA ENTRENAR') >= 0, '85 → LISTO PARA ENTRENAR');
ok(run('verdictFor(40).text').indexOf('DESCANSO') >= 0, '40 → DESCANSO');

console.log('\n== calcScore recortado a 0–100 ==');
eq(run('calcScore({hrv:100000, restingHR:1, sleep:8, ctl:1000, atl:-1000})'), 100, 'techo 100');
eq(run('calcScore({hrv:1, restingHR:999, sleep:0.5, ctl:0, atl:0})'), 0, 'suelo 0');
eq(run('calcScore(null)'), 0, 'null → 0');

console.log('\n== Normalización del sueño (sleepSecs / sleep) ==');
eq(run('normalizeRows([{id:"2026-01-01", sleepSecs:27000, hrv:60, restingHR:50}])[0].sleep'), 7.5,
   'sleepSecs 27000 → 7,5 h');
eq(run('normalizeRows([{id:"2026-01-01", sleep:6.5, hrv:60}])[0].sleep'), 6.5, 'sleep 6.5 → 6,5 h');
eq(run('normalizeRows([{id:"2026-01-01", hrv:60}])[0].sleep'), null, 'sin sueño → null');
eq(run('normalizeRows(null).length'), 0, 'entrada nula → 0 filas');
eq(run('normalizeRows({wellness:[{id:"2026-01-01", sleep:7, hrv:50}]}).length'), 1,
   'acepta envoltorio {wellness:[…]}');

console.log('\n== Dashboard renderizado ==');
run('S.logs = []; initApp(buildDemo()); showTab("dashboard");');
eq($('score-num').textContent, '78', 'círculo con el 78');
ok($('score-status').textContent.indexOf('Buena') >= 0, 'estado del círculo (78 → Buena)',
   $('score-status').textContent);
ok($('score-desc').textContent.length > 10, 'descripción del score');
eq($('metrics-grid').querySelectorAll('.metric').length, 4, '4 tarjetas de métrica');
ok($('metrics-grid').textContent.indexOf('Sue') >= 0, 'hay tarjeta de Sueño');
eq($('week-chart').children.length, 7, 'gráfico de 7 días');
eq($('week-dots').children.length, 7, '7 puntos de la semana');
ok($('insights-list').children.length > 0, 'hay conclusiones automáticas');

console.log('\n== Navegación por pestañas ==');
['calendar', 'report', 'ai', 'log', 'settings', 'dashboard'].forEach(t => {
  run('showTab("' + t + '")');
  const el = $('tab-' + t);
  eq(el.classList.contains('active'), true, 'tab-' + t + ' activo');
  const others = w.document.querySelectorAll('.tab-content.active');
  eq(others.length, 1, 'solo un tab activo (' + t + ')');
  const nav = w.document.querySelector('.nav-item[data-tab="' + t + '"]');
  if (t === 'settings') ok(!nav, 'Ajustes no está en la barra inferior (va por ⚙️)');
  else eq(!!nav && nav.classList.contains('active'), true, 'nav-item activo (' + t + ')');
});

console.log('\n== Calendario ==');
run('showTab("calendar")');
const cy = run('S.calY'), cm = run('S.calM');
const now = new Date();
const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const demoStart = new Date(today0.getTime());
demoStart.setDate(demoStart.getDate() - 27);
let expected = 0;
const cur = new Date(cy, cm, 1);
const monthEnd = new Date(cy, cm + 1, 0);
while (cur <= monthEnd) {
  if (cur >= demoStart && cur <= today0) expected++;
  cur.setDate(cur.getDate() + 1);
}
eq($('cal-grid').querySelectorAll('.cal-day[data-has]').length, expected,
   'días con datos en el mes actual (' + expected + ')');
ok(txt('cal-title').length > 2, 'título de mes', txt('cal-title'));
const sepTitle = txt('cal-title');
run('$("cal-prev").click()');
ok(txt('cal-title') !== sepTitle, 'navega al mes anterior', sepTitle + ' → ' + txt('cal-title'));
run('$("cal-next").click()');
eq(txt('cal-title'), sepTitle, 'vuelve al mes actual');

console.log('\n== Detalle de un día ==');
const tk = run('todayKey()');
run('showDayDetail("' + tk + '")');
eq($('day-detail').classList.contains('hidden'), false, 'el detalle se abre');
ok($('day-detail').textContent.indexOf('Recuperaci') >= 0, 'muestra la recuperación del día');
ok($('day-detail').textContent.indexOf('TSB') >= 0, 'muestra TSB');
ok($('day-detail').textContent.indexOf('7.5') >= 0, 'muestra el sueño redondeado',
   $('day-detail').textContent.slice(0, 160));
run('showDayDetail("1999-01-01")');
eq($('day-detail').classList.contains('hidden'), true, 'día sin datos → oculto');

console.log('\n== Informe ==');
run('showTab("report")');
ok(txt('report-verdict').indexOf('PUEDE ENTRENAR') >= 0, 'veredicto 78 → PUEDE ENTRENAR',
   txt('report-verdict'));
ok(txt('report-date').length > 3, 'fecha del informe', txt('report-date'));
ok($('report-bars').children.length > 0, 'barras del informe');
const bars = $('report-bars').textContent;
ok(bars.indexOf('HRV') >= 0 && bars.indexOf('Sue') >= 0, 'barras HRV y sueño');

console.log('\n== Informe: estado de forma y rendimiento ==');
ok(txt('report-form').length > 50, 'la sección se pinta', txt('report-form').slice(0, 60));
const ftxt = $('report-form').textContent;
ok($('report-form').querySelector('.f-index').textContent.indexOf('86') === 0,
   'índice de forma 86', $('report-form').querySelector('.f-index').textContent);
ok($('report-form').querySelector('.f-level').textContent.indexOf('En gran forma') >= 0,
   'nivel "En gran forma"', $('report-form').querySelector('.f-level').textContent);
ok(ftxt.indexOf('CTL') >= 0, 'muestra CTL');
ok(ftxt.indexOf('ATL') >= 0, 'muestra ATL');
ok(ftxt.indexOf('TSB') >= 0, 'muestra TSB');
ok(ftxt.indexOf('0.94') >= 0, 'ratio CTL/ATL con 2 decimales', ftxt.match(/[\d.]+/g));
ok(ftxt.indexOf('Sueño medio') >= 0, 'muestra el sueño medio');
eq($('report-form').querySelectorAll('.fstat').length, 6, '6 estadísticas');
ok($('report-recs').children.length > 0, 'recomendaciones');

console.log('\n== Chat IA sin configurar ==');
run('MY_AI_PROXY = null; S.chatHistory = []; $("chat-msgs").innerHTML = ""; sendChat("hola");');
const msgs = w.document.querySelectorAll('.msg.ai .msg-bubble');
ok(msgs.length > 0, 'responde aunque no haya proxy');
ok(msgs[msgs.length - 1].textContent.indexOf('no est') >= 0,
   'explica que falta MY_AI_PROXY', msgs[msgs.length - 1].textContent.slice(0, 70));

console.log('\n== buildApiMessages: saneado para Anthropic ==');
run('window.__am = (function(){' +
    'S.chatHistory=[{role:"assistant",content:"x"},{role:"user",content:"a"},' +
    '{role:"assistant",content:"b"},{role:"user",content:"c"}];' +
    'return buildApiMessages();})()');
const am = run('window.__am');
eq(am[0].role, 'user', 'no empieza por assistant');
eq(am.length, 3, 'mensajes saneados (4 → 3)', am.length);
ok(am.every(m => m.role === 'user' || m.role === 'assistant'), 'roles válidos');

console.log('\n== Chat IA con proxy: payload correcto ==');
run('MY_AI_PROXY = "https://example.test/ai"; S.chatHistory = [{role:"assistant",content:"Bienvenido"}];' +
    ' $("chat-msgs").innerHTML = ""; sendChat("¿Puedo entrenar fuerte hoy?");');
await wait(60);
ok(!!aiCall, 'se llamó a MY_AI_PROXY', aiCall && aiCall.url);
eq(aiCall.opts.method, 'POST', 'es POST');
eq(aiCall.body.model, 'claude-sonnet-4-20250514', 'modelo Claude');
eq(aiCall.body.max_tokens, 600, 'max_tokens 600');
ok(typeof aiCall.body.system === 'string' && aiCall.body.system.indexOf('Índice de recuperación') >= 0,
   'system prompt en texto plano con los datos del día',
   String(aiCall.body.system).slice(0, 60));
ok(aiCall.body.system.indexOf('<b>') < 0, 'el system prompt no lleva HTML');
ok(Array.isArray(aiCall.body.messages), 'messages es un array');
eq(aiCall.body.messages[0].role, 'user', 'primer mensaje role=user');
ok(aiCall.body.messages.length <= 10, 'historial limitado a 10', aiCall.body.messages.length);
ok(aiCall.body.messages.every((m, i) => i > 0 || m.role === 'user'),
   'sin mensajes assistant iniciales');
const aiMsgs = w.document.querySelectorAll('.msg.ai .msg-bubble');
ok(aiMsgs[aiMsgs.length - 1].textContent.indexOf('Respuesta de prueba') >= 0,
   'la respuesta se pinta en el chat');
eq(run('S.chatHistory[S.chatHistory.length-1].content'), 'Respuesta de prueba',
   'la respuesta se guarda en el historial');

console.log('\n== Registro subjetivo ==');
run('showTab("log")');
eq(run('readLogForm().fatigue'), null, 'form vacío al empezar');
w.document.querySelector('.rating-row[data-field="fatigue"] .rating-btn[data-val="4"]').click();
w.document.querySelector('.rating-row[data-field="sleepQ"] .rating-btn[data-val="5"]').click();
w.document.querySelector('.rating-row[data-field="mood"] .rating-btn[data-val="3"]').click();
w.document.querySelector('.rating-row[data-field="stress"] .rating-btn[data-val="2"]').click();
eq(run('readLogForm().fatigue'), 4, 'cansancio = 4');
eq(run('readLogForm().sleepQ'), 5, 'sueño = 5');
eq(run('readLogForm().mood'), 3, 'ánimo = 3');
eq(run('readLogForm().stress'), 2, 'estrés = 2');

const pains = () => w.document.querySelector('.tags-row[data-field="pains"]');
pains().querySelector('[data-val="Piernas"]').click();
ok(pains().querySelector('[data-val="Piernas"]').classList.contains('selected'), 'marca Piernas');
pains().querySelector('[data-val="Ninguno"]').click();
eq(pains().querySelectorAll('.selected').length, 1, '"Ninguno" deselecciona lo demás');
eq(pains().querySelector('[data-val="Ninguno"]').classList.contains('selected'), true,
   '"Ninguno" queda marcado');
pains().querySelector('[data-val="Rodillas"]').click();
eq(pains().querySelector('[data-val="Ninguno"]').classList.contains('selected'), false,
   'otro síntoma quita "Ninguno"');
eq(pains().querySelector('[data-val="Rodillas"]').classList.contains('selected'), true,
   'y marca el nuevo');
eq(run('readLogForm().pains.length'), 1, 'una sola molestia');

$('log-notes').value = '  buen día  ';
run('saveLog()');
let logs = JSON.parse(w.localStorage.getItem('riq_logs'));
eq(logs.length, 1, 'registro guardado en localStorage');
eq(logs[0].notes, 'buen día', 'notas recortadas');
eq(logs[0].pains[0], 'Rodillas', 'molestia guardada');
eq(logs[0].recoveryScore, 78, 'score del día guardado con el registro');
eq(run('readLogForm().fatigue'), null, 'formulario reseteado tras guardar');
eq($('log-notes').value, '', 'notas borradas');
ok($('log-history').children.length > 0, 'aparece en el historial');
eq($('display-log-count').textContent, '1', 'Ajustes muestra 1 registro');

run('resetLogForm(); saveLog();');
logs = JSON.parse(w.localStorage.getItem('riq_logs'));
eq(logs.length, 1, 'form vacío → no guarda nada');

console.log('\n== Errores JS al final ==');
ok(!$('js-err') || !$('js-err').classList.contains('show'), 'ningún error JS',
   $('js-err') && $('js-err').textContent);

console.log('\n---------------------------------------');
console.log('Humo: ' + pass + ' OK, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
