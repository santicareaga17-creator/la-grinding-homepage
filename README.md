# L.A. Grinding Homepage

Production implementation of the **L.A. Grinding / Arizona Grinding homepage**, compiled
from the Claude Design handoff into plain static HTML, CSS and JavaScript.

This is a standalone project. It shares a build recipe with the separate Tree Care
Industry site but has its own repository, its own Vercel project and its own assets;
nothing here is deployed over that site.

---

## Live environment

| | |
| --- | --- |
| **Production URL** | see `Deployment` below |
| **Hosting** | Vercel (static output) |
| **Vercel project** | `la-grinding-homepage` |
| **Repository** | <https://github.com/santicareaga17-creator/la-grinding-homepage> |
| **Production branch** | `main` |
| **Local dev port** | **3200** |

---

## Quick start

```bash
npm run dev      # build, then serve dist/ at http://localhost:3200
```

There are **no dependencies**. `package.json` declares neither `dependencies` nor
`devDependencies`, so `npm install` is not needed. Node.js 18+ is the only prerequisite.

| Command | What it does |
| --- | --- |
| `npm run build` | Compiles the handoff into `dist/` |
| `npm run serve` | Serves `dist/` on port 3200 |
| `npm run dev` | Build, then serve |
| `node tools/sync-assets.mjs "<handoff folder>"` | Re-copies the images the design uses |

---

## Repository structure

```
design-source/                   the Claude Design handoff — the source of truth
  LA Grinding Homepage.dc.html     markup, styles and page data, as exported
  support.js                       the editor's React runtime (reference only, never shipped)
  _ds/industry-…/styles.css        the design system stylesheet
assets/
  js/site.js                       all page behaviour (no framework)
  uploads/                         100 images, copied out of the handoff
tools/
  build.mjs                        the compiler: handoff -> dist/
  data.mjs                         executes the design's renderVals() to get page data
  sync-assets.mjs                  copies the referenced images out of the handoff
  serve.mjs                        local static server
dist/                            build output — generated, gitignored
```

---

## How the build works

The handoff is authored in Claude Design's `dc` template dialect and is rendered in the
editor by a CDN React + Babel runtime (`support.js`). That runtime is never shipped.
`tools/build.mjs` resolves the dialect ahead of time:

| In the handoff | In `dist/` |
| --- | --- |
| `<sc-for list="{{ xs }}" as="x">` | the markup, repeated, with `{{ x.* }}` filled in |
| `<sc-if value="{{ flag }}">` | unwrapped when statically true; interactive ones become `data-panel="…" hidden` |
| `{{ expr }}` | the value, HTML-escaped |
| `style-hover` / `style-active` | real CSS `:hover` / `:active` rules in `site.css` |
| `onClick` / `onMouseEnter` / `ref` | `data-on-*` / `data-ref` hooks wired by `site.js` |
| `<img data-src="…">` | `<img src="…">`, resolved at build time |
| the `<helmet><style>` block | copied out **verbatim** as `page.css` |

Copying the `<style>` block verbatim is what preserves the design's responsive
behaviour: its rules stay authoritative and are never re-authored.

### Page data is executed, not transcribed

The design keeps its content model in a `<script type="text/x-dc">` block — a class
whose `renderVals()` returns every list the template loops over. `tools/data.mjs`
**executes** that class in a sandbox rather than restating it in JavaScript here. This
matters: hand-transcribing it is the one step that reliably drifts from the design. Edit
the design, rebuild, and the content follows automatically.

### The build refuses to ship a broken page

`tools/build.mjs` fails loudly rather than emitting something subtly wrong:

- an unresolved `{{ … }}` or `<sc-…>` left in the output
- a handler or ref the design binds that `renderVals()` does not define
- a handler or ref that `assets/js/site.js` does not implement
- an `<img data-src>` that would render blank
- a referenced image missing from `assets/uploads/`

---

## Responsive behaviour

The design's own breakpoints, reproduced as authored:

| Range | Layout |
| --- | --- |
| **≥ 1024px** | Desktop. `#page` is pinned to `min-width: 1280px` by the design. |
| **641 – 1023px** | Tablet. `#page { min-width: 0 }`, grids collapse, nav becomes the drawer. |
| **≤ 640px** | Mobile. Logo strip becomes a scroll-snapping auto-advancing rail. |

Because the desktop floor is 1280px and the responsive rules only start at 1023px, a
viewport between **1024px and 1279px scrolls horizontally**. That is the design's own
behaviour, verified against the handoff at both widths, and it is reproduced rather than
corrected — changing it would be a redesign.

Verified at 1440, 1280, 1024, 1023, 768, 430, 393 and 375: no broken images, no clipped
text beyond the design's own 2-line clamp on long product names, and no horizontal
scroll outside the 1024–1279 band described above.

---

## Interactions

All are ports of the design's own logic, with its timings preserved:

- **Hero slider** — 4 slides on a 500% track with a trailing copy of slide 1, so the
  loop has no visible rewind. Auto-advances every 12s; arrows, touch swipe (>45px) and
  horizontal trackpad scroll all drive it.
- **Sticky header** — condenses on scroll (util row 52→40px, nav row 96→76px, shadow
  on), driven by a 1px sentinel rather than a fixed scroll offset.
- **Shop All / Services mega-menus** — open on hover, close on leave.
- **Search** — suggestion panel on focus, closing 160ms after blur so a click on a
  suggestion still registers.
- **Category / product / review rails** — arrow buttons nudge by 780px.
- **Mobile drawer** — hamburger toggles it; four accordion groups, one open at a time,
  with the trailing glyph switching between `+` and `–`.
- **Distributor logo strip** — below 640px it steps one logo per second and wraps,
  pausing 2.5s whenever it is touched, and respecting `prefers-reduced-motion`.

---

## Assets

`assets/uploads/` holds the 100 images the design uses, copied out of the handoff. They
are the real photography and logos from the design — nothing is a placeholder.

The design also hot-links 29 images from `lagrinding.com/wp-content/uploads/` (review
thumbnails, the service-area map, some product and brand logos). Those are left pointing
at the client's own CDN exactly as the design authored them, so the page picks up any
update made there.

---

## Deployment

Vercel builds with `npm run build` and serves `dist/` (see `vercel.json`). Deploy from
this directory:

```bash
vercel --prod
```

This project has no `.vercel/` link committed, so confirm the target project is
`la-grinding-homepage` before deploying.
