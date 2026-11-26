"""청킹전 .md -> 청킹 조각 (메타데이터·맥락 줄·검색 제외 포함).
사용법: py -I build_chunks.py <청킹전> <청킹 출력> <검색제외 출력> <links.json> <보고서.json> [파일 이름에 들어갈 글자]
자르기 규칙은 chunk.py 와 같다(법령은 조마다, 보고서·별표는 ## 마다, 1500자, 100자 미만 합치기).
바뀐 점: 맥락 줄 길이만큼 한도를 줄이고, 삭제 조문 조각은 검색제외 폴더로 보낸다.
별표(파일 이름에 '_별표')는 모 조례의 번호·시행일·버전·원문 링크를 이어받는다.
표가 나뉘면 뒷조각 맨 위에 그 표의 머리글(머리 행 + 구분 행)을 다시 넣는다.
마지막 인자를 주면 파일 이름에 그 글자가 든 문서만 만든다(예: _별표).
"""
import sys, os, re, glob, json
HERE = os.path.dirname(os.path.abspath(__file__))
SRC, DST, EXC, LINKS, REPORT = sys.argv[1:6]
ONLY = sys.argv[6] if len(sys.argv) > 6 else None

# chunk.py 의 함수(단위 나누기·자르기)를 그대로 가져온다
sys_argv = sys.argv
sys.argv = ['chunk.py', SRC, DST, REPORT]
code = open(os.path.join(HERE, 'chunk.py'), encoding='utf-8').read().split('\n# ------------------------------------------------------------ 3단계')[0]
G = {'__name__': 'chunklib'}
exec(code, G)
sys.argv = sys_argv
LIMIT, SMALL = 1500, 100
links = json.load(open(LINKS, encoding='utf-8'))
BAD = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
safe = lambda s: BAD.sub('', re.sub(r'\s+', '', s))


def doc_meta(rel, lines, kind):
    title = lines[0][2:].strip()
    m = {'문서 종류': '', '법령명': title, '종류': '-', '번호': '-', '공포일': '-', '시행일': '-'}
    if kind != 'law':
        m['문서 종류'] = '해설(비공식)'
        return m
    text = '\n'.join(lines[:40])
    name = next((l.strip() for l in lines[1:40] if l.strip() and not l.startswith(('#', '※', '[', '국가법령정보센터', '|'))), title)
    m['법령명'] = name
    r = re.search(r'\[시행 ([^\]]+)\]\s*\[(.+?) 제0*(\d+)호, ([^,\]]+),', text)
    if r:
        kind_raw = r.group(2)
        m['시행일'] = r.group(1).strip()
        m['공포일'] = r.group(4).strip()
        if '조례' in kind_raw:
            m['종류'] = '조례'; m['문서 종류'] = '조례'; m['번호'] = f'성북구 조례 제{r.group(3)}호'
        else:
            m['종류'] = kind_raw; m['문서 종류'] = '법령'; m['번호'] = f'{kind_raw} 제{r.group(3)}호'
    return m


def ymd(s):
    p = re.findall(r'\d+', s)
    return tuple(int(x) for x in p[:3]) if len(p) >= 3 else (0, 0, 0)


def is_deleted(text):
    """제목 줄을 빼고 나면 '삭제'와 날짜·기호만 남는 조각."""
    body = '\n'.join(l for l in text.split('\n') if not G['HEAD'].match(l))
    head = ' '.join(l for l in text.split('\n') if G['HEAD'].match(l))
    rest = re.sub(r'삭제|[<>()\[\]〈〉.,:\s\d①-⑳]', '', body)
    if rest:
        return False
    return '삭제' in body or '삭제' in head


files = sorted(p for p in glob.glob(os.path.join(SRC, '**', '*.md'), recursive=True)
               if os.path.basename(p) != '질문리스트.md')
