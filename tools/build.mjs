/**
 * Compiles the Claude Design handoff (design-source/LA Grinding Homepage.dc.html)
 * into a static, dependency-free production page.
 *
 * Page data is not written out by hand: tools/data.mjs executes the design's own
 * renderVals() so the content model cannot drift from the design.
 *
 * The handoff is authored in Claude Design's `dc` template dialect, which is
 * rendered in the editor by a React + Babel runtime loaded from a CDN. That is
 * fine for a mockup and unacceptable for production, so this build resolves the
 * whole dialect ahead of time:
 *
 *   <sc-for list="{{ xs }}" as="x">   ->  the markup, repeated, with {{ x.* }} filled in
 *   <sc-if  value="{{ flag }}">       ->  unwrapped when statically true, or marked
 *                                         as a runtime panel when it is interactive
 *   {{ expr }}                        ->  the value, HTML-escaped
 *   style-hover / style-active        ->  real CSS :hover / :active rules
 *   onClick / onMouseEnter / ref      ->  data-* hooks wired up by assets/js/site.js
 *
 * Output: everything the site needs, written into dist/ — source files are never
 * modified, so dist/ can be deleted and regenerated at any time.
 */

import { readFile, readdir, writeFile, mkdir, rm, cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { data, handlerNames, refNamesList } from "./data.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "design-source", "LA Grinding Homepage.dc.html");
const DESIGN_SYSTEM = join(
  ROOT, "design-source", "_ds", "industry-4d598bcf-ed61-4905-862f-a72479e9ff93", "styles.css"
);
const OUT = join(ROOT, "dist");

/* The menus, search panel and mobile drawer are conditional in the design because
 * the editor re-renders on state change. In the shipped page they are always in the
 * DOM and toggled by site.js, so each one is tagged instead of dropped.
 *
 * `showMobile` and `showCaptions` are deliberately absent: they are editor props,
 * not interactions, so the build resolves them statically to the design's defaults
 * (mobile-nav concept off, industry tile captions on) exactly as the canvas shows. */
/* Where the CTAs that the design leaves as bare fragments should point. */
const LIVE_SITE = "https://lagrinding.com/";

const RUNTIME_PANELS = {
  shopOpen: "shop",
  servicesOpen: "services",
  searchOpen: "search",
  // Mobile drawer and its accordion groups (V2 responsive design).
  drawerOpen: "drawer",
  accCat: "acc-cat",
  accInd: "acc-ind",
  accBrand: "acc-brand",
  accSvc: "acc-svc"
};

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr"
]);

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Resolves `x`, `x.y` against the loop scope first, then the page data. */
function resolve(expr, scope) {
  const path = expr.trim().split(".");
  let value = Object.prototype.hasOwnProperty.call(scope, path[0])
    ? scope[path[0]]
    : data[path[0]];
  for (let i = 1; i < path.length; i += 1) {
    if (value == null) return undefined;
    value = value[path[i]];
  }
  return value;
}

/* ---------- template directives ---------- */

/**
 * Finds the first `<tag ...>` at or after `from` and returns it together with the
 * index range of its matching close tag, honouring nesting of the same tag name.
 */
function findBlock(html, tag, from = 0) {
  const open = new RegExp(`<${tag}(\\s[^>]*)?>`, "g");
  open.lastIndex = from;
  const start = open.exec(html);
  if (!start) return null;

  const scanner = new RegExp(`<${tag}(?:\\s[^>]*)?>|</${tag}>`, "g");
  scanner.lastIndex = start.index;
  let depth = 0;
  let match;
  while ((match = scanner.exec(html))) {
    depth += match[0].startsWith(`</`) ? -1 : 1;
    if (depth === 0) {
      return {
        openStart: start.index,
        innerStart: start.index + start[0].length,
        innerEnd: match.index,
        end: match.index + match[0].length,
        attrs: start[1] || ""
      };
    }
  }
  throw new Error(`Unclosed <${tag}> in template`);
}

const readAttr = (attrs, name) => {
  const match = attrs.match(new RegExp(`${name}="([^"]*)"`));
  return match ? match[1] : null;
};

