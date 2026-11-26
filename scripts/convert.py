"""원본 폴더의 .hwp(HWPML) / .docx / .txt / .csv / .xlsx / .md 를 청킹전 폴더에 .md 로 저장한다.
사용법: py -I convert.py <원본폴더> <청킹전폴더> <보고서.json>
"""
import sys, os, re, json, zipfile, glob
import xml.etree.ElementTree as ET

SRC, DST, REPORT = sys.argv[1], sys.argv[2], sys.argv[3]


# ---------------------------------------------------------------- 공통
def clean(s):
    return s.replace('\xa0', ' ').replace('\r\n', '\n').replace('\r', '\n')


def cell_text(s):
    s = clean(s).strip()
    s = re.sub(r'\s*\n\s*', '<br>', s)
    return s.replace('|', '\\|')


def md_table(grid):
    """grid: 행 목록(각 행은 칸 글자 목록). 첫 행을 머리 행으로 쓴다."""
    if not grid:
        return ''
    width = max(len(r) for r in grid)
    rows = [r + [''] * (width - len(r)) for r in grid]
    out = ['| ' + ' | '.join(rows[0]) + ' |', '|' + ' --- |' * width]
    for r in rows[1:]:
        out.append('| ' + ' | '.join(r) + ' |')
    return '\n'.join(out)


# ---------------------------------------------------------------- HWPML
RANK = [('편', r'^제\d+편(의\d+)?(\s|$)'), ('장', r'^제\d+장(의\d+)?(\s|$)'),
        ('절', r'^제\d+절(의\d+)?(\s|$)'), ('관', r'^제\d+관(의\d+)?(\s|$)')]


def split_article(text):
    """'제1조(목적) 본문' -> ('제1조(목적)', '본문'). 조문이 아니면 None."""
    m = re.match(r'^제\d+조(의\d+)?', text)
    if not m:
        return None
    i = m.end()
    if i < len(text) and text[i] == '(':
        depth = 0
        for j in range(i, len(text)):
            if text[j] == '(':
                depth += 1
            elif text[j] == ')':
                depth -= 1
                if depth == 0:
                    return text[:j + 1], text[j + 1:].strip()
        return None
    rest = text[i:]
    if rest == '' or rest[0] in ' \t':
        return text[:i], rest.strip()
    return None  # 예: '제19조제1항 중 ...'


