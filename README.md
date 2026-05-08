# 💩 GastroTracker

Control gastrointestinal del grupo de WhatsApp. Parsea exportaciones de chat y grafica estadísticas de cada miembro.

---

## Arquitectura

```
Navegador (GitHub Pages)
    ↕  fetch
Cloudflare Worker (proxy)          ← guarda GIST_TOKEN y GIST_ID como secrets
    ↕  GitHub API
GitHub Gist                        ← "base de datos" JSON
```

El token de GitHub **nunca llega al navegador** — sólo el Worker lo conoce.

---

## Instalación (10 min)

### 1. Crear el Gist

1. Ve a https://gist.github.com
2. Crea un nuevo Gist con cualquier nombre de archivo, por ejemplo `gastro-data.json`, y contenido `{}`
3. **Copia el ID del Gist** — es la cadena al final de la URL:
   `https://gist.github.com/tu-usuario/ESTE_ES_EL_ID`

### 2. Crear un Personal Access Token de GitHub

1. Ve a https://github.com/settings/tokens/new
2. Nombre: `gastrotracker`
3. Expiration: la que quieras (o "No expiration")
4. Scopes: activa solo **`gist`**
5. Genera y **copia el token** (solo se muestra una vez)

### 3. Desplegar el Cloudflare Worker

Necesitas [Node.js](https://nodejs.org) y una cuenta gratuita en [Cloudflare](https://cloudflare.com).

```bash
# Instalar Wrangler (CLI de Cloudflare)
npm install -g wrangler

# Autenticarse
wrangler login

# Dentro de esta carpeta:
wrangler deploy

# Añadir los secrets (te los pedirá uno a uno)
wrangler secret put GIST_TOKEN
wrangler secret put GIST_ID
```

Al terminar, Wrangler te da la URL del Worker, algo así:
```
https://gastro-proxy.TU-USUARIO.workers.dev
```

Guarda esa URL — la necesitas en el paso 5.

### 4. Publicar en GitHub Pages

1. Sube esta carpeta a un repositorio de GitHub (solo necesita `index.html`)
2. Ve a **Settings → Pages**
3. Source: `Deploy from a branch` → `main` → `/ (root)`
4. En unos segundos tendrás la URL de tu página

### 5. Configurar la app

1. Abre la URL de GitHub Pages
2. Pulsa **⚙️ Configurar**
3. Pega la URL del Worker (`https://gastro-proxy.TU-USUARIO.workers.dev`)
4. Guarda

---

## Uso

### Exportar el chat de WhatsApp

**Android**: Abre el chat → ⋮ (menú) → Más → Exportar chat → **Sin multimedia**

**iOS**: Abre el chat → nombre del grupo arriba → Exportar chat → **Sin multimedia**

Se genera un archivo `.txt`. Súbelo a la app arrastrando o con el botón de selección.

### Qué detecta

El parser busca el emoji 💩 en cada mensaje y registra:
- **Quién** lo envió
- **Fecha** y **hora** exacta
- Si un mensaje contiene varios 💩, cuenta cada uno por separado

Los datos se **fusionan automáticamente** — puedes subir el mismo export varias veces sin crear duplicados. Cualquier miembro del grupo puede subir un export y los datos se acumulan en el Gist.

### Gráficas

| Gráfica | Descripción |
|---------|-------------|
| 🏆 Ranking | Total de eventos por miembro (barras horizontales) |
| 📈 Actividad semanal | Eventos por semana a lo largo del tiempo |
| 🕐 Hora del día | A qué hora del día sucede más frecuentemente |
| 📆 Día de la semana | Qué día de la semana es el más activo |
| 🗓️ Mapa de calor | Visión anual día a día (estilo GitHub contributions) |
| 👥 Tarjetas por miembro | Total, días activos, promedio, hora favorita, récord |

---

## Seguridad

- El token de GitHub nunca sale del Worker.
- El Gist puede ser **privado** (recomendado) o público.
- La URL del Worker actúa como "contraseña": quien la tenga puede leer y escribir datos.
- Si quieres proteger el proxy, puedes añadir una cabecera secreta en el Worker y validarla desde el frontend (no incluido en esta versión básica).

---

## Formatos de export compatibles

| Plataforma | Formato detectado |
|------------|-------------------|
| Android (es/en) | `DD/MM/YYYY, HH:MM - Autor: mensaje` |
| iOS | `[DD/MM/YYYY, HH:MM:SS] Autor: mensaje` |
| Algunas versiones antiguas | sin coma entre fecha y hora |
| 12h (AM/PM) | soportado |
| Años de 2 dígitos | soportado (asume 2000s) |

El parser asume formato de fecha **MM/DD/YY** (formato de WhatsApp en EE.UU.). Las fechas ambiguas donde el mes o el día supera 12 se detectan automáticamente.
