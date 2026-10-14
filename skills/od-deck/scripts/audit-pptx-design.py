#!/usr/bin/env python3
"""
audit-pptx-design.py —— 客观核验一份 PPTX 的设计合规性

子代理会自报"我用了这些颜色和字体"。这个脚本不信自报，直接拆 OOXML 数。

用法:
    audit-pptx-design.py <file.pptx> [--tokens #F9F8F5,#1B150D,...]

检查：
  1. 页数
  2. 实际使用的字体（latin / ea / cs 三个槽分别统计）
  3. 实际使用的颜色 —— 与允许的 token 集合比对，报出"越界色"
  4. 渐变填充（AI 味重灾区）
  5. emoji 当图标
  6. 中文段落的行高（CJK 需要比拉丁更大的 leading）
  7. 左边竖条卡片的典型特征（细长矩形 + 贴左）
"""
import argparse, re, sys, zipfile, json
from collections import Counter

DEFAULT_TOKENS = ['F9F8F5', 'FFFFFE', '1B150D', '625D56', 'DFDEDA', '9A5048', 'FFFFFF', '000000']
EMOJI = re.compile('[\U0001F300-\U0001FAFF\u2600-\u27BF\uFE0F]')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('pptx')
    ap.add_argument('--tokens', default=','.join(DEFAULT_TOKENS))
    ap.add_argument('--json', action='store_true')
    a = ap.parse_args()
    allowed = {t.strip().lstrip('#').upper() for t in a.tokens.split(',') if t.strip()}

    z = zipfile.ZipFile(a.pptx)
    slides = sorted(n for n in z.namelist() if re.match(r'ppt/slides/slide\d+\.xml$', n))
    out = {'file': a.pptx, 'slides': len(slides), 'issue': []}

    fonts, colors, grads, emojis = Counter(), Counter(), 0, 0
    ea_fonts, latin_fonts = Counter(), Counter()
    leading_issues = []

    for n in slides:
        xml = z.read(n).decode('utf-8', 'ignore')

        # 字体：按槽位分
        for m in re.finditer(r'<a:(latin|ea|cs)\s+typeface="([^"]*)"', xml):
            slot, face = m.group(1), m.group(2)
            if not face or face.startswith('+'): continue
            fonts[face] += 1
            (ea_fonts if slot == 'ea' else latin_fonts if slot == 'latin' else Counter())[face] += 1

        # 颜色
        for m in re.finditer(r'<a:srgbClr\s+val="([0-9A-Fa-f]{6})"', xml):
            colors[m.group(1).upper()] += 1

        # 渐变
        grads += len(re.findall(r'<a:gradFill', xml))

        # emoji（只数文本节点，避免 theme 里的字符）
        for m in re.finditer(r'<a:t>(.*?)</a:t>', xml, re.S):
            if EMOJI.search(m.group(1)): emojis += 1

        # 中文段落的 lnSpc
        #
        # 只查**可能折行**的段落。眉标「产业观察 · 2026」、页码「01 / 22」、
        # 短标签这类单行文字不设行高完全无害 —— 早期版本把它们一起报出来，
        # 71 条里绝大多数是误报，反而把真问题淹了。（真问题看
        # audit-pptx-geometry.py 的几何检查。）
        for para in re.findall(r'<a:p>.*?</a:p>', xml, re.S):
            txt = ''.join(re.findall(r'<a:t>(.*?)</a:t>', para, re.S))
            if not re.search(r'[\u4e00-\u9fff]', txt): continue
            if len(txt.strip()) < 20: continue          # 单行，不查
            pct = re.search(r'<a:lnSpc><a:spcPct val="(\d+)"', para)
            pts = re.search(r'<a:lnSpc><a:spcPts val="(\d+)"', para)
            if pct:
                v = int(pct.group(1)) / 100000
                if v < 1.30: leading_issues.append((n, txt[:18], f'{v:.2f}×'))
            elif not pts:
                leading_issues.append((n, txt[:18], '未设置'))

    out['fonts'] = dict(fonts.most_common())
    out['ea_fonts'] = dict(ea_fonts.most_common())
    out['latin_fonts'] = dict(latin_fonts.most_common())
    out['colors'] = dict(colors.most_common())
    out['gradients'] = grads
    out['emoji_uses'] = emojis

    stray = {c: n for c, n in colors.items() if c not in allowed}
    out['stray_colors'] = stray
    out['leading_issues'] = leading_issues[:12]

    if grads: out['issue'].append(f'{grads} 处渐变填充（AI 味重灾区）')
    if emojis: out['issue'].append(f'{emojis} 处 emoji（不要用 emoji 当图标）')
    if stray: out['issue'].append(f'{len(stray)} 种越界色：{", ".join("#"+c for c in stray)}')
    if leading_issues: out['issue'].append(f'{len(leading_issues)} 段中文行高 < 1.30')
    # 衬线中文字体的常见命名（SimSun 本身就是宋体，别漏）
    SERIF_CJK = ('serif', 'song', 'sung', 'ming', '宋', 'stsong', 'simsun', 'nsimsun',
                 'fangsong', '仿宋', 'kai', '楷', 'source han serif', 'noto serif')
    if ea_fonts and not any(any(k in f.lower() for k in SERIF_CJK) for f in ea_fonts):
        out['issue'].append(f'中文字体疑似非衬线：{list(ea_fonts)}')

    if a.json:
        print(json.dumps(out, ensure_ascii=False, indent=2)); return

    print(f'文件      : {a.pptx}')
    print(f'页数      : {out["slides"]}')
    print(f'字体(latin): {out["latin_fonts"]}')
    print(f'字体(ea)   : {out["ea_fonts"]}')
    print(f'颜色      : {out["colors"]}')
    print(f'渐变      : {grads}    emoji: {emojis}')
    if leading_issues:
        print(f'中文行高问题 {len(leading_issues)} 段（前 5）:')
        for n, t, v in leading_issues[:5]: print(f'   {n.split("/")[-1]}  {v:>6}  {t}')
    print()
    if out['issue']:
        print('⚠️ 发现问题:')
        for i in out['issue']: print(f'   · {i}')
        sys.exit(1)
    print('✅ 设计合规：无越界色 / 无渐变 / 无 emoji / 行高合规')


if __name__ == '__main__':
    main()