def hwp_convert(path):
    raw = open(path, 'rb').read().decode('utf-8')
    raw = re.sub(r'<!DOCTYPE[^\[]*\[.*?\]>', '', raw, flags=re.S).replace('&nbsp;', '&#160;')
    root = ET.fromstring(raw)
    items = []          # ('p', 원문글자) / ('table', grid) / ('pic', None)
    atoms = []          # 누락 검사용 원문 조각
    pics = {'body': 0, 'deco': 0}
    loose = re.findall(r'>\s*(\{[^<}]+\})\s*<', raw[raw.find('<BODY'):])

    def table_grid(t):
        rows = int(t.get('RowCount', '0')); cols = int(t.get('ColCount', '0'))
        grid = [[''] * cols for _ in range(rows)]
        for cell in t.iter('CELL'):
            ps = []
            for p in cell.iter('P'):
                s = ''.join(ch.text or '' for ch in p.iter('CHAR'))
                if s.strip():
                    ps.append(s)
                    atoms.append(s)
            r, c = int(cell.get('RowAddr')), int(cell.get('ColAddr'))
            if r < rows and c < cols:
                grid[r][c] = cell_text('\n'.join(ps))
        return grid

    def walk_p(p, deco=False):
        buf = []

        def flush():
            s = ''.join(buf)
            buf.clear()
            if s.strip():
                items.append(('p', s))
                atoms.append(s)

        def walk(el):
            for c in el:
                if c.tag == 'CHAR':
                    buf.append(c.text or '')
                elif c.tag == 'TABLE':
                    flush(); items.append(('table', table_grid(c)))
                elif c.tag == 'PICTURE':
                    pics['deco' if deco else 'body'] += 1
                    if not deco:
                        items.append(('pic', None))
                elif c.tag in ('HEADER', 'FOOTER'):
                    flush()
                    for sub in c.iter('PICTURE'):
                        pics['deco'] += 1
                    for t in c.iter('TABLE'):
                        items.append(('table', table_grid(t)))
                elif c.tag == 'P':
                    flush(); walk_p(c, deco)
                else:
                    walk(c)
        for tx in p.findall('TEXT'):
            walk(tx)
        flush()

    for sec in root.find('BODY').findall('SECTION'):
        for p in sec.findall('P'):
            walk_p(p)

    # 표지 로고: 본문 글자가 나오기 전에 있는 그림은 장식으로 본다
    seen_text = False
    for k, (kind, _) in enumerate(items):
        if kind == 'p':
            seen_text = True
        elif kind == 'pic' and not seen_text:
            items[k] = ('decopic', None); pics['body'] -= 1; pics['deco'] += 1

    # 문서에 있는 구조 단위 -> 제목 수준
    present = []
    for name, rx in RANK:
        if any(k == 'p' and re.match(rx, clean(v).strip()) and len(clean(v).strip()) < 60 for k, v in items):
            present.append(name)
    level_of = {name: 2 + i for i, name in enumerate(present)}

    title = os.path.splitext(os.path.basename(path))[0]
    out = [f'# {title}', '', '## 기본 정보', '']
    cur = 1          # 지금 열려 있는 구조 제목의 수준(1이면 없음)
    where = '기본 정보'
    pic_where = []
    for kind, val in items:
        if kind == 'table':
            out += [md_table(val), '']
            continue
        if kind == 'pic':
            pic_where.append(where)
            continue
        if kind == 'decopic':
            continue
        text = clean(val)
        s = text.strip()
        lines = [ln.strip() for ln in s.split('\n') if ln.strip()]
        s1 = ' '.join(lines) if len(lines) == 1 else s
        head = None
        if len(s) < 60:
            for name, rx in RANK:
                if re.match(rx, s):
                    head = (level_of[name], s)
                    break
            if head is None and re.match(r'^부칙(\s|<|$)', s):
                head = (2, re.sub(r'\s+', ' ', s))
        if head:
            cur = head[0]
            out += ['#' * head[0] + ' ' + head[1], '']
            where = head[1]
            continue
        art = split_article(text.lstrip('\n')) if not text[:1].isspace() else None
        if art:
            lv = min(cur + 1, 6)
            out += ['#' * lv + ' ' + art[0], '']
            where = art[0]
            if art[1]:
                out += ['\n'.join(ln.strip() for ln in art[1].split('\n') if ln.strip()), '']
            continue
        out += ['\n'.join(lines), '']
    md = '\n'.join(out).rstrip() + '\n'
    note = []
    if pic_where:
        from collections import Counter
        cnt = Counter(pic_where)
        note.append('본문 그림 %d개(%s)' % (len(pic_where), ', '.join(f'{k} {v}개' if v > 1 else k for k, v in cnt.items())))
    if pics['deco']:
        note.append('표지·머리말·꼬리말 로고 그림 %d개' % pics['deco'])
    return md, atoms, note, loose


# ---------------------------------------------------------------- DOCX
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
q = lambda t: '{%s}%s' % (W, t)


