"""청킹전 .md -> 청킹 조각 파일.
사용법: py -I chunk.py <청킹전> <청킹> <보고서.json>
"""
import sys, os, re, glob, json

SRC, DST, REPORT = sys.argv[1], sys.argv[2], sys.argv[3]
LIMIT, SMALL = 1500, 100
ART = re.compile(r'^(#{2,6}) (제\d+조(의\d+)?(\(.*\))?)\s*$')
HEAD = re.compile(r'^(#{2,6}) (.+)$')


def doc_kind(rel, text):
    name = os.path.basename(rel)
    if re.search(r'\((법률|대통령령|환경부령|[^()]*조례)\)\(제', name):
        return 'law'
    if name.startswith('질문리스트'):
        return 'list'
    return 'report'


# ------------------------------------------------------------ 1단계: 단위 나누기
def units_law(lines):
    """[{kind, subs, lines}] - kind: article / section"""
    units, pending, cur, h2, buchik = [], [], None, None, None
    for ln in lines:
        m = HEAD.match(ln)
        if m:
            level, text = len(m.group(1)), m.group(2)
            if level == 2:
                h2 = text
                buchik = text if text.startswith('부칙') else None
            a = ART.match(ln)
            if a:
                sub = a.group(2) if buchik is None else f'{buchik} {a.group(2)}'
                cur = {'kind': 'article', 'subs': [sub], 'lines': pending + [ln, '']}
                units.append(cur); pending = []
            else:
                pending += [ln, '']
            continue
        if not ln.strip():
            if cur is not None and not pending:
                cur['lines'].append(ln)
            continue
        if pending:
            cur = {'kind': 'section', 'subs': [h2], 'lines': pending + [ln]}
            units.append(cur); pending = []
        elif cur is not None:
            cur['lines'].append(ln)
    if pending:  # 끝에 제목만 남은 경우 앞 단위에 붙인다
        if cur is not None:
            cur['lines'] += [''] + pending
        else:
            units.append({'kind': 'section', 'subs': [h2], 'lines': pending})
    return units


def units_h2(lines):
    units, cur = [], None
    for ln in lines:
        if ln.startswith('## '):
            cur = {'kind': 'section', 'subs': [ln[3:].strip()], 'lines': [ln]}
            units.append(cur)
        elif cur is not None:
            cur['lines'].append(ln)
    return units


# ------------------------------------------------------------ 2단계: 1500자 넘으면 다시 자르기
def blocks_of(text, kind):
    """문단 단위 블록. 표는 ('table', header, rows), 나머지는 ('p', 글) / ('h', 제목)."""
    out = []
    for para in re.split(r'\n\s*\n', text.strip('\n')):
        para = para.strip('\n')
        if not para.strip():
            continue
        ls = para.split('\n')
        if all(l.startswith('|') for l in ls) and len(ls) >= 2 and re.fullmatch(r'\|( --- \|)+', ls[1]):
            out.append(('table', ls[0] + '\n' + ls[1], ls[2:]))
        elif len(ls) == 1 and HEAD.match(ls[0]):
            out.append(('h', para))
        elif kind == 'list' and len(ls) > 1:
            out.append(('rows', ls))
        else:
            out.append(('p', para))
    return out


def split_long_para(p, limit):
    """문단 하나가 한도를 넘을 때: 줄 끝 -> 문장 끝에서 자른다."""
    parts = p.split('\n')
    if len(parts) == 1:
        parts = re.split(r'(?<=[.?!])\s+(?=\S)', p)
        sep = ' '
    else:
        sep = '\n'
    out, buf = [], ''
    for x in parts:
        cand = x if not buf else buf + sep + x
        if len(cand) <= limit or not buf:
            buf = cand
        else:
            out.append(buf); buf = x
    if buf:
        out.append(buf)
    return out


def pack(text, kind):
    """반환: [{'text', 'needs_header', 'hdr_len', 'oversize'}]"""
    blocks = blocks_of(text, kind)
    chunks = []
    cur = {'parts': [], 'needs_header': False, 'hdr_len': 0, 'oversize': None}

    def size(c):
        return len(render(c['parts']))

    def limit(c):
        return LIMIT - (c['hdr_len'] + 1 if c['needs_header'] else 0)

    def new():
        nonlocal cur
        if cur['parts']:
            chunks.append(cur)
        cur = {'parts': [], 'needs_header': False, 'hdr_len': 0, 'oversize': None}

    def add(part):
        """part: (sep, 글). sep은 앞 조각과의 구분자."""
        cur['parts'].append(part)

    def fits(part):
        return len(render(cur['parts'] + [part])) <= limit(cur)

    for b in blocks:
        if b[0] in ('p', 'h'):
            part = ('\n\n', b[1])
            if cur['parts'] and not fits(part):
                new()
            if len(b[1]) > limit(cur) and b[0] == 'p':
                pieces = split_long_para(b[1], limit(cur))
                for k, pc in enumerate(pieces):
                    pp = ('\n\n' if k == 0 else ('\n' if '\n' in b[1] else ' '), pc)
                    if cur['parts'] and not fits(pp):
                        new()
                    add(pp)
                    if len(pc) > LIMIT:
                        cur['oversize'] = '문장 하나가 1500자 초과'
            else:
                add(part)
        elif b[0] == 'rows':
            for k, r in enumerate(b[1]):
                part = ('\n\n' if k == 0 else '\n', r)
                if cur['parts'] and not fits(part):
                    new()
                add(part)
                if len(r) > LIMIT:
                    cur['oversize'] = '목록 한 행이 1500자 초과'
        else:  # table
            _, header, rows = b
            hdr_len = len(header)
            first = ('\n\n', header)
            # 머리글 + 첫 행이 들어가지 않으면 새 조각에서 시작
            if cur['parts'] and not (rows and fits(first) and len(render(cur['parts'] + [first, ('\n', rows[0])])) <= limit(cur)):
                new()
            add(first)
            for r in rows:
                part = ('\n', r)
                if not fits(part):
                    if len(cur['parts']) == 1 and cur['parts'][0] == first:
                        add(part); cur['oversize'] = '표 한 행이 1500자 초과'; continue
                    new()
                    cur['needs_header'] = True; cur['hdr_len'] = hdr_len
                    part = ('\n\n', r)
                    if not fits(part):
                        add(part); cur['oversize'] = '표 한 행이 1500자 초과'
                        new(); continue
                add(part)
    new()
    # 제목으로 끝나는 조각은 그 제목을 다음 조각으로 넘긴다
    for i in range(len(chunks) - 1):
        while chunks[i]['parts'] and chunks[i]['parts'][-1][0] == '\n\n' and HEAD.match(chunks[i]['parts'][-1][1]) and len(chunks[i]['parts']) > 1:
            h = chunks[i]['parts'].pop()
            chunks[i + 1]['parts'].insert(0, h)
    return [{'text': render(c['parts']), 'needs_header': c['needs_header'], 'hdr_len': c['hdr_len'],
             'oversize': c['oversize'] if len(render(c['parts'])) > LIMIT else None} for c in chunks if c['parts']]


