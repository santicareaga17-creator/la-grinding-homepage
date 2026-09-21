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
  css/desktop.css                  desktop-only fix, all inside @media min-width 1024px
  css/mobile.css                   mobile-only refinements, all inside @media 640px
  js/site.js                       all page behaviour (no framework)
  uploads/                         100 images, copied out of the handoff
tools/
  build.mjs                        the compiler: handoff -> dist/
  data.mjs                         executes the design's renderVals() to get page data
  sync-assets.mjs                  copies the referenced images out of the handoff
  make-mobile-plates.mjs           draws the taller mobile hero plates
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
- a copy correction whose source text is no longer in the design

That last one covers `COPY_FIXES` and `LINK_FIXES` in `tools/build.mjs`: wording and
destinations changed after the handoff was exported are corrected at build time rather
than by editing `design-source/`, so that folder stays a faithful record of what Claude
Design produced. Currently they drop the "/ Reno" qualifier from the Saw Blades card and
point the Sharpening Support card at `lagrinding.com/sharpening/`.

`LINK_FIXES` finds its card by the image's `alt` text rather than by the href it is
replacing, because several unrelated links on the page share that href — a blanket
replacement would move those too. It fails the build if the card is missing or if the
`alt` matches more than once.

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

### The desktop layer

`assets/css/desktop.css` holds one correction, inside a single
`@media (min-width: 1024px)` block: the About Us navy wedge.

The section scales with the viewport — `aspect-ratio: 1897 / 840` with
`container-type: inline-size` — but the wedge inside it is positioned and sized in fixed
pixels, so it does not scale, and its size relative to the section changes with every
resize:

| Viewport | Wedge spans | Result |
| --- | --- | --- |
| 1280 | 43.4%–117.8% | floods the section, diagonal far too steep |
| 1440 | 38.8%–105.3% | correct: bleeds just past the right and bottom edges |
| 1897 | 29.3%–79.5% | floats mid-section, badges land outside it |

The wedge is *designed* to bleed off the right and bottom edges — that bleed is what
makes it read as a corner wedge rather than a floating rectangle — so scaling it to the
1897px artboard is not the fix; that pulls it inside the section and breaks it the way
1897 already does. Instead its geometry is frozen as percentages of the section taken at
the width where it is right (1440), which the fixed-aspect section then carries
unchanged to every other width. Measured at 1024, 1280, 1440, 1600, 1897 and 2560, the
wedge now spans an identical 38.76%–105.31% by 27.13%–114.03% at every one.

Toggling the sheet on and off at 1440px changes exactly two of the page's 2025 elements:
the wedge and the badge row. Nothing else on desktop moves.

### The mobile layer

`assets/css/mobile.css` holds phone-specific refinements requested after the desktop
design was signed off. **Every rule in it lives inside a single
`@media (max-width: 640px)` block**, so it cannot reach the tablet tier or the desktop
layout — that containment is the guarantee that desktop stays approved-as-is, and it is
verified by re-diffing 1440px against the handoff after every change.

What it changes, and why:

| Area | Change |
| --- | --- |
| Hero slider | 40% taller (`2172/411` → `2172/575`); copy scales up to match |
| Hero plates | Swapped for mobile variants whose US flag clears the slider arrow |
| Hero slide 4 | The nine-item services list is dropped from the mobile sequence |
| Category grid | Two feature cards over three support cards, all five above the fold |
| Our Services | Becomes a swipeable rail with arrows, matching Shop by category |
| About Us | Contains the overflowing photo and rebuilds the OEM logo grid |

Two of those need more than CSS:

**The taller plates.** `hero-plate-clean.png` and `min6.png` both carry a small US flag
about 2.7% from the left edge, which on a phone sits underneath the 22px "previous
slide" arrow. They also cannot simply be stretched to the taller mobile ratio — the
plate is a pure gradient and would survive it, but `min6.png` carries the CA/NV/AZ map,
which must not distort. `tools/make-mobile-plates.mjs` generates
`hero-plate-mobile.png` and `min6-mobile.png` by exploiting the fact that the plate
texture is uniform along X: the row median *is* the texture, so the artwork can be
separated from it, the texture rebuilt at the taller height (stretching only the band
between the red bars, so the bars keep their thickness), and the artwork pasted back
unscaled — with the flag moved to 10.5%, clear of the arrow on both sides. Re-run it
with `node tools/make-mobile-plates.mjs` if either source plate changes.

**The Our Services rail.** Stacked, the five service cards run to several screens on a
phone, so below 640px they become a horizontal rail with the same mechanics as the
"Shop by category" row: scroll-snap, swipe, and a pair of round arrow buttons in the
section header. `site.js` clones those buttons from that section rather than rebuilding
them, so they carry its exact markup, inline styling and hover class, and it creates
them only while the viewport is actually narrow — which is what keeps the desktop DOM
identical to the handoff.

**Dropping slide 4.** CSS hides the slide and narrows the track from five panels to
four, so no gap is left behind. `assets/js/site.js` counts the panels that are actually
laid out rather than assuming five, and re-measures when the viewport crosses 640px, so
the slider's loop and its trailing clone stay correct in both layouts.

Two defects in the handoff's own mobile CSS are fixed here rather than reproduced,
because both are plainly bugs rather than design intent:

- `.about-photo` was left at its desktop `856x654px` while its mobile frame is 210px
  tall, so the photo overflowed by 444px and covered the copy beneath it.
- `.about-oem-logos` asks for four columns, but the handoff's later
  `[style*="grid-template-columns"] { grid-template-columns: 1fr }` rule matches at
  equal specificity and wins, stacking all eight logos in one column.

Verified at 1440, 1280, 1024, 1023, 768, 641, 640, 430, 414, 393, 390, 375 and 360: no
broken images, no overflowing elements, no clipped text beyond the design's own 2-line
clamp on long product names, and no horizontal scroll outside the 1024–1279 band
described above.

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
