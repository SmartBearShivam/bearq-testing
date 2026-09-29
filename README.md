# Paligo (DocBook) → Astro Starlight migration engine

`convert.mjs` converts a **Paligo structured DocBook XML export** into a complete,
standalone [Astro Starlight](https://starlight.astro.build) documentation site —
MDX pages, optimized images, and a generated sidebar.

It is **idempotent**: every run wipes the generated output and rewrites it from
scratch, so it never duplicates or appends. Re-run it any time the export changes.

---

## Quick start (drop-in → result)

Two folders make this turnkey — no paths to configure:

```
Migration Script/
├── _Paligo In/     ← drop your unzipped Paligo export here
└── _Astro Out/     ← the finished Astro project appears here
```

1. **Put** your unzipped Paligo DocBook export into **`_Paligo In/`**
   (the `resource-<id>.xml` + `assets/` folder, or the whole export sub-folder —
   either works).
2. **Run** one command:

   ```bash
   ./migrate.sh            # generate the Astro project into _Astro Out/
   ./migrate.sh --dev      # …and start the local dev server
   ./migrate.sh --build    # …and produce a production build in _Astro Out/dist/
   ```

   (`migrate.sh` installs the engine's dependency on first run. No prior setup.)
3. **Result:** a ready-to-run Astro Starlight site in **`_Astro Out/`**. If you
   didn't use `--dev`/`--build`:

   ```bash
   cd "_Astro Out" && npm install && npm run dev
   ```

The output folder is **scaffolded automatically** (it starts empty) and its site
title is taken from the Paligo publication title. Both `_Paligo In/` and
`_Astro Out/` are meant to stay empty between runs so the tool stays reusable.

---

## What it does

Given a Paligo export (`resource-<id>.xml` + an `assets/` image folder), the
engine:

1. **Parses the Paligo export model** — the publication structure (`<e:structure>`),
   the topic components, the ~thousands of separately-stored text fragments
   (`xinfo:text` references), the variable set, and the image resources.
2. **Resolves references** — inlines text fragments, resolves variables, expands
   `xi:include` content reuse, and rewrites cross-references
   (`urn:resource:component:…`) into site-relative links.
3. **Serializes DocBook → MDX** — sections/headings, lists, procedures, tables,
   images, YouTube embeds, code blocks, inline markup, and admonitions
   (`note`/`tip`/`warning` → Starlight `:::` asides).
4. **Writes the site** into an existing Astro Starlight project:
   - one `.mdx` per topic under `src/content/docs/` (mirroring the publication tree),
   - a splash homepage at `src/content/docs/index.mdx`,
   - images under `src/assets/<page-slug>/` (per-page folders; images used by
     more than one page go to `src/assets/_shared/`; unreferenced source images
     are preserved in `src/assets/_unused/`),
   - a generated sidebar written into `astro.config.mjs`.

---

## Prerequisites

- **Node.js 18+** (built/tested on Node 24).
- A **Paligo DocBook export**, unzipped — a folder with `resource-<id>.xml` and
  an `assets/` folder.

That's it. The target Astro project does **not** need to exist beforehand — the
engine scaffolds a fresh Astro Starlight project (from the bundled
[`template/`](template)) whenever the output folder has no `astro.config.mjs`. If
you point it at an *existing* project instead, it leaves your config/title alone
and only refreshes the docs, images, and sidebar.

---

## Other ways to run it

Besides `./migrate.sh` (see Quick start above), you can call the engine directly:

```bash
cd "Migration Script"
npm install          # installs cheerio (one time)

# Defaults to ./_Paligo In  →  ./_Astro Out
npm run migrate

# Or point it at any export + output folder explicitly:
node convert.mjs "/path/to/paligo-export" "/path/to/astro-output"

# Or via environment variables:
PALIGO_EXPORT_DIR="/path/to/paligo-export" \
ASTRO_PROJECT_DIR="/path/to/astro-output" \
node convert.mjs
```

The output folder is scaffolded if needed, then build/preview it:

```bash
cd "/path/to/astro-output"
npm install
npm run build      # or: npm run dev
```

---

## Files

| Path | Purpose |
| :--- | :--- |
| `migrate.sh`   | One-command turnkey wrapper (`_Paligo In` → `_Astro Out`). |
| `convert.mjs`  | The migration engine. |
| `template/`    | The Astro Starlight project skeleton scaffolded into the output. |
| `_Paligo In/`  | Drop the Paligo export here (kept empty otherwise). |
| `_Astro Out/`  | Generated site lands here (kept empty otherwise). |
| `package.json` | Declares the `cheerio` dependency + `npm run migrate`. |

---

## Customization notes

- **Product-name variables / rebranding.** `PRODUCT_VARS` and the `rebrand()`
  function near the top of `convert.mjs` resolve this publication's product
  variables to `Zephyr Essential` / `Zephyr Essential DC` and rewrite legacy
  "Zephyr Squad" strings. Edit these for a different product, or empty them out
  to keep the source text verbatim.
- **Theme chrome.** Images whose Paligo `remap` path is under
  `images/commonImages/` (e.g. `go.gif` arrows, note collapse toggles) are
  treated as decorative theme chrome and dropped. Adjust the
  `images/commonImages/` check in `resolveImage()` if your export differs.
- **Homepage cards / hero.** The splash page is generated near the bottom of
  `convert.mjs` (`cardCandidates`, hero actions) — tweak to match your IA.
