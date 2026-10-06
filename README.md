# RecoveryIQ 3.0.0

App de recuperación deportiva para iPhone (PWA) conectada a la API de **Intervals.icu**.
Combina métricas objetivas (HRV, FC en reposo, sueño, carga de entrenamiento) con tus
registros subjetivos para calcular un **Índice de Recuperación de 0 a 100** y darte
recomendaciones diarias.

> Idioma de la app: **Español** · Compatibilidad prioritaria: **iPhone Safari (PWA)**,
> Chrome Android, Chrome Desktop.

---

## 1. Archivos

| Archivo | Descripción |
|---|---|
| `recovery-app.html` | La app completa (HTML + CSS + JS en un único archivo) |
| `proxy.php` | Proxy servidor-a-servidor para la API de Intervals.icu (evita CORS) |
| `proxy-ai.php` | Proxy para la API de Claude/Anthropic (chat IA) |
| `proxy-ai-config.example.php` | Plantilla: cópiala a `proxy-ai-config.php` y pon ahí tu key |
| `worker.js` + `wrangler.toml` | Alternativa sin PHP (Cloudflare Workers): proxy de Intervals.icu, conexión con Garmin Connect (§4.5) e IA |
| `tests/` | Suites de jsdom: `test-smoke.mjs` y `test-garmin.mjs` (§9) |
| `apple-touch-icon.png` | Icono 180×180 que muestra iOS al añadir a pantalla de inicio |
| `.gitignore` | Impide subir `.DS_Store` y las API keys a GitHub |

No hay build, ni npm, ni framework: se sube tal cual.

---

## 0. ¿Desde GitHub?

**GitHub Pages sirve HTML estático por HTTPS, pero no ejecuta PHP.** Así que:

| Qué | ¿Funciona en Pages? |
|---|---|
| `recovery-app.html` (app, dashboard, calendario, informe, registro, ajustes) | ✅ Sí, todo |
| Modo demo | ✅ Sí |
| Instalar como PWA en el iPhone | ✅ Sí |
| Conectar con tu cuenta de **Intervals.icu** | ✅ Sí, vía `worker.js` |
| Conectar con tu cuenta de **Garmin Connect** | ✅ Sí, vía `worker.js` (§4.5) |
| Chat con **IA** | ✅ Sí, **gratis** con Workers AI (§4.4) |

**Esta app ya está desplegada**: `MY_PROXY` apunta a
`https://recoveryiq-proxy.ecovery.workers.dev`, un Cloudflare Worker creado a
partir de `worker.js` de este repo.

> Si clonas el repo para publicarlo en tu propia cuenta, despliega **tu** worker
> (`wrangler deploy`) y cambia `MY_PROXY` por tu URL. Si dejas la de otro
> proyecto — o pones `var MY_PROXY = 'proxy.php';` — recibirás un 404 y no
> conectará.
>
> `proxy.php` y `proxy-ai.php` siguen siendo válidos para quien prefiera alojar
> la app entera en un hosting con PHP (§4) en lugar de en Pages.

---

## 2. Instalar en el iPhone (30 segundos)

1. Sube los 3 archivos a un servidor **HTTPS** (ver §4).
2. En el iPhone, abre Safari y ve a `https://tudominio.com/recovery-app.html`
3. **Compartir → Añadir a pantalla de inicio** (el botón de cuadrado con flecha).
4. Abre **RecoveryIQ** desde el icono: se ejecuta a pantalla completa, sin barra de
   Safari, con safe areas para notch / Dynamic Island / home indicator.

> Los meta tags `apple-mobile-web-app-capable` y `viewport-fit=cover` ya están
> incluidos. **No se usa Service Worker**: la app funciona online y guarda la sesión
> y los registros en `localStorage`.

---

## 3. Conectar tus datos

La app tiene **dos vías de obtención de información**: Intervals.icu y Garmin
Connect. Eliges una en la pantalla de inicio (las pestañas de arriba) y puedes
cambiar de una a otra cuando quieras haciendo **Cerrar sesión** y volviendo a
conectar.

### 3.1 Intervals.icu

1. En Intervals.icu: **Perfil → Configuración → API** y copia la **API key**.
2. Tu **Athlete ID** empieza siempre por `i` (ej: `i1234567`).
3. En la app: pega ambos campos → **Conectar y Continuar**.