const unwrapExpr = (value) => {
  const match = value && value.match(/^\{\{\s*(.+?)\s*\}\}$/);
  return match ? match[1] : null;
};

/** Adds attributes to the first element tag found in a fragment. */
function addAttrsToFirstTag(html, extra) {
  return html.replace(/<([a-zA-Z][\w-]*)((?:\s[^>]*?)?)(\/?)>/, (m, tag, attrs, close) =>
    `<${tag}${attrs} ${extra}${close}>`
  );
}

function expandDirectives(html, scope) {
  // sc-for: expand the body once per item, with the loop variable in scope.
  for (;;) {
    const block = findBlock(html, "sc-for");
    if (!block) break;

    const listExpr = unwrapExpr(readAttr(block.attrs, "list"));
    const alias = readAttr(block.attrs, "as");
    if (!listExpr || !alias) throw new Error(`<sc-for${block.attrs}> is missing list/as`);

    const items = resolve(listExpr, scope);
    if (!Array.isArray(items)) throw new Error(`<sc-for list="${listExpr}"> did not resolve to an array`);

    const body = html.slice(block.innerStart, block.innerEnd);
    const expanded = items
      .map((item) => expandDirectives(body, { ...scope, [alias]: item }))
      .join("");

    html = html.slice(0, block.openStart) + expanded + html.slice(block.end);
  }

  // sc-if: statically true conditions are unwrapped; interactive ones become panels.
  for (;;) {
    const block = findBlock(html, "sc-if");
    if (!block) break;

    const condition = unwrapExpr(readAttr(block.attrs, "value"));
    let body = html.slice(block.innerStart, block.innerEnd);

    if (condition in RUNTIME_PANELS) {
      body = addAttrsToFirstTag(body, `data-panel="${RUNTIME_PANELS[condition]}" hidden`);
    } else if (!resolve(condition, scope)) {
      body = "";
    }

    html = html.slice(0, block.openStart) + body + html.slice(block.end);
  }

  // Resolve while this scope is still current; outer scopes fill in on the way up.
  return interpolate(html, scope);
}

/** Fills in `{{ expr }}` occurrences, leaving handler bindings for the next pass. */
function interpolate(html, scope) {
  return html.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (whole, expr) => {
    const value = resolve(expr, scope);
    return value === undefined || value === null ? whole : escapeHtml(value);
  });
}

/* ---------- interaction styles ---------- */

class StyleSheet {
  constructor() {
    this.rules = new Map(); // declarations -> class name
    this.order = [];
  }

  classFor(declarations, state) {
    const normalised = declarations
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => (/!important$/.test(d) ? d : `${d} !important`))
      .join("; ");

    const key = `${state}|${normalised}`;
    if (!this.rules.has(key)) {
      const name = `dc-${state === "hover" ? "h" : "a"}${this.rules.size}`;
      this.rules.set(key, name);
      this.order.push({ name, state, declarations: normalised });
    }
    return this.rules.get(key);
  }

  toCss() {
    // :hover first, then :active, so a pressed element wins over the hover rule.
    const byState = (want) => this.order.filter((r) => r.state === want);
    const render = (r) => `.${r.name}:${r.state} { ${r.declarations}; }`;
    return [
      "/* Generated by tools/build.mjs from style-hover / style-active in the design handoff. */",
      "/* Declarations are !important because the design applies every base style inline. */",
      "",
      ...byState("hover").map(render),
      "",
      ...byState("active").map(render),
      ""
    ].join("\n");
  }
}

