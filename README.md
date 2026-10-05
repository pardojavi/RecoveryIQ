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
| `worker.js` + `wrangler.toml` | Alternativa sin PHP (Cloudflare Workers) para GitHub Pages |
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
| Chat con **IA** | ⏳ Falta `wrangler secret put ANTHROPIC_API_KEY` |

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

## 3. Conectar tu cuenta de Intervals.icu

1. En Intervals.icu: **Perfil → Configuración → API** y copia la **API key**.
2. Tu **Athlete ID** empieza siempre por `i` (ej: `i1234567`).
3. En la app: pega ambos campos → **Conectar y Continuar**.

La app descarga **60 días** de `wellness` y `activities`, calcula las medias de
referencia y renderiza el dashboard.

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

### 4.2 `MY_AI_PROXY` (opcional — chat con IA)

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
   var MY_AI_PROXY = null;   // o '.../ai' si activas el chat
   ```

4. *(Opcional, chat IA)*
   ```bash
   wrangler secret put ANTHROPIC_API_KEY
   ```
   y `var MY_AI_PROXY = 'https://recoveryiq-proxy.tu-subdomino.workers.dev/ai';`

`worker.js` replica la lógica de `proxy.php`: mismos parámetros `url` y `auth`,
misma whitelist estricta a `https://intervals.icu/api/`, más la ruta `/ai` para
Claude. La API key de Anthropic vive en un **secreto** de Cloudflare, nunca en
el repo.

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
- Si usas Cloudflare Workers, protege la ruta `/ai` si no quieres que alguien
  gaste tus tokens: añade un `if (!request.headers.get('X-RecoveryIQ')) ...`
  o activa *Cloudflare Access*.

---

## 6. Estructura de la app

Cinco pestañas en la barra inferior + Ajustes (desde el ⚙️ de arriba):

| Pestaña | Contenido |
|---|---|
| 🏠 **Inicio** | Círculo de índice (conic-gradient), pills de tendencia, gráfico de 7 días, 4 métricas, conclusiones automáticas |
| 📅 **Calendario** | Mes completo coloreado por score, detalle por día (wellness + registro subjetivo) |
| 🏁 **Informe** | Veredicto (🟢🟡🟠🔴), barras HRV/sueño/global, recomendaciones por rango |
| 🤖 **IA** | Chat con Claude, 5 preguntas rápidas, system prompt con tus datos del día |
| 📝 **Registrar** | Cansancio, ánimo, estrés, calidad de sueño, molestias, salud, notas |
| ⚙️ **Ajustes** | Athlete ID, sincronizar, nº de registros, versión, cerrar sesión |

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
| `riq_config` | `{athleteId, apiKey}` — restaura la sesión al abrir |
| `riq_logs` | Registros subjetivos (máx. **180**, se eliminan los más antiguos) |

Al abrir con sesión guardada se muestra *«Restaurando sesión…»*. Si la
restauración falla, se borra la config y se deja el formulario limpio.

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

Ejecutada con jsdom sobre `recovery-app.html` (95 aserciones, 0 fallos,
0 errores en tiempo de ejecución):

- Arranque, modo demo, credenciales y auto-restauración de sesión.
- Valores exactos de los datos demo de la spec (78/100, HRV 64, baseline 58,
  +10,3 %, FC 52/55, −5,5 %, sueño 7,5 h, +1 h, TSB −4, 28 días).
- Render del dashboard, pills sin unidades duplicadas, semana y métricas.
- Navegación por pestañas, calendario (23 días con datos en septiembre),
  detalle de día, informe (78 → 🟡 PUEDE ENTRENAR).
- Formulario de registro: selección, exclusividad de «Ninguno», guardado en
  `localStorage`, reset e historial.
- Chat IA: `MY_AI_PROXY = null` → mensaje de configuración; con proxy → payload
  correcto (`claude-sonnet-4-20250514`, `max_tokens: 600`, system prompt en texto
  plano) e historial saneado para Anthropic.
- Integración con la API real: normalización de `sleepSecs`/`sleep`, cálculo de
  TSB, límites de `calcScore` y umbrales de `scoreColor`/`scoreLabel`.

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
