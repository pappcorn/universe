# El equivalente en Claude Desktop y claude.ai

Claude Desktop y claude.ai no tienen subagentes que se invocan solos. El equivalente es un
**Proyecto**: un espacio con sus propias instrucciones, sus archivos de conocimiento y, si quieres,
skills. Entras al Proyecto cuando quieres ese ayudante y todas las conversaciones de ahí lo usan.

## Piezas del Proyecto y su correspondencia

| En Claude Code (agente)                      | En Desktop o claude.ai (Proyecto)                                                      |
| -------------------------------------------- | -------------------------------------------------------------------------------------- |
| Descripción (cuándo delegar)                 | El nombre y la descripción del Proyecto, para que sepas cuál abrir                     |
| Cuerpo del archivo del agente                | **Instrucciones del Proyecto**                                                         |
| Fuente de verdad (carpeta, documentos)       | **Archivos del Proyecto** (conocimiento)                                               |
| Tareas repetibles con scripts                | **Skills** subidas como `.zip`                                                         |
| Memoria en un archivo que él mismo actualiza | Un `memoria.md` en el Proyecto que **tú actualizas** pegando lo que el agente te dicte |
| Herramientas limitadas                       | Los conectores y permisos que actives                                                  |

## Pasos (resumen; la guía con capturas va en GUIA.md)

1. Crea el Proyecto con un nombre que diga el trabajo.
2. Pega las instrucciones (usa `assets/plantilla-instrucciones-proyecto.md`).
3. Sube los archivos de conocimiento que acordaron en la entrevista.
4. Si hay una tarea repetible, súbela como skill (ver el kit `/crear-skill`).
5. Prueba con un caso real, dentro del Proyecto.

Los nombres exactos de los menús cambian con las versiones de la aplicación. Si no encuentras algo
donde la guía lo dice, busca en la barra lateral o en Ajustes una opción parecida y avisa para
corregir la guía.

## Diferencias que conviene decir con claridad

- No hay delegación automática: el agente "responde" cuando entras al Proyecto.
- La memoria no se escribe sola. Al cerrar una decisión importante, el agente te da un párrafo corto
  y tú lo agregas a `memoria.md`.
- Un Proyecto no puede cambiar tus archivos del computador por su cuenta. Con conectores sí puede
  actuar en servicios, siempre con tu permiso.
- Los archivos de conocimiento deben ser de tamaño razonable y estar al día; un documento viejo
  produce respuestas viejas.
