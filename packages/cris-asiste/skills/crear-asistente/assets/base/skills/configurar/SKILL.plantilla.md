---
name: configurar
description: >-
  La entrevista de arranque que convierte este asistente en el asistente de esta persona: nombre,
  tono, metas, foco y herramientas. Escribe `profile.json` y las notas que leen los especialistas.
  Úsala en la primera ejecución (`profile.json` dice `"configured": false`) y cuando la persona
  quiera rehacer o ampliar la configuración: "configurar de nuevo", "cambia mi tono", "quiero
  agregar una herramienta", "empezar", "volvamos a la entrevista".
---

# configurar

El asistente llega en blanco a propósito. Uno que afirma con seguridad tu público y tus prioridades
es peor que uno que pregunta. Esta entrevista es lo que lo hace tuyo. Toma unos diez a quince minutos.

## Reglas

- Una pregunta por mensaje, con palabras de todos los días. Si hay pocas respuestas posibles, ofrece
  opciones para elegir en vez de pedir que escriba.
- **Nunca fabriques un valor por defecto.** Si no sabe, escribe `null` y anótalo como pendiente.
- Responde en el idioma de la persona y cámbialo si ella lo cambia.
- No expliques la arquitectura. Le importa que funcione.
- Al final de cada bloque repite lo que entendiste en dos líneas y pregunta si es así.

## Bloque 1. Personalidad

1. ¿Cómo quieres llamar a tu asistente?
2. ¿Cómo te gustaría que te hable? (cercano o formal, corto o detallado, con humor o serio)
3. ¿En qué idioma, y en qué ciudad o zona horaria estás?
4. ¿Qué te molesta de cómo te responden otras IA?
5. ¿Prefieres una recomendación directa o ver opciones?

## Bloque 2. Metas

1. ¿Qué haces? Cuéntalo como a alguien en una fiesta. (Es el dato más usado después.)
2. ¿Qué quieres lograr en los próximos tres meses?
3. ¿Qué te gustaría dejar de hacer a mano?
4. ¿Cómo sabrías que el asistente te está sirviendo?

## Bloque 3. Foco

1. ¿Cuáles son tus áreas de trabajo o de vida?
2. ¿Qué proyectos activos tienes, con fin a la vista?
3. ¿Qué debería ignorar el asistente?
4. ¿Qué no debe hacer nunca sin preguntarte?

## Bloque 4. Herramientas

Pregunta cuáles usa de verdad: notas (Obsidian, Notion u otra), correo, calendario, Drive, Slack,
WhatsApp. Para cada una que quiera conectar, dile qué acceso concede y cómo se quita antes de
conectarla, y que **nunca debe pegar claves en el chat**. Las conexiones se activan desde Claude Code
(`/mcp`) o desde su cuenta de Claude; guía a la persona un paso a la vez. Marca en `profile.json`
solo las que quedaron funcionando.

## Escribir todo

En este orden:

1. `profile.json`: llena cada campo con las respuestas. Pon `"configured": true` **de último**.
2. `vault/2. Areas/Sobre mí.md`: quién es, qué hace, metas, foco, qué ignorar, límites.
3. `vault/2. Areas/Mi voz.md`: lo que observaste en cómo escribe y habla, sus "nunca", y cómo le
   gusta que le escriban. Si no tienes ejemplos suyos, pídele dos o tres textos y cita frases suyas
   como ancla. Sin ejemplos, es teoría.
4. `vault/2. Areas/Foco.md`: el tablero de `foco` con los cubos (Entrada, Hoy, Esta semana,
   Esperando, Algún día, Hecho), vacío.
5. `vault/0. Inbox/<fecha de hoy>.md`: la primera nota del día, con una línea que diga que el asistente se configuró hoy.
6. Si nombró áreas o proyectos, una nota inicial por cada uno en su carpeta.

Cada nota con el frontmatter de la skill `bobeda`.

## Cerrar

En tres o cuatro líneas dile qué pasó y qué probar primero, sacado de **sus** respuestas: capturar un
pendiente, preguntar "qué hago hoy", pegar un borrador para que `escritor` lo pula. Termina ahí, sin
tour ni demostración de todo.

## Si ya está configurado

No empieces de cero. Pregunta qué quiere cambiar y repite solo ese bloque. Conserva lo que sigue
valiendo y fecha lo que cambió.
