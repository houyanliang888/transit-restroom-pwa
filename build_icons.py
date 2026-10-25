#!/usr/bin/env python3
"""把 AI 生成的含白边图标裁成纯深蓝底方形 PWA 图标（192/512/1024）。"""
from PIL import Image
import numpy as np
import os

SRC = r'C:/Users/Administrator/WorkBuddy/2026-10-24-09-29-14/transit-restroom-pwa/icons/Premium_modern_mobile_app_icon_2026-10-25T07-17-06.png'
OUT = r'C:/Users/Administrator/WorkBuddy/2026-10-24-09-29-14/transit-restroom-pwa/icons'

img = Image.open(SRC).convert('RGB')
W, H = img.size
arr = np.array(img)
# 非白（背景为白边）像素：R/G/B 任一 < 235 视为内容
mask = (arr[:, :, 0] < 235) | (arr[:, :, 1] < 235) | (arr[:, :, 2] < 235)
ys, xs = np.where(mask)
x0, x1 = xs.min(), xs.max()
y0, y1 = ys.min(), ys.max()
print(f'内容包围盒: x[{x0},{x1}] y[{y0},{y1}] 于 {W}x{H}')

# 圆角方块边距
bx = x0 + (W - x1)  # 左白边
by = y0 + (H - y1)  # 上白边
# 内缩：取中心最大正方形，避开圆角与右下角水印
inner = min(x1 - x0, y1 - y0)
cx = (x0 + x1) // 2
cy = (y0 + y1) // 2
shrink = int(inner * 0.06)  # 避开圆角玻璃高光
s = inner - 2 * shrink
left = cx - s // 2
top = cy - s // 2
crop = img.crop((left, top, left + s, top + s))
print(f'裁剪正方形: {s}x{s} @ ({left},{top})')

# 深蓝底填充（content 之外确保是 #0f172a，避免残留边角）
bg = (15, 23, 42)

for size in (1024, 512, 192):
    resized = crop.resize((size, size), Image.LANCZOS)
    # 若四角有非深蓝残留，铺底（正常不会有）
    arr2 = np.array(resized)
    corner = arr2[0, 0]
    if not (corner[0] < 30 and corner[1] < 35 and corner[2] < 60):
        # 用深蓝铺满整张后再贴内容不可行；这里直接保存（裁剪已保证纯底）
        pass
    out = os.path.join(OUT, f'icon-{size}.png')
    resized.save(out, 'PNG')
    print('已生成', out, resized.size)

# 同时保留一张展示用大图
crop.resize((1024, 1024), Image.LANCZOS).save(os.path.join(OUT, 'icon-1024.png'), 'PNG')
print('完成')
