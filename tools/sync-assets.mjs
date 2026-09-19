/**
 * Copies the images the design actually uses out of the Claude Design handoff and
 * into assets/uploads/.
 *
 * The set of images cannot be found by grepping the handoff: the design builds many
 * paths by concatenation (`UP + "wysong-clean.png"`), so the string `uploads/` never
 * appears next to those filenames. The authoritative list therefore comes from two
 * places that hold fully-resolved values:
 *
 *   - the page data, as executed by tools/data.mjs
 *   - `src` / `data-src` attributes in the handoff's markup
 *
 * Handoff paths are URL-encoded ("NIAGARA%20.png"); the files on disk are not, so
 * every reference is decoded before it is looked up.
 *
 * Usage:  node tools/sync-assets.mjs "<path to the Claude Design project folder>"
 */

import { readFile, readdir, copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { data } from "./data.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEST = join(ROOT, "assets", "uploads");

const handoff = process.argv[2];
if (!handoff) {
  console.error('usage: node tools/sync-assets.mjs "<Claude Design project folder>"');
  process.exit(1);
}

const referenced = new Set();
const note = (value) => {
  if (typeof value !== "string") return;
  const match = value.match(/^uploads\/(.+)$/);
  if (match) referenced.add(decodeURIComponent(match[1]));
};

/* 1. every string in the executed page data */
(function walk(value) {
  if (typeof value === "string") return note(value);
  if (value && typeof value === "object") Object.values(value).forEach(walk);
})(data);

/* 2. every image path written directly into the markup */
const source = await readFile(join(ROOT, "design-source", "LA Grinding Homepage.dc.html"), "utf8");
for (const [, path] of source.matchAll(/(?:data-)?src="uploads\/([^"]+)"/g)) {
  referenced.add(decodeURIComponent(path));
}

/* 3. copy, and say plainly what is missing rather than shipping a blank image */
const available = new Set(await readdir(join(handoff, "uploads")));
const missing = [...referenced].filter((name) => !available.has(name)).sort();

await mkdir(DEST, { recursive: true });
let copied = 0;
for (const name of referenced) {
  if (!available.has(name)) continue;
  await copyFile(join(handoff, "uploads", name), join(DEST, name));
  copied += 1;
}

console.log(`referenced ${referenced.size}, copied ${copied}, missing ${missing.length}`);
for (const name of missing) console.error(`  MISSING: ${name}`);
if (missing.length) process.exit(1);
