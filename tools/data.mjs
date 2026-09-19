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

export const data = plain(rawVals);

/** The names the template may bind as handlers — every function renderVals returns. */
export const handlerNames = new Set(
  Object.entries(rawVals).filter(([, v]) => typeof v === "function").map(([k]) => k)
);

/** The names the template may bind as refs. */
export const refNamesList = [...refNames.values()].sort();
