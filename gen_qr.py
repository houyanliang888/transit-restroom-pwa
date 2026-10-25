#!/usr/bin/env python3
# 生成出行助手推广二维码（纯 Python，零依赖：segno）
# 用法：python gen_qr.py
# 若部署地址变化，改下方 URL 后重跑即可。
import segno

# 部署后的公开地址（GitHub Pages 子路径）
URL = "https://houyanliang888.github.io/transit-restroom-pwa/"

qr = segno.make(URL, error="h")  # error='h' 高纠错，手机小屏/印刷更易扫
qr.save("qrcode.png", scale=12, border=4)
print("已生成 qrcode.png ->", URL)
