#!/usr/bin/env python3
"""Paint the Freud and Diablo marks out of the Freud & Diablo hero banner.

The banner artwork ships with both logos printed into its left-hand side, and the
hero draws its own Freud & Diablo logos as the slide title over that same area, so
the two collide. The title is the one that should stay: it is live text with links
and hover, and it sizes with the layout.

The area behind the marks is flat navy — RGB(9,40,68) either side of them, with a
gradient of about two levels across the whole patch — so the marks are removed by
diffusing the surrounding background inwards (a Laplace fill, boundary held fixed),
then adding back noise matched to the neighbouring pixels so the patch does not read
as smoother than what surrounds it.

The originals are the handoff's own assets/cr/B-2.png and B-2m.png, in the delivery
folder, if these ever need to be restored.

Usage:  python3 tools/strip-banner-logos.py
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
BANNERS = ["assets/uploads/r26/B-2.png", "assets/uploads/r26/B-2m.png"]

# The marks sit in the artwork's left-hand panel; the product photography on the
# right must not be touched, so the search is bounded well short of it.
LEFT_FRACTION = 0.45
DILATE = 14          # px, enough to swallow the anti-aliased edge and the drop glow
ITERATIONS = 600     # Laplace sweeps; the patch is small and converges long before this


def logo_mask(rgb):
    """Saturated red or near-white pixels in the left panel: that is the printing."""
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    mask = ((r > g + 40) & (r > b + 20)) | ((r > 150) & (g > 150) & (b > 150))
    mask[:, int(rgb.shape[1] * LEFT_FRACTION):] = False
    return mask


def dilate(mask, radius):
    out = mask.copy()
    for _ in range(radius):
        grown = out.copy()
        grown[1:, :] |= out[:-1, :]
        grown[:-1, :] |= out[1:, :]
        grown[:, 1:] |= out[:, :-1]
        grown[:, :-1] |= out[:, 1:]
        out = grown
    return out


def fill(rgb, mask):
    """Hold everything outside the mask fixed and let the background diffuse in."""
    work = rgb.astype(np.float64).copy()
    # Seed the hole with the mean of its boundary so convergence is quick.
    boundary = dilate(mask, 2) & ~mask
    work[mask] = work[boundary].mean(axis=0)

    for _ in range(ITERATIONS):
        avg = np.zeros_like(work)
        avg[1:-1, 1:-1] = (
            work[:-2, 1:-1] + work[2:, 1:-1] + work[1:-1, :-2] + work[1:-1, 2:]
        ) / 4.0
        work[mask] = avg[mask]

    # Match the grain of the surrounding pixels, which is about two levels.
    sigma = rgb[boundary].astype(np.float64).std(axis=0)
    noise = np.random.default_rng(7).normal(0.0, np.maximum(sigma, 0.3), size=work.shape)
    work[mask] += noise[mask]
    return np.clip(work, 0, 255).astype(np.uint8)


def main():
    for rel in BANNERS:
        path = ROOT / rel
        image = Image.open(path)
        had_alpha = image.mode in ("RGBA", "LA")
        alpha = image.getchannel("A") if had_alpha else None
        rgb = np.asarray(image.convert("RGB"))

        mask = dilate(logo_mask(rgb), DILATE)
        if not mask.any():
            print(f"{rel}: nothing to remove — already clean")
            continue

        ys, xs = np.nonzero(mask)
        out = Image.fromarray(fill(rgb, mask))
        if had_alpha:
            out.putalpha(alpha)
        out.save(path)

        # Confirm the marks are gone rather than assume it.
        left = logo_mask(np.asarray(Image.open(path).convert("RGB")))
        print(
            f"{rel}: cleared x{xs.min()}–{xs.max()} y{ys.min()}–{ys.max()} "
            f"({mask.sum()} px); remaining logo pixels: {left.sum()}"
        )
        if left.sum():
            sys.exit(f"{rel}: {left.sum()} logo pixels survived")


if __name__ == "__main__":
    main()
