"""Extract the official One King One Crown artwork from the print-and-play PDF.

Usage (needs PyMuPDF, Pillow and numpy):
    python tools/extract_assets.py "path/to/All Cards.pdf" Client/public/art

Every card sheet in the PDF is one 300-DPI raster (2550x3300) holding a 3x3
grid of cards separated by ~14px cut lines. We crop each cell, check that
copies of the same card really are the same picture, keep one image per card,
and write manifest.json. The money-grid geometry of the two character cards
and the round positions on the round tracker are MEASURED from the pixels here
(never typed by hand), so the client's marker always lines up with the art.
"""

import json
import os
import sys
from collections import defaultdict

import numpy as np
import pymupdf
from PIL import Image

# Cut-grid of every card sheet (pixels in the 2550x3300 sheet).
CELL_X = [(157, 893), (907, 1643), (1657, 2393)]
CELL_Y = [(82, 1118), (1132, 2168), (2182, 3218)]
INSET = 6  # stay clear of the cut lines

# Sheet page -> the 9 cards on it, row by row. "k:" = King deck.
# (Backs are on the following even page, mirrored left-right for duplex
# printing: page 24's King back in column 0 sits behind page 23 column 2,
# which is how we know Black Plague is a King card.)
SHEETS = {
    7: ["actors"] * 3 + ["allies"] * 3 + ["bad_blood"] * 3,
    9: ["beggars_blessing"] * 3 + ["betrayal"] * 4 + ["betray_the_king"] * 2,
    11: ["council_meeting"] * 3 + ["divine_right", "grudge", "grudge"] + ["helping_hand"] * 3,
    13: ["hindsight", "hindsight", "icarus", "icarus", "indebted", "indebted"] + ["isolation"] * 3,
    15: ["king_maker", "king_maker", "knight", "knight", "loyalty", "loyalty", "loyalty", "meat_for_meat", "meat_for_meat"],
    17: ["meat_for_meat", "meat_for_meat", "peoples_champion", "royal_bomb", "scout", "scout"] + ["shadow_deal"] * 3,
    19: ["shadow_deal", "shadow_deal"] + ["sub_rosa"] * 5 + ["subsidies", "subsidies"],
    21: ["subsidies", "suppress_rebellion", "suppress_rebellion", "tithe", "tithe", "unprotected", "unprotected", "wrath", "wrath"],
    23: ["wrath", "wrath", "k:black_plague", "k:eye_for_an_eye", "k:bend_the_knee", "k:bend_the_knee", "k:helping_hand", "k:knight", "k:anchor"],
    25: ["k:anchor", "k:loyal_dog", "k:loyal_dog", "k:loyal_dog", "k:mad_king", "k:debt_collector", "k:debt_collector", "k:royal_parrot", "k:royal_parrot"],
    27: ["k:shifting_tides", "k:snakes", "k:sub_rosa", "k:sub_rosa", "k:scapegoat", "k:kings_eye", "k:kings_eye", "k:we_ride_together", "k:we_ride_together"],
}

# A copy of a card may differ from the first copy by print noise / a slightly
# different background tint, but never by this much (different cards differ
# by 27+ on the same scale).
SAME_CARD_MAX_DIFF = 10.0


def sheet_images(pdf_path):
    doc = pymupdf.open(pdf_path)
    pages = {}
    for i, page in enumerate(doc):
        imgs = page.get_images(full=True)
        if not imgs:
            continue
        pix = pymupdf.Pixmap(doc, imgs[0][0])
        if pix.n > 3 or pix.alpha:
            pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
        mode = "L" if pix.n == 1 else "RGB"
        pages[i + 1] = Image.frombytes(mode, (pix.width, pix.height), pix.samples).convert("L")
    return pages


def cell(sheet, index):
    r, c = divmod(index, 3)
    (x0, x1), (y0, y1) = CELL_X[c], CELL_Y[r]
    return sheet.crop((x0 + INSET, y0 + INSET, x1 - INSET, y1 - INSET))


def runs(mask):
    out, start = [], None
    for i, v in enumerate(mask):
        if v and start is None:
            start = i
        if not v and start is not None:
            out.append((start, i - 1))
            start = None
    if start is not None:
        out.append((start, len(mask) - 1))
    return out


def money_grid(img, grid_is_white):
    """Edges of the 3x7 money grid printed on a character card, in pixels."""
    a = np.asarray(img).astype(float) / 255
    grid = a > 0.5 if grid_is_white else a < 0.5
    rows = np.where(grid.mean(axis=1) > 0.3)[0]
    cols = np.where(grid.mean(axis=0) > 0.3)[0]
    y0, y1, x0, x1 = int(rows[0]), int(rows[-1]), int(cols[0]), int(cols[-1])
    sub = ~grid[y0:y1 + 1, x0:x1 + 1]
    vlines = runs(sub.mean(axis=0) > 0.8)
    hlines = runs(sub.mean(axis=1) > 0.8)
    if len(vlines) != 2 or len(hlines) != 6:
        raise SystemExit(f"money grid not found ({len(vlines)} vertical, {len(hlines)} horizontal lines)")
    # cell k spans from the end of line k-1 to the start of line k
    xs = [x0] + [x0 + (a_ + b_) / 2 for a_, b_ in vlines] + [x1]
    ys = [y0] + [y0 + (a_ + b_) / 2 for a_, b_ in hlines] + [y1]
    return {"colEdges": [round(v, 1) for v in xs], "rowEdges": [round(v, 1) for v in ys]}


