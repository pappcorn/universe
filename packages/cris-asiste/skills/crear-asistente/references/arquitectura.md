# Cómo está armado el asistente

## Principios

1. **Sin dependencias.** La memoria son archivos de texto en una carpeta. No necesita instalar
   programas ni servidores para funcionar. Las conexiones son opcionales y se agregan después.
2. **Rutas relativas.** Todo se escribe relativo a la carpeta del asistente, que puede estar en
   cualquier lugar del computador.
3. **Doctrina fija, especificidades de la entrevista.** Las reglas de trabajo (fechas absolutas,
   confirmar antes de borrar, no inventar) vienen de serie. Todo lo que es de la persona sale de la
   entrevista. Reemplazar un nombre en una plantilla produce asistentes huecos; por eso se entrevista.
4. **Permisos explícitos.** `.claude/settings.json` lista lo que puede hacer sin preguntar y lo que
   tiene prohibido. Limita borrados masivos, comandos de administrador y descargas de programas, pero
   no es una caja de arena perfecta: la persona sigue siendo quien aprueba lo importante.

## El asistente principal (`CLAUDE.md`)

Hace tres cosas: **enruta** (decide a quién delega), **sintetiza** (junta lo que vuelve de los
especialistas) y **cuida la memoria**. Responde directo cuando es una búsqueda rápida, una pregunta
que cruza áreas o algo sobre el propio asistente.

## Especialistas comunes

Elige por el trabajo que la persona quiere dejar de hacer a mano. Máximo dos al comienzo.

| Especialista          | Cuándo conviene                               | Qué hace                                                               | Herramientas                                                               |
| --------------------- | --------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `foco`                | Casi siempre                                  | Lleva pendientes, agenda y revisión semanal; responde "qué hago hoy"   | Lectura y escritura en la carpeta; calendario y correo si están conectados |
| `escritor`            | Si redacta mucho (posts, correos, propuestas) | Escribe y pule textos con la voz de la persona; nunca envía ni publica | Lectura y escritura en la carpeta                                          |
| `investigador`        | Si busca información a menudo                 | Reúne fuentes y entrega resumen con enlaces                            | Lectura, búsqueda web                                                      |
| `finanzas-personales` | Si quiere revisar gastos                      | Clasifica movimientos de extractos; solo lee                           | Solo lectura                                                               |
| `estudio`             | Si aprende algo en serio                      | Plan de estudio, repasos, resúmenes                                    | Lectura y escritura en la carpeta                                          |

Si el trabajo que describe no encaja con ninguno, se crea uno nuevo con `/crear-agente` o con la
misma entrevista. Si es una tarea repetible más que un rol, es una skill (`/crear-skill`).

## La memoria: método PARA

| Carpeta         | Contiene                                              | Prueba                                   |
| --------------- | ----------------------------------------------------- | ---------------------------------------- |
| `0. Inbox/`     | Captura sin ordenar y notas del día (`AAAA-MM-DD.md`) | "Aún no decidí qué es esto"              |
| `1. Projects/`  | Esfuerzos con un final                                | "Esto se puede terminar"                 |
| `2. Areas/`     | Responsabilidades continuas                           | "Nunca termina, pero se puede descuidar" |
| `3. Resources/` | Referencia que vale la pena guardar                   | "Lo querría aunque cambiara mi vida"     |
| `4. Archives/`  | Terminado o dormido                                   | "Ahora no, pero no se pierde"            |

Nunca se borra: se archiva. Cada nota lleva fecha de creación y etiquetas simples.

### Si usa Obsidian

La carpeta `vault/` se abre como bóveda en Obsidian (descargar desde obsidian.md). Son los mismos
archivos: el asistente los escribe y Obsidian los muestra. No hace falta ningún conector.

### Si usa Notion

La memoria vive en Notion con la misma estructura: cinco páginas o una base de datos con una
propiedad "Tipo" (Inbox, Proyecto, Área, Recurso, Archivo). Requiere el conector de Notion (ver
`conectores.md`). Aclara que el asistente solo ve las páginas a las que la persona le dé acceso, y
que Notion es más lento de leer que archivos locales. Mantén igual una carpeta `vault/` mínima con
las reglas y la nota "Sobre mí", para que el asistente siempre tenga un lugar seguro donde empezar.

### Si no usa nada

Carpeta local `vault/`. Es la opción más simple y se puede abrir con Obsidian más adelante.

## Primera ejecución

El asistente lee `profile.json`. Si dice `"configured": false`, no responde nada más y lanza la
skill `configurar`. No adivina nombre ni preferencias. Cuando termina, pone `"configured": true`
**de último**, solo con todo lo demás escrito.

## Cambiarlo con el tiempo

Todo es texto que la persona puede leer, y el asistente puede editarlo. Pedidos normales:
"cámbiate el tono", "agrega un especialista para mi boletín", "deja de preguntarme antes de editar
notas". Lo que se aprende se escribe con fecha y su motivo, para que la memoria no se vuelva ficción.

## Especialistas que se agregan después

Si trabaja con video, contenido en redes o planes de publicación, se pueden sumar especialistas
para planear, escribir y editar. Aclara que un editor de video necesita programas instalados
aparte (ffmpeg), que el asistente no debe descargar por su cuenta, y que no se prometa nada que
dependa de eso hasta confirmarlo.
