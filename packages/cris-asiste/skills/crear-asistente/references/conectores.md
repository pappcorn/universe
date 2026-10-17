# Conectores: qué conceden y cómo se quitan

Principio para todos: **un conector es una puerta a tu cuenta.** Se abre con inicio de sesión en el
navegador o con el llavero del computador, nunca pegando una clave en el chat ni dentro de los
archivos del asistente. Si alguien o algo te pide pegar un token en la conversación, para y revisa.

Abre solo las puertas que necesitas, de a una, y anota en `profile.json` cuáles están abiertas.

Lo marcado como **verificar** no se pudo comprobar con la documentación oficial al escribir este
kit (2026-10-16). Revísalo en el momento de usarlo y corrige este archivo si cambió.

## Cómo se añaden en Claude Code

Hay dos caminos, y conviene saber cuál es cuál.

### A. Conectores de tu cuenta de Claude

Si inicias sesión en Claude Code con tu cuenta de Claude, los conectores que añadas en
`claude.ai/customize/connectors` aparecen solos en Claude Code. Paso a paso:

1. Entra a `claude.ai/customize/connectors`, añade el servicio y completa el inicio de sesión.
2. En Claude Code escribe `/mcp` para ver la lista y comprobar que aparece.
3. Por proyecto, se pueden activar o apagar desde `/mcp`.

Fuente: documentación de Claude Code, página "Connect Claude Code to tools via MCP". No funciona
si entras con una clave de API en vez de tu cuenta.

### B. Servidores que se añaden por comando

```bash
claude mcp add --transport http <nombre> <url>
```

`claude mcp list` muestra los instalados, `claude mcp remove <nombre>` quita uno (y borra sus
credenciales guardadas) y `/mcp` dentro de Claude Code permite autenticar. Abre una sesión nueva
después de instalar.

## Notion

- **Instalar:** `claude mcp add --transport http notion https://mcp.notion.com/mcp`, y luego `/mcp`
  para iniciar sesión en el navegador. (Documentación de Notion y de Claude Code.)
- **Acceso que concede:** lo que tú le des permiso de ver en tu espacio de trabajo. Pregunta a la
  persona a qué páginas quiere que llegue.
- **Cómo quitarlo:** en `/mcp`, elige **Clear authentication**; o `claude mcp remove notion`. En
  Notion también se puede retirar la conexión desde sus ajustes de conexiones (**verificar** el menú
  exacto).

## Gmail, Google Calendar y Google Drive

Dos opciones, según qué tan técnica sea la persona.

### Opción 1. Conectores oficiales (recomendada)

Añádelos como en el camino A (`claude.ai/customize/connectors`) y comprueba con `/mcp`. Antes de
prometer algo, **verificar** qué puede hacer cada uno hoy (leer, redactar borradores, enviar,
escribir en el calendario). Como referencia sin comprobar al escribir este kit: correo con
lectura y borradores sin envío, Drive solo lectura, Calendar con lectura y escritura. No lo
ofrezcas como cierto sin comprobarlo.

- **Acceso:** el que muestra la pantalla de autorización de Google al conectar. Léela con la persona.
- **Cómo quitarlo:** desconecta en `claude.ai/customize/connectors`; y revisa en tu cuenta de Google,
  sección de seguridad, el acceso de terceros (**verificar** el nombre exacto del menú).

### Opción 2. Conectores abiertos del catálogo de PappCorn (`pappcorn/universe`)

Hay `gmail-mcp` (leer, buscar, ordenar, redactar y **enviar** correo) y `gsheets-mcp` (leer y editar hojas
compartidas contigo, con vista previa y confirmación en cada escritura). Usan **tu propia aplicación
de Google** (creas un proyecto en Google Cloud y obtienes tus credenciales), así que tus llaves no pasan por nadie más.
La contra: la configuración inicial es técnica. Úsala con personas cómodas con eso, o paso a paso con la guía.

1. Sigue la guía de la cuenta de Google en el repositorio `pappcorn/universe`: para correo, el archivo
   `docs/setup-google-cloud.md` (guía visual: `docs/how-to-gmail.md`); para hojas, el archivo
   `docs/setup-google-sheets.md`. Cada conector tiene su propia configuración.
2. Instala el conector desde Claude Code:
   ```
   /plugin marketplace add pappcorn/universe
   /plugin install gmail-mcp@pappcorn-plugins
   ```
   (Para hojas: `/plugin install gsheets-mcp@pappcorn-plugins`.)
3. El instalador te pide las credenciales y las guarda en el llavero de tu sistema operativo; no se
   escribe ningún archivo de claves. Reinicia Claude Code.

- **Acceso:** `gmail-mcp` usa los permisos `gmail.modify` y `gmail.send` sobre **tu** buzón; `gsheets-mcp`
  lee y escribe hojas y puede crear archivos que él mismo genera. Los permisos exactos están en el
  README de cada conector.
- **Cómo quitarlo:** `/plugin` para desinstalar el conector; en tu cuenta de Google, retira el
  acceso de tu aplicación (**verificar** el menú); y si quieres cerrar del todo, borra las credenciales en
  tu proyecto de Google Cloud.

## Slack

- **Instalar:** el servidor de Slack está en `https://mcp.slack.com/mcp` (documentación de Slack).
  Slack no publica un comando específico para Claude Code; usa el camino A (conectores de tu cuenta
  de Claude) o el camino B con la URL, y **verificar** el procedimiento vigente.
- **Requisito:** en la documentación de Slack, el administrador del espacio de trabajo aprueba y
  gestiona las integraciones con MCP, y solo funcionan aplicaciones publicadas en el Marketplace de Slack
  o internas. Si la persona no es administradora, tiene que pedir esa aprobación.
- **Acceso:** lo que la aplicación solicite al autorizar. Léelo con la persona.
- **Cómo quitarlo:** `/mcp` y **Clear authentication**, y revoca la aplicación desde la
  administración de apps del espacio de trabajo (**verificar**).

## WhatsApp

Es la conexión con más requisitos. El conector `whatsapp-mcp` de `pappcorn/universe` envía
mensajes desde **tu número de negocio** con la API oficial de WhatsApp (Meta). No lee chats
personales. Necesita una aplicación en Meta con su token y fuera de la ventana de 24 horas solo
permite plantillas aprobadas. Guía: `docs/setup-meta-whatsapp.md` en el repositorio de universe, e
instalación igual a la de Gmail con `/plugin install whatsapp-mcp@pappcorn-plugins`.

- **Acceso:** envío de mensajes desde ese número.
- **Cómo quitarlo:** desinstala con `/plugin` y revoca el token en la configuración de tu cuenta de Meta (**verificar** el menú).
- No recomiendes clientes no oficiales de WhatsApp personal: exigen emparejar con código QR, procesos
  en segundo plano y ponen en riesgo la cuenta.

## Obsidian

No hace falta ningún conector. Abre la carpeta `vault/` como bóveda desde la aplicación Obsidian.
Los dos leen los mismos archivos.

## Lo que el asistente debe decir cuando algo no está conectado

"Esto necesita [conexión]. Todavía no la tienes activa. ¿La conectamos ahora o lo hacemos a mano?"
Sin atajos, sin pedir claves, sin construir soluciones alternativas por su cuenta.
