/**
 * Content model for the L.A. Grinding homepage.
 *
 * The design handoff keeps all of its page data in a `<script type="text/x-dc">`
 * block at the end of the file — a `Component extends DCLogic` class whose
 * `renderVals()` returns every list the template loops over.
 *
 * Rather than transcribe that by hand (the step most likely to drift from the
 * design), this module *executes* it: the class is evaluated in a sandbox with
 * stubs for the two things it touches from the editor runtime — `React.createRef`
 * and `DCLogic` — and `renderVals()` is called. Whatever the design says is what
 * the build gets, so editing the design and rebuilding cannot silently disagree.
 *
 * Only plain data survives into the build. Refs become `{ __ref: name }` markers
 * and event handlers are dropped, because tools/build.mjs lowers those into
 * `data-ref` / `data-on-*` hooks that assets/js/site.js wires up instead.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "design-source", "LA Grinding Homepage.dc.html");

const source = await readFile(SOURCE, "utf8");

/* ---------- locate the design's data block ---------- */

const scriptMatch = source.match(
  /<script type="text\/x-dc"[^>]*data-dc-script([^>]*)>([\s\S]*?)<\/script>/
);
if (!scriptMatch) throw new Error("No <script type=\"text/x-dc\" data-dc-script> block in the handoff");

const [, scriptAttrs, scriptBody] = scriptMatch;

/* The editor's prop panel declares its own defaults in `data-props`; honour them
 * so the build renders the same variant the design canvas does. */
const decodeEntities = (value) =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

const propsAttr = scriptAttrs.match(/data-props="([^"]*)"/);
const props = {};
if (propsAttr) {
  const declared = JSON.parse(decodeEntities(propsAttr[1]));
  for (const [name, spec] of Object.entries(declared)) props[name] = spec.default;
}

/* ---------- run it ---------- */

/** Refs are identified by name so the build can emit `data-ref="…"`. */
const refNames = new Map();
const makeRef = () => {
  const ref = { current: null, __isRef: true };
  return ref;
};

const sandbox = {
  React: { createRef: makeRef },
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  Math,
  Object,
  Date,
  window: undefined,
  document: undefined
};

const script = new vm.Script(`
  class DCLogic {
    setState() { /* never reached: renderVals only reads state */ }
  }
  ${scriptBody}
  globalThis.__instance = new Component();
`);

const context = vm.createContext(sandbox);
script.runInContext(context);

const instance = sandbox.__instance ?? context.__instance;
instance.props = props;

const rawVals = instance.renderVals();

/* Name each ref object from the key it was returned under, so `{{ catsRef }}`
 * in the template can be lowered to `data-ref="catsRef"`. */
for (const [key, value] of Object.entries(rawVals)) {
  if (value && typeof value === "object" && value.__isRef) refNames.set(value, key);
}

/* ---------- reduce to plain data ---------- */

function plain(value) {
  if (typeof value === "function") return undefined;          // handlers: site.js owns these
  if (value === null || typeof value !== "object") return value;
  /* Refs are dropped rather than serialised: the template's `ref="{{ catsRef }}"`
   * must survive interpolation untouched so lowerInteractions() can turn it into
   * `data-ref="catsRef"`. Resolving it to a value here would inline the object. */
  if (value.__isRef) return undefined;
  if (Array.isArray(value)) return value.map(plain);
  const out = {};
  for (const [key, nested] of Object.entries(value)) {
    const reduced = plain(nested);
    if (reduced !== undefined) out[key] = reduced;
  }
  return out;
}

const model = plain(rawVals);

/* ---------- content added after the handoff was exported ---------- *
 *
 * Kept here rather than edited into design-source/, so that folder stays a faithful
 * record of what Claude Design produced — the same reason tools/build.mjs carries its
 * COPY_FIXES and CARD_FIXES. Each addition names the list it extends and the build
 * fails if the design no longer has that list, so this cannot go stale unnoticed.
 */
const ADDITIONS = {
  // A fourth card in "Shop featured products". The card markup is the design's own, so
  // it picks up the same size, spacing, type, hover and arrow behaviour as the rest;
  // only the content is new. "View product" is hard-coded in the template, not here.
  featured: [
    {
      cat: "Tree Care",
      name: "Mulcher Teeth — OEM-Compatible Kits & Replacement Parts",
      img: "uploads/mulcher-teeth-featured.jpg",
      href: "https://lagrinding.com/shop/?swoof=1&product_cat=mulcher-teeth"
    },
    /* The card has two text slots — an eyebrow and a name — not three, so the product
     * and its description share the name field with an em dash, which is the pattern
     * the design's own cards already use ("Brush Chipper Knives — precision ground OEM
     * match", "Stump Grinder Teeth — replacement options"). */
    {
      cat: "Granulators – Recycling and Plastics",
      name: "Granulators — Compatible Screens",
      img: "uploads/granulator-screens-featured.jpg",
      href: "https://lagrinding.com/product-category/granulators/"
    }
  ]
};

