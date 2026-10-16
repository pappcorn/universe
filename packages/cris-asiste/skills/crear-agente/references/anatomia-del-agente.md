# Anatomía de un agente en Claude Code

Un agente es **un solo archivo** `.md` en `.claude/agents/`. Si necesita scripts, esos viven en una
skill (carpeta aparte con su `SKILL.md`), nunca dentro de la carpeta de agentes.

## Frontmatter

```yaml
---
name: nombre-en-minusculas # igual al nombre del archivo, solo letras minúsculas y guiones
description: Qué es y cuándo usarlo # el enrutador: lo más importante del archivo
tools: Read, Grep, Glob # lo mínimo que el trabajo necesita
model: sonnet # sonnet, haiku o inherit
---
```

- **name.** Igual al nombre del archivo, para que buscarlo sea fácil. Sin sufijo "-agent".
- **description.** Claude decide si delega leyendo solo esto. Qué es, qué cubre, frases reales con
  las que la persona lo pediría y dónde vive su información. Sé insistente: pocas descripciones
  fallan por ser largas, muchas por tímidas.
- **model.** `haiku` para tareas simples y rápidas, `sonnet` para el trabajo diario, `inherit` cuando
  el producto del agente es criterio (revisar un contrato, dar un veredicto, cuidar una voz).
- **tools.** Ver la tabla.

## Qué herramientas darle

| El agente...              | Herramientas                                  |
| ------------------------- | --------------------------------------------- |
| Solo lee y analiza        | `Read, Grep, Glob`                            |
| Además busca en internet  | `Read, Grep, Glob, WebFetch, WebSearch`       |
| Escribe o edita archivos  | `Read, Grep, Glob, Edit, Write`               |
| Corre comandos            | Suma `Bash` solo si de verdad lo necesita     |
| Usa un servicio conectado | El nombre de las herramientas de ese conector |

La ausencia de una herramienta es un límite de seguridad. Un agente sin `Edit` ni `Write` no puede
dañar tus archivos aunque se equivoque.

## Las secciones del cuerpo, en este orden

1. **Quién eres** (obligatoria). Dos o tres frases: el rol, para quién trabaja, el tono.
2. **Antes de actuar, lee** (obligatoria). La fuente de verdad: un documento, una carpeta, su
   memoria. Si no existe, la crea en la primera corrida y no inventa contexto.
3. **El tema en pocas líneas** (recomendada). Un resumen de cómo se ve el mundo del agente, con
   fechas. Le dices que verifique antes de citar de memoria.
4. **Procedimientos** (obligatoria). Los 2 a 5 flujos que repite. Para cada uno: cuándo arranca, los
   pasos y cómo se ve "terminado".
5. **Memoria** (si recuerda). Qué archivos, qué guarda cada uno, leer al empezar y escribir al cerrar
   una decisión. Incluye la cláusula de aprendizaje: lo que la realidad contradiga se corrige con
   fecha y motivo.
6. **Reglas** (obligatoria). Solo límites reales, cada uno con su porqué. Si todo es regla, nada lo es.
7. **Estilo** (obligatoria). Idioma, longitud, cómo presentar opciones (una tabla corta con una
   recomendación), qué explicar y qué dar por sabido.

## Ejemplo de descripción floja y buena

Floja: "Ayudante para temas de finanzas."

Buena: "Analista de gastos personales. Revisa los extractos de la carpeta `finanzas/`, clasifica los
movimientos y avisa de cargos raros. Úsalo cuando la persona diga 'revisa mis gastos', 'cuánto gasté
en X', 'qué cobros no reconozco' o suba un extracto. Su memoria vive en `memoria/finanzas.md`."

## Una regla vale lo que vale su porqué

Mejor: "No envíes correos sin mostrármelos antes, porque una vez salió uno a la persona equivocada."
Peor: "NUNCA ENVÍES CORREOS."