La app descarga **60 días** de `wellness` y `activities`, calcula las medias de
referencia y renderiza el dashboard.

### 3.2 Garmin Connect

1. En la app: pestaña **Garmin Connect** → email y contraseña de tu cuenta Garmin
   → **Conectar con Garmin**.
2. Si tu cuenta tiene verificación en dos pasos, la app te pide el **código de 6
   dígitos** y lo introducirá en el mismo sitio.
3. Descarga los últimos 60 días y ya está.

Requiere que `worker.js` esté desplegado (§4.3), porque el login de Garmin se
hace en servidor: no puede hacerse desde el navegador. Ver **§4.5** para qué da
y qué no da esta vía.

¿Aún no quieres conectar? Botón **«Probar con datos demo»**: 28 días de datos
de ejemplo (HRV 64 ms, FC 52 bpm, sueño 7,5 h, TSB −4, índice **78/100**).

---

## 4. Despliegue

Necesitas un hosting con **PHP 8.0+** y **HTTPS** (HTTPS es obligatorio para la PWA
y para que el navegador permita `fetch`).

```bash
scp recovery-app.html proxy.php proxy-ai.php apple-touch-icon.png \
    usuario@tudominio:/var/www/html/
```

Alternativas sin servidor propio: Railway, Render, Fly.io, DigitalOcean App Platform,
o cualquier hosting compartido con PHP.

### 4.1 `MY_PROXY` (obligatorio)

Dentro de `recovery-app.html`, al principio del `<script>`. El valor por defecto
ya apunta al worker desplegado:

```js
var MY_PROXY = 'https://recoveryiq-proxy.ecovery.workers.dev';   // Cloudflare Worker (actual)
// var MY_PROXY = 'proxy.php';                                     // si PHP y HTML van juntos
// var MY_PROXY = 'https://tudominio.com/proxy.php';               // PHP en otro sitio
```

Si `MY_PROXY` no funciona, la app intenta un fallback público
(`api.allorigins.win`) que **no** reenvía tu API key, así que fallará casi siempre.
El proxy propio es, por tanto, imprescindible.

### 4.2 `MY_AI_PROXY` — API de Anthropic (opcional y de pago)

> ⚠️ **La API de Anthropic no tiene nivel gratuito.** Si no quieres gastarte
> nada, usa **Workers AI** (§4.4) — es gratis y es lo que ya viene configurado
> en esta app.

1. Copia la plantilla y pon ahí tu key:
   ```bash
   cp proxy-ai-config.example.php proxy-ai-config.php
   # edita proxy-ai-config.php y pon tu sk-ant-...
   ```
   (`proxy-ai-config.php` está en `.gitignore`: **no se sube a GitHub**.)
   También funciona con la variable de entorno `ANTHROPIC_API_KEY`.
2. Súbelo junto al resto.
3. En `recovery-app.html`:
   ```js
   var MY_AI_PROXY = 'proxy-ai.php';
   ```

Mientras `MY_AI_PROXY` sea `null`, el chat muestra un mensaje de configuración y
**el resto de la app funciona con normalidad**.

### 4.3 Opción GitHub Pages: Cloudflare Workers (sin PHP)

1. **Publica la app en Pages**
   - Sube el repo a GitHub (ya existe: `pardojavi/RecoveryIQ`).
   - *Settings → Pages → Source: Deploy from a branch → main / (root)* → Save.
   - En un minuto estará en `https://pardojavi.github.io/RecoveryIQ/`.

2. **Despliega el proxy** (cuenta gratuita de Cloudflare, sin tarjeta)
   ```bash
   npm i -g wrangler
   wrangler login
   wrangler deploy
   ```
   Te devuelve una URL tipo `https://recoveryiq-proxy.tu-subdomino.workers.dev`.

3. **Configura la app** al principio del `<script>` de `recovery-app.html`:
   ```js
   var MY_PROXY    = 'https://recoveryiq-proxy.tu-subdomino.workers.dev';
   var MY_AI_PROXY = 'https://recoveryiq-proxy.tu-subdomino.workers.dev/ai';
   ```

4. *(Opcional)* Si prefieres la API de pago de Claude en lugar de Workers AI:
   ```bash
   wrangler secret put ANTHROPIC_API_KEY
   ```
   El worker le da prioridad automáticamente, sin tocar nada más.