for (const [list, items] of Object.entries(ADDITIONS)) {
  if (!Array.isArray(model[list])) {
    throw new Error(`Addition is stale: the design no longer has a "${list}" list`);
  }
  model[list] = model[list].concat(items);
}

/* ---------- entries changed after the handoff was exported ---------- *
 *
 * Each edit names the lists it applies to rather than searching the whole model: the
 * "Shop by category" rail is built from `cats`, but the mobile order is a separate
 * `mobileCats` slice taken inside renderVals, and by this point the two hold different
 * objects — so an entry that appears in both has to be edited in both or the change
 * only lands on one layout. Names like "Tree Care" also occur in unrelated lists
 * (services, shopIndustries) that must not be touched.
 */
const EDITS = [
  {
    lists: ["cats", "mobileCats"],
    find: "Serrated Tape Knives",
    set: {
      name: "Bindery Supplies & Accessories",
      img: "uploads/bindery-supplies-accessories.jpg",
      href: "https://lagrinding.com/product-category/la-grinding-catalog/?swoof=1&paged=1&product_cat=bindery-supplies-accessories&really_curr_tax=817-product_cat"
    }
  },
  {
    // The photo filed under Serrated Tape Knives is, as its filename says, the tree care
    // one; it moves to the Tree Care card. Title and link there are unchanged.
    lists: ["cats", "mobileCats"],
    find: "Tree Care",
    // %20 as the handoff writes it: the file really does have a space in its name.
    set: { img: "uploads/tree%20care.png" }
  }
];

for (const { lists, find, set } of EDITS) {
  let hits = 0;
  for (const list of lists) {
    if (!Array.isArray(model[list])) {
      throw new Error(`Edit is stale: the design no longer has a "${list}" list`);
    }
    for (const entry of model[list]) {
      if (entry && entry.name === find) {
        Object.assign(entry, set);
        hits += 1;
      }
    }
  }
  if (hits === 0) throw new Error(`Edit is stale: no entry named "${find}" in ${lists.join(", ")}`);
}

/* The distributor strip, restored to the order the Tree Care build shipped: the
 * eighteen manufacturers the design itself listed, then the fifteen added since.
 *
 * The restored rows name their logo explicitly, because the design carried them in
 * `brandLogos` — a list of pictures with no destinations. Those cells were never
 * links, so there is no earlier href to preserve and the ones below are the
 * client's. A row with no href renders the way it did before: an image, not a link.
 *
 * Every destination was checked against lagrinding.com on 2026-09-21, through the
 * store's own attribute terms and then in a browser. A `pa_main-brand` term that
 * does not exist returns 404, so a wrong slug is worse than no link at all: the
 * eleven rows below with no href are the ones the shop has nothing to point at.
 * They are listed in the commit message and were reported rather than guessed. */
const SHOP = "https://lagrinding.com/shop/?swoof=1&pa_main-brand=";
const RESTORED = [
  ["Freud",             "logo_freud.webp",              SHOP + "freud"],
  ["Diablo",            "diablo-logo.webp",             SHOP + "diablo"],
  ["Accurshear",        "logo-AccurShear.webp",         SHOP + "accurshear"],
  ["Bobst",             "logo-BOBST.webp",              null],
  ["Challenge",         "logo-Challenge-Machinery.webp", SHOP + "challenge"],
  // The design's list skips Cumberland; this is the client's own CPS file, the one
  // already on the Cumberland OEM card and the one the Tree Care strip showed.
  ["Cumberland",        "oem-cumberland.png",           SHOP + "cumberland"],
  ["FS Tool",           "logo-fs-tool.webp",            null],
  ["Herbold Meckesheim", "logo-herbold-usa.webp",       SHOP + "herbold"],
  ["Lenox",             "logo-lenox.webp",              null],
  ["Multivac",          "logo-multivac.webp",           null],
  ["National Equipment Corporation", "logo-national-equipment.webp", null],
  // Polar's parts live in a category of their own, not behind a brand filter.
  ["Polar Mohr",        "logo-polar-mohr.webp",
   "https://lagrinding.com/product-category/la-grinding-catalog/polar-parts/"],
  ["Reiser",            "logo-reiser-packaging.webp",   null],
  ["Tidland",           "logo-tidland-slitter.webp",    null],
  ["Eldan Recycling",   "unnamed.webp",                 null],
  ["Columbus McKinnon", "unnamed_1.webp",               null],
  ["Barclay Shredders", "unnamed_2.webp",               null],
  ["Granutech Saturn",  "unnamed_3.webp",               null]
];

/* The newer cards keep the logo and the destination they already had — they are read
 * straight out of the design's brand list, not restated here. */
