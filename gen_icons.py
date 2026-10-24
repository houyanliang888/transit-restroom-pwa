import zlib, struct, os

OUT = r"C:/Users/Administrator/WorkBuddy/2026-10-24-09-29-14/transit-restroom-pwa/icons"

def make_icon(size):
    s = size
    buf = bytearray(s * s * 4)  # RGBA
    # 背景（方底，适配 maskable）
    bg = (43, 108, 255)
    for i in range(s * s):
        o = i * 4
        buf[o] = bg[0]; buf[o+1] = bg[1]; buf[o+2] = bg[2]; buf[o+3] = 255

    cx, cy = s * 0.5, s * 0.40
    r1 = s * 0.135          # 白色外圈
    r2 = s * 0.062          # 蓝色内点
    white = (255, 255, 255)
    accent = (43, 108, 255)

    def put(x, y, c):
        if 0 <= x < s and 0 <= y < s:
            o = (y * s + x) * 4
            buf[o] = c[0]; buf[o+1] = c[1]; buf[o+2] = c[2]; buf[o+3] = 255

    # 路线白条
    y0, y1 = int(s * 0.80), int(s * 0.865)
    x0, x1 = int(s * 0.18), int(s * 0.82)
    for y in range(y0, y1):
        for x in range(x0, x1):
            put(x, y, white)

    # 定位圆点（白色外圈 + 蓝色内点）
    for y in range(s):
        for x in range(s):
            dx, dy = x - cx, y - cy
            d = (dx*dx + dy*dy) ** 0.5
            if d <= r1:
                put(x, y, white)
            if d <= r2:
                put(x, y, accent)

    # 编码 PNG
    raw = bytearray()
    for y in range(s):
        raw.append(0)  # filter type 0
        raw.extend(buf[y * s * 4:(y + 1) * s * 4])

    def chunk(typ, data):
        return struct.pack(">I", len(data)) + typ + data + struct.pack(">I", zlib.crc32(typ + data) & 0xffffffff)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", s, s, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    return png

for size in (192, 512):
    p = os.path.join(OUT, f"icon-{size}.png")
    with open(p, "wb") as f:
        f.write(make_icon(size))
    print("wrote", p, size, "px")