`worker.js` replica la lógica de `proxy.php`: mismos parámetros `url` y `auth`,
misma whitelist estricta a `https://intervals.icu/api/`, más la ruta `/ai`.
La API key de Anthropic vive en un **secreto** de Cloudflare, nunca en el repo.

### 4.4 Chat IA **gratuito** con Workers AI (el que usa esta app)

La API de Anthropic es de pago, así que por defecto el worker no la usa: la
ruta `/ai` llama a **Workers AI**, que ya viene incluido en tu cuenta de
Cloudflare.

| | |
|---|---|
| **Coste** | **0 €** — 10.000 *neurons*/día incluidos en el plan Free |
| **Tarjeta** | No hace falta. Y en plan Free **no se puede facturar de más**: si te pasas de la cuota, las llamadas fallan |
| **Reset** | Diario, a las 00:00 UTC |
| **Modelo por defecto** | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` |

Estimación de mensajes al día gratis (800 tokens de entrada + 300 de salida
por mensaje):

| Modelo | Msg/día |
|---|---|
| `@cf/qwen/qwen3-30b-a3b-fp8` | ~778 |
| `@cf/meta/llama-3.1-8b-instruct-fp8` | ~529 |
| `@cf/mistralai/mistral-small-3.1-24b-instruct` | ~245 |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` ← por defecto | ~120 |

Para cambiar de modelo, edita `WORKERS_AI_MODEL` en `worker.js` y vuelve a
desplegar (`wrangler deploy`). El binding ya está en `wrangler.toml`:

```toml
[ai]
binding = "AI"
```

Y en `recovery-app.html`:

```js
var MY_AI_PROXY = 'https://recoveryiq-proxy.tu-subdomino.workers.dev/ai';
```

**El worker devuelve el formato de respuesta de Anthropic**, así que la app no
distingue entre uno y otro: si algún día creas el secreto `ANTHROPIC_API_KEY`,
pasas a usar Claude sin modificar nada más.

> ⚠️ Un detalle que costó encontrar: en workers con sintaxis de **ES module**
> los secretos llegan en el objeto `env` del handler, **no** como variables
> globales (eso solo vale en el formato *service worker*). Escribir
> `typeof ANTHROPIC_API_KEY !== 'undefined'` devuelve siempre `false` y el
> worker responde "Falta el secreto" aunque exista.

---

### 4.5 Segunda vía: Garmin Connect (la que implementa la app)

Recupera del sitio de desarrolladores de Garmin que hay **dos programas
distintos**:

| Programa | ¿Quién entra? | ¿Da datos de salud? |
|---|---|---|
| **Connect IQ** (caras de reloj, apps de tienda) | Cualquiera, abierto | ❌ No |
| **Garmin Connect Developer Program** (*Health API*) | Empresas, con solicitud (§4.6) | ✅ Sí, pero hay que esperar |

RecoveryIQ añade **una tercera opción pragmática**: la misma vía de acceso que
usa la app oficial de Garmin Connect en el móvil, reproducida en `worker.js`.
Funciona hoy con tu cuenta personal y sin esperar a nadie.

**Flujo de autenticación** (idéntico al de la app oficial):

```
POST sso.garmin.com/mobile/api/login          → serviceTicketId
POST diauth.garmin.com/…/oauth/token          → access + refresh token
GET  connectapi.garmin.com/…                  → datos
```

Si tu cuenta tiene verificación en dos pasos, la app recibe `MFA_REQUIRED`, te
pide el código de 6 dígitos y lo manda con `POST sso.garmin.com/mobile/api/mfa/verifyCode`.

**Datos que recupera y qué le aporta a RecoveryIQ:**

| Dato | Endpoint | ¿Intervals.icu lo da? |
|---|---|---|
| HRV nocturno | `/hrv-service/hrv/daily/{ini}/{fin}` | ✅ |
| FC en reposo | `/userstats-service/wellness/daily/…?metricId=60` | ✅ |
| Sueño total | `/sleep-service/stats/sleep/daily/{a}/{b}` | ✅ |
| **Fases: profundo · ligero · REM · despierto** | ídem (`deepSleepSeconds`, `remSleepSeconds`…) | ❌ **Solo Garmin** |
| Carga de entrenamiento por actividad | `/fitnessstats-service/activity/all?metric=activityTrainingLoad` | ✅ |
| Actividades recientes | `/activitylist-service/activities/search/activities` | ✅ |

