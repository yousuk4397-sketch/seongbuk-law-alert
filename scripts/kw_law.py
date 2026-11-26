"""법률·시행령·시행규칙 조각의 키워드를 만든다.
조각에 실제로 나오는 말 + (그 말이 조각에 있을 때만) 이용자가 쓸 만한 비슷한 말.
비슷한 말에는 '~'를 붙여 둔다(쓸 때 뗀다).
사용법: py -I kw_law.py <청킹> <결과.json>
"""
import sys, os, re, glob, json, collections
CH, OUT = sys.argv[1:3]
LAW = re.compile(r'\((법률|대통령령|환경부령)\)\(제')

# 조각에 나오는 말 -> 이용자가 달리 부르는 말 (뜻이 같은 것만)
SYN = {
    # 공동주택
    '공동주택': '아파트', '입주자대표회의': '아파트 동대표 회의', '관리주체': '관리사무소',
    '관리비': '아파트 관리비', '장기수선충당금': '수선 적립금', '장기수선계획': '아파트 수선 계획',
    '하자보수': '하자 수리', '층간소음': '윗집 소음', '경비원': '아파트 경비원',
    '관리사무소장': '관리소장', '주택관리사': '관리소장 자격', '입주자등': '입주민',
    '공동주택관리정보시스템': '아파트 관리 정보 시스템',
    # 지방세
    '지방세': '지방 세금', '납세고지서': '세금 고지서', '독촉장': '세금 독촉장', '체납처분': '압류',
    '체납자': '세금 밀린 사람', '체납액': '밀린 세금', '환급가산금': '환급 이자', '환급': '세금 돌려받기',
    '납부지연가산세': '세금 연체료', '가산세': '추가 세금', '경정청구': '세금 정정 청구',
    '이의신청': '이의 제기', '심판청구': '조세심판 청구', '과세전적부심사': '세금 부과 전 심사',
    '세무조사': '세금 조사', '제2차 납세의무': '대신 내는 세금', '연대납세의무': '함께 내는 세금',
    '전자송달': '전자 고지서', '전자신고': '인터넷 세금 신고', '전자납부': '인터넷 세금 납부',
    '과세표준': '세금 매기는 기준', '징수유예': '세금 납부 유예', '기한의 연장': '납부 기한 연장',
    '지방세심의위원회': '세금 심의위원회', '납세자보호관': '세금 고충 담당관',
    '선정대리인': '세금 불복 대리인', '명단공개': '체납자 명단 공개', '납세자': '세금 내는 사람',
    '포상금': '신고 포상금', '상속인': '상속받은 사람',
    # 폐기물
    '음식물류 폐기물': '음식물 쓰레기', '생활폐기물': '생활쓰레기', '대형폐기물': '큰 쓰레기',
    '사업장폐기물': '사업장 쓰레기', '지정폐기물': '유해 폐기물', '의료폐기물': '병원 쓰레기',
    '건설폐기물': '공사 쓰레기', '폐기물처리시설': '쓰레기 처리장', '방치폐기물': '버려진 쓰레기',
    '폐기물부담금': '쓰레기 부담금', '분리배출': '분리수거', '종량제': '쓰레기봉투',
    '매립시설': '쓰레기 매립지', '소각시설': '쓰레기 소각장', '침출수': '쓰레기 오수',
    '폐기물처리업': '쓰레기 처리 업체', '수집ㆍ운반': '쓰레기 수거', '폐기물': '쓰레기',
}
SYN_KEYS = sorted(SYN, key=lambda x: (-len(x), x))
TERMS = set(SYN) | {
    '과태료', '벌칙', '징역', '벌금', '허가', '등록', '신고', '취소', '영업정지', '과징금', '수수료',
    '부과', '징수', '납부', '감면', '비과세', '세율', '지방세징수법', '지방세법', '관리규약', '관리비예치금',
    '안전점검', '안전관리', '관리인', '위탁관리', '자치관리', '분쟁조정위원회', '하자심사', '감사',
    '재활용시설', '처리기준', '처리명령', '조치명령', '보관', '운반', '처분', '사후관리', '에너지 회수',
}
norm = lambda s: re.sub(r'[\sㆍ·・]', '', s)
GENERIC = {'보관', '처분', '부과', '징수', '등록', '신고', '운반', '허가', '취소', '납부', '감사', '관리인', '지방세', '폐기물', '공동주택', '납세자'}
WEAK_HEAD = {'처리', '사유', '신고', '기준', '방법', '절차', '운영', '구성', '지급', '제출', '범위', '확인', '작성', '관리', '설치', '지정', '승인', '보고', '기록', '공개', '수립', '산정', '조치', '특례', '내용', '대상', '신청', '결정', '통지'}
STOP = {'등', '경우', '대한', '따른', '관한', '위한', '통한', '인한', '및', '또는', '그', '같은', '관련'}


def count_in(term, text):
    return text.count(norm(term))


