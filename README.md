# L.A. Grinding Homepage

Production implementation of the **L.A. Grinding / Arizona Grinding homepage**, compiled
from the Claude Design handoff into plain static HTML, CSS and JavaScript.

This is a standalone project. It shares a build recipe with the separate Tree Care
Industry site but has its own repository, its own Vercel project and its own assets;
nothing here is deployed over that site.

**Live:** <https://la-grinding-homepage.vercel.app>

## What is shared with the Tree Care site, exactly

Both sites are compiled from the same Claude Design export, so the chrome is common —
but "the same" is worth stating precisely, because only one of the two is untouched:

| | Status |
| --- | --- |
| **Footer** | **Byte-identical.** Same 10,971 characters of markup from the same handoff; this project has never edited it. |
| **Navbar** | **Same component, two deliberate additions.** The markup is identical to the Tree Care export once the handoff's image deferral (`data-src` vs `src`) is normalised. On top of it this project adds a *Shop by OEM* section — a column in the Shop All dropdown and an accordion in the mobile drawer — and a mobile rule keeping the three phone numbers on one line. Nothing else in the nav differs. |
| **Page body** | **Different.** Everything between the header and the footer belongs to this project. |

Both claims above are checked by comparing the two repositories' handoffs directly,
not assumed from a shared origin.

---

## Live environment

| | |
| --- | --- |
| **Production URL** | <https://la-grinding-homepage.vercel.app> |
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
design-source/                   the Claude Design handoffs — the source of truth
  LA Grinding Homepage.dc.html     the original export: nav, footer and everything
                                     from "One partner makes it easier" down
  support.js                       the editor's React runtime (reference only, never shipped)
  _ds/industry-…/styles.css        the design system stylesheet
  refresh-2026-09/                 the September 2026 export: hero, products, About Us
    LA-Home-Takeuchi-C.dc.html       the page
    LA-Nav.dc.html                   its own nav — NOT used; this site keeps the original
assets/
  css/desktop.css                  desktop-only fix, all inside @media min-width 1024px
  css/mobile.css                   mobile-only refinements, all inside @media 640px
  js/site.js                       all page behaviour (no framework)
  uploads/                         130 images from the original handoff
    r26/                           54 images from the September 2026 refresh
tools/
  build.mjs                        the compiler: both handoffs -> dist/
  data.mjs                         executes the original handoff's renderVals()
  refresh-data.mjs                 the same for the refresh, once per UI state
  sync-assets.mjs                  copies the referenced images out of a handoff
  make-mobile-plates.mjs           draws the taller mobile hero plates
  strip-banner-logos.py            paints the printed logos out of the Freud banner
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
| the `<helmet><style>` block | copied out as `page.css`, near-verbatim (see below) |

Copying the `<style>` block rather than re-authoring it is what preserves the design's
responsive behaviour: its rules stay authoritative. The single change is that its
**responsive** rules are scoped away from the September 2026 sections. Those rules
target the old layout by shape rather than by name — `#page h2 { font-size: 28px
!important }`, `#page [style*="grid-template-columns"] { grid-template-columns: 1fr }`
— so they reached into the newer sections and overruled the sizing that design ships
inline. Each such selector gets `:not(.r26 *)` on its subject, 113 of them; the
unconditional rules, which are the page's base typography and colour, are untouched.
Verified by measuring every section below About Us against production: unchanged.

### Two handoffs, one page

The page is compiled from **two** Claude Design exports, spliced at build time:

| Part of the page | Comes from |
| --- | --- |
| Nav and footer | `LA Grinding Homepage.dc.html` (the original) |
| Hero, Products, About Us | `refresh-2026-09/LA-Home-Takeuchi-C.dc.html` |
| "One partner makes it easier" down to the photo strip | the original |

The refresh replaces three sections outright and nothing else; everything below About Us
still comes from the first export. The refresh also ships its own nav and footer, and
this project deliberately ignores both — see the table at the top of this file.

That design renders one state at a time (one hero slide, one open products panel, one
mini-card set) and a static page cannot, so `tools/refresh-data.mjs` runs its
`renderVals()` once per state and the build emits them all, each in the position the
design gives it, with `site.js` switching between them. It also ships two complete
layouts instead of one responsive tree, split at 1024px as the design splits it; both
are in the DOM and CSS picks (`.r26-desk` / `.r26-mob`).

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

That last one covers `COPY_FIXES` and `CARD_FIXES` in `tools/build.mjs`: wording,
labels and destinations changed after the handoff was exported are corrected at build
time rather than by editing `design-source/`, so that folder stays a faithful record of
what Claude Design produced.

- `COPY_FIXES` rewrites text across the document. It is only safe for strings that are
  unique, so each one is chosen to be: `"across California, Nevada and Arizona."` keeps
  its leading `across` because three other places name the same three states and must
  keep doing so.
