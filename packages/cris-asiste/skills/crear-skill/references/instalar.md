# Cómo instalar una skill

## La estructura que debe tener

```
nombre-de-la-skill/
├── SKILL.md          (obligatorio)
├── references/       (opcional: detalle que se lee cuando hace falta)
└── assets/           (opcional: plantillas y archivos que la skill entrega)
```

- La carpeta se llama igual que el `name` del frontmatter: minúsculas, números y guiones.
- El archivo se llama exactamente `SKILL.md`.
- El `.zip` lleva **la carpeta** en la raíz, no los archivos sueltos.

## Claude Desktop y claude.ai

Requisito: tener activada la opción **Code execution and file creation** en Ajustes, sección
Capacidades. Sin eso la subida de skills no funciona.

1. Arma el `.zip` (abajo).
2. En Claude, abre **Customize** (Personalizar) y entra a **Skills**.
3. Haz clic en **+**, elige **Upload a skill** y selecciona el `.zip`.
4. Verifica que aparece en la lista y está activada.

Los nombres de los menús cambian entre versiones. Si no encuentras uno, busca algo parecido en
Ajustes o en la barra lateral. Si una versión anterior de la aplicación te muestra
**Ajustes > Capacidades > Skills**, es el mismo lugar.

Si la subida falla, las causas más comunes son: el nombre de la carpeta no coincide con el `name`,
falta el archivo `SKILL.md`, o hay caracteres raros en el nombre o la descripción.

### Armar el .zip sin saber de terminal

- **Mac:** clic derecho sobre la **carpeta** de la skill y elige "Comprimir".
- **Windows:** clic derecho sobre la **carpeta** y elige "Enviar a" y luego "Carpeta comprimida".

Comprime la carpeta, no su contenido. Al abrir el `.zip`, lo primero que debe verse es la carpeta.

### Si Claude puede crear archivos en la conversación

Con la creación de archivos activada, puedes pedirle a Cris que arme el `.zip` y te lo entregue para
descargar. Revisa igual que la carpeta quede en la raíz.

## Claude Code

1. Crea la carpeta `.claude/skills/<nombre>/` dentro del proyecto (la skill solo vale para ese
   proyecto) o `~/.claude/skills/<nombre>/` (vale para todos tus proyectos).
2. Guarda ahí el `SKILL.md` y sus carpetas.
3. Abre una sesión nueva de Claude Code. En una sesión abierta, escribe `/` y comprueba que aparece.

## Actualizar una skill

Cambia el `SKILL.md`, arma el `.zip` otra vez y súbelo de nuevo (Desktop), o edita el archivo
(Code). Si cambias el nombre, es una skill distinta: borra la vieja.

## Compartir una skill

Una skill es un archivo de texto. Antes de compartirla, léela completa y confirma que no contiene
nada que no quieras regalar: nombres de clientes, direcciones, claves, cifras internas.