const NEWER = [
  "Wysong & Miles", "Pexto", "Tennsmith", "Niagara", "Roper Whitney",
  "Di-Acro Elga", "Atlantic/Haco", "Famco", "Amada", "Pearson",
  "Summit", "Durma", "Dreis & Krump", "Adira", "Edwards - Besco"
];

model.distributorBrands = [
  ...RESTORED.map(([name, file, href]) => ({ name, logo: `uploads/${file}`, href })),
  ...NEWER.map((name) => {
    const brand = model.brands.find((b) => b.name === name);
    if (!brand) throw new Error(`Distributor strip: the design has no brand named "${name}"`);
    return brand;
  })
].map((b) => ({ ...b, unlinked: !b.href }));
/* "Shop by OEM" lists equipment manufacturers, keyed to the shop's machine-make filter.
 * The logos are the ones the About Us section already carries (uploads/oem-*.png), so
 * nothing is re-created. The list is deliberately separate from `brands`: that one still
 * feeds the mega-menu (menuBrands) and the distributor strip, which must not change. */
const OEMS = [
  ["Caterpillar", "oem-caterpillar.png", "cat"],
  ["Vermeer",     "oem-vermeer.png",     "vermeer"],
  ["Bandit",      "oem-bandit.png",      "bandit"],
  ["Morbark",     "oem-morbark.png",     "morbark"],
  ["Rayco",       "oem-rayco.png",       "rayco"],
  ["Fecon",       "oem-fecon.png",       "fecon"],
  ["Bobcat",      "oem-bobcat.png",      "bobcat"],
  ["Carlton",     "oem-carlton.png",     "carlton"],
  /* Mostly sourced from each manufacturer's own site. Five are SVG: sharper at any size
   * than the PNGs, and transparent by nature. FAE, Rapid and Vecoplan ship their logo in
   * white because their own headers are dark, so those were recoloured to the site's
   * text colour — they render greyscale at rest either way.
   *
   * Cumberland and Nelmor are the client's own files. Cumberland's site serves a
   * white-on-dark mark, which was invisible on these white cards; both supplied PNGs
   * already carried transparency and were only trimmed and scaled down. */
  ["FAE",         "oem-fae.png",         "fae"],
  ["Takeuchi",    "oem-takeuchi.svg",    "takeuchi"],
  ["Cumberland",  "oem-cumberland.png",  "cumberland"],
  ["Nelmor",      "oem-nelmor.png",      "nelmor"],
  ["Rapid",       "oem-rapid.svg",       "rapid"],
  ["Sweed",       "oem-sweed.svg",       "sweed"],
  ["Vecoplan",    "oem-vecoplan.svg",    "vecoplan"],
  /* Polar Mohr's logo is the one the design already ships in its distributor list,
   * fetched from the same URL and kept locally like the rest. Greenteeth's is the
   * client's file; both already had, or were given, a transparent background. */
  ["Polar Mohr",  "oem-polar-mohr.png",  "polar"],
  ["Greenteeth",  "oem-greenteeth.png",
   "https://lagrinding.com/shop/?swoof=1&pa_oem-compatible=green&pa_main-machine-make=greenteeth&paged=1"]
];
/* The third column is normally just the machine-make slug, since every OEM so far uses
 * the same filter URL. Greenteeth's destination has extra parameters, so a full URL is
 * accepted there too. */
model.oems = OEMS.map(([name, file, makeOrHref]) => ({
  name,
  logo: `uploads/${file}`,
  href: makeOrHref.startsWith("http")
    ? makeOrHref
    : `https://lagrinding.com/shop/?swoof=r&pa_main-machine-make=${makeOrHref}`
}));

/* The Shop All dropdown lists six priority OEMs; the mobile drawer lists them all.
 * Both read `model.oems`, so the menus and the on-page grid can never drift apart —
 * an OEM added to the list above appears in the drawer without another edit here. */
const MENU_OEMS = ["Caterpillar", "Vermeer", "Bandit", "Morbark", "Rayco", "Fecon"];
model.menuOems = MENU_OEMS.map((name) => {
  const oem = model.oems.find((o) => o.name === name);
  if (!oem) throw new Error(`Shop All dropdown: there is no OEM named "${name}"`);
  return oem;
});

export const data = model;

/* Handlers this build adds on top of the handoff, for menu sections the design does
 * not have. They follow the design's own accordion convention (`acc<Name>T` toggles
 * the `acc<Name>` panel) and are implemented in assets/js/site.js like the rest. */
const ADDED_HANDLERS = ["accOemT"];

/** The names the template may bind as handlers — every function renderVals returns. */
export const handlerNames = new Set([
  ...Object.entries(rawVals).filter(([, v]) => typeof v === "function").map(([k]) => k),
  ...ADDED_HANDLERS
]);

/** The names the template may bind as refs. */
export const refNamesList = [...refNames.values()].sort();
