# site/ — the public front door

The static site served at <https://pappcorn.github.io/universe/> via GitHub
Pages (deployed by [`.github/workflows/pages.yml`](../.github/workflows/pages.yml)).

It is the landing page for the PappCorn Universe catalog: what is in the
`pappcorn-plugins` marketplace, how to install from it, the `cris-asiste`
skills as downloadable kits, and a pointer to Cris at
[pappcorn.ai](https://pappcorn.ai/).

| File                | What it is                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `index.html`        | The catalog landing                                                                                                      |
| `masterclass.html`  | The masterclass kit ("Tu Ventaja con IA"): two prompts, the R-C-T-F framework, the gift skill and the class map          |
| `styles.css`        | Shared styles for both pages                                                                                             |
| `copy.js`           | The "Copiar" buttons                                                                                                     |
| `fonts/`            | Red Hat Display Bold (headings), self-hosted, with its [SIL Open Font License](fonts/OFL.txt)                            |
| `mapa.png`, `*.pdf` | Masterclass assets, linked from `masterclass.html`                                                                       |
| `kits/`             | Not committed. The Pages workflow builds one `.zip` per `cris-asiste` skill here on every deploy (see the workflow file) |

Deliberate exceptions and constraints:

- **The page content is Spanish.** Its audience is the LATAM Claude user, not
  the repo contributor. Everything repo-facing (this README, commits, PRs,
  docs) stays English per [CONTRIBUTING](../CONTRIBUTING.md).
- **No build step.** Plain HTML/CSS/JS with assets side by side, published
  as-is. Keep it that way: self-contained, no external scripts, no external
  fonts, no trackers.
- **Brand.** Three colors (cyan `#00d9ff`, ink `#161519`, white), cyan only on
  what you can act on or what has focus, Red Hat Display Bold for headings and a
  system sans-serif for body, one radius scale (12px boxes, 8px controls, pill
  tags), no em dashes in new copy.
- **Public copy only.** Anything said about Cris or PappCorn on these pages
  must already be public on pappcorn.ai. Plans and pricing are linked, never
  described here.

Asset note: the site previously lived at `pappcorn.github.io/ai-native/`; that
repo now redirects here but keeps its own copies of the PDF and images alive,
because sent emails link to them directly. `mapa.png` and the PDF keep their
paths here for the same reason.