def check_start_cell(img, grid, expected):
    """The printed starting cell is drawn inverted: sample a corner of every
    measured cell and make sure the odd one out is the official start value."""
    a = np.asarray(img).astype(float)
    samples = {}
    for v in range(0, 2001, 100):
        r, c = divmod(v // 100, 3)
        x0, x1 = grid["colEdges"][c], grid["colEdges"][c + 1]
        y0, y1 = grid["rowEdges"][r], grid["rowEdges"][r + 1]
        px, py = int(x0 + (x1 - x0) * 0.15), int(y0 + (y1 - y0) * 0.2)
        samples[v] = a[py - 3:py + 3, px - 3:px + 3].mean()
    median = float(np.median(list(samples.values())))
    odd = [v for v, s in samples.items() if abs(s - median) > 100]
    if odd != [expected]:
        raise SystemExit(f"money grid check failed: inverted cells {odd}, expected [{expected}]")


def save_webp(img, path, quality=82, width=None):
    if width:
        img = img.resize((width, round(img.height * width / img.width)), Image.LANCZOS)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, "WEBP", quality=quality, method=6)


def main(pdf_path, out_dir):
    pages = sheet_images(pdf_path)
    manifest = {"source": os.path.basename(pdf_path), "cards": {}, "copies": {}}

    groups = defaultdict(list)
    for page, keys in SHEETS.items():
        for i, key in enumerate(keys):
            groups[key].append(cell(pages[page], i))

    for key, cells in groups.items():
        first = np.asarray(cells[0]).astype(float)
        for other in cells[1:]:
            diff = np.abs(first - np.asarray(other).astype(float)).mean()
            if diff > SAME_CARD_MAX_DIFF:
                raise SystemExit(f"{key}: copies differ by {diff:.1f} - check the sheet map")
        deck = "king" if key.startswith("k:") else "noble"
        name = key.split(":")[-1]
        rel = f"cards/{deck}/{name}"
        save_webp(cells[0], f"{out_dir}/{rel}.webp")
        save_webp(cells[0], f"{out_dir}/{rel}.sm.webp", quality=78, width=300)
        manifest["cards"][f"{deck}:{name}"] = {"full": f"{rel}.webp", "small": f"{rel}.sm.webp"}
        manifest["copies"][f"{deck}:{name}"] = len(cells)

    # backs: page 8 = Noble back, page 24 column 0 = King back, page 6 = character back
    backs = {"noble": cell(pages[8], 0), "king": cell(pages[24], 0), "character": cell(pages[6], 0)}
    manifest["backs"] = {}
    for name, img in backs.items():
        save_webp(img, f"{out_dir}/backs/{name}.webp")
        save_webp(img, f"{out_dir}/backs/{name}.sm.webp", quality=78, width=300)
        manifest["backs"][name] = {"full": f"backs/{name}.webp", "small": f"backs/{name}.sm.webp"}

    # character (money) cards: page 5 cell 0 = King, cell 1 = Noble
    manifest["character"] = {}
    for role, idx, white, start in (("king", 0, False, 1000), ("noble", 1, True, 600)):
        img = cell(pages[5], idx)
        grid = money_grid(img, white)
        check_start_cell(img, grid, start)  # Rules p6: King 1000, Nobles 600
        save_webp(img, f"{out_dir}/character/{role}.webp", quality=88)
        manifest["character"][role] = {"src": f"character/{role}.webp", "width": img.width, "height": img.height, **grid}

    # round tracker + the eye tokens below it (page 3)
    tracker = pages[3].crop((497, 82, 2052, 1185))
    save_webp(tracker, f"{out_dir}/round-tracker.webp", quality=85)
    a = np.asarray(tracker).astype(float) / 255
    band = a[int(a.shape[0] * 0.40):int(a.shape[0] * 0.55)] < 0.5  # the four round emblems
    blobs = []
    for r in runs(band.mean(axis=0) > 0.05):  # the King's crown spikes split its emblem: merge close pieces
        if blobs and r[0] - blobs[-1][1] < 60:
            blobs[-1] = (blobs[-1][0], r[1])
        else:
            blobs.append(r)
    if len(blobs) != 4:
        raise SystemExit(f"round tracker: expected 4 emblems, found {len(blobs)}")
    manifest["roundTracker"] = {
        "src": "round-tracker.webp", "width": tracker.width, "height": tracker.height,
        "centersX": [round((b0 + b1) / 2 / tracker.width * 100, 2) for b0, b1 in blobs],
    }
    token = pages[3].crop((684, 1210, 868, 1393))
    save_webp(token, f"{out_dir}/token.webp", quality=90)
    manifest["token"] = "token.webp"

    banner = pages[1]
    save_webp(banner, f"{out_dir}/banner.webp", quality=88, width=1200)
    manifest["banner"] = "banner.webp"

    with open(f"{out_dir}/manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    total = sum(manifest["copies"].values())
    print(f"wrote {len(manifest['cards'])} card faces ({total} physical cards) to {out_dir}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
