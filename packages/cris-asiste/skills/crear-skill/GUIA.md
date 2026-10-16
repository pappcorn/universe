# Guía: enséñale una tarea a tu Claude con una skill

Esta guía es para ti, aunque nunca hayas creado nada con Claude. Al final tendrás una skill propia:
una receta que tu Claude sigue sin que se la expliques de nuevo.

**Antes de empezar necesitas**

- Una cuenta de Claude con plan de pago (Pro o superior).
- Claude Desktop instalado, o entrar a claude.ai.
- Activar **Code execution and file creation** en Ajustes, sección Capacidades. Sin eso no se pueden subir skills. [CAPTURA 1]
- Una tarea que repitas y un ejemplo real reciente de cómo la hiciste.

> Los nombres de los menús cambian con las versiones. Si algo no está donde dice la guía, busca una
> opción parecida y cuéntanos en github.com/pappcorn/universe/issues para corregir la guía.

## Parte 1. Instala `/crear-skill` (una sola vez)

1. Descarga [`crear-skill.zip`](https://pappcorn.github.io/universe/kits/crear-skill.zip).
2. En Claude abre **Customize** (Personalizar) y entra a **Skills**. [CAPTURA 2]
3. Haz clic en **+** y elige **Upload a skill**. [CAPTURA 3]
4. Selecciona `crear-skill.zip` y verifica que queda **activada**. [CAPTURA 4]

## Parte 2. Cuéntale a Cris tu tarea

1. Abre un chat nuevo y escribe: **"Quiero crear una skill"**. [CAPTURA 5]
2. Cris te pregunta, una por una: qué tarea repites, qué te da quien la hace, qué pasos sigues, cómo
   se ve el resultado bien hecho y cómo lo pedirías tú con tus palabras. Responde como si le
   hablaras a un compañero.
3. Si tienes un ejemplo de algo que te quedó bien, pégalo. Vale más que cualquier explicación.

## Parte 3. Revisa el borrador

1. Cris te muestra la skill por partes. Lee la **descripción** con atención: es la frase que hace que
   Claude use tu skill sola. Debe incluir las palabras que tú usas de verdad.
2. Corrige lo que no suene a ti. Es tu receta.
3. Cris prueba la skill con un caso tuyo. Si el resultado no se parece a lo que querías, dilo y se ajusta.

## Parte 4. Instálala

1. Cris te entrega un archivo `.zip` con tu skill. Descárgalo. Si no puede crear el archivo, te
   guía para hacerlo: clic derecho sobre la **carpeta** de la skill y "Comprimir" (Mac) o "Enviar a, Carpeta
   comprimida" (Windows). [CAPTURA 6]
2. En **Customize**, **Skills**, haz clic en **+**, **Upload a skill**, y selecciona tu `.zip`. [CAPTURA 7]
3. Verifica que aparece en la lista y está activada.

## Parte 5. La prueba que importa

Abre un chat nuevo y pide la tarea con tus palabras de siempre, **sin nombrar la skill**. Si Claude
la usa, quedó. Si no, vuelve con Cris y dile qué frase usaste: casi siempre se arregla con la
descripción.

## Si usas Claude Code

Instala el plugin una sola vez (`/plugin marketplace add pappcorn/universe` y luego `/plugin install cris-asiste@pappcorn-plugins`).
Después pídele a Cris "quiero crear una skill": guarda la skill en `.claude/skills/<nombre>/` de tu proyecto (o en `~/.claude/skills/` para todos
tus proyectos). Abre una sesión nueva para que aparezca.

## Cuidados

- No pongas claves ni datos de otras personas dentro de la skill.
- Antes de compartir una skill, léela completa.
- La skill ahorra tiempo. No garantiza resultados de negocio.
