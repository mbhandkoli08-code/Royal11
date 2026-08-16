"""Extract the seated Royal Host from room-host.png into a transparent PNG.

Crops a generous region around the host (top-left of the 1672x941 room render),
runs rembg to isolate the person, trims the transparent border, and saves a
crisp RGBA cutout for the mobile host-enabled layout.
"""
from PIL import Image
from rembg import remove, new_session
import io

SRC = "/app/frontend/public/assets/royal11/room-host.png"
OUT = "/app/frontend/public/assets/royal11/host-cutout.png"

im = Image.open(SRC).convert("RGB")
W, H = im.size  # 1672 x 941

# Generous crop around the host (she sits top-left, forearm on the felt rim).
crop = im.crop((0, 55, int(W * 0.30), int(H * 0.66)))  # x:0..501, y:55..621

buf = io.BytesIO()
crop.save(buf, format="PNG")
session = new_session("u2net_human_seg")
out_bytes = remove(buf.getvalue(), session=session,
                   alpha_matting=True,
                   alpha_matting_foreground_threshold=240,
                   alpha_matting_background_threshold=15,
                   alpha_matting_erode_size=8)
cut = Image.open(io.BytesIO(out_bytes)).convert("RGBA")

# Trim fully-transparent border.
bbox = cut.getbbox()
if bbox:
    cut = cut.crop(bbox)

cut.save(OUT, format="PNG")
print("saved", OUT, cut.size, cut.mode)
