# Guía: crea tu propio agente

Esta guía es para ti, sin importar si has usado Claude antes. Vamos paso a paso. Al final tendrás
un ayudante de IA que hace un trabajo concreto para ti, y lo habrás armado tú.

**Antes de empezar necesitas**

- Una cuenta de Claude con plan de pago (Pro o superior).
- La aplicación de Claude Desktop instalada, o entrar a claude.ai desde el navegador.
- Para subir la skill: tener activada la opción **Code execution and file creation** (ejecución de código y creación de archivos). Se activa en Ajustes, sección Capacidades. [CAPTURA 1: Ajustes, Capacidades]
- Unos 20 minutos y un ejemplo real de una tarea que te gustaría quitarte de encima.

> Los nombres de los menús pueden cambiar con las versiones de la aplicación. Si algo no está
> donde dice la guía, busca una opción parecida y cuéntanos en github.com/pappcorn/universe/issues para corregir la guía.

## Parte 1. Instala la skill (una sola vez)

1. Descarga el archivo [`crear-agente.zip`](https://pappcorn.github.io/universe/kits/crear-agente.zip).
2. En Claude, abre el menú **Customize** (Personalizar) y entra a **Skills**. [CAPTURA 2: menú Customize]
3. Haz clic en el botón **+** y elige **Upload a skill** (Subir una skill). [CAPTURA 3: botón +]
4. Selecciona el archivo `crear-agente.zip`.
5. Verifica que la skill aparece en la lista y está **activada**. [CAPTURA 4: skill activada]

## Parte 2. Crea el Proyecto que será tu agente

En Claude Desktop y claude.ai, tu agente vive en un **Proyecto**: un espacio con sus propias
instrucciones y archivos. (En Claude Code los agentes son archivos que Claude llama por su cuenta.
En Desktop no existen, así que el Proyecto cumple el mismo papel: entras a él cuando quieres ese ayudante.)

1. En la barra lateral, entra a **Projects** y haz clic en **+ New Project**. [CAPTURA 5: nuevo proyecto]
2. Ponle un nombre que diga el trabajo, por ejemplo "Revisor de contratos". Guarda.

## Parte 3. Deja que Cris te entreviste

1. Dentro del Proyecto, abre un chat nuevo y escribe: **"Quiero crear un agente"**. [CAPTURA 6: primer mensaje]
2. Cris te hará preguntas, una por una: qué tarea quieres quitarte, de dónde sale la información,
   qué no debe hacer nunca, cómo quieres que te hable. Responde con tus palabras. Si no sabes algo, dilo y
   Cris propone una opción.
3. Al final Cris te muestra el borrador por partes. Léelo y corrige lo que no suene a ti.

## Parte 4. Pon el agente a trabajar

Cris te entregará dos cosas.

1. **El texto de las instrucciones.** Copia el texto. En tu Proyecto haz clic en **Set project instructions**,
   pega el texto y guarda. [CAPTURA 7: instrucciones del proyecto]
2. **Los archivos de conocimiento.** Si acordaron archivos (por ejemplo tu lista de clientes o tus reglas),
   súbelos en la sección de conocimiento del Proyecto con el botón **+**. [CAPTURA 8: conocimiento]
3. Si tu agente recuerda cosas, crea el archivo `memoria.md` que Cris te indique y súbelo también.

## Parte 5. Pruébalo

1. Abre un chat nuevo **dentro del Proyecto** y pídele un caso real.
2. Si la respuesta sale genérica o se equivoca, vuelve al chat de Cris y dile qué falló. Se ajusta
   en unos minutos. Es normal afinarlo dos o tres veces durante la primera semana.
3. Cuando el agente te diga "Para tu memoria: ...", copia ese párrafo en `memoria.md`. Es así como
   aprende de ti: tú decides qué guarda.

## Si usas Claude Code

Instala el plugin una sola vez (`/plugin marketplace add pappcorn/universe` y luego `/plugin install cris-asiste@pappcorn-plugins`)
y pídele a Cris lo mismo ("quiero crear un agente"). La skill crea el archivo del agente en la carpeta
`.claude/agents/`, te propone una fila en tu `CLAUDE.md` y un archivo de memoria. Cuando termine,
cierra y abre Claude Code para que el agente nuevo aparezca.

## Cuidados

- No pegues contraseñas ni claves en el chat ni dentro de los archivos del agente.
- Tú decides qué hace el agente y qué no. Si algo no te gusta, se cambia.
- El agente ahorra trabajo. No garantiza resultados de negocio.