**Son 8 peticiones por sincronización** (perfil, HRV por rango, FC reposo por
rango, carga, actividades y 3 trozos de sueño de 28 días — ese endpoint tiene
límite de 28 días). El límite del plan Free de Workers son 50 subpeticiones por
invocación, así que hay margen de sobra.

**CTL / ATL / TSB.** Garmin no expone CTL/ATL como tal, así que se calculan en
`garminToRows()` con **el mismo modelo de Banister que usa Intervals.icu**:

```
CTL = media móvil exponencial de la carga con constante 42 días
ATL = lo mismo con constante 7 días
TSB = CTL − ATL
```

Se siembra EMA con la media del propio rango para no arrancar desde 0. Si la
cuenta no devuelve `activityTrainingLoad` (sin entrenos aún), CTL/ATL quedan en
0 y el indicador de forma del Informe lo reflejará.

**Con Garmin, la hoja de detalle del sueño muestra fases reales** en lugar del
reparto estimado (§6): las cuatro barras pasan de «estimación» a «informado
por tu dispositivo».

**Riesgos, límites y coste** — esto hay que leerlo antes de conectar:

- **No oficial.** No está respaldada por Garmin. Si cambian un endpoint deja de
  funcionar; es lo que le pasa continuamente a `python-garminconnect`
  (3.100 ★), que se actualiza a menudo.
- **Uso personal.** No la montes para un servicio con usuarios propios; para
  eso está la vía oficial (§4.6).
- **El `refresh_token` da acceso a tu cuenta Garmin.** Vive en el
  `localStorage` del dispositivo (el mismo sitio donde ya está tu API key de
  Intervals.icu) y se borra con **Cerrar sesión**. Si crees que se filtró,
  cambia la contraseña de Garmin Connect: eso revoca los tokens.
- **Tu contraseña no se guarda**: se usa una sola vez para obtener el token.
- **Rate limit / anti-bots.** Si Garmin bloquea el intento, el worker responde
  `RATE_LIMIT` o `CAPTCHA`. Solución: entra una vez a mano en
  `connect.garmin.com` desde tu navegador y reintenta unos minutos después,
  desde otra red si puedes.
- **Coste: 0 €.** No hay intermediario ni cuota: son llamadas a la API de
  Garmin. Y la sincronización no consume neurons de Workers AI (eso solo lo usa
  el chat).

---

### 4.6 Vía oficial: Garmin Health API (por si te aprueban)

Si prefieres la vía legal y estable, o si algún día tu proyecto es un negocio,
esto es lo que hay que hacer. **Se puede pedir en paralelo**: es gratis, no
compite con lo anterior y la respuesta llega en dos días.

1. Documentación: <https://developer.garmin.com/gc-developer-program/health-api/>
   y FAQ del programa: <https://developer.garmin.com/gc-developer-program/program-faq/>
2. Solicitud: rellena el formulario de *wellness partner*
   <https://www.garmin.com/forms/wellnesspartner/> (o el botón **REQUEST**
   desde la página del programa).
3. Garmin confirma el estado **en 2 días hábiles** e invita a una *integration
   call*. Después te dan un entorno de evaluación; una integración típica
   tarda **1 a 4 semanas**.
4. Es **OAuth 2.0 de servidor a servidor** con consentimiento del usuario final
   (el usuario aprueba la conexión en una página de Garmin), y Garmin *empuja*
   los datos a tu endpoint por webhook.

Condiciones oficiales, literales:

| | |
|---|---|
| Coste de licencia | *"There are no licensing or maintenance fees"* |
| Destinatario | *"…but it is **only for business use**"* / *"available for **enterprise use**"* |
| Datos | Sueño (con fases), FC, estrés, Body Battery, SpO2, pasos, actividad |

> No confundas de nuevo: solicitar **Connect IQ** no te da acceso a estos datos.
> La FAQ del programa lo dice: *"One does not require the use of the other."*