def docx_convert(path):
    z = zipfile.ZipFile(path)
    rels = {}
    if 'word/_rels/document.xml.rels' in z.namelist():
        for r in ET.fromstring(z.read('word/_rels/document.xml.rels')):
            rels[r.get('Id')] = (r.get('Target'), r.get('TargetMode'))
    numfmt = {}
    if 'word/numbering.xml' in z.namelist():
        nroot = ET.fromstring(z.read('word/numbering.xml'))
        absfmt = {}
        for a in nroot.findall(q('abstractNum')):
            for lvl in a.findall(q('lvl')):
                f = lvl.find(q('numFmt'))
                absfmt[(a.get(q('abstractNumId')), lvl.get(q('ilvl')))] = f.get(q('val')) if f is not None else 'bullet'
        for n in nroot.findall(q('num')):
            aid = n.find(q('abstractNumId')).get(q('val'))
            for (a, l), f in absfmt.items():
                if a == aid:
                    numfmt[(n.get(q('numId')), l)] = f
    root = ET.fromstring(z.read('word/document.xml'))
    body = root.find(q('body'))
    atoms, notes = [], []
    title = os.path.splitext(os.path.basename(path))[0]
    out = [f'# {title}', '']
    counters = {}
    where = '첫머리'
    pics = []

    def para_text(p, links=True):
        parts, plain = [], []

        def run_text(r):
            s = ''
            for c in r:
                if c.tag == q('t'):
                    s += c.text or ''
                elif c.tag == q('tab'):
                    s += '\t'
                elif c.tag in (q('br'), q('cr')):
                    s += '\n'
            return s
        for c in p:
            if c.tag == q('r'):
                s = run_text(c)
                parts.append(s); plain.append(s)
                if c.find('.//' + q('drawing')) is not None or c.find('.//' + q('pict')) is not None:
                    pics.append(where)
            elif c.tag == q('hyperlink'):
                s = ''.join(run_text(r) for r in c.iter(q('r')))
                plain.append(s)
                rid = c.get('{%s}id' % R)
                tgt = rels.get(rid, (None, None))[0] if rid else None
                parts.append(f'[{s}]({tgt})' if (links and tgt and s) else s)
            elif c.tag in (q('ins'), q('smartTag'), q('sdt'), q('fldSimple')):
                s = ''.join(run_text(r) for r in c.iter(q('r')))
                parts.append(s); plain.append(s)
        return ''.join(parts), ''.join(plain)

    def all_bold(p):
        runs = [r for r in p.iter(q('r')) if ''.join(t.text or '' for t in r.iter(q('t'))).strip()]
        if not runs:
            return False
        for r in runs:
            b = r.find(q('rPr') + '/' + q('b'))
            if b is None or b.get(q('val')) in ('0', 'false'):
                return False
        return True

    first_h1 = True
    for el in body:
        if el.tag == q('p'):
            ppr = el.find(q('pPr'))
            style = ''
            if ppr is not None and ppr.find(q('pStyle')) is not None:
                style = ppr.find(q('pStyle')).get(q('val'))
            text, plain = para_text(el)
            text = clean(text).strip()
            if not text:
                continue
            atoms.append(plain)
            m = re.match(r'Heading(\d)', style)
            if m:
                n = int(m.group(1))
                if n == 1 and first_h1 and plain.strip() == title:
                    first_h1 = False
                    continue
                n = max(n, 2)
                if out and out[-1] != '':
                    out.append('')
                out += ['#' * min(n, 6) + ' ' + text, '']
                where = text
                continue
            numpr = ppr.find(q('numPr')) if ppr is not None else None
            if numpr is not None and numpr.find(q('numId')) is not None:
                nid = numpr.find(q('numId')).get(q('val'))
                il = numpr.find(q('ilvl')).get(q('val')) if numpr.find(q('ilvl')) is not None else '0'
                fmt = numfmt.get((nid, il), 'bullet')
                ind = '  ' * int(il)
                if fmt == 'bullet' or fmt == 'none':
                    out += [ind + '- ' + text.replace('\n', '\n' + ind + '  ')]
                else:
                    k = (nid, il)
                    counters[k] = counters.get(k, 0) + 1
                    for kk in list(counters):
                        if kk[0] == nid and int(kk[1]) > int(il):
                            del counters[kk]
                    out += [ind + f'{counters[k]}. ' + text.replace('\n', '\n' + ind + '   ')]
                continue
            if out and out[-1] != '':
                out.append('')
            if style in ('Quote', 'IntenseQuote'):
                out += ['> ' + text.replace('\n', '\n> '), '']
            elif all_bold(el):
                out += ['**' + text + '**', '']
            else:
                out += [text, '']
        elif el.tag == q('tbl'):
            if out and out[-1] != '':
                out.append('')
            grid = []
            for tr in el.findall(q('tr')):
                row = []
                for tc in tr.findall(q('tc')):
                    tcpr = tc.find(q('tcPr'))
                    span, cont = 1, False
                    if tcpr is not None:
                        g = tcpr.find(q('gridSpan'))
                        if g is not None:
                            span = int(g.get(q('val')))
                        v = tcpr.find(q('vMerge'))
                        if v is not None and v.get(q('val')) != 'restart':
                            cont = True
                    ps = []
                    for p in tc.findall('.//' + q('p')):
                        t, pl = para_text(p)
                        if pl.strip():
                            atoms.append(pl)
                            ps.append(t)
                    row.append('' if cont else cell_text('\n'.join(ps)))
                    row += [''] * (span - 1)
                grid.append(row)
            out += [md_table(grid), '']
    md = re.sub(r'\n{3,}', '\n\n', '\n'.join(out)).rstrip() + '\n'
    if pics:
        notes.append('그림 %d개(%s 아래)' % (len(pics), ', '.join(dict.fromkeys(pics))))
    return md, atoms, notes, []


