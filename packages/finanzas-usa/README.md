# finanzas-usa

**Dos asesores para tus finanzas en Estados Unidos: inversiones y retiro, e impuestos.**

Los dos te proponen y te explican. Tú decides y tú lo haces en la plataforma. Ninguno compra, vende,
mueve plata ni presenta declaraciones.

> **English summary.** A free, MIT-licensed agent pack, written in Spanish for a LATAM audience
> living in the United States. Two advisor agents: **Indexandro** (investing and retirement on
> Interactive Brokers: a written IPS, a boring indexed core, a monthly review from IBKR CSV
> statements with banded rebalancing, a capped learning sleeve and an HTML dashboard; it never
> places orders) and **Tributina** (US personal and small-business taxes for an LLC, S-corp or
> C-corp: it organizes documents and deadlines, finds legal savings with IRS sources and the tax
> year, and prepares the work for a CPA; it never files). No credentials, no server, no broker API.
> Contributor notes at the bottom.

## Los dos agentes

| Agente         | Qué hace                                                                                                                                                                                                                                                                             | Nunca                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| **Indexandro** | Te entrevista y arma contigo una política de inversión por escrito (IPS). Diseña un núcleo aburrido de ETFs indexados, bonos o Treasuries escalonados y un colchón de uno a dos años. Cada mes lee el extracto CSV de Interactive Brokers, revisa las bandas y actualiza un tablero. | Pone órdenes. Te dice la orden exacta y tú la pones en la app.      |
| **Tributina**  | Entiende tus impuestos personales y los de tu pequeña empresa (LLC, S-corp o C-corp). Busca maneras legales de pagar menos, cita al IRS con el año, lleva el calendario fiscal y te arma el paquete para el CPA.                                                                     | Prepara ni presenta declaraciones. Eso lo hace tu CPA con su firma. |

Trabajan juntos sobre la misma carpeta: Indexandro le deja a Tributina las ventas con ganancia o
pérdida y los posibles _wash sales_, y Tributina le deja a Indexandro lo que cambia la estrategia
(por ejemplo, si conviene invertir dentro de tu empresa o fuera). Si tienes empresa, haz primero la
entrevista de impuestos.

**No son asesores con licencia.** Te preparan el trabajo para que la cita con un asesor _fee-only
fiduciary_ y con tu CPA sea corta, barata y con preguntas concretas. Los dos te lo van a recordar.

## Dónde viven tus datos

En una carpeta tuya, en archivos de texto que puedes abrir y leer. Los dos agentes escriben en
`vault/2. Areas/Finanzas/` dentro de esa carpeta, con el método PARA:

```
tu-carpeta/
├── Cómo vamos.html            el tablero, doble clic y se abre en el navegador
├── instrucciones/             solo si usas un Proyecto de Claude (ver abajo)
├── plantillas/como-vamos.html la plantilla del tablero
└── vault/2. Areas/Finanzas/
    ├── compartido/            hogar, empresa, calendario fiscal, notas entre los dos
    ├── retiro/                IPS, plan, portafolio, bitácora, extractos/
    └── impuestos/             mapa fiscal, optimizaciones, para el CPA, documentos/
```

La ruta es siempre la misma. Si después quieres ver tus notas en Obsidian, conviertes `vault/` en
una bóveda y los agentes siguen escribiendo en el mismo lugar. Si ya armaste tu asistente con
[`cris-asiste`](../cris-asiste), es la misma carpeta `vault/`.

## Cómo instalarlo

### En Claude Code (terminal o la pestaña Code de Claude Desktop)

```bash
/plugin marketplace add pappcorn/universe
/plugin install finanzas-usa@pappcorn-plugins
```

Abre una sesión nueva dentro de la carpeta donde quieres tus finanzas y escribe, por ejemplo,
**"armemos mi plan de retiro"** o **"revisemos mis impuestos"**. Claude delega en el agente que
corresponde. Dentro de Claude Code se llaman `finanzas-usa:indexandro` y `finanzas-usa:tributina`.

### En la app de Claude, sin terminal (Proyectos y una carpeta)

Esta forma es para quien no usa la terminal. Cada agente es un **Proyecto** de Claude con sus
instrucciones, y los dos trabajan sobre una **carpeta** de tu computador que les das con Cowork.
Toma unos 15 minutos.

**Paso 1. La carpeta.**

1. Crea una carpeta llamada, por ejemplo, **Finanzas**. Si quieres compartirla con alguien de tu
   hogar, ponla en iCloud Drive (o en otro servicio que sincronice) y, en un Mac, apaga
   **Optimizar almacenamiento del Mac** en los ajustes de iCloud Drive, para que los archivos estén
   siempre en el disco.
2. Descarga los archivos del kit desde la carpeta [`kit/`](kit) de este paquete: los dos archivos de
   `kit/instrucciones/` y `kit/plantillas/como-vamos.html`. En GitHub, cada archivo tiene un botón
   para descargarlo.
3. Ponlos dentro de tu carpeta así: `Finanzas/instrucciones/indexandro.md`,
   `Finanzas/instrucciones/tributina.md` y `Finanzas/plantillas/como-vamos.html`.

**Paso 2. El Proyecto de impuestos.**

1. Abre Claude en el computador. En el menú de la izquierda, entra a **Proyectos** y crea uno nuevo
   llamado **Impuestos**.