/** Turns style-hover / style-active into classes, and handler/ref bindings into data hooks. */
function lowerInteractions(html, sheet) {
  const handlers = {
    onClick: "data-on-click",
    onMouseEnter: "data-on-mouseenter",
    onMouseLeave: "data-on-mouseleave",
    onFocus: "data-on-focus",
    onBlur: "data-on-blur"
  };

  return html.replace(/<([a-zA-Z][\w-]*)((?:\s[^>]*?)?)(\/?)>/g, (whole, tag, attrs, close) => {
    if (!/style-hover=|style-active=|ref="\{\{|on[A-Z]\w+="\{\{/.test(attrs)) return whole;

    const added = [];

    attrs = attrs.replace(/\s*style-(hover|active)="([^"]*)"/g, (_m, state, decls) => {
      added.push(sheet.classFor(decls, state));
      return "";
    });

    attrs = attrs.replace(/\s*ref="\{\{\s*([^}]+?)\s*\}\}"/g, (_m, name) => ` data-ref="${name.trim()}"`);

    for (const [prop, attr] of Object.entries(handlers)) {
      attrs = attrs.replace(
        new RegExp(`\\s*${prop}="\\{\\{\\s*([^}]+?)\\s*\\}\\}"`, "g"),
        (_m, name) => ` ${attr}="${name.trim()}"`
      );
    }

    if (added.length) {
      const existing = attrs.match(/\sclass="([^"]*)"/);
      if (existing) {
        attrs = attrs.replace(existing[0], ` class="${existing[1]} ${added.join(" ")}"`);
      } else {
        attrs += ` class="${added.join(" ")}"`;
      }
    }

    return `<${tag}${attrs}${close}>`;
  });
}

/* ---------- document assembly ---------- */

function section(html, open, close) {
  const start = html.indexOf(open);
  const end = html.indexOf(close, start);
  if (start === -1 || end === -1) throw new Error(`Could not locate ${open} … ${close}`);
  return html.slice(start + open.length, end);
}

const source = await readFile(SOURCE, "utf8");

const helmet = section(source, "<helmet>", "</helmet>");
const pageStyles = section(helmet, "<style>", "</style>");

// Everything after </helmet> up to </x-dc> is the artboard markup.
const template = section(source, "</helmet>", "</x-dc>");

/* ---------- template patches ---------- *
 *
 * Applied to the handoff's dc markup before the dialect is resolved, for changes that
 * data alone cannot express. Like the copy and card fixes, they live here so that
 * design-source/ stays a faithful record of what Claude Design exported, and each one
 * fails the build if the markup it expects is gone.
 */
const TEMPLATE_PATCHES = [
  {
    why: "The distributor strip shows manufacturer logos only — no names, no product " +
         "counts — drawn from the design's own brand list so each keeps its existing " +
         "destination. The cells become links and pick up the brand cards' hover.",
    from:
      '        <sc-for list="{{ brandLogos }}" as="l" hint-placeholder-count="18">\n' +
      '          <div style="background: #ffffff; height: 108px; display: flex; align-items: center; justify-content: center; padding: 16px">\n' +
      '            <img data-src="{{ l.img }}" alt="{{ l.name }}" style="max-width: 100%; max-height: 62px; width: auto; height: auto; object-fit: contain; filter: grayscale(1); opacity: 0.75" style-hover="filter: none; opacity: 1">\n' +
      '          </div>\n' +
      '        </sc-for>',
    to:
      '        <sc-for list="{{ distributorBrands }}" as="b" hint-placeholder-count="15">\n' +
      // The <div> stays: every responsive rule for this strip is written against
      // `#page .logos > div`, so replacing it with the link would break all of them.
      '          <div style="position: relative; background: #ffffff; height: 108px; display: flex; align-items: center; justify-content: center; padding: 16px">\n' +
      // inset:0 makes the whole cell clickable, including its padding; padding:inherit
      // keeps the logo inset by whatever the responsive rules give the cell.
      '            <a class="logo-link" href="{{ b.href }}" aria-label="{{ b.name }}" style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: inherit">\n' +
      '              <img data-src="{{ b.logo }}" alt="{{ b.name }}" style="max-width: 100%; max-height: 62px; width: auto; height: auto; object-fit: contain">\n' +
      '            </a>\n' +
      '          </div>\n' +
      '        </sc-for>'
  },
  {
    why: "Fifteen logos divide evenly into five columns, so the strip no longer ends " +
         "on a part-empty row the way nine columns left it.",
    from: '<div class="g-mob-3 logos" style="display: grid; grid-template-columns: repeat(9, 1fr);',
    to:   '<div class="g-mob-3 logos" style="display: grid; grid-template-columns: repeat(5, 1fr);'
  }
];

