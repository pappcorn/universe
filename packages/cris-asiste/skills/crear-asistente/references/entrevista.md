# La entrevista del asistente

Cuatro bloques. Una pregunta por mensaje, con palabras de todos los días. Al final de cada bloque,
repite lo que entendiste en dos líneas y pregunta "¿así?". Corregir ahora cuesta un minuto; corregirlo
después, un asistente raro durante semanas.

Si la persona contesta corto, no insistas: propón una opción y pide que la confirme. Lo que no sepa
queda como **pendiente**, nunca como invento.

## Antes de empezar

Dilo así: "Voy a hacerte unas preguntas para armar tu asistente. No hay respuestas buenas o malas.
Al final tendrás algo tuyo, que puedes cambiar cuando quieras."

## Bloque 1. Personalidad

| Pregunta                                                                             | Para qué sirve                                                                           | Si no sabe                                        |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------- |
| ¿Cómo te gustaría llamar a tu asistente?                                             | Es su nombre en `profile.json` y en `CLAUDE.md`. Lo elige ella, sin sugerir el de nadie. | Que lo piense y mientras tanto "asistente".       |
| ¿Cómo quieres que te hable? (cercano o formal, corto o detallado, con humor o serio) | Define el tono.                                                                          | Cercano, claro y corto.                           |
| ¿En qué idioma? ¿Y en qué zona horaria estás?                                        | Idioma y fechas.                                                                         | El del chat; preguntar la ciudad.                 |
| ¿Qué te molesta de cómo te responden las IA?                                         | Se convierte en reglas de estilo ("sin saludos largos", "sin listas infinitas").         | Directo, sin preámbulos.                          |
| ¿Prefieres que te dé una recomendación o que te muestre opciones?                    | Postura por defecto.                                                                     | Recomendación, con las alternativas en una línea. |

## Bloque 2. Metas

| Pregunta                                                           | Para qué sirve                     | Si no sabe                      |
| ------------------------------------------------------------------ | ---------------------------------- | ------------------------------- |
| ¿Qué haces? Cuéntalo como se lo contarías a alguien en una fiesta. | Es el dato más usado después.      | Que cuente la semana pasada.    |
| ¿Qué quieres lograr en los próximos tres meses?                    | Metas que guían las prioridades.   | Una sola meta basta.            |
| ¿Qué te gustaría dejar de hacer a mano?                            | Candidatos a especialista o skill. | Pensar en lo que más se repite. |
| ¿Cómo sabrías que el asistente te está sirviendo?                  | Un criterio de éxito concreto.     | "Que no se me olviden cosas."   |

## Bloque 3. Foco

| Pregunta                                                                                                 | Para qué sirve                                  | Si no sabe                                        |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------- |
| ¿Cuáles son tus áreas de vida o trabajo? (por ejemplo: trabajo, negocio propio, estudio, familia, salud) | Las carpetas de Áreas en la memoria.            | Dos o tres para empezar.                          |
| ¿Qué proyectos tienes activos ahora, con fin a la vista?                                                 | Las carpetas de Proyectos.                      | Los dos más urgentes.                             |
| ¿Qué debería ignorar el asistente?                                                                       | Evita ruido: temas, personas, canales.          | Nada por ahora.                                   |
| ¿Hay algo que nunca debe hacer sin preguntarte?                                                          | Reglas duras: enviar, borrar, gastar, publicar. | Enviar mensajes y borrar notas.                   |
| ¿Qué datos sensibles hay que cuidar?                                                                     | Qué no se guarda en notas.                      | Claves y documentos de identidad, nunca en notas. |

## Bloque 4. Herramientas

Pregunta cuáles usa de verdad hoy, no cuáles le gustaría usar.

| Herramienta | Pregunta                                           | Qué cambia                                                                    |
| ----------- | -------------------------------------------------- | ----------------------------------------------------------------------------- |
| Notas       | ¿Usas Obsidian, Notion u otra cosa para tus notas? | Dónde vive la memoria (ver `arquitectura.md`). Si no usa nada, carpeta local. |
| Correo      | ¿Gmail? ¿Quieres que lo lea o que también redacte? | Conector de correo (ver `conectores.md`).                                     |
| Calendario  | ¿Google Calendar?                                  | Conector de calendario.                                                       |
| Documentos  | ¿Drive? ¿Hojas de cálculo?                         | Conectores de Drive o de hojas.                                               |
| Mensajería  | ¿Slack? ¿WhatsApp?                                 | Conector correspondiente; WhatsApp tiene más requisitos.                      |
| Otra        | ¿Hay algo más que uses todos los días?             | Se anota; se resuelve después si hay opción.                                  |

Para cada una que elija, dile qué acceso concede y cómo se quita antes de conectarla.

## Qué sale de las respuestas

| Respuestas                          | Producen                                            |
| ----------------------------------- | --------------------------------------------------- |
| Nombre, tono, idioma, estilo        | Sección "Identidad" de `CLAUDE.md` y `profile.json` |
| Qué hace, metas, criterio de éxito  | `profile.json` y nota `vault/2. Areas/Sobre mí.md`  |
| Lo que quiere dejar de hacer a mano | Especialistas o skills elegidos                     |
| Áreas y proyectos                   | Carpetas y notas iniciales en la memoria            |
| Ignorar y nunca hacer               | Reglas de `CLAUDE.md` y lista de permisos           |
| Herramientas                        | Conexiones y la lista de la primera semana          |

## Cuántos especialistas

Cuenta cuántas cosas repetidas distintas describió en el bloque 2. Una o dos: un especialista cada
una. Más de dos: empieza por las dos que más tiempo le quitan y deja el resto en la lista de
"después de la primera semana". Un asistente con cinco especialistas desde el día uno se usa menos
que uno con dos que funcionan.

## Si ya tiene algo armado

Si la persona ya usa un `CLAUDE.md` o una carpeta de notas, léelos primero, conserva lo que le
funciona y ofrece mejorar en el lugar. No reorganices sus notas sin que lo pida.
