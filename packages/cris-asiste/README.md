# cris-asiste

**Tres skills para configurar tu propia IA, no solo usarla.**

La IA rinde mucho más cuando está configurada para ti. Estas skills no te entregan nada hecho:
Cris, la anfitriona de IA de PappCorn, te entrevista, propone y escribe contigo, y al final tienes
algo tuyo que entiendes y puedes cambiar.

> **English summary.** A free, MIT-licensed skill pack, written in Spanish for a LATAM audience.
> Three skills that guide a person to configure their own AI: build a small focused agent, teach
> Claude a repetitive task as a skill, and set up a personal assistant with a plain-text second
> brain. No credentials, no server, no network calls of its own. Contributor notes at the bottom.

## Las tres skills

| Skill              | Qué hace                                                                                                                                                                                       | Dónde funciona                         |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `/crear-agente`    | Te entrevista y arma un agente pequeño con un trabajo claro, una fuente de información y unos límites. En Claude Code es un archivo en `.claude/agents/`; en el chat de Claude, un Proyecto.   | Claude Code y chat (claude.ai/Desktop) |
| `/crear-skill`     | Convierte una tarea que repites en una skill propia, con una descripción escrita para que tu Claude la use sola.                                                                               | Claude Code y chat (claude.ai/Desktop) |
| `/crear-asistente` | Arma tu asistente personal: nombre y tono propios, tus metas y tu foco, memoria en una carpeta tuya con el método PARA, y dos especialistas para empezar. Te dice qué acceso da cada conexión. | Claude Code (terminal o pestaña Code)  |

Dentro de Claude Code quedan con el nombre del plugin adelante: `/cris-asiste:crear-agente`,
`/cris-asiste:crear-skill`, `/cris-asiste:crear-asistente`. No hace falta escribirlas: si dices
"quiero crear un agente" o "quiero mi propio asistente", Claude las usa sola.

## Cómo instalarlo

### En Claude Code (terminal o la pestaña Code de Claude Desktop)

```bash
/plugin marketplace add pappcorn/universe
/plugin install cris-asiste@pappcorn-plugins
```

Abre una sesión nueva y escribe, por ejemplo, **"quiero crear un agente"**.

### En el chat de Claude (claude.ai, Claude Desktop o el celular)

Los plugins no corren en el chat, así que cada skill se sube como un `.zip`:

| Skill             | Descarga                                                                            | Guía paso a paso                          |
| ----------------- | ----------------------------------------------------------------------------------- | ----------------------------------------- |
| `crear-agente`    | [crear-agente.zip](https://pappcorn.github.io/universe/kits/crear-agente.zip)       | [GUIA.md](skills/crear-agente/GUIA.md)    |
| `crear-skill`     | [crear-skill.zip](https://pappcorn.github.io/universe/kits/crear-skill.zip)         | [GUIA.md](skills/crear-skill/GUIA.md)     |
| `crear-asistente` | [crear-asistente.zip](https://pappcorn.github.io/universe/kits/crear-asistente.zip) | [GUIA.md](skills/crear-asistente/GUIA.md) |

En Claude, abre **Customize**, entra a **Skills**, haz clic en **+**, elige **Upload a skill** y
sube el `.zip`. Necesitas tener activada la opción **Code execution and file creation** en
Ajustes, sección Capacidades. Las guías tienen el detalle, pensado para quien nunca ha hecho esto.

`/crear-asistente` también se puede subir al chat, pero el asistente que construye necesita
Claude Code: es una carpeta con memoria, especialistas y permisos.

## Lo que estas skills no hacen

- **No construyen nada sin ti.** Preguntan, proponen y te dejan decidir. Piden permiso antes de
  crear o cambiar archivos.
- **No guardan claves.** Ningún archivo que generan lleva contraseñas ni tokens. Si algo necesita
  conectarse a un servicio, se conecta con inicio de sesión en el navegador o con el llavero de tu
  computador, nunca pegando una clave en el chat.
- **No envían nada por ti.** El asistente que arma `/crear-asistente` propone correos y mensajes;
  tú los apruebas.
- **No se conectan a internet por su cuenta.** `crear-asistente.sh` solo copia archivos en una
  carpeta nueva y se niega a escribir sobre una que ya tenga contenido.

---

## For contributors

```
packages/cris-asiste/
├── .claude-plugin/plugin.json   plugin manifest
├── project.json                 Nx targets: build (the zips) and test
├── scripts/build-kits.sh        one uploadable zip per skill
├── test/kits.test.mjs           frontmatter, references, privacy, zip shape, the assistant script
└── skills/
    ├── crear-agente/            SKILL.md · references/ · assets/ · GUIA.md
    ├── crear-skill/             SKILL.md · references/ · assets/ · GUIA.md
    └── crear-asistente/         SKILL.md · references/ · assets/base/ · scripts/ · GUIA.md
```

**One source, two packagings.** The plugin installs straight from `skills/`. The zips for chat
users are built from the same folders by `scripts/build-kits.sh`: skill folder at the zip root,
`SKILL.md` plus `references/`, `assets/` and `scripts/`, and `GUIA.md` left out because it is
written for people, not for Claude. The Pages workflow builds them on every merge to `main` and
serves them at `https://pappcorn.github.io/universe/kits/<skill>.zip`, so the download links never
go stale and no binary is ever committed.

Inside `skills/crear-asistente/assets/base/`, files Claude Code would interpret by name are stored
under other names (`CLAUDE.plantilla.md`, `SKILL.plantilla.md`, `ajustes.json`, `agentes/`) so they
neither activate inside the plugin nor confuse a zip upload. `crear-asistente.sh` puts them in place.

```bash
npx nx run cris-asiste:test    # or: node --test packages/cris-asiste/test/*.test.mjs
npx nx run cris-asiste:build   # zips land in packages/cris-asiste/dist/
```

House rules for these skills, enforced by the test where a test can: Spanish (neutral LATAM,
_tú_), no em dashes, every file under `references/` and `assets/` named in its `SKILL.md`, and
nothing personal or secret. A user-visible change bumps the version in both `plugin.json` and the
root `marketplace.json`.

**Status.** Built and validated by the tests above; not yet run end to end by a first-time user on
a clean account. The guides still carry `[CAPTURA n]` markers where screenshots will go, and
`references/conectores.md` marks with **verificar** the vendor menus that could not be confirmed
against official documentation.