def render(parts):
    s = ''
    for k, (sep, t) in enumerate(parts):
        s += (t if k == 0 else sep + t)
    return s


# ------------------------------------------------------------ 3단계: 작은 조각 합치기
def merge_small(chunks):
    notes = []
    i = 0
    while i < len(chunks):
        c = chunks[i]
        if c['kind'] == 'article' or len(c['text']) >= SMALL:
            i += 1; continue
        nxt = chunks[i + 1] if i + 1 < len(chunks) else None
        prv = chunks[i - 1] if i > 0 else None
        ok = lambda o: o is not None and o['kind'] != 'article' and not o['needs_header'] and len(o['text']) + 2 + len(c['text']) <= LIMIT
        if nxt is not None and ok(nxt):
            nxt['text'] = c['text'] + '\n\n' + nxt['text']
            nxt['subs'] = c['subs'] + [s for s in nxt['subs'] if s not in c['subs']]
            del chunks[i]
            continue  # 합친 조각이 아직 작으면 다시 본다
        if ok(prv):
            prv['text'] = prv['text'] + '\n\n' + c['text']
            prv['subs'] = prv['subs'] + [s for s in c['subs'] if s not in prv['subs']]
            notes.append(('앞 조각과 합침' if nxt is not None else '마지막이라 앞 조각과 합침', c['subs'][0]))
            del chunks[i]
            i = max(i - 1, 0)
            continue
        notes.append(('100자 미만이지만 합칠 수 없어 그대로 둠', c['subs'][0], len(c['text'])))
        i += 1
    return notes


# ------------------------------------------------------------ 실행
BAD = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def safe(s):
    return BAD.sub('', re.sub(r'\s+', '', s))


report = []
for path in sorted(glob.glob(os.path.join(SRC, '**', '*.md'), recursive=True)):
    rel = os.path.relpath(path, SRC)
    text = open(path, encoding='utf-8').read()
    lines = text.split('\n')
    title = lines[0][2:].strip() if lines[0].startswith('# ') else os.path.splitext(os.path.basename(path))[0]
    kind = doc_kind(rel, text)
    body = lines[1:]
    first_h2 = next((i for i, l in enumerate(body) if l.startswith('## ')), len(body))
    pre = '\n'.join(body[:first_h2]).strip('\n')
    units = []
    if pre.strip():
        units.append({'kind': 'section', 'subs': ['문서정보'], 'lines': pre.split('\n')})
    rest = body[first_h2:]
    units += units_law(rest) if kind == 'law' else units_h2(rest)

    chunks = []
    for u in units:
        t = '\n'.join(u['lines']).strip('\n')
        t = re.sub(r'\n{3,}', '\n\n', t)
        for pc in pack(t, kind):
            chunks.append({'kind': u['kind'], 'subs': list(u['subs']), **pc})
    notes = merge_small(chunks)

    width = 3 if len(chunks) >= 100 else 2
    stem = os.path.splitext(os.path.basename(path))[0]
    outdir = os.path.join(DST, os.path.dirname(rel))
    os.makedirs(outdir, exist_ok=True)
    files = []
    for n, c in enumerate(chunks, 1):
        fname = f'{BAD.sub("", stem)}_{n:0{width}d}_{safe(c["subs"][0])}.md'
        src_line = '출처: # ' + title + ''.join(' · ## ' + s for s in c['subs'])
        with open(os.path.join(outdir, fname), 'w', encoding='utf-8', newline='\n') as f:
            f.write(src_line + '\n\n' + c['text'].strip('\n') + '\n')
        files.append({'file': fname, 'len': len(c['text'].strip('\n')), 'kind': c['kind'], 'subs': c['subs'],
                      'needs_header': c['needs_header'], 'oversize': c['oversize'],
                      'pathlen': len(os.path.join(outdir, fname))})
    report.append({'src': rel, 'kind': kind, 'units': len(units), 'chunks': len(chunks), 'notes': notes, 'files': files,
                   'docinfo': bool(pre.strip())})
json.dump(report, open(REPORT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('done', len(report), sum(r['chunks'] for r in report))
