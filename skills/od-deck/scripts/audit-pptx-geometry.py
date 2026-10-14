#!/usr/bin/env python3
"""
audit-pptx-geometry.py —— 检查 PPTX 的**跨渲染器几何风险**

为什么需要单独的几何检查：不同渲染器（PowerPoint / LibreOffice / WPS）对
「文字装不下形状框」的处理不一样 —— 有的撑开、有的裁切、有的让文字**溢出框外**
撞到邻居。所以只要存在「框重叠」或「框装不下内容」，同一份文件在不同软件里
就是两个样子。

实测案例：一份 22 页 deck 的封面，标题框 2.40in 而内容需要 ≈2.46in，
于是 LibreOffice 让文字溢出，副标题贴上标题下沿。（标题本来就有行高 1.34 —— 
所以「只看未设行高」会误诊。）

用法:
    audit-pptx-geometry.py <file.pptx> [--overlap-tolerance 0.02]
"""
import argparse, sys, math
from pptx import Presentation

EMU = 914400.0


def est_lines(text, box_w_in, size_pt):
    """估算段落折行数。CJK 按「每字 ≈ 1em」算，拉丁按 ≈0.55em 算。"""
    if not text.strip():
        return 0, 0.0
    cjk = sum(1 for c in text if '\u3000' <= c <= '\u9fff' or '\uff00' <= c <= '\uffef')
    latin = len(text) - cjk
    width_em = cjk + latin * 0.55
    avail_em = (box_w_in * 72.0) / max(size_pt, 1)
    lines = max(1, math.ceil(width_em / max(avail_em, 1)))
    return lines, width_em


def para_metrics(tf, box_w_in):
    """一个文本框的内容总高（英寸）"""
    total = 0.0
    for para in tf.paragraphs:
        text = ''.join(r.text for r in para.runs) or para.text
        if not text.strip():
            continue
        size_pt = None
        for r in para.runs:
            if r.font.size:
                size_pt = r.font.size.pt
                break
        size_pt = size_pt or 18.0
        lead = para.line_spacing if isinstance(para.line_spacing, float) else 1.2
        lines, _ = est_lines(text, box_w_in, size_pt)
        total += lines * (size_pt / 72.0) * lead
    return total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('pptx')
    ap.add_argument('--overlap-tolerance', type=float, default=0.02,
                    help='允许的框重叠（英寸），默认 0.02')
    ap.add_argument('--headroom', type=float, default=1.0,
                    help='框高余量系数：内容高 × 此值 ≤ 框高 才算安全，默认 1.0')
    a = ap.parse_args()

    prs = Presentation(a.pptx)
    overlaps, tight, overflow = [], [], []

    for idx, slide in enumerate(prs.slides, 1):
        boxes = []
        for sh in slide.shapes:
            if not sh.has_text_frame or not sh.text_frame.text.strip():
                continue
            if sh.width is None or sh.height is None:
                continue
            top, left = sh.top / EMU, sh.left / EMU
            h, w = sh.height / EMU, sh.width / EMU
            boxes.append({'top': top, 'h': h, 'w': w, 'bottom': top + h,
                          'left': left, 'right': left + w,
                          'needed': para_metrics(sh.text_frame, w),
                          'text': sh.text_frame.text.strip().replace('\n', '⏎')[:26]})

        # ① 框装不下自己的内容
        #    乘 SAFETY：不同渲染器的行高与内边距都比 python-pptx 的账面值大，
        #    账面刚好装下 ≠ 渲染时不会溢出。
        SAFETY = 1.15
        for b in boxes:
            if b['needed'] * SAFETY > b['h'] + 1e-6:
                tag = f"slide{idx}: 「{b['text']}」"
                if b['needed'] > b['h'] * 1.02:
                    overflow.append((tag, b['h'], b['needed']))
                else:
                    tight.append((tag, b['h'], b['needed']))

        # ② 相邻文字框重叠 —— 但只报**上下堆叠**的那种
        #
        #    「框重叠」本身很常见也很正常：同一行的左对齐 + 右对齐两个全宽框，
        #    它们的框必然重叠，而文字并不碰。所以要排除：
        #      · 同一行（top 几乎相同）
        #      · 左右并排（横向重叠相对较窄的那个框占比不大）
        #    剩下的才是「堆叠元素之间没留够空隙」—— 那才会在不同渲染器下撞车。
        for i in range(len(boxes)):
            for j in range(i + 1, len(boxes)):
                x, y = boxes[i], boxes[j]
                if abs(x['top'] - y['top']) <= 0.05:          # 同一行
                    continue
                vgap = min(x['bottom'], y['bottom']) - max(x['top'], y['top'])
                hgap = min(x['right'], y['right']) - max(x['left'], y['left'])
                narrower = min(x['w'], y['w'])
                if not (vgap > a.overlap_tolerance
                        and hgap > max(a.overlap_tolerance, narrower * 0.30)):
                    continue
                #    还要「至少一方接近满框」才算风险 —— 框里有大量余量时，
                #    重叠是安全的（设计师也常把标题拆成两个框分别上样式）。
                #    没余量 = 渲染器稍大一点就溢出，那才会撞到邻居。
                fill_x = x['needed'] / x['h'] if x['h'] else 0
                fill_y = y['needed'] / y['h'] if y['h'] else 0
                if max(fill_x, fill_y) < 0.85:
                    continue
                overlaps.append((idx, x['text'], y['text'], vgap, hgap, max(fill_x, fill_y)))

    print(f'文件   : {a.pptx}')
    print(f'页数   : {len(prs.slides)}')
    print()
    bad = False

    if overlaps:
        bad = True
        print(f'⚠️  {len(overlaps)} 组「堆叠重叠 + 框近满」—— 不同渲染器下会撞车:')
        for idx, t1, t2, v, h, fill in overlaps[:12]:
            print(f'   slide{idx}  「{t1}」×「{t2}」  重叠 {v:.2f}in  满框度 {fill:.0%}')
        print()
    if overflow:
        bad = True
        print(f'⚠️  {len(overflow)} 个框的余量不足（不同渲染器下文字可能溢出撞到邻居）:')
        for tag, box_h, need in overflow[:12]:
            print(f'   {tag}  框高 {box_h:.2f}in < 需要 {need:.2f}in  （差 {need-box_h:.2f}in）')
        print()
    if tight:
        print(f'ℹ️  {len(tight)} 个框刚好卡住（余量 < 2%，建议放宽）:')
        for tag, box_h, need in tight[:8]:
            print(f'   {tag}  框高 {box_h:.2f}in ≈ 需要 {need:.2f}in')
        print()

    if not bad:
        print('✅ 几何安全：无框重叠、无内容溢出风险')
    print('（估算值 —— 用 pptx-preview 渲染出来肉眼确认，估算器会误判换行）')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