# ---------------------------------------------------------------- TXT / CSV / XLSX / MD
def read_text(path):
    b = open(path, 'rb').read()
    for enc in ('utf-8-sig', 'cp949'):
        try:
            return b.decode(enc), enc
        except UnicodeDecodeError:
            pass
    return b.decode('utf-8', errors='replace'), 'utf-8(깨짐)'


def txt_convert(path):
    s, enc = read_text(path)
    title = os.path.splitext(os.path.basename(path))[0]
    s = clean(s).strip('\n')
    lines = [ln.rstrip() for ln in s.split('\n')]
    atoms = [ln for ln in lines if ln.strip()]
    md = f'# {title}\n\n## 본문\n\n' + '\n'.join(lines).rstrip() + '\n'
    return md, atoms, [] if enc != 'utf-8(깨짐)' else ['UTF-8·CP949 모두 실패'], [], enc


def csv_convert(path):
    import csv, io
    s, enc = read_text(path)
    rows = list(csv.reader(io.StringIO(s)))
    title = os.path.splitext(os.path.basename(path))[0]
    atoms = [c for r in rows for c in r if c.strip()]
    grid = [[cell_text(c) for c in r] for r in rows]
    return f'# {title}\n\n## 표\n\n' + md_table(grid) + '\n', atoms, [], [], enc


def md_convert(path):
    s, enc = read_text(path)
    title = os.path.splitext(os.path.basename(path))[0]
    s = clean(s).strip('\n')
    atoms = [ln for ln in s.split('\n') if ln.strip()]
    if not re.match(r'#\s', s):
        s = f'# {title}\n\n' + s
    return s.rstrip() + '\n', atoms, [], [], enc


# ---------------------------------------------------------------- 검사
def norm(s):
    s = re.sub(r'\[([^\]]*)\]\([^)]*\)', r'\1', s)
    s = s.replace('<br>', '').replace('\\|', '|')
    return re.sub(r'[\s#*>|\-]', '', s.replace('\xa0', ''))


def garble(s):
    bad = s.count('�')
    pua = sum(1 for ch in s if 0xE000 <= ord(ch) <= 0xF8FF)
    moj = len(re.findall(r'[ÃÂìíëêð][\x80-\xbf]', s))
    return bad, pua, moj


results = []
for path in sorted(glob.glob(os.path.join(SRC, '**', '*'), recursive=True)):
    if not os.path.isfile(path):
        continue
    rel = os.path.relpath(path, SRC)
    ext = os.path.splitext(path)[1].lower()
    dst = os.path.join(DST, os.path.splitext(rel)[0] + '.md')
    rec = {'src': rel, 'dst': os.path.relpath(dst, DST), 'enc': 'utf-8'}
    try:
        if ext == '.hwp':
            md, atoms, notes, loose = hwp_convert(path)
        elif ext == '.docx':
            md, atoms, notes, loose = docx_convert(path)
        elif ext == '.txt':
            md, atoms, notes, loose, rec['enc'] = txt_convert(path)
        elif ext == '.csv':
            md, atoms, notes, loose, rec['enc'] = csv_convert(path)
        elif ext == '.md':
            md, atoms, notes, loose, rec['enc'] = md_convert(path)
        else:
            rec.update(dst=None, error='지원하지 않는 형식'); results.append(rec); continue
    except Exception as e:  # noqa
        rec.update(dst=None, error=repr(e)); results.append(rec); continue
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with open(dst, 'w', encoding='utf-8', newline='\n') as f:
        f.write(md)
    N = norm(md)
    missing = [a for a in atoms if norm(a) and norm(a) not in N]
    src_chars = sum(len(norm(a)) for a in atoms)
    rec.update(notes=notes, loose=loose, garble=garble(md), atoms=len(atoms),
               missing=len(missing), missing_sample=[m[:80] for m in missing[:3]],
               src_chars=src_chars, md_chars=len(N),
               h2=len(re.findall(r'^## ', md, re.M)), h3=len(re.findall(r'^### ', md, re.M)),
               h4=len(re.findall(r'^#### ', md, re.M)), tables=len(re.findall(r'^\|( --- \|)+$', md, re.M)))
    results.append(rec)

json.dump(results, open(REPORT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('done', len(results))
