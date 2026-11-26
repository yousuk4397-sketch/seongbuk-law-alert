"""조각에 「키워드:」 둘째 줄을 넣는다.
- 법령: kw_law.py 의 규칙(조 제목·정의된 용어·용어 사전)으로 만든다. 비슷한 말은 넣지 않는다.
- 조례·해설: data/키워드_수작업.json (조각 본문 -> 키워드)에서 가져온다. 표에 없으면 '확인 필요'로 보고한다.
- 조각에 없는 말이 들어가면 쓰지 않고 보고한다.
사용법: py -I kw_build.py <청킹 폴더> <보고서.json> [--write] [--check]
  --write : 키워드가 없는 조각에 키워드 줄을 넣는다
  --check : 이미 들어 있는 키워드 줄과 다시 만든 결과가 같은지만 본다
"""
import sys, os, re, glob, json
HERE = os.path.dirname(os.path.abspath(__file__))
CH, OUT = sys.argv[1:3]
WRITE, CHECK = '--write' in sys.argv, '--check' in sys.argv
code = open(os.path.join(HERE, 'kw_law.py'), encoding='utf-8').read().split('\nres = {}')[0]
L = {'__name__': 'kwlib'}
argv = sys.argv; sys.argv = ['kw_law.py', CH, OUT]
exec(code, L)
sys.argv = argv
L['SYN'] = {}
manual = json.load(open(os.path.join(HERE, 'data', '키워드_수작업.json'), encoding='utf-8'))
norm = lambda s: re.sub(r'[\sㆍ·・"“”\'()]', '', s)

rows, problems, diffs = [], [], []
for p in sorted(glob.glob(os.path.join(CH, '**', '*.md'), recursive=True)):
    rel = os.path.relpath(p, CH)
    t = open(p, encoding='utf-8').read()
    first, _, rest = t.partition('\n')
    old = None
    if rest.startswith('키워드:'):
        old, _, rest = rest.partition('\n')
        old = old[len('키워드: '):].split(', ')
    meta, body = rest.split('\n---\n', 1)[0], rest.split('\n---\n', 1)[1].strip('\n')
    kind = re.search(r'문서 종류: (.+)', meta).group(1).strip()
    text = body.partition('\n\n')[2]
    if kind == '법령':
        ov = L['OVERRIDE'].get(re.sub(r'[\sㆍ·・]', '', text))
        kws = [k for k in (list(ov) if ov else L['make'](first.split(' · ## ')[1], body, '')) if not k.startswith('~')]
    else:
        kws = manual.get(norm(text))
        if kws is None:
            problems.append((rel, '수작업 키워드 표에 없음 - 확인 필요')); continue
    kws = [re.sub(r'(?<=\d),(?=\d{3})', '', k) for k in kws][:5]
    bad = [k for k in kws if norm(k) not in norm(body)]
    if bad or not kws:
        problems.append((rel, f'조각에 없는 말 또는 0개: {bad}')); continue
    if CHECK and old is not None and old != kws:
        diffs.append((rel, old, kws))
    rows.append({'file': rel, 'kind': kind, 'keywords': kws})
    if WRITE and old is None:
        open(p, 'w', encoding='utf-8', newline='\n').write(first + '\n키워드: ' + ', '.join(kws) + '\n' + rest)
json.dump({'rows': rows, 'problems': problems, 'diffs': diffs}, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
print('rows', len(rows), 'problems', len(problems), 'diffs', len(diffs))
