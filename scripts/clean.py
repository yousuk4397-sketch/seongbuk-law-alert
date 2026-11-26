"""청킹전 .md 정제: 머리말 표 · 쪽번호(꼬리말) 표 · 겹친 빈 줄만 뺀다.
사용법: py -I clean.py <청킹전폴더> <보고서.json>
"""
import sys, glob, os, re, json

root = sys.argv[1]
report = []
for p in sorted(glob.glob(os.path.join(root, '**', '*.md'), recursive=True)):
    s = open(p, encoding='utf-8').read()
    lines = s.split('\n')
    removed = []
    keep = []
    i = 0
    in_info = False
    while i < len(lines):
        ln = lines[i]
        if ln.startswith('## '):
            in_info = (ln == '## 기본 정보')
        nxt = lines[i + 1] if i + 1 < len(lines) else ''
        # 쪽번호가 든 꼬리말 표: | 법제처 | - / - | 국가법령정보센터 |
        if in_info and re.fullmatch(r'\| 법제처 \| -\s+/\s+- \| 국가법령정보센터 \|', ln) and re.fullmatch(r'\|( --- \|)+', nxt):
            removed.append(('쪽번호(꼬리말) 표', ln)); i += 2; continue
        # 머리말 표: 기본 정보 안의 한 칸짜리 표(법령 이름)
        if in_info and re.fullmatch(r'\| [^|]+ \|', ln) and nxt == '| --- |':
            removed.append(('머리말 표', ln)); i += 2; continue
        keep.append(ln)
        i += 1
    t = '\n'.join(keep)
    blanks = len(re.findall(r'\n{3,}', t))
    t = re.sub(r'\n{3,}', '\n\n', t).rstrip() + '\n'
    if t != s:
        open(p, 'w', encoding='utf-8', newline='\n').write(t)
    report.append({'file': os.path.relpath(p, root), 'removed': removed, 'blank_merged': blanks,
                   'lines_before': len(lines), 'lines_after': len(t.split('\n'))})
json.dump(report, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('done', len(report))
