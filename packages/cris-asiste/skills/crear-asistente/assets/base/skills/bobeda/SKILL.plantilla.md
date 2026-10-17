---
name: bobeda
description: >-
  El manual de la memoria: dónde va cada nota (método PARA), cómo se escribe el frontmatter, cómo se
  ordena la bandeja de entrada, cómo se enlaza y cómo se archiva. Úsala cada vez que el trabajo toque
  notas: "guarda esto", "anota", "recuerda que", "busca lo que escribí sobre X", notas del día,
  ordenar, o cualquier cosa dentro de `vault/`. Léela antes de trabajo no trivial con notas.
---

# bobeda

`vault/` es la memoria. Texto plano en carpetas, sin base de datos ni servidor, para que la persona
pueda abrirla con Obsidian, con el Finder o con cualquier editor y vea lo mismo que tú.

## Dónde va cada cosa

| Carpeta         | Contiene                                              | Prueba                                   |
| --------------- | ----------------------------------------------------- | ---------------------------------------- |
| `0. Inbox/`     | Captura sin ordenar y notas del día (`AAAA-MM-DD.md`) | "Aún no decidí qué es esto"              |
| `1. Projects/`  | Esfuerzos con un final                                | "Esto se puede terminar"                 |
| `2. Areas/`     | Responsabilidades continuas                           | "Nunca termina, pero se puede descuidar" |
| `3. Resources/` | Referencia que vale guardar                           | "Lo querría aunque cambiara mi vida"     |
| `4. Archives/`  | Terminado o dormido                                   | "Ahora no, pero no se pierde"            |

Decide en este orden: ¿es un esfuerzo activo con final? Proyectos. ¿Responsabilidad continua? Áreas.
¿Referencia? Recursos. ¿Terminado o frío? Archivo. ¿Dudas? Inbox, y lo marcas en el siguiente repaso.
Inbox es una respuesta válida: un archivo equivocado con mucha seguridad cuesta más que uno sin decidir.

## Frontmatter

Toda nota nueva lleva:

```yaml
---
created: 2026-10-16
tags: [area/trabajo, tipo/nota]
---
```

`created` siempre, con fecha absoluta. Las etiquetas en minúsculas, forma `categoria/valor`, y reutiliza
las que existen antes de inventar otra. Mira las notas vecinas y copia su forma.

## Nombres

Títulos legibles, no códigos: `Mi voz.md`. Notas del día: `AAAA-MM-DD.md` en `0. Inbox/`. Las carpetas
categorizan; el nombre solo nombra.

## Escribir

**Extiende, no multipliques.** Antes de crear una nota, busca si ya existe una que lo cubra. Agregar
una sección con fecha a una nota existente casi siempre es lo correcto.
**Lee antes de editar.** Lee la nota completa antes de cambiarla. Nunca sobrescribas algo que no viste.
**Enlaza con generosidad:** `[[Nombre de la nota]]`. Un enlace a una nota que aún no existe está bien: marca algo por escribir.
**Fecha lo que cambia:** `2026-10-16: pasé a X porque Y.` El porqué es lo valioso y lo primero que se pierde.

## Capturar

Cuando la persona diga "guarda esto" o diga algo que vale la pena conservar:

1. Si el destino es obvio, ruta; si no, al Inbox.
2. Escríbelo con **sus** palabras, y añade contexto.
3. Con contexto suficiente para entenderse en seis meses. "lo del precio" no sirve.
4. Confirma en pocas palabras, sin narrar el archivado.

## Ordenar el Inbox

Ítem por ítem: si es accionable y toma dos minutos, hazlo y no lo archives. Si es una tarea más larga,
pásasela a `foco`. Si es referencia, a Recursos o al Área. Si pertenece a un proyecto, a la nota del proyecto.
Si ya no importa, bórralo diciéndolo en voz alta. Apunta a vaciarlo: una bandeja siempre llena enseña
a dejar de capturar.

## Archivar

Mover, no borrar. `4. Archives/` copia la estructura de origen para que todo siga siendo encontrable.
Borrar de verdad se reserva para ruido (duplicados, errores, notas de prueba), y se confirma antes.

## Errores comunes

- Una nota por pensamiento: la memoria es curada, la mayoría de las capturas caben en una nota existente.
- Reorganizar sin que lo pidan: rompe el mapa mental de la persona y los enlaces.
- Inventar convenciones: mira lo que ya hay. Si no hay nada, elige lo más simple y anota que lo elegiste.
- Guardar claves, contraseñas o documentos de identidad en las notas: nunca.
