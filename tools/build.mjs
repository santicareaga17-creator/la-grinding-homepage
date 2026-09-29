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
import * as refresh from "./refresh-data.mjs";

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
  accSvc: "acc-svc",
  // Shop by OEM, added to the drawer by TEMPLATE_PATCHES below.
  accOem: "acc-oem"
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
    onBlur: "data-on-blur",
    // The refresh hero is swipeable, so it binds pointer events too.
    onTouchStart: "data-on-touchstart",
    onTouchEnd: "data-on-touchend",
    onWheel: "data-on-wheel"
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
    why: "The distributor strip shows manufacturer logos only — no names, no " +
         "product counts. A row the shop can filter on becomes a link and picks up " +
         "the brand cards' hover; a row with no destination stays the plain image " +
         "the design shipped, hovering the same way. Both look identical at rest.",
    from:
      '        <sc-for list="{{ brandLogos }}" as="l" hint-placeholder-count="18">\n' +
      '          <div style="background: #ffffff; height: 108px; display: flex; align-items: center; justify-content: center; padding: 16px">\n' +
      '            <img data-src="{{ l.img }}" alt="{{ l.name }}" style="max-width: 100%; max-height: 62px; width: auto; height: auto; object-fit: contain; filter: grayscale(1); opacity: 0.75" style-hover="filter: none; opacity: 1">\n' +
      '          </div>\n' +
      '        </sc-for>',
    to:
      '        <sc-for list="{{ distributorBrands }}" as="b" hint-placeholder-count="33">\n' +
      // The <div> stays: every responsive rule for this strip is written against
      // `#page .logos > div`, so replacing it with the link would break all of them.
      '          <div style="position: relative; background: #ffffff; height: 108px; display: flex; align-items: center; justify-content: center; padding: 16px">\n' +
      '            <sc-if value="{{ b.href }}">\n' +
      // inset:0 makes the whole cell clickable, including its padding; padding:inherit
      // keeps the logo inset by whatever the responsive rules give the cell.
      '              <a class="logo-link" href="{{ b.href }}" aria-label="{{ b.name }}" style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: inherit">\n' +
      '                <img data-src="{{ b.logo }}" alt="{{ b.name }}" style="max-width: 100%; max-height: 62px; width: auto; height: auto; object-fit: contain">\n' +
      '              </a>\n' +
      '            </sc-if>\n' +
      '            <sc-if value="{{ b.unlinked }}">\n' +
      '              <img data-src="{{ b.logo }}" alt="{{ b.name }}" style="max-width: 100%; max-height: 62px; width: auto; height: auto; object-fit: contain; filter: grayscale(1); opacity: 0.75" style-hover="filter: none; opacity: 1">\n' +
      '            </sc-if>\n' +
      '          </div>\n' +
      '        </sc-for>'
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
,
  {
    why:
      "Shop by OEM sits under Shop by Brand in the dropdown's third column, " +
      "six priority manufacturers deep. Heading, link and grid styles are " +
      "the column's own, so the section is indistinguishable from the one " +
      "above it. 'View all OEMs' jumps to the page's OEM grid rather than " +
      "listing all of them here, closing the menu on the way with the " +
      "dropdown's own closeMenus — it is the one link that does not " +
      "navigate away from the page.",
    from:
      '            <a href="https://lagrinding.com/shop/" style="display: inline-block; margin-top: 16px; font-family: \'Barlow Condensed\', sans-serif; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; font-size: 13px; color: #0B2A4A; border-bottom: 2px solid #EA4E32; padding-bottom: 3px">View the full catalog</a>\n' +
      '          </div>',
    to:
      '            <a href="https://lagrinding.com/shop/" style="display: inline-block; margin-top: 16px; font-family: \'Barlow Condensed\', sans-serif; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; font-size: 13px; color: #0B2A4A; border-bottom: 2px solid #EA4E32; padding-bottom: 3px">View the full catalog</a>\n' +
      '            <div style="margin-top: 26px; font-family: \'Barlow Condensed\', sans-serif; font-weight: 700; text-transform: uppercase; letter-spacing: 0.14em; font-size: 12.5px; color: #EA4E32; padding-bottom: 10px; border-bottom: 1px solid #d4d4d7">Shop by OEM</div>\n' +
      '            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2px 20px; margin-top: 14px">\n' +
      '              <sc-for list="{{ menuOems }}" as="o" hint-placeholder-count="6">\n' +
      '                <a href="{{ o.href }}" style="font-size: 14px; color: #1d1f20; padding: 6px 0" style-hover="color: #EA4E32">{{ o.name }}</a>\n' +
      '              </sc-for>\n' +
      '            </div>\n' +
      '            <a href="#shop-by-oem" onClick="{{ closeMenus }}" style="display: inline-block; margin-top: 16px; font-family: \'Barlow Condensed\', sans-serif; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; font-size: 13px; color: #0B2A4A; border-bottom: 2px solid #EA4E32; padding-bottom: 3px">View all OEMs</a>\n' +
      '          </div>'
  },
  {
    why:
      "The drawer gets the same section above Shop by Brand, listing every " +
      "OEM: a phone accordion scrolls, so there is nothing to shorten. It " +
      "reuses the design's own trigger markup and one-open-at-a-time " +
      "accordion behaviour.",
    from:
      '        <button type="button" onClick="{{ accBrandT }}" style="width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px; min-height: 52px; background: #ffffff; border: 0; border-bottom: 1px solid #e7e7ea; cursor: pointer; font-family: \'Barlow Condensed\', sans-serif; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; font-size: 16px; color: #0B2A4A">Shop by Brand<span style="color: #EA4E32; font-size: 20px; line-height: 1">+</span></button>\n',
    to:
      '        <button type="button" onClick="{{ accOemT }}" style="width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px; min-height: 52px; background: #ffffff; border: 0; border-bottom: 1px solid #e7e7ea; cursor: pointer; font-family: \'Barlow Condensed\', sans-serif; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; font-size: 16px; color: #0B2A4A">Shop by OEM<span style="color: #EA4E32; font-size: 20px; line-height: 1">+</span></button>\n' +
      '        <sc-if value="{{ accOem }}" hint-placeholder-val="{{ false }}">\n' +
      '          <div style="display: flex; flex-direction: column; background: #F2F2F3">\n' +
      '            <sc-for list="{{ oems }}" as="o" hint-placeholder-count="15">\n' +
      '              <a href="{{ o.href }}" style="padding: 13px 16px; font-size: 15px; color: #1d1f20; border-bottom: 1px solid #e7e7ea">{{ o.name }}</a>\n' +
      '            </sc-for>\n' +
      '          </div>\n' +
      '        </sc-if>\n' +
      '        <button type="button" onClick="{{ accBrandT }}" style="width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px; min-height: 52px; background: #ffffff; border: 0; border-bottom: 1px solid #e7e7ea; cursor: pointer; font-family: \'Barlow Condensed\', sans-serif; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; font-size: 16px; color: #0B2A4A">Shop by Brand<span style="color: #EA4E32; font-size: 20px; line-height: 1">+</span></button>\n'
  },
  {
    why:
      "The dropdown's 'View all OEMs' link needs somewhere to land. " +
      "scroll-margin clears the sticky header so the heading is not hidden " +
      "under it.",
    from:
      '  <section data-screen-label="Shop by Brand" style="background: #ffffff">',
    to:
      '  <section id="shop-by-oem" data-screen-label="Shop by Brand" style="background: #ffffff; scroll-margin-top: 112px">'
  }