TEMPLATE_PATCHES.push(
  {
    why: "The Shop by OEM grid lists equipment manufacturers, not the brand catalogue. " +
         "Matched together with the card's opening tag because the same sc-for also " +
         "appears in the mega-menu, which keeps the brand list.",
    from:
      '        <sc-for list="{{ brands }}" as="b" hint-placeholder-count="18">\n' +
      '          <a href="{{ b.href }}" class="brand-card"',
    to:
      '        <sc-for list="{{ oems }}" as="b" hint-placeholder-count="15">\n' +
      '          <a href="{{ b.href }}" class="brand-card"'
  },
  {
    why: "Each OEM card shows the logo and the name only — the product counts and " +
         "'Official distributor' line come from this span.",
    from: '            <span style="font-size: 12px; color: #6b7280; letter-spacing: 0.04em">{{ b.meta }}</span>\n',
    to: ''
  }
);

let patched = template;
for (const { from, to, why } of TEMPLATE_PATCHES) {
  const hits = patched.split(from).length - 1;
  if (hits !== 1) {
    throw new Error(`Template patch matched ${hits} times, expected 1 — ${why}`);
  }
  patched = patched.replace(from, to);
}

const sheet = new StyleSheet();

let body = expandDirectives(patched, {});
body = lowerInteractions(body, sheet);

// The canvas thumbnail is editor chrome, not page content.
body = body.replace(/<template id="__bundler_thumbnail">[\s\S]*?<\/template>/, "");

/* The design defers 127 images behind `data-src`, promoted to `src` by a polling
 * script in its <helmet>. That script exists only because the editor would otherwise
 * try to fetch an unresolved `{{ … }}` placeholder as a URL. This build resolves the
 * placeholders ahead of time, so the indirection is resolved here too: the images get
 * a real `src` and load with the document instead of waiting for a timer. */
let promoted = 0;
body = body.replace(/<img\s([^>]*)>/g, (whole, attrs) => {
  if (!/\sdata-src="/.test(` ${attrs}`) || /\ssrc="/.test(` ${attrs}`)) return whole;
  promoted += 1;
  return `<img ${attrs.replace(/(^|\s)data-src="/, '$1src="')}>`;
});
if (body.includes("data-src=")) throw new Error("An <img data-src> survived: it would render blank");