metas = {}
for p in files:
    rel = os.path.relpath(p, SRC)
    lines = open(p, encoding='utf-8').read().split('\n')
    kind = G['doc_kind'](rel, '')
    metas[rel] = (kind, doc_meta(rel, lines, kind), lines)
# 버전: 같은 법령명끼리 공포일 순
by_name = {}
for rel, (kind, m, _) in metas.items():
    if kind == 'law':
        by_name.setdefault(m['법령명'], []).append(rel)
for name, rels in by_name.items():
    rels.sort(key=lambda r: ymd(metas[r][1]['공포일']))
    for i, r in enumerate(rels):
        metas[r][1]['버전'] = '단일 버전' if len(rels) == 1 else ('최신 버전' if i == len(rels) - 1 else '이전 버전') + f' (같은 법령 {len(rels)}개 버전 중)'
# 별표: 모 조례의 메타데이터를 이어받는다. 파일 이름 예) 서울특별시 성북구 폐기물 관리 조례(제1396호)_별표6
link_of = {}
for rel, (kind, m, lines) in metas.items():
    b = re.search(r'^(.*?)\(제(\d+)호\)_별표(\d+)$', os.path.splitext(os.path.basename(rel))[0])
    if not b:
        continue
    parent = next((r for r, (k, pm, _) in metas.items() if k == 'law' and '_별표' not in r
                   and pm['법령명'] == b.group(1) and pm['번호'].endswith(f'제{b.group(2)}호')), None)
    if parent is None:
        print('모 조례를 못 찾음:', rel); continue
    pm = metas[parent][1]
    m.update({k: pm[k] for k in ('종류', '번호', '공포일', '시행일', '버전')})
    m['문서 종류'] = '조례 별표'
    m['법령명'] = f'{pm["법령명"]} 별표 {b.group(3)}'
    link_of[os.path.splitext(rel)[0]] = links.get(os.path.splitext(parent)[0], '-')
links.update(link_of)

