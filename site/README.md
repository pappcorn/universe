# site/ — the public front door

The static site served at <https://pappcorn.github.io/universe/> via GitHub
Pages (deployed by [`.github/workflows/pages.yml`](../.github/workflows/pages.yml)).

It is the getting-started landing for the PappCorn Universe catalog, and it
carries the masterclass kit ("Tu Ventaja con IA"): the prompts, the R-C-T-F
framework (page + one-pager PDF), the gift skill, and the class map — plus an
introduction to the `pappcorn-plugins` marketplace and how to install from it.

Two deliberate exceptions to repo norms:

- **The page content is Spanish.** Its audience is the LATAM masterclass
  attendee, not the repo contributor. Everything repo-facing (this README,
  commits, PRs, docs) stays English per [CONTRIBUTING](../CONTRIBUTING.md).
- **No build step.** Plain HTML/CSS/JS with assets side by side, published
  as-is. Keep it that way — self-contained, no external scripts, no trackers.

Asset note: the site previously lived at `pappcorn.github.io/ai-native/`; that
repo now redirects here but keeps its own copies of the PDF and images alive,
because sent emails link to them directly.
