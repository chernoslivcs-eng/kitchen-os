#!/usr/bin/env python3
"""Крок 9 (1): стискання ілюстрацій онбордингу — квантизація до 128 кольорів +
optimize. Оригінали живуть у дизайн-проєкті власника; у репо — стиснуті.
Запуск: python3 scripts/compress-onboarding-png.py  (потрібен Pillow)
"""
import glob, os, sys
from PIL import Image

files = sorted(glob.glob('apps/web/public/onboarding/profile-*.png'))
if not files:
    sys.exit('немає apps/web/public/onboarding/profile-*.png')
total_before = total_after = 0
for f in files:
    before = os.path.getsize(f)
    im = Image.open(f).convert('RGBA')
    # Без прозорості — MEDIANCUT по RGB (краща палітра); з альфою — FASTOCTREE
    # (єдиний метод Pillow для RGBA).
    opaque = im.getchannel('A').getextrema()[0] == 255
    q = (im.convert('RGB').quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG)
         if opaque else im.quantize(colors=128, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG))
    q.save(f, optimize=True)
    after = os.path.getsize(f)
    total_before += before; total_after += after
    print(f'{os.path.basename(f):22} {before/1024:7.0f} KB → {after/1024:6.0f} KB')
print(f'{"разом":22} {total_before/1024:7.0f} KB → {total_after/1024:6.0f} KB')
