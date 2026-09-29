/**
 * Content model for the September 2026 homepage refresh.
 *
 * The refresh replaces three sections — the hero, the category grid and About Us —
 * with a second Claude Design handoff, `design-source/refresh-2026-09/`. Everything
 * below About Us still comes from the original handoff via tools/data.mjs, which is
 * why this is a separate module rather than a replacement for it.
 *
 * It reads that handoff the same way data.mjs reads the first one: by *executing*
 * the design's own `renderVals()` in a sandbox instead of transcribing it. The
 * difference is that this design is stateful — it renders one hero slide at a time,
 * and opens one category menu at a time — while the build has to emit every state up
 * front for site.js to switch between. So renderVals() is called once per state and
 * the results are collected:
 *
 *   slides  5 hero slides x 2 layouts (the design splits desktop and mobile at 1024px)
 *   menus   the 6 category panels, keyed the way the design keys them
 *   minis   the two mini-card sets behind the hero's "Shop" / "Technical data" buttons
 *
 * Handlers and refs are dropped here exactly as in data.mjs: build.mjs lowers them to
 * `data-on-*` hooks and assets/js/site.js owns the behaviour.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "design-source", "refresh-2026-09", "LA-Home-Takeuchi-C.dc.html");

export const REFRESH_SOURCE = SOURCE;

const source = await readFile(SOURCE, "utf8");

const scriptMatch = source.match(
  /<script type="text\/x-dc"[^>]*data-dc-script([^>]*)>([\s\S]*?)<\/script>/
);
if (!scriptMatch) throw new Error("No <script type=\"text/x-dc\" data-dc-script> block in the refresh handoff");
const [, , scriptBody] = scriptMatch;

/* ---------- run it ---------- */

/* The design reads `window.innerWidth` in a class field to pick its initial layout,
 * and registers a resize listener on mount. Neither runs in the shipped page — the
 * build emits both layouts and CSS chooses — but the field is evaluated when the
 * class is constructed, so the sandbox has to answer it. componentDidMount is never
 * called here, so the listener and the autoplay timer never start. */
const sandbox = {
  React: { createRef: () => ({ current: null, __isRef: true }) },
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  Math, Object, Date, JSON, encodeURIComponent, RegExp, Array, String, Number, Boolean,
  window: { innerWidth: 1440, addEventListener() {}, removeEventListener() {} },
  document: undefined
};

const script = new vm.Script(`
  class DCLogic {
    setState() { /* never reached: this module sets state directly between renders */ }
  }
  ${scriptBody}
  globalThis.__instance = new Component();
`);

const context = vm.createContext(sandbox);
script.runInContext(context);
const instance = sandbox.__instance ?? context.__instance;
instance.props = {};

/** Renders the design once in a given state and returns the plain data it produced. */
function renderAt(state) {
  instance.state = { mob: false, slide: 0, mini: null, menu: null, ...state };
  return plain(instance.renderVals());
}

function plain(value) {
  if (typeof value === "function") return undefined;
  if (value === null || typeof value !== "object") return value;
  if (value.__isRef) return undefined;
  if (Array.isArray(value)) return value.map(plain);
  const out = {};
  for (const [key, nested] of Object.entries(value)) {
    const reduced = plain(nested);
    if (reduced !== undefined) out[key] = reduced;
  }
  return out;
}

/* ---------- collect every state the page can be in ---------- */

const base = renderAt({});
const SLIDE_COUNT = Number(base.total);
if (!Number.isInteger(SLIDE_COUNT) || SLIDE_COUNT < 1) {
  throw new Error(`The refresh handoff reports ${base.total} slides; expected a count`);
}

/** One entry per hero slide, carrying both layouts' background treatment. */
export const slides = Array.from({ length: SLIDE_COUNT }, (_, i) => {
  const desk = renderAt({ mob: false, slide: i });
  const mob = renderAt({ mob: true, slide: i });
  if (desk.slide.title !== mob.slide.title) {
    throw new Error(`Slide ${i} differs between layouts; the build assumes one content set`);
  }
  return { index: i, slide: desk.slide, num: desk.slideNum, hero: desk.hero, heroMob: mob.hero };
});

/** The mini-card sets behind the hero's two dropdown buttons (slide 2 only). */
export const minis = {
  shop: renderAt({ slide: 1, mini: "shop" }).minis,
  tech: renderAt({ slide: 1, mini: "tech" }).minis
};
for (const [name, set] of Object.entries(minis)) {
  if (!Array.isArray(set) || set.length === 0) throw new Error(`Hero mini set "${name}" is empty`);
}
if (JSON.stringify(minis.shop) === JSON.stringify(minis.tech)) {
  throw new Error("The hero's two mini sets are identical; the design changed shape");
}

export const cats = base.cats;
export const oems = base.oems;
export const badges = base.badges;
export const badges4 = base.badges4;
export const actions = base.actions;
export const total = base.total;

/** The category panel that opens under the grid, one per card that has one. */
const catKeyOf = (name) =>
  /^sharpening/i.test(name) ? "svc"
  : /tree care/i.test(name) ? "tree"
  : /printing/i.test(name) ? "print"
  : /granulator/i.test(name) ? "gran"
  : /^recycling/i.test(name) ? "recy"
  : /diablo|saw blade/i.test(name) ? "diab"
  : null;

export const menus = {};
for (const cat of cats) {
  const key = catKeyOf(cat.name);
  if (!key) continue;
  const opened = renderAt({ menu: key });
  if (!opened.menuOpen || !opened.menuItems.length) {
    throw new Error(`Category "${cat.name}" maps to menu "${key}", which renders empty`);
  }
  menus[key] = opened.menuItems;
  cat.menuKey = key;
}
if (Object.keys(menus).length === 0) {
  throw new Error("No category opens a menu; the design changed shape");
}