,
  {
    why:
      "The Shop by Industry section is removed from the homepage. The dropdown " +
      "and the drawer keep their own Shop by Industry lists, which read the same " +
      "`shopIndustries` data and are untouched.",
    from:
      '  <section data-screen-label="Shop by Industry" style="background: #ffffff">\n' +
      '    <div style="max-width: 1360px; margin: 0 auto; padding: 64px 40px 0">\n' +
      '      <h2 style="font-family: \'Barlow Condensed\', sans-serif; font-weight: 600; text-transform: uppercase; font-size: 46px; line-height: 1; color: #0B2A4A; margin: 0">Shop by industry</h2>\n' +
      '      <p style="font-size: 16px; color: #4b5563; margin: 12px 0 0">Filter the catalog to the products your operation runs.</p>\n' +
      '      <div class="g-mob-2" style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 16px; margin-top: 32px">\n' +
      '        <sc-for list="{{ shopIndustries }}" as="i" hint-placeholder-count="10">\n' +
      '          <a href="{{ i.href }}" class="ind-card" style="border: 1px solid #d4d4d7; background: #ffffff; padding: 24px 16px 22px; color: #1d1f20; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 4px; min-height: 250px; justify-content: flex-start" style-hover="border-color: #EA4E32; background: #F2F2F3">\n' +
      '            <span style="width: 100%; height: 156px; display: flex; align-items: center; justify-content: center; margin-bottom: 12px">\n' +
      '              <img data-src="{{ i.icon }}" alt="{{ i.name }}" style="max-height: 156px; max-width: 100%; width: auto; height: auto; object-fit: contain">\n' +
      '            </span>\n' +
      '            <span style="font-family: \'Barlow Condensed\', sans-serif; font-weight: 600; text-transform: uppercase; font-size: 18px; line-height: 1.08; color: #0B2A4A">{{ i.name }}</span>\n' +
      '          </a>\n' +
      '        </sc-for>\n' +
      '      </div>\n' +
      '    </div>\n' +
      '  </section>\n' +
      '\n' +
      '',
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

/* ---------- September 2026 refresh ---------- *
 *
 * Three sections — the hero, the category grid and About Us — are replaced by a second
 * handoff, design-source/refresh-2026-09/. Everything below About Us still comes from
 * the original one, so the two are compiled separately and the result is spliced in
 * here, before the main pass runs: the refresh markup arrives with its directives
 * already resolved but its `style-hover` and handler bindings intact, so it picks up
 * the same hover lowering and the same handler checks as the rest of the page.
 *
 * That design renders one state at a time — one hero slide, one open category menu —
 * and the shipped page cannot, so each state is rendered here and site.js switches
 * between them. Sections are emitted whole rather than split into layers: duplicating
 * the hero's action row four times costs a little markup and keeps every slide's own
 * geometry exactly as the design wrote it.
 */

const refreshSource = await readFile(refresh.REFRESH_SOURCE, "utf8");
let refreshTemplate = section(refreshSource, "</helmet>", "</x-dc>");

/* Patches to the refresh handoff, for the same reason TEMPLATE_PATCHES exists: the
 * design's own file stays a faithful record of the export. */
const REFRESH_PATCHES = [
  {
    why: "The category cards bind a per-card handler the design closes over. The page " +
         "needs one named handler plus the key of the menu the card opens.",
    from: 'onClick="{{ c.onClick }}"',
    to: 'onClick="{{ catMenu }}" data-cat-menu="{{ c.menuKey }}"',
    count: 2
  },
  {
    why: "Same for the mobile hero's dots, which also carry a style object the " +
         "template would stringify as [object Object].",
    from: 'onClick="{{ d.pick }}" style="{{ d.style }}"',
    to: 'onClick="{{ heroDot }}" data-slide="{{ d.index }}" style="{{ d.css }}"',
    count: 1
  },
  /* The nav already owns a handler called toggleShop — the Shop All mega-menu — and
   * the hero's dropdown is a different control, so it gets its own name. */
  { why: "Hero mini dropdown, renamed off the nav's toggleShop.",
    from: 'onClick="{{ toggleShop }}"', to: 'onClick="{{ heroMiniShop }}"', count: 2 },
  { why: "The other hero mini dropdown, renamed to match.",
    from: 'onClick="{{ toggleTech }}"', to: 'onClick="{{ heroMiniTech }}"', count: 2 }
];
for (const { from, to, why, count } of REFRESH_PATCHES) {
  const hits = refreshTemplate.split(from).length - 1;
  if (hits !== count) {
    throw new Error(`Refresh patch matched ${hits} times, expected ${count} — ${why}`);
  }
  refreshTemplate = refreshTemplate.replaceAll(from, to);
}

/** Pulls out the block a top-level `<sc-if value="{{ name }}">` wraps. */
function refreshLayout(name) {
  let from = 0;
  for (;;) {
    const block = findBlock(refreshTemplate, "sc-if", from);
    if (!block) throw new Error(`The refresh handoff has no <sc-if value="{{ ${name} }}">`);
    if (unwrapExpr(readAttr(block.attrs, "value")) === name) {
      return refreshTemplate.slice(block.innerStart, block.innerEnd);
    }
    from = block.openStart + 1;
  }
}

/** Splits a layout into its labelled sections, keeping the order the design wrote. */
function refreshSections(layout) {
  const out = [];
  const re = /<(section|div) data-screen-label="([^"]+)"/g;
  const starts = [...layout.matchAll(re)];
  for (let i = 0; i < starts.length; i += 1) {
    const tag = starts[i][1];
    const block = findBlock(layout, tag, starts[i].index);
    out.push({ label: starts[i][2], tag, html: layout.slice(block.openStart, block.end) });
    re.lastIndex = block.end;
  }
  return out;
}