// Assets ship under assets/uploads/ rather than the project-root uploads/.
body = body.replace(/(src|href)="uploads\//g, '$1="assets/uploads/');

// The design leaves the quote and pickup CTAs as bare anchors (#requestModal,
// #pickupModal) with no modal on the page. They resolve to the live site, which
// owns those modals. Only bare fragments are rewritten — anchors that already
// carry a full URL are left alone.
for (const fragment of ["requestModal", "pickupModal"]) {
  body = body.replaceAll(`href="#${fragment}"`, `href="${LIVE_SITE}#${fragment}"`);
}

/* Fail loudly if the design binds a handler or ref the build did not expect, or one
 * that assets/js/site.js does not implement — otherwise a redesign silently ships an
 * interaction that does nothing. */
const siteJs = await readFile(join(ROOT, "assets", "js", "site.js"), "utf8");

const boundHandlers = [...body.matchAll(/data-on-[a-z]+="([^"]+)"/g)].map((m) => m[1]);
for (const name of new Set(boundHandlers)) {
  if (!handlerNames.has(name)) {
    throw new Error(`Template binds handler "${name}" that renderVals() does not define`);
  }
  if (!siteJs.includes(name)) {
    throw new Error(`Handler "${name}" is bound in the design but not implemented in assets/js/site.js`);
  }
}

const boundRefs = [...body.matchAll(/data-ref="([^"]+)"/g)].map((m) => m[1]);
for (const name of new Set(boundRefs)) {
  if (!refNamesList.includes(name)) {
    throw new Error(`Template binds ref "${name}" that renderVals() does not define`);
  }
  if (!siteJs.includes(name)) {
    throw new Error(`Ref "${name}" is bound in the design but never read by assets/js/site.js`);
  }
}

/* Copy corrections applied on top of the handoff, so design-source/ stays a faithful
 * record of what Claude Design exported. Each one fails the build if its text is no
 * longer present, rather than silently going stale when the design is re-exported. */
const COPY_FIXES = [
  // The "/ Reno" qualifier was dropped from the Saw Blades category card.
  ["Saw Blades / Reno", "Saw Blades"],
  // Commercial Orders now states nationwide coverage. The leading "across " keeps this
  // unique: three other places name the same three states and must keep doing so.
  ["across California, Nevada and Arizona.", "Nationwide across the U.S."],
  // The distributor strip's heading now reads "Based in" rather than "Serving".
  ["Serving California, Nevada, and Arizona", "Based in California, Nevada, and Arizona"],
  // "Shop by brand" becomes "Shop by OEM".
  ["Shop by brand", "Shop by OEM"],
  ["Machine-matched blades and parts by manufacturer.",
   "OEM-compatible blades and replacement parts matched to your equipment manufacturer."],
  ["All brands", "All OEMs"]
];
for (const [from, to] of COPY_FIXES) {
  if (!body.includes(from)) {
    throw new Error(`Copy fix is stale: "${from}" no longer appears in the design`);
  }
  body = body.replaceAll(from, to);
}

/* Corrections to the five category cards: their label, and where they point.
 *
 * Each card is found by the alt text it currently carries, and only the markup inside
 * that one <a class="panel-card"> … </a> is rewritten. A blanket replacement is not an
 * option here: "Saw Blades" appears 13 times across the page and "Shear Blades" 10, in
 * menus and category lists that must keep their own wording.
 *
 * `label` renames both the visible heading and the image's alt, so the link is
 * announced consistently; `href` is optional and only set where the destination was
 * also wrong. Nothing about the imagery changes. */
const CARD_FIXES = [
  { find: "Shear Blades",                    label: "Printing & Binding" },
  { find: "Granulator Knives & Screens",     label: "Granulators / Recycling & Plastics" },
  { find: "Saw Blades",                      label: "Diablo & Freud Parts" },
  // Sharpening Support also pointed at the brush chipper knives category.
  { find: "Sharpening Support",              label: "Sharpening",
    href: "https://lagrinding.com/sharpening/" }
];

/* Matched by walking the panel cards themselves: the same alt text also appears in the
 * mega-menu and the category rails, so searching the whole document would be ambiguous
 * (and the build refuses rather than guess — that is how this was caught). */
const cardRe = /<a class="panel-card" href="([^"]*)"[\s\S]*?<\/a>/g;
const applied = new Map(CARD_FIXES.map((f) => [f.find, 0]));

body = body.replace(cardRe, (block, currentHref) => {
  const altMatch = block.match(/\salt="([^"]*)"/);
  if (!altMatch) return block;
  const fix = CARD_FIXES.find((f) => escapeHtml(f.find) === altMatch[1]);
  if (!fix) return block;

  applied.set(fix.find, applied.get(fix.find) + 1);
  const label = escapeHtml(fix.label);

  let out = block.replace(altMatch[0], ` alt="${label}"`);
  if (fix.href) out = out.replace(`href="${currentHref}"`, `href="${fix.href}"`);

  const headRe = /(<span class="panel-head"[^>]*>)[^<]*(<\/span>)/;
  if (!headRe.test(out)) throw new Error(`Card fix: no heading in the card for "${fix.find}"`);
  return out.replace(headRe, `$1${label}$2`);
});

for (const [find, count] of applied) {
  if (count !== 1) {
    throw new Error(`Card fix for "${find}" matched ${count} cards, expected exactly 1`);
  }
}

const leftoverExpr = body.match(/\{\{[^}]*\}\}/);
if (leftoverExpr) throw new Error(`Unresolved template expression: ${leftoverExpr[0]}`);
const leftoverTag = body.match(/<sc-[a-z]+/);
if (leftoverTag) throw new Error(`Unresolved template directive: ${leftoverTag[0]}`);