OVERRIDE = {  # 사전 용어가 하나도 없는 짧은 뒷조각: 직접 읽고 정함
    norm('나. 법인의 출연재산(설립을 위한 출연재산만 해당한다)의 100분의 30 이상을 출연하고 그 중 1명이 설립자인 경우'):
        ['출연재산', '법인', '100분의 30', '설립자'],
    norm('⑤ 삭제 <2017. 10. 19.>'): ['삭제', '~삭제된 항'],
}


def make(sub, body, title_doc):
    nb = norm(body)
    if nb in OVERRIDE:
        return list(OVERRIDE[nb])
    kws = []

    def add(k):
        k = re.sub(r'(?<=\d),(?=\d{3})', '', k.strip())
        if not k.startswith('~') and norm(k) not in nb:  # 조각 본문에 없는 말은 넣지 않는다
            return
        if k and k not in kws and k.lstrip('~') not in [x.lstrip('~') for x in kws] and len(kws) < 5:
            kws.append(k)

    m = re.search(r'(제\d+조(의\d+)?)(\((.*)\))?$', sub)
    if sub == '기본 정보':
        lines = [l.strip() for l in body.split('\n') if l.strip() and not l.startswith('#')]
        name = lines[1] if len(lines) > 1 and not lines[1].startswith('[') else None
        for l in lines:
            if not l.startswith(('※', '[', '국가법령정보센터')) and len(l) < 40 and '(' not in l:
                name = l; break
        if name: add(name)
        if '[시행' in body: add('시행')
        for dept in collections.OrderedDict.fromkeys(re.findall(r'([가-힣]+부)\(', body)):
            add(dept)
        add('~담당 부서 연락처')
        return kws
    if m and not m.group(3):  # 제목 없는 조 = 삭제된 조
        add(m.group(1))
        if '삭제' in body: add('삭제'); add('~삭제된 조문')
        return kws
    title = m.group(4) if m else None
    if sub.startswith('부칙'):
        add('부칙')
    if title:
        t = re.sub(r'\s*등$', '', title)
        if len(norm(t)) <= 12:
            add(t)
        else:
            # 긴 제목: 띄어쓰기 단위로 나누고 조사를 떼어 긴 말 2개를 고른다
            toks = []
            for w in re.split(r'\s+', t):
                w = re.sub(r'(에서의|에서|에의|으로|이나|에게|의|에|을|를|와|과|로|나|은|는|이|가)$', '', w)
                if len(norm(w)) >= 2 and w not in STOP:
                    toks.append(w)
            toks = list(dict.fromkeys(toks))
            if toks:
                head = toks[-1]  # 한국어 제목은 끝말이 중심어
                others = sorted([w for w in toks if w != head], key=lambda x: -len(norm(x)))
                if head in WEAK_HEAD and others:  # 끝말이 일반어면 나머지 긴 말 2개
                    for w in others[:2]:
                        add(w)
                else:
                    add(head)
                    if others:
                        add(others[0])
    # 정의된 용어 ("대통령령으로 정하는 ..." 같은 위임 문구는 뺀다)
    defined = [d for d in re.findall(r'“([^”]{2,20})”(?:이)?란', body) if not re.search(r'(령|조례|규칙)으로 정하는', d)]
    # 조각에 나오는 사전 용어 (긴 말 먼저, 짧은 말이 긴 말 속에만 있으면 뺀다)
    found = []
    for k in sorted(TERMS, key=lambda x: (-len(x), x)):  # 길이가 같으면 가나다순: 실행마다 같은 결과
        c = count_in(k, nb)
        if c and not any(norm(k) in norm(f) and count_in(f, nb) >= c for f, _ in found):
            found.append((k, c))
    in_title = [k for k, _ in found if title and norm(k) in norm(title)]
    rest = sorted(found, key=lambda x: (x[0] in GENERIC, -x[1]))
    ranked = in_title + [k for k, _ in rest if k not in in_title]
    # 비슷한 말 1개: 제목에 있는 말 우선, 없으면 가장 많이 나온 말
    syn_src = next((k for k in ranked if k in SYN and k not in GENERIC), None) or next((k for k in ranked if k in SYN), None)
    for d in defined[:2]:
        add(d)
    for k in ranked:
        if len(kws) >= 4 and syn_src: break
        add(k)
    if syn_src:
        if len(kws) >= 5: kws.pop()
        add('~' + SYN[syn_src])
    if sub.startswith('부칙') and '시행' in body and '~언제부터 시행' not in kws:
        if len(kws) >= 5: kws.pop()
        add('~언제부터 시행')
    if m and len(kws) < 5:
        add(m.group(1))
    return kws


res = {}
for p in sorted(glob.glob(os.path.join(CH, '**', '*.md'), recursive=True)):
    if not LAW.search(os.path.basename(p)):
        continue
    t = open(p, encoding='utf-8').read()
    first, _, body = t.partition('\n')
    subs = first.split(' · ## ')[1:]
    title_doc = first.split(' · ## ')[0][len('출처: # '):]
    res[os.path.relpath(p, CH)] = make(subs[0], body.strip('\n'), title_doc)
json.dump(res, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
print(len(res))