**Si te aprueban, no hay que rehacer la app.** El contrato interno ya está
aislado: `garminToRows(g)` recibe un objeto con `hrv`, `rhr`, `sleep`, `load` y
`activities` y devuelve las `rows` que consume `assembleData()`. Bastaría con
cambiar `garminSync()` del worker (o añadir un `action: 'sync_official'` con el
token OAuth 2.0) para que la app ni se entere.

---

## 5. ⚠️ Seguridad — léelo

`proxy.php` recibe la API key de Intervals.icu en la **query string**
(`?auth=Basic...`). Es el diseño de la spec y funciona en cualquier hosting, pero
implica que **la key aparece en los logs de acceso del servidor, del CDN y del
proxy**.

Recomendaciones:

- Activa **HTTPS** siempre (ya obligatorio).
- Usa una API key de Intervals.icu **solo para esta app**, revócala si sospechas.
- **La API key de Anthropic NO se guarda en el repo**: va en
  `proxy-ai-config.php` (ignorado por git) o en una variable de entorno /
  secreto. `proxy-ai.php` y `worker.js` pueden subirse a GitHub sin riesgo.
- `proxy.php` y `worker.js` solo aceptan URLs que empiezan por
  `https://intervals.icu/api/` (validación estricta), así que no pueden usarse
  como proxy abierto.
- Las credenciales del atleta se guardan en `localStorage` del propio dispositivo
  y se borran con **Cerrar sesión**.
- **Garmin (§4.5)**: la contraseña **no se guarda** en ningún sitio; se usa una
  sola vez en el worker para obtener el `refresh_token`, y ese token es lo que
  se persiste en `localStorage`. Si lo pierdes, cambia la contraseña de Garmin
  Connect para revocarlo. La ruta `/garmin` del worker solo acepta tres
  acciones (`login`, `mfa`, `sync`) y valida el formato de fechas, así que no
  es un proxy abierto.
- Si usas Cloudflare Workers, protege la ruta `/ai` si no quieres que alguien
  gaste tus tokens: añade un `if (!request.headers.get('X-RecoveryIQ')) ...`
  o activa *Cloudflare Access*.

---

## 6. Estructura de la app

Cinco pestañas en la barra inferior + Ajustes (desde el ⚙️ de arriba):

| Pestaña | Contenido |
|---|---|
| 🏠 **Inicio** | Círculo de índice (conic-gradient), pills de tendencia, gráfico de 7 días, 4 métricas, conclusiones automáticas. El cuadro de **Sueño es clicable** y abre su detalle por fases |
| 📅 **Calendario** | Mes completo coloreado por score, detalle por día (wellness + registro subjetivo) |
| 🏁 **Informe** | Veredicto (🟢🟡🟠🔴), barras HRV/sueño/global, **estado de forma y rendimiento** (índice 0–100, CTL/ATL/TSB, ratio, narrativa), recomendaciones por rango |
| 🤖 **IA** | Chat con Claude, 5 preguntas rápidas, system prompt con tus datos del día (incluidas las fases del sueño) |
| 📝 **Registrar** | Cansancio, ánimo, estrés, calidad de sueño, molestias, salud, notas |
| ⚙️ **Ajustes** | Fuente activa (Intervals.icu / Garmin), sincronizar, nº de registros, versión, cerrar sesión |

#### Fuente de datos

La pantalla de conexión tiene un selector con las **dos vías**: `Intervals.icu`
y `Garmin Connect` (§4.5). Solo se persiste la sesión cuando la fuente acepta
las credenciales. Para cambiar de fuente: **Ajustes → Cerrar sesión** y
conectar con la otra. Ajustes muestra siempre cuál está activa.

#### Detalle del sueño

Tocar el cuadro **🌙 Sueño** abre una hoja con el total, el reparto por fases
(profundo, ligero, REM, despierto), su porcentaje, la comparación con tu media,
el rango 7–9 h y la calidad 0–100.

Intervals.icu **no publica las fases del sueño**, solo el total (`sleepSecs`/`sleep`).
Por eso la app:

1. Si el origen sí las trae (`sleepDeepSecs`, `sleepRemSecs`… o un objeto
   `sleepStages`, en segundos o en horas) → las muestra **tal cual**, marcadas
   como informadas por el dispositivo.
2. Si no → las **estima** con el reparto típico del adulto (algo peor cuanto menos
   se duerme) y lo dice explícitamente en la hoja, para que nadie lo confunda
   con un dato real.