- `ADDITIONS` in `tools/data.mjs` extends a list the design defines — currently two
  extra "Shop featured products" cards (Mulcher Teeth, Granulator screens). The card
  markup is the design's own, so an added entry inherits the existing size, spacing,
  type, hover and arrow behaviour; only the content is new. The build fails if the
  design no longer has the list being extended. Note the card has two text slots, an
  eyebrow and a name, so a product and its description share the name field with an em
  dash — the pattern the design's own cards already use.
- `EDITS` in `tools/data.mjs` changes entries the design already defines — currently the
  Shop-by-category card that was "Serrated Tape Knives" (renamed, repointed and given
  its own photo) and the Tree Care card's image. Each edit names the lists it applies
  to: the rail is built from `cats` but the menus use a separate `mobileCats` slice, and
  by that point the two hold different objects, so a shared entry must be edited in
  both. It fails the build if a name no longer matches.
- `TEMPLATE_PATCHES` in `tools/build.mjs` rewrites the handoff's dc markup before the
  dialect is resolved, for changes data alone cannot express — currently the distributor
  strip, whose cells became links around manufacturer logos. Each patch fails the build
  if the markup it expects is gone.
- `CARD_FIXES` renames the five category cards and, where needed, repoints them. These
  cannot be document-wide replacements — "Saw Blades" appears 13 times across the page
  and "Shear Blades" 10, in menus and category rails that keep their own wording — so
  the build walks the `<a class="panel-card">` blocks and rewrites only inside the one
  card whose image `alt` matches. It fails if a fix matches no card or more than one.

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

The wedge is also stepped right, from the handoff's 38.757% to 43%. At the handoff
position the navy's leftmost tip lands at 39.9% while the OEM logo grid's right-hand
column runs to 42.2%, so the Carlton logo sat on navy — by 73px at 1440. At 43% the tip
is at 44.1%, measured clear of the headline, the OEM heading, the brand list and all
eight logos at every width.

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

- **Hero slider** — 5 slides, one `<section>` each, switched by `hidden`. Auto-advances
  every 9s; driven by the arrows, the dots, a touch swipe (>40px horizontal, and more
  horizontal than vertical), and a two-finger trackpad gesture. The trackpad handler
  accumulates travel rather than testing a single event, and cancels the gesture so the
  browser cannot claim it as a back/forward navigation. Slide 2 carries two dropdowns
  of mini cards, which pause the carousel while open.
- **Sticky header** — condenses on scroll (util row 52→40px, nav row 96→76px, shadow
  on), driven by a 1px sentinel rather than a fixed scroll offset.
- **Shop All / Services mega-menus** — open on hover, close on leave.
- **Search** — suggestion panel on focus, closing 160ms after blur so a click on a
  suggestion still registers.
- **Category / product / review rails** — arrow buttons nudge by 780px.
- **Mobile drawer** — hamburger toggles it; five accordion groups (Category, Industry,
  OEM, Brand, Services), one open at a time, with the trailing glyph switching between
  `+` and `–`.
- **Products grid** — each card opens its own panel of links: below the grid on desktop,
  inline at the end of the card's row on mobile, as the design does it.
- **OEM strip under About Us** — white marks at rest; on hover the cell lightens and the
  mark shows its real colours, and each one links to that make's shop filter.
- **Distributor logo strip** — below 640px it steps one logo per second and wraps,
  pausing 2.5s whenever it is touched, and respecting `prefers-reduced-motion`.

---

## Assets

`assets/uploads/` holds the 130 images the original handoff uses, and `uploads/r26/`
the 54 the September 2026 refresh adds, all copied out of their handoffs unmodified.
They are the real photography and logos from the design — nothing is a placeholder.

One exception, and it is deliberate: the Freud & Diablo banner shipped with both logos
printed into its artwork, and the hero draws its own over the same spot. They are
painted out by `tools/strip-banner-logos.py`, which is reproducible and documents the
method; the untouched originals are the handoff's own `assets/cr/B-2.png` and `B-2m.png`.

The design also hot-links 29 images from `lagrinding.com/wp-content/uploads/` (review
thumbnails, the service-area map, some product and brand logos). Those are left pointing
at the client's own CDN exactly as the design authored them, so the page picks up any
update made there.

---

## Deployment

Live at **<https://la-grinding-homepage.vercel.app>**, from the `la-grinding-homepage`
Vercel project, deployed off `main`.

Vercel builds with `npm run build` and serves `dist/` (see `vercel.json`). Deploy from
this directory:

```bash
vercel --prod --yes
```

This project has no `.vercel/` link committed, so confirm the target project is
`la-grinding-homepage` before deploying — never the Tree Care one.

After a deploy the served page should match the local build exactly:

```bash
curl -s https://la-grinding-homepage.vercel.app/ -o /tmp/prod.html
cmp dist/index.html /tmp/prod.html && echo "production matches the local build"
```