report = []
for rel, (kind, m, lines) in metas.items():
    if ONLY and ONLY not in os.path.basename(rel):
        continue
    m.setdefault('버전', '-')
    stem = os.path.splitext(rel)[0]
    title = lines[0][2:].strip()
    body = lines[1:]
    first_h2 = next((i for i, l in enumerate(body) if l.startswith('## ')), len(body))
    pre = '\n'.join(body[:first_h2]).strip('\n')
    units = []
    if pre.strip():
        units.append({'kind': 'section', 'subs': ['문서정보'], 'lines': pre.split('\n')})
    rest = body[first_h2:]
    units += G['units_law'](rest) if kind == 'law' else G['units_h2'](rest)

    ctx_of = lambda subs: f'【{m["법령명"]} · {", ".join(subs)}】'
    chunks = []
    for u in units:
        t = re.sub(r'\n{3,}', '\n\n', '\n'.join(u['lines']).strip('\n'))
        G['LIMIT'] = LIMIT - len(ctx_of(u['subs'])) - 2
        tlines = t.split('\n')
        for pc in G['pack'](t, kind):
            if pc['needs_header']:
                # 이 조각 첫 행보다 앞에 있는 가장 가까운 표 머리글을 찾아 맨 위에 넣는다
                first = pc['text'].split('\n')[0]
                pos = next((k for k, l in enumerate(tlines) if l == first), None)
                hdr = None
                if pos is not None:
                    for k in range(pos - 1, 0, -1):
                        if re.fullmatch(r'\|( --- \|)+', tlines[k]) and tlines[k - 1].startswith('|'):
                            hdr = tlines[k - 1] + '\n' + tlines[k]; break
                if hdr:
                    pc['text'] = hdr + '\n' + pc['text']
                    pc['header_added'] = hdr.split('\n')[0]
                else:
                    pc['header_added'] = '머리글 못 찾음'
            chunks.append({'kind': u['kind'], 'subs': list(u['subs']), **pc})
    # 100자 미만 합치기 (조는 합치지 않는다). 맥락 줄을 더한 길이로 1500자를 본다
    notes, i = [], 0
    total = lambda c: len(ctx_of(c['subs'])) + 2 + len(c['text'])
    while i < len(chunks):
        c = chunks[i]
        if c['kind'] == 'article' or len(c['text']) >= SMALL:
            i += 1; continue
        nxt = chunks[i + 1] if i + 1 < len(chunks) else None
        prv = chunks[i - 1] if i > 0 else None

        def fits(a, b):
            subs = a['subs'] + [s for s in b['subs'] if s not in a['subs']]
            return len(ctx_of(subs)) + 2 + len(a['text']) + 2 + len(b['text']) <= LIMIT
        if nxt and nxt['kind'] != 'article' and not nxt['needs_header'] and fits(c, nxt):
            nxt['text'] = c['text'] + '\n\n' + nxt['text']
            nxt['subs'] = c['subs'] + [s for s in nxt['subs'] if s not in c['subs']]
            del chunks[i]; continue
        if prv and prv['kind'] != 'article' and fits(prv, c):
            prv['text'] += '\n\n' + c['text']
            prv['subs'] += [s for s in c['subs'] if s not in prv['subs']]
            del chunks[i]; i = max(i - 1, 0); continue
        notes.append(('100자 미만 그대로', c['subs'][0], len(c['text'])))
        i += 1

    keep = [c for c in chunks if not (c['kind'] == 'article' and is_deleted(c['text']))]
    dropped = [c for c in chunks if c not in keep]
    files_out = []
    for group, outroot in ((keep, DST), (dropped, EXC)):
        width = 3 if len(group) >= 100 else 2
        outdir = os.path.join(outroot, os.path.dirname(rel))
        os.makedirs(outdir, exist_ok=True)
        for n, c in enumerate(group, 1):
            subs = c['subs']
            fname = f'{BAD.sub("", os.path.basename(stem))}_{n:0{width}d}_{safe(subs[0])}.md'
            src_line = '출처: # ' + title + ''.join(' · ## ' + s for s in subs)
            if m['문서 종류'] == '해설(비공식)':
                disp = f'{m["법령명"]} (해설, 비공식) · {", ".join(subs)}'
            else:
                disp = f'{m["법령명"]} ({m["번호"]}, 시행 {m["시행일"]}) {", ".join(subs)}'
            meta = ['---',
                    f'문서 종류: {m["문서 종류"]}',
                    f'법령명: {m["법령명"]}',
                    f'종류: {m["종류"]}',
                    f'번호: {m["번호"]}',
                    f'공포일: {m["공포일"]}',
                    f'시행일: {m["시행일"]}',
                    f'버전: {m["버전"]}',
                    f'조문: {", ".join(subs) if c["kind"] == "article" else "-"}',
                    f'화면용 출처: {disp}',
                    f'원문 링크: {links.get(stem, "-")}',
                    '---']
            text = ctx_of(subs) + '\n\n' + c['text'].strip('\n')
            with open(os.path.join(outdir, fname), 'w', encoding='utf-8', newline='\n') as f:
                f.write(src_line + '\n' + '\n'.join(meta) + '\n\n' + text + '\n')
            files_out.append({'file': os.path.relpath(os.path.join(outdir, fname), outroot), 'excluded': outroot == EXC,
                              'len': len(text), 'kind': c['kind'], 'subs': subs, 'needs_header': c['needs_header'],
                              'oversize': c['oversize'], 'header_added': c.get('header_added')})
    report.append({'src': rel, 'kind': kind, 'meta': m, 'chunks': len(keep), 'excluded': len(dropped),
                   'notes': notes, 'files': files_out})
json.dump(report, open(REPORT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('docs', len(report), 'chunks', sum(r['chunks'] for r in report), 'excluded', sum(r['excluded'] for r in report))