/* Every local image the page asks for must exist. The design builds some paths by
 * concatenation, so a missing file is easy to introduce and invisible until the page
 * renders a blank box — run `node tools/sync-assets.mjs "<handoff folder>"` to fix. */
const localAssets = new Set(
  [...body.matchAll(/(?:src|href)="assets\/uploads\/([^"]+)"/g)].map((m) => decodeURIComponent(m[1]))
);
const onDisk = new Set(await readdir(join(ROOT, "assets", "uploads")));
const absent = [...localAssets].filter((name) => !onDisk.has(name)).sort();
if (absent.length) {
  throw new Error(
    `${absent.length} referenced asset(s) missing from assets/uploads/:\n  ` + absent.join("\n  ")
  );
}

// Start from a clean dist/ so removed source files never linger in a deploy.
await rm(OUT, { recursive: true, force: true });
await mkdir(join(OUT, "assets", "css"), { recursive: true });

// Static assets are copied through untouched.
await cp(join(ROOT, "assets"), join(OUT, "assets"), { recursive: true });
await cp(DESIGN_SYSTEM, join(OUT, "assets", "css", "design-system.css"));

/* Hover for the distributor strip's logo cells, matching the brand cards: the greyscale
 * lifts and the cell tints. Written here rather than in desktop.css or mobile.css
 * because it applies at every width, and those two are deliberately scoped. */
const STRIP_CSS = `
/* Distributor strip — logo cells are links (see TEMPLATE_PATCHES in tools/build.mjs). */
.logo-link img { filter: grayscale(1); opacity: 0.75; transition: filter 200ms ease, opacity 200ms ease; }
.logo-link:hover img, .logo-link:active img, .logo-link:focus-visible img { filter: none; opacity: 1; }
.logo-link:hover, .logo-link:focus-visible { background: #F2F2F3; }
`;

await writeFile(join(OUT, "assets", "css", "site.css"), sheet.toCss() + STRIP_CSS, "utf8");

const document = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>L.A. Grinding &amp; Arizona Grinding — Industrial Blades, Parts &amp; Professional Sharpening</title>
<meta name="description" content="L.A. Grinding and Arizona Grinding supply precision-ground replacement blades, knives and teeth and provide professional industrial sharpening for tree care, metal, paper, printing, corrugated, packaging, plastics, ice rinks and woodworking — shipping nationwide, with pickup and delivery across CA, NV and AZ.">
<link rel="icon" href="assets/uploads/logo-la-arizona-grinding.webp">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&amp;family=Barlow:wght@400;500;600;700&amp;display=swap" rel="stylesheet">
<link rel="stylesheet" href="assets/css/design-system.css">
<link rel="stylesheet" href="assets/css/page.css">
<link rel="stylesheet" href="assets/css/site.css">
<!-- Desktop-only corrections; every rule is inside @media (min-width: 1024px). -->
<link rel="stylesheet" href="assets/css/desktop.css">
<!-- Mobile-only refinements; every rule is inside @media (max-width: 640px). -->
<link rel="stylesheet" href="assets/css/mobile.css">
</head>
<body>
${body.trim()}
<script src="assets/js/site.js" defer></script>
</body>
</html>
`;

await writeFile(join(OUT, "index.html"), document, "utf8");

// The design's own <style> block, kept verbatim so its rules stay authoritative.
await writeFile(
  join(OUT, "assets", "css", "page.css"),
  `/* Copied verbatim from the <style> block in the design handoff. */\n${pageStyles.trim()}\n\n` +
    `/* Panels that the design renders conditionally are always in the DOM here. */\n` +
    `[data-panel][hidden] { display: none !important; }\n`,
  "utf8"
);

console.log(
  `built dist/  (index.html ${document.length.toLocaleString()} bytes, ` +
    `${sheet.order.length} interaction rules, ${promoted} images un-deferred, ` +
    `${localAssets.size} local assets, ` +
    `${new Set(boundHandlers).size} handlers, ${new Set(boundRefs).size} refs)`
);