> **Garmin Connect sí las trae**, con dos familias de nombres según el endpoint:
> en `dailySleepDTO` son `deepSleepSeconds`, `lightSleepSeconds`,
> `remSleepSeconds` y `awakeSleepSeconds`; en `individualStats` (el endpoint por
> rango, el que usa la app) vienen anidadas en un subobjeto `values`:
> `values.deepTime`, `values.lightTime`, `values.remTime`, `values.awakeTime` y
> `values.totalSleepTimeInSeconds`. El normalizador aplana `values` y acepta los
> dos juegos de nombres. Con esa fuente la hoja muestra siempre **fases reales**
> (caso 1), nunca la estimación. Es la razón principal por la que merece la pena
> tener las dos vías.

Además, todas las horas de sueño se muestran con **máximo 1 decimal y sin el `.0`
sobrante** (`fmtSleep()`): `7.483333333333333` → `7.5`.

### Algoritmo de puntuación

Base neutral de **50**, ajustada por:

| Factor | Efecto |
|---|---|
| HRV vs media de 60 días | hasta **+25 / −25** |
| FC en reposo vs media | hasta **+15** (más baja = mejor) |
| Sueño 7–9 h / ≥6 h / <6 h | **+10 / +4 / −8** |
| TSB = CTL − ATL | hasta **±10** (×0,5) |

Resultado recortado a 0–100 y redondeado. Colores: **≥80 verde** (Excelente),
**≥65 azul** (Buena), **≥50 amarillo** (Moderada), **<50 rojo** (Baja).

---

## 7. Persistencia

| Clave `localStorage` | Contenido |
|---|---|
| `riq_config` | Intervals: `{source:'intervals', athleteId, apiKey}` · Garmin: `{source:'garmin', garmin:{refreshToken, clientId, displayName}}` — restaura la sesión al abrir |
| `riq_logs` | Registros subjetivos (máx. **180**, se eliminan los más antiguos) |

Al abrir con sesión guardada se muestra *«Restaurando sesión…»*. Si la
restauración falla, se borra la config y se deja el formulario limpio. Excepción:
si solo ha caducado el token de Garmin (`REFRESH_FAILED`), **no** se borra nada
— solo hay que volver a conectar.

---

## 8. Notas técnicas

- **JavaScript ES5** a propósito (`var`, `function`, sin flechas ni `const/let`)
  para máxima compatibilidad con Safari antiguo.
- **Sin `DOMContentLoaded`**: el `<script>` es el último elemento de `<body>` y
  cada listener se registra dentro de su propio `try/catch`.
- **Un único bloque `<script>`**: sin módulos ni imports.
- `scoreColor()`, `scoreLabel()` y `calcScore()` son globales y se usan en varios
  renders.
- **TSB puede ser negativo**: negativo = fatiga acumulada, positivo = frescura.
- El username de la autenticación básica de Intervals.icu es literalmente
  `"API_KEY"`, no el ID del atleta:
  `btoa('API_KEY:' + apiKey)`.
- El sueño se normaliza porque la API lo expone de dos formas:
  `sleepSecs` (segundos) o `sleep` (horas).
- La score circle se pintan `--pct` y `--sc` con `element.style.setProperty()`.

---

## 9. Verificación

Dos suites de jsdom sobre `recovery-app.html` (**224 aserciones, 0 fallos**,
0 errores en tiempo de ejecución). Están en `tests/` (`npm install` y
`node test-smoke.mjs` / `node test-garmin.mjs`).

### `test-smoke.mjs` — 124 aserciones

- Arranque, modo demo, credenciales y auto-restauración de sesión.
- Valores exactos de los datos demo de la spec (78/100, HRV 64, baseline 58,
  +10,3 %, FC 52/55, −5,5 %, sueño 7,5 h, +1 h, CTL 68, ATL 72, TSB −4, 28 días).
- Render del dashboard (círculo, 4 tarjetas, semana, conclusiones).
- Navegación por las 5 pestañas + Ajustes (un solo tab activo a la vez).
- Calendario: recuento exacto de días con datos del mes, navegación entre meses
  y detalle de día (con `scrollIntoView` protegido).
