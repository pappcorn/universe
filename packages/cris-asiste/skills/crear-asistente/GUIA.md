# Guía: crea tu propio asistente personal

Esta guía es para ti, aunque nunca hayas usado una terminal. Al final tendrás un asistente con el
nombre que tú le pongas, que conoce tus metas, guarda notas en una carpeta tuya y te ayuda a
organizarte. Lo armamos juntos.

**Antes de empezar necesitas**

- Una cuenta de Claude con plan de pago (Pro o superior).
- Claude Code. La forma más sencilla es la pestaña **Code** dentro de Claude Desktop. [CAPTURA 1: pestaña Code]
- Unos 30 minutos para la primera vez.
- Una carpeta nueva y vacía donde vivirá tu asistente, por ejemplo en Documentos.

> Los nombres de los menús cambian con las versiones. Si algo no está donde dice la guía, busca una
> opción parecida y cuéntanos en github.com/pappcorn/universe/issues para corregirla.

## Parte 1. Abre Claude Code en tu carpeta

**Opción A. Desde Claude Desktop (sin terminal)**

1. Abre Claude Desktop y haz clic en la pestaña **Code**.
2. Elige **Select folder** (Seleccionar carpeta) y escoge tu carpeta nueva y vacía. [CAPTURA 2: elegir carpeta]

**Opción B. Desde la terminal**
Instalación oficial de Claude Code (en Mac, Linux o WSL):

```
curl -fsSL https://claude.ai/install.sh | bash
```

En Windows PowerShell: `irm https://claude.ai/install.ps1 | iex`. Después abre una terminal nueva,
entra a tu carpeta y escribe `claude`. Si necesitas ayuda para abrir una terminal, pídesela a Cris.
Fuente: documentación oficial de Claude Code. Si el comando falla, avísanos antes de insistir.

## Parte 2. Instala la skill y elige tu camino

1. Instala la skill una sola vez. En Claude Code lo más sencillo es el plugin: escribe
   `/plugin marketplace add pappcorn/universe` y luego `/plugin install cris-asiste@pappcorn-plugins`.
   Si prefieres subirla como `.zip` a Claude Desktop, descarga
   [`crear-asistente.zip`](https://pappcorn.github.io/universe/kits/crear-asistente.zip), y en **Customize**, **Skills**, haz clic en **+** y
   **Upload a skill**. (Necesitas tener activada la opción **Code execution
   and file creation** en Ajustes, Capacidades.) [CAPTURA 3]
2. En Claude Code, escribe: **"Quiero crear mi propio asistente"**. [CAPTURA 4]
3. Cris te pregunta cuál camino prefieres.

### Camino 1. "Lo armamos con el script"

Cris te explica el comando y lo corre por ti, o te dice exactamente qué pegar. Si prefieres no tocar la
terminal, Cris lo corre por ti cuando le des permiso, o eliges el camino 2. Después abres esa carpeta en Claude Code y escribes **"empezar"**. Tu asistente te hará una
entrevista de unos 15 minutos y se configurará solo. [CAPTURA 5: primera entrevista]

### Camino 2. "Lo armo yo, paso a paso"

Cris te hace la entrevista ahora, de a una pregunta. Son cuatro bloques:

1. **Personalidad.** Cómo se llama tu asistente y cómo te habla.
2. **Metas.** Qué haces y qué quieres lograr.
3. **Foco.** Tus áreas y proyectos, qué ignorar y qué nunca debe hacer sin preguntarte.
4. **Herramientas.** Qué usas: Notion, Obsidian, Slack, Gmail, Calendario, Drive, WhatsApp.

Con tus respuestas, Cris escribe los archivos de tu asistente, te muestra cada uno antes de
guardarlo y te pregunta si suena a ti. [CAPTURA 6: borrador de CLAUDE.md]

## Parte 3. Conecta lo que quieras (opcional, de a una)

Cris te explica, para cada servicio: qué acceso concede y cómo quitarlo. Reglas de seguridad que no
cambian:

- **Nunca pegues contraseñas, claves ni tokens en el chat** ni dentro de los archivos del asistente. Los servicios te piden iniciar sesión en el navegador.
- Conecta una herramienta a la vez y prueba que funciona antes de la siguiente.
- Para quitar una conexión: escribe `/mcp` en Claude Code, elige la conexión y **Clear authentication**.

Los conectores de tu cuenta de Claude se activan en `claude.ai/customize/connectors` y luego aparecen en Claude
Code (comprueba escribiendo `/mcp`). [CAPTURA 7: /mcp]

## Parte 4. Cierra y abre Claude Code

Los especialistas se cargan al iniciar. Cierra Claude Code y ábrelo de nuevo en la misma carpeta. Escribe
"hola" y verifica que tu asistente se presenta con el nombre y el tono que elegiste.

## Primera semana

Una lista corta para que el asistente se vuelva tuyo. Marca lo que vayas haciendo.

**Día 1**

- [ ] Dile tres cosas que tienes pendientes y mira dónde las guarda.
- [ ] Pregúntale "qué hago hoy" y corrige lo que no te guste de la respuesta.

**Día 2 a 3**

- [ ] Pégale un texto tuyo (un correo o un mensaje) y pídele que lo mejore con tu voz.
- [ ] Si conectaste calendario o correo, pídele que mire tu semana.

**Día 4 a 5**

- [ ] Cámbiale algo de personalidad: "sé más corto", "háblame más cercano".
- [ ] Revisa tu carpeta de notas (`vault`): ¿entiendes lo que guardó? Pídele ajustar lo que no.

**Día 6 a 7**

- [ ] Pídele la revisión semanal: qué avanzó, qué se quedó pegado.
- [ ] Decide si necesitas un especialista nuevo o una skill para algo que repetiste. Cris te ayuda con `/crear-agente` y `/crear-skill`.

## Si algo sale mal

- **No aparece mi asistente nuevo:** cierra y abre Claude Code en la carpeta.
- **Me pide permiso a cada rato:** dile a tu asistente cuál permiso te pidió y propón agregarlo a la lista permitida en `.claude/settings.json`; él te lo muestra antes.
- **El script dice que la carpeta tiene contenido:** usa una carpeta nueva y vacía.
- **Una conexión falló:** escribe `/mcp` para ver el estado y vuelve a autenticar. Si sigue, cuéntale a Cris.

## Cuidados

- Tu asistente guarda notas en tu computador. Cópialas de vez en cuando a otro lugar.
- Nada sale al mundo (correos, mensajes, publicaciones) sin que tú lo apruebes.
- El asistente ahorra trabajo. No garantiza resultados de negocio.