2. En la descripción del Proyecto pega: _Tributina, mi asesora de impuestos de Estados Unidos.
   Organiza, busca maneras legales de pagar menos y prepara el trabajo para el CPA. No presenta
   declaraciones._
3. Abre `instrucciones/tributina.md`, copia **todo** el texto y pégalo en las **instrucciones** del
   Proyecto.
4. Dentro del Proyecto, abre **Cowork** y dale acceso a tu carpeta **Finanzas**.
5. Escribe **empecemos**. Tributina te hace una entrevista de unos 20 minutos.

**Paso 3. El Proyecto de inversiones y retiro.** Igual que el paso 2, con el nombre **Retiro**, el
archivo `instrucciones/indexandro.md` y esta descripción: _Indexandro, mi asesor de inversiones y
retiro en Interactive Brokers. Propone y explica; nunca ejecuta órdenes._

**Paso 4 (opcional). Compartir con alguien de tu hogar.** Comparte la carpeta con esa persona y que
repita los pasos 2 y 3 en su propio Claude. Comparte la carpeta solo con personas de confianza: ahí
va a quedar información de tu plata.

Los nombres de los menús cambian con las versiones de la app. Si no encuentras algo donde dice la
guía, busca una opción parecida en la barra lateral o en Ajustes.

**Cómo se usa después:**

- **En Cowork:** para todo. Lee y guarda en la carpeta: entrevistas, revisiones del mes, propuestas,
  el tablero.
- **En el chat normal o en el celular:** para preguntas rápidas. Ahí el agente **no ve la carpeta**,
  solo lo que subiste al Proyecto como conocimiento. Después de cada revisión, sube el
  `resumen-vigente.md` nuevo de cada agente al conocimiento de su Proyecto, reemplazando el anterior.
  El agente te lo recuerda.
- **Una vez al mes:** baja el extracto de Interactive Brokers en CSV (Indexandro te explica cómo),
  guárdalo donde te diga y escribe en Cowork **revisión del mes**.
- **Cuando haya versión nueva:** la primera línea de cada archivo de `instrucciones/` dice su
  versión. Si el agente te avisa que sus instrucciones están viejas, reemplaza el archivo en tu
  carpeta, copia todo y pégalo de nuevo en las instrucciones del Proyecto. No se pierde nada: la
  memoria está en la carpeta.

## Tres reglas de seguridad

1. **Nunca** le escribas a un agente contraseñas, códigos de verificación ni respuestas de
   seguridad.
2. Antes de guardar documentos de impuestos en la carpeta, tacha el número de Seguro Social (SSN),
   el EIN y los números completos de cuenta. No hacen falta.
3. Los agentes **no reemplazan** a tu CPA ni a un asesor financiero con licencia.

## Lo que estos agentes no hacen

- **No ponen órdenes ni mueven plata.** No se conectan a tu broker. En esta versión ("Fase 0")
  trabajan solo con los extractos que tú bajas.
- **No presentan declaraciones** ni hablan con el IRS por ti.
- **No guardan claves.** Ningún archivo que escriben lleva contraseñas, el SSN ni números de cuenta.
- **No cambian el plan en caliente.** El IPS se cambia por escrito, con fecha, y nunca el mismo día
  de una caída del mercado.

---

## For contributors

```
packages/finanzas-usa/
├── .claude-plugin/plugin.json   plugin manifest
├── project.json                 Nx targets: kit (rebuild the Projects kit) and test
├── agents/
│   ├── indexandro.md            investing and retirement (the source)
│   └── tributina.md             taxes (the source)
├── kit/                         what people without Claude Code download
│   ├── instrucciones/           generated from agents/, committed
│   └── plantillas/como-vamos.html  the dashboard template both lanes use
├── scripts/build-kit.sh         agents/<name>.md minus frontmatter -> kit/instrucciones/<name>.md
└── test/agentes.test.mjs        frontmatter, version lockstep, kit drift, doctrine, privacy
```

**One source, two packagings.** The plugin installs `agents/` for Claude Code. People who use a
Project in the Claude app paste `kit/instrucciones/<name>.md`, which is the same agent body without
its frontmatter. The kit is committed so it can be downloaded from GitHub, and the test fails when
it drifts from `agents/`. After editing an agent:

```bash
npx nx run finanzas-usa:kit     # or: bash packages/finanzas-usa/scripts/build-kit.sh
npx nx run finanzas-usa:test    # or: node --test packages/finanzas-usa/test/*.test.mjs
```

**Versioning.** The first line of each agent body is `<!-- versión: X.Y.Z -->`, equal to
`plugin.json`. In a Project, that line is how the agent notices its pasted instructions are older
than the file in the person's folder. A user-visible change bumps the version in the two agents,
`plugin.json` and the root `marketplace.json`; the test enforces all four.

House rules, enforced by the test where a test can: Spanish (neutral LATAM, _tú_ by default), no em
dashes, no personal data or secrets, no `Bash` in an advisor's tools, and the doctrine that must
survive any rewrite: never place orders, everything against the IPS, a boring indexed core, a 3 to
4% reference withdrawal rate, a capped learning sleeve that is never refilled from the core, wash
sales across every account including IRAs, no commingling of business and personal money, IRS
citations with the tax year, a fee-only fiduciary and a CPA, and the eleven tax points.

**Status.** Validated by the tests above; not yet run end to end by a first-time user on a clean
account. The Projects lane is a manual download today; a zip served from GitHub Pages, like the
`cris-asiste` kits, is the natural next step.