const cssText = (style) =>
  Object.entries(style)
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}: ${v}`)
    .join("; ");

/* The scope every refresh section resolves against. Handlers are absent on purpose:
 * `interpolate` leaves an unresolved binding alone and `lowerInteractions` turns it
 * into a data hook, which is how the rest of the page's interactions are wired. */
const refreshBase = {
  /* The design hands some styles to the template as objects rather than strings
   * (`c.imgBox`, `c.mobCell`). Interpolated as-is they become "[object Object]", which
   * silently drops the rule — and for imgBox that rule is `position: relative`, so the
   * card image escapes its box and covers the page. Flattened here; the guard below
   * catches any further one the design adds. */
  cats: refresh.cats.map((c) => {
    const out = { ...c };
    for (const [k, v] of Object.entries(out)) {
      if (v && typeof v === "object" && !Array.isArray(v)) out[k] = cssText(v);
    }
    return out;
  }),
  oems: refresh.oems,
  badges: refresh.badges,
  badges4: refresh.badges4,
  actions: refresh.actions,
  total: refresh.total,
  menuOpen: false,
  miniOpen: false,
  /* sc-for is expanded before sc-if, so every list the template loops over has to
   * resolve even inside a block that is about to be dropped. */
  minis: [],
  menuItems: [],
  // The mini panels start closed, so the buttons render in their resting colours.
  shopBg: "#EA4E32", techBg: "#12305A", shopRot: "none", techRot: "none"
};

/** Renders one layout's sections, with the hero repeated once per slide. */
function buildRefreshLayout(name, cls) {
  const parts = [];
  for (const { label, html } of refreshSections(refreshLayout(name))) {
    if (/Hero$/.test(label)) {
      refresh.slides.forEach((s, i) => {
        const dots = refresh.slides.map((_, k) => ({
          index: k,
          label: `Slide ${k + 1}`,
          css: cssText({
            width: k === i ? "28px" : "10px", height: "10px", padding: 0, border: 0,
            cursor: "pointer", background: k === i ? "#EA4E32" : "rgba(255,255,255,0.4)",
            transition: "width 200ms ease"
          })
        }));
        const scope = {
          ...refreshBase, slide: s.slide, slideNum: s.num, dots,
          hero: name === "isMob" ? s.heroMob : s.hero
        };
        let markup = expandDirectives(withMinis(html, scope), scope);
        markup = addAttrsToFirstTag(markup, `class="r26-slide" data-r26-slide="${i}"${i ? " hidden" : ""}`);
        parts.push(markup);
      });
    } else if (/Categories$/.test(label)) {
      parts.push(refreshCategories(html));
    } else {
      parts.push(expandDirectives(html, refreshBase));
    }
  }
  return refreshPin(refreshAssets(`<div class="r26 ${cls}">${parts.join("\n")}</div>`));
}

/** Finds the `<sc-if value="{{ name }}">` block inside a section's raw markup. */
function conditionalBlock(html, name) {
  let from = 0;
  for (;;) {
    const block = findBlock(html, "sc-if", from);
    if (!block) throw new Error(`The refresh section has no <sc-if value="{{ ${name} }}">`);
    if (unwrapExpr(readAttr(block.attrs, "value")) === name) return block;
    from = block.openStart + 1;
  }
}

/* The hero's mini cards sit behind two dropdown buttons, inside the slide. Both sets
 * are rendered in place of the design's single conditional block, so each keeps the
 * position and spacing the design gave it; site.js only unhides one. */
function withMinis(heroHtml, scope) {
  if (!scope.slide.minis) return heroHtml;
  const block = conditionalBlock(heroHtml, "miniOpen");
  const inner = heroHtml.slice(block.innerStart, block.innerEnd);
  const panels = ["shop", "tech"].map((set) =>
    `<div class="r26-minis" data-r26-minis="${set}" hidden>` +
    expandDirectives(inner, { ...scope, miniOpen: true, minis: refresh.minis[set] }) +
    `</div>`
  ).join("");
  return heroHtml.slice(0, block.openStart) + panels + heroHtml.slice(block.end);
}

/* The two layouts open a category panel differently, and both are reproduced rather
 * than flattened to one. Desktop drops a single panel under the whole grid; mobile
 * inserts it inside the grid, at the end of the row holding the card that was tapped,
 * which is what the design's `panelHere` computes. */
function refreshCategories(html) {
  return html.includes("{{ c.panelHere }}")
    ? refreshCategoriesInline(html)
    : refreshCategoriesBelow(html);
}

/** Desktop: every panel rendered in the slot the design opens one in, hidden. */
function refreshCategoriesBelow(html) {
  const block = conditionalBlock(html, "menuOpen");
  const inner = html.slice(block.innerStart, block.innerEnd);
  const panels = Object.entries(refresh.menus).map(([key, items]) =>
    `<div class="r26-catmenu" data-r26-catmenu="${key}" hidden>` +
    expandDirectives(inner, { ...refreshBase, menuOpen: true, menuItems: items }) +
    `</div>`
  ).join("");
  const spliced = html.slice(0, block.openStart) + panels + html.slice(block.end);
  return expandDirectives(spliced, refreshBase);
}

/** Mobile: the loop is expanded here so each panel lands at the end of its own row. */
function refreshCategoriesInline(html) {
  const loop = findBlock(html, "sc-for", html.indexOf('<sc-for list="{{ cats }}"'));
  if (!loop) throw new Error("The mobile category section has no cats loop");
  const inner = html.slice(loop.innerStart, loop.innerEnd);
  const panel = conditionalBlock(inner, "c.panelHere");
  const cardMarkup = inner.slice(0, panel.openStart) + inner.slice(panel.end);
  const panelMarkup = inner.slice(panel.innerStart, panel.innerEnd);

  const cats = refreshBase.cats;   // flattened styles, not the raw model
  // The design puts the panel at the end of the two-column row the open card sits in.
  const rowEnd = (k) => Math.min(k | 1, cats.length - 1);

  const cells = cats.map((c, k) => {
    let out = expandDirectives(cardMarkup, { ...refreshBase, c });
    const mine = cats
      .map((other, j) => ({ other, j }))
      .filter(({ other, j }) => other.menuKey && rowEnd(j) === k);
    for (const { other } of mine) {
      out += `<div class="r26-catmenu" data-r26-catmenu="${other.menuKey}" hidden>` +
             expandDirectives(panelMarkup, { ...refreshBase, c: other, menuItems: refresh.menus[other.menuKey] }) +
             `</div>`;
    }
    return out;
  });

  const rebuilt = html.slice(0, loop.openStart) + cells.join("\n") + html.slice(loop.end);
  return expandDirectives(rebuilt, refreshBase);
}

/* The refresh handoff addresses its images relative to its own folder; in the shipped
 * page they all live together under assets/uploads/r26/. Rewritten by basename, which
 * is safe because tools/sync-assets.mjs copies them flat and would have collided on a
 * duplicate name. Both the src attributes and the CSS url() backgrounds are covered. */
/* The first handoff's page.css carries blanket responsive rules — `#page
 * [style*="grid-template-columns"] { grid-template-columns: 1fr !important }` and a
 * matching one for `gap` — that were written to collapse *its* grids on small screens.
 * They reach into the refresh too and flatten its two-column layouts.
 *
 * Rather than weaken those rules for the sections that still depend on them, the
 * refresh pins its own values: an inline declaration marked !important outranks an
 * !important rule from a stylesheet, so each grid keeps exactly what the design wrote.
 * Safe here because the refresh ships a whole layout per breakpoint and never restyles
 * one grid across widths. */
function refreshPin(html) {
  return html.replace(/style="([^"]*)"/g, (whole, decls) => {
    if (!/grid-template-columns|(^|;)\s*gap\s*:/.test(decls)) return whole;
    const pinned = decls.replace(
      /(grid-template-columns|gap)\s*:\s*([^;"]+?)(\s*!important)?(?=;|$)/g,
      (_m, prop, value) => `${prop}: ${value.trim()} !important`
    );
    return `style="${pinned}"`;
  });
}

function refreshAssets(html) {
  return html.replace(/assets\/(?:cr\/)?([A-Za-z0-9._-]+\.(?:png|jpe?g|webp|svg|gif))/g,
    (whole, file) => (whole.startsWith("assets/uploads/") ? whole : `assets/uploads/r26/${file}`));
}

const refreshDesktop = buildRefreshLayout("isDesk", "r26-desk");
const refreshMobile = buildRefreshLayout("isMob", "r26-mob");

for (const [name, html] of [["desktop", refreshDesktop], ["mobile", refreshMobile]]) {
  if (html.includes("[object Object]")) {
    throw new Error(`The refresh ${name} layout stringified an object into the markup`);
  }
}

/* Splice: the three sections the refresh replaces come out, the new markup goes in. */
const REPLACED = ["Hero — Tree Care", "Now You Can Order Online", "About Us"];
for (const [i, label] of REPLACED.entries()) {
  const at = patched.indexOf(`<section data-screen-label="${label}"`);
  if (at === -1) throw new Error(`The refresh replaces "${label}", which the page no longer has`);
  const block = findBlock(patched, "section", at);
  const replacement = i === 0 ? refreshDesktop + "\n" + refreshMobile : "";
  patched = patched.slice(0, block.openStart) + replacement + patched.slice(block.end);
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
  /* The "/ Reno" qualifier fix retired with the September 2026 refresh: it corrected a
   * card in "Now you can order online", a section that refresh replaces outright. */
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
const staleCopy = COPY_FIXES.filter(([from]) => !body.includes(from)).map(([from]) => from);
if (staleCopy.length) {
  throw new Error(`Copy fixes are stale, no longer in the design:\n  ${staleCopy.join("\n  ")}`);
}
for (const [from, to] of COPY_FIXES) body = body.replaceAll(from, to);

/* The five category-card corrections retired with the September 2026 refresh. Every
 * one of them rewrote a card inside "Now you can order online", and that section is
 * replaced outright by the refresh's own Products grid, which carries its own labels
 * and destinations. Nothing on the page still uses .panel-card. */
if (body.includes("panel-card")) {
  throw new Error("A .panel-card survived the refresh; its label fixes were retired");
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
/* Read recursively: the September 2026 refresh keeps its images in a subfolder. */
async function filesUnder(dir, prefix = "") {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(...await filesUnder(join(dir, entry.name), prefix + entry.name + "/"));
    else out.push(prefix + entry.name);
  }
  return out;
}
const onDisk = new Set(await filesUnder(join(ROOT, "assets", "uploads")));
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

/* The refresh ships both layouts and lets CSS pick, at the 1024px line the design
 * itself switches on. Doing it here rather than in desktop.css or mobile.css keeps
 * those two files' single-media-query guarantee intact — neither covers 641–1023px,
 * and this rule has to. */
const REFRESH_CSS = `
/* September 2026 refresh — one layout is shown, the other is inert. */
@media (max-width: 1023.98px) { .r26-desk { display: none !important; } }
@media (min-width: 1024px)    { .r26-mob  { display: none !important; } }
/* Slides and panels are switched by assets/js/site.js via the hidden attribute;
   make sure nothing in the design's inline display wins over it. */
.r26 [hidden] { display: none !important; }
`;

await writeFile(
  join(OUT, "assets", "css", "site.css"),
  sheet.toCss() + STRIP_CSS + REFRESH_CSS,
  "utf8"
);

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