- Informe: veredicto 78 → 🟡 PUEDE ENTRENAR y la sección **Estado de forma y
  rendimiento** (índice 86, «En gran forma», CTL 68, ATL 72, TSB −4, ratio
  `0.94` con 2 decimales, 6 estadísticas y recomendaciones).
- Formulario de registro: selección, exclusividad de «Ninguno», guardado en
  `localStorage` (con el score del día), reset e historial.
- Chat IA: `MY_AI_PROXY = null` → mensaje de configuración; con proxy → payload
  correcto (`claude-sonnet-4-20250514`, `max_tokens: 600`, system prompt en
  texto plano con los datos del día), historial limitado a 10 y saneado para
  Anthropic (nunca empieza por `assistant`).
- Límites de `calcScore` (0–100), umbrales de `scoreColor`/`scoreLabel`/
  `verdictFor` y normalización `sleepSecs`/`sleep`.

### `test-garmin.mjs` — 100 aserciones

- **Normalizador `garminToRows()`**: 60 filas, HRV, FC en reposo, sueño en horas
  con 1 decimal, y las 4 fases reales sumando exactamente el total.
- Redondeo de horas (`sec2h`), `garminFitness()` (EMA 42/7 con semilla en la
  media: carga constante 100 → CTL/ATL 100).
- `assembleData()` con filas de Garmin: fases **no estimadas**, TSB = CTL − ATL,
  y una cuenta sin `activityTrainingLoad` no rompe (CTL/ATL en 0).
- Datos basura (`null`, `{}`, campos ausentes) no lanzan excepción.
- UI: selector de fuente, Ajustes reflejando «Garmin Connect» y el
  `displayName`, y la hoja de detalle del sueño diciendo «informado por tu
  dispositivo» en lugar de «estimación».
- Errores amables por código (`BAD_CREDENTIALS`, `RATE_LIMIT`, `CAPTCHA`,
  `BLOCKED`, `REFRESH_FAILED`, `TOKEN_EXCHANGE`, `NO_DATA_GARMIN`).
- `fetchGarminData()` contra el worker con *stub*: rotación del `refresh_token`
  en memoria y en `riq_config`, y POST con rango de fechas válido.
- Conexión completa: login, ida y vuelta de **MFA** (sin mandar la contraseña en
  el segundo paso) y cierre de sesión.
- `restoreSession()` con config de Garmin válida / incompleta / de Intervals.

Además, `node --check` sobre el bloque `<script>` del HTML y sobre `worker.js`.

---

## 10. Portar a una app nativa iOS (SwiftUI)

La PWA ya funciona como app instalada. Si más adelante quieres una app nativa
(Notificaciones, HealthKit, complicaciones del Apple Watch, App Store), el mapeo
es directo porque toda la lógica está aislada en funciones puras:

| PWA (actual) | SwiftUI |
|---|---|
| `var S` (estado global) | `@StateObject final class RecoveryModel: ObservableObject` |
| `buildData()` / `calcScore()` | `struct RecoveryCalculator` — **idénticas**, se copian tal cual |
| `MY_PROXY` + `fetch` | `URLSession` + `URLSessionDelegate` (en iOS no hay CORS: **se puede llamar a Intervals.icu directamente**, `proxy.php` deja de ser necesario) |
| `localStorage` (`riq_config`, `riq_logs`) | `@AppStorage` / `Keychain` (la API key debe ir en Keychain) |
| 5 `.tab-content` + `.bottom-nav` | `TabView(selection:)` |
| `.recovery-hero` + score circle | `ZStack` con `Circle().trim(from:to:).stroke(..., style: StrokeStyle(lineWidth:8))` |
| Calendario con grid 7 columnas | `LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 7))` |
| Chat IA | `ScrollViewReader` + `VStack` de burbujas |
| `env(safe-area-inset-*)` | `safeAreaInset(edge: .top)` / `.bottom` |
| `proxy-ai.php` | Se puede mantener igual, o usar la key de Anthropic en `Keychain` con llamada directa desde la app |

**Recomendación:** si llegáis a nativa, la primera tarea es portar
`calcScore()` + `buildData()` a un target de tests de Swift y verificar que dan
exactamente los mismos números que la PWA (los 95 tests anteriores sirven de
lista de casos).

---

*RecoveryIQ 3.0.0 · Especificación de octubre de 2026.*
