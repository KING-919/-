"""Generate a small NOVA Agent .ico using only the Python standard library."""
import math
import struct
import zlib
from pathlib import Path

SIZE = 256
SAMPLES = 4
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "assets" / "nova.ico"


def rounded_rect(x, y, left, top, right, bottom, radius):
    cx = min(max(x, left + radius), right - radius)
    cy = min(max(y, top + radius), bottom - radius)
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2


def segment_distance(px, py, x1, y1, x2, y2):
    dx, dy = x2 - x1, y2 - y1
    t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))


def pixel(x, y):
    totals = [0, 0, 0, 0]
    for sy in range(SAMPLES):
        for sx in range(SAMPLES):
            px, py = x + (sx + .5) / SAMPLES, y + (sy + .5) / SAMPLES
            inside = rounded_rect(px, py, 16, 16, 240, 240, 48)
            if not inside:
                continue
            color = (25, 23, 20, 255)
            edge = not rounded_rect(px, py, 19, 19, 237, 237, 45)
            if edge:
                color = (58, 52, 45, 255)
            mark = False
            cx, cy = SIZE / 2, SIZE / 2
            for degree in range(0, 360, 45):
                angle = math.radians(degree)
                ex, ey = cx + math.cos(angle) * 61, cy + math.sin(angle) * 61
                if segment_distance(px, py, cx, cy, ex, ey) <= 4.8:
                    mark = True
                    break
            if mark:
                color = (217, 119, 87, 255)
            if math.hypot(px - cx, py - cy) <= 12:
                color = (233, 149, 115, 255)
            for channel in range(4):
                totals[channel] += color[channel]
    count = SAMPLES * SAMPLES
    alpha = totals[3] // count
    if alpha == 0:
        return (0, 0, 0, 0)
    return tuple(totals[i] // count for i in range(3)) + (alpha,)


def png_chunk(kind, payload):
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)


raw = bytearray()
for y in range(SIZE):
    raw.append(0)
    for x in range(SIZE):
        raw.extend(pixel(x, y))

png = b"\x89PNG\r\n\x1a\n"
png += png_chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0))
png += png_chunk(b"IDAT", zlib.compress(bytes(raw), 9))
png += png_chunk(b"IEND", b"")
header = struct.pack("<HHH", 0, 1, 1)
entry = struct.pack("<BBBBHHII", 0, 0, 0, 0, 1, 32, len(png), 22)
OUT.write_bytes(header + entry + png)
print(f"Wrote {OUT} ({OUT.stat().st_size:,} bytes)")
