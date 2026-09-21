/**
 * Generates the mobile variants of the two hero plate images.
 *
 * The mobile slider is taller than the desktop one (see assets/css/mobile.css), and
 * the desktop plates cannot simply be stretched: `hero-plate-clean.png` would be fine
 * (it is a pure vertical gradient) but `min6.png` carries the CA/NV/AZ map, which must
 * not distort. Both also carry a small US flag at ~2.7% from the left, which on a phone
 * sits underneath the 22px "previous slide" arrow.
 *
 * Both problems are solved the same way, exploiting the fact that the plate texture is
 * uniform along X — every row is a single colour, so the row median *is* the texture:
 *
 *   1. row median  -> the pure texture, as a 1-D vertical gradient
 *   2. deviation from the row median -> the artwork (map, text, black bar, flag)
 *   3. rebuild the texture at the taller height, stretching only the band between the
 *      red bars so the bars keep their thickness
 *   4. paste the artwork back at its original scale, vertically centred, so nothing
 *      is distorted -- and paste the flag at a new X, clear of the arrow
 *
 * This is a build asset step, not something the page does at runtime. Re-run with:
 *   node tools/make-mobile-plates.mjs
 * It shells out to Python + Pillow, which is what actually does the pixel work.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Taller mobile slide: 411 -> 575 is the 40% the design brief asked for. */
export const MOBILE_HEIGHT_SCALE = 1.4;
/** Where the flag's left edge lands, as a % of image width. Clears the 22px arrow. */
export const FLAG_LEFT_PCT = 10.5;

const script = `
import numpy as np
from PIL import Image
import sys, json

H_SCALE = ${MOBILE_HEIGHT_SCALE}
FLAG_LEFT_PCT = ${FLAG_LEFT_PCT}

def build(src, dst):
    im = Image.open(src).convert("RGB")
    a = np.asarray(im).astype(np.float64)
    H, W, _ = a.shape

    # 1. the texture: every row of this plate is one colour across its width
    med = np.median(a, axis=1)                       # (H,3)

    # 2. the artwork: how far each pixel departs from its row's colour
    dev = np.abs(a - med[:, None, :]).max(axis=2)    # (H,W)
    alpha = np.clip((dev - 8.0) / 12.0, 0.0, 1.0)    # soft edges keep anti-aliasing

    # the red bars top and bottom, which must not stretch
    red = (med[:, 0] > 200) & (med[:, 1] < 130)
    top_bar = 0
    while top_bar < H and red[top_bar]: top_bar += 1
    bot_bar = 0
    while bot_bar < H and red[H - 1 - bot_bar]: bot_bar += 1
    inner0, inner1 = top_bar, H - bot_bar
    inner_h = inner1 - inner0

    # 3. the flag: the artwork lying in the left 12%, between the bars.
    #    min6.png also has a 1px border down its left edge, which spans the whole band
    #    and is not the flag -- skip the outermost columns and any column tall enough
    #    to be a border rather than a piece of a small flag.
    lim = int(W * 0.12)
    band = alpha[inner0:inner1, :lim]
    band_h = inner1 - inner0
    col_height = (band > 0.5).sum(axis=0)
    is_flag_col = (col_height > 0) & (col_height < band_h * 0.6)
    is_flag_col[:4] = False
    keep = np.zeros_like(band, dtype=bool)
    keep[:, is_flag_col] = band[:, is_flag_col] > 0.5
    ys, xs = np.nonzero(keep)
    fx0, fx1 = int(xs.min()), int(xs.max())
    fy0, fy1 = int(ys.min()) + inner0, int(ys.max()) + inner0
    flag_rgb = a[fy0:fy1 + 1, fx0:fx1 + 1].copy()
    flag_a = alpha[fy0:fy1 + 1, fx0:fx1 + 1].copy()

    # everything that is not the flag stays where it is, horizontally
    rest_a = alpha.copy()
    rest_a[fy0:fy1 + 1, fx0:fx1 + 1] = 0.0

    # 4. rebuild the texture at the new height: bars fixed, middle stretched
    H2 = int(round(H * H_SCALE))
    inner_h2 = H2 - top_bar - bot_bar
    src_rows = np.linspace(0, inner_h - 1, inner_h2)
    lo = np.floor(src_rows).astype(int); hi = np.minimum(lo + 1, inner_h - 1)
    t = (src_rows - lo)[:, None]
    mid = med[inner0:inner1]
    new_mid = mid[lo] * (1 - t) + mid[hi] * t
    new_med = np.vstack([med[:top_bar], new_mid, med[inner1:]])
    canvas = np.repeat(new_med[:, None, :], W, axis=1)

    # 5. paste the artwork back, unscaled and vertically centred
    dy = top_bar + (inner_h2 - inner_h) // 2
    def over(dst_arr, y, x, rgb, al):
        h, w = al.shape
        if y < 0 or x < 0 or y + h > dst_arr.shape[0] or x + w > dst_arr.shape[1]:
            raise SystemExit("paste out of bounds")
        region = dst_arr[y:y + h, x:x + w]
        dst_arr[y:y + h, x:x + w] = region * (1 - al[..., None]) + rgb * al[..., None]

    over(canvas, dy, 0, a, rest_a)

    # 6. the flag, moved right so the slider arrow no longer sits on top of it
    new_fx = int(round(W * FLAG_LEFT_PCT / 100.0))
    over(canvas, fy0 + dy, new_fx, flag_rgb, flag_a)

    Image.fromarray(np.clip(canvas, 0, 255).astype(np.uint8)).save(dst)
    return {
        "src": src, "dst": dst, "from": [W, H], "to": [W, H2],
        "bars": [top_bar, bot_bar],
        "flag_was_pct": round(fx0 / W * 100, 2),
        "flag_now_pct": round(new_fx / W * 100, 2),
        "flag_px": [fx1 - fx0 + 1, fy1 - fy0 + 1],
    }

out = []
for s, d in json.loads(sys.argv[1]):
    out.append(build(s, d))
print(json.dumps(out, indent=2))
`;

const pairs = [
  [join(ROOT, "assets/uploads/hero-plate-clean.png"), join(ROOT, "assets/uploads/hero-plate-mobile.png")],
  [join(ROOT, "assets/uploads/min6.png"), join(ROOT, "assets/uploads/min6-mobile.png")]
];

const result = execFileSync("python3", ["-c", script, JSON.stringify(pairs)], { encoding: "utf8" });
console.log(result);
