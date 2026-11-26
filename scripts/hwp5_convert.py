"""이진 HWP 5.0(.hwp, 첫 바이트 D0 CF 11 E0) 을 .md 로 바꾼다. Python 기본 기능만 쓴다.
문단 글자와 표(셀 병합 포함)를 읽는다. 그림·도형 안 글자는 읽지 않는다.
사용법: py -I hwp5_convert.py <입력.hwp> <출력.md> [문서 이름]
"""
import sys, struct, zlib, re, os


# ------------------------------------------------------------ OLE(복합 문서) 읽기
class Ole:
    def __init__(self, data):
        self.d = data
        if data[:8] != bytes.fromhex('D0CF11E0A1B11AE1'):
            raise ValueError('OLE 파일이 아님')
        self.ss = 1 << struct.unpack_from('<H', data, 30)[0]
        self.mss = 1 << struct.unpack_from('<H', data, 32)[0]
        nfat = struct.unpack_from('<I', data, 44)[0]
        self.dir_start = struct.unpack_from('<I', data, 48)[0]
        self.mini_cut = struct.unpack_from('<I', data, 56)[0]
        minifat_start = struct.unpack_from('<I', data, 60)[0]
        difat_start, ndifat = struct.unpack_from('<II', data, 68)
        difat = list(struct.unpack_from('<109I', data, 76))
        s = difat_start
        for _ in range(ndifat):
            sec = self.sector(s)
            vals = struct.unpack('<%dI' % (self.ss // 4), sec)
            difat += vals[:-1]; s = vals[-1]
        self.fat = []
        for fs in difat[:nfat]:
            self.fat += struct.unpack('<%dI' % (self.ss // 4), self.sector(fs))
        self.minifat = []
        if minifat_start < 0xFFFFFFFA:
            mf = self.chain(minifat_start)
            self.minifat = list(struct.unpack('<%dI' % (len(mf) // 4), mf))
        dirdata = self.chain(self.dir_start)
        self.entries = []
        for i in range(len(dirdata) // 128):
            e = dirdata[i * 128:(i + 1) * 128]
            nlen = struct.unpack_from('<H', e, 64)[0]
            name = e[:max(nlen - 2, 0)].decode('utf-16-le', 'ignore')
            typ = e[66]
            left, right, child = struct.unpack_from('<III', e, 68)
            start = struct.unpack_from('<I', e, 116)[0]
            size = struct.unpack_from('<I', e, 120)[0]
            self.entries.append({'name': name, 'type': typ, 'left': left, 'right': right, 'child': child, 'start': start, 'size': size})
        root = self.entries[0]
        self.ministream = self.chain(root['start'])[:root['size']] if root['start'] < 0xFFFFFFFA else b''

    def sector(self, n):
        o = (n + 1) * self.ss
        return self.d[o:o + self.ss]

    def chain(self, start):
        out, s, seen = [], start, set()
        while s < 0xFFFFFFFA and s not in seen:
            seen.add(s); out.append(self.sector(s)); s = self.fat[s]
        return b''.join(out)

    def minichain(self, start):
        out, s, seen = [], start, set()
        while s < 0xFFFFFFFA and s not in seen:
            seen.add(s); o = s * self.mss; out.append(self.ministream[o:o + self.mss]); s = self.minifat[s]
        return b''.join(out)

    def paths(self):
        res = {}

        def walk(idx, prefix):
            if idx == 0xFFFFFFFF or idx >= len(self.entries):
                return
            e = self.entries[idx]
            walk(e['left'], prefix); walk(e['right'], prefix)
            p = prefix + e['name']
            if e['type'] == 2:
                res[p] = e
            elif e['type'] == 1:
                walk(e['child'], p + '/')
        walk(self.entries[0]['child'], '')
        return res

    def read(self, path):
        e = self.paths()[path]
        data = self.minichain(e['start']) if e['size'] < self.mini_cut else self.chain(e['start'])
        return data[:e['size']]


# ------------------------------------------------------------ HWP 레코드
TAG = 0x10
PARA_HEADER, PARA_TEXT, CTRL_HEADER, LIST_HEADER, TABLE = TAG + 50, TAG + 51, TAG + 55, TAG + 56, TAG + 61
EXT = {1, 2, 3, 11, 12, 14, 15, 16, 17, 18, 21, 22, 23}   # 8글자짜리 확장 조판 부호
INL = {4, 5, 6, 7, 8, 9, 19, 20}                          # 8글자짜리 인라인 부호


def records(data):
    i, out = 0, []
    while i + 4 <= len(data):
        h = struct.unpack_from('<I', data, i)[0]; i += 4
        tag, level, size = h & 0x3FF, (h >> 10) & 0x3FF, h >> 20
        if size == 0xFFF:
            size = struct.unpack_from('<I', data, i)[0]; i += 4
        out.append((tag, level, data[i:i + size])); i += size
    return out


def para_text(b):
    s, i, n = [], 0, len(b) // 2
    while i < n:
        c = struct.unpack_from('<H', b, i * 2)[0]
        if c < 32:
            if c in EXT or c in INL:
                i += 8; continue
            if c == 9:
                s.append('\t')
            elif c in (10,):
                s.append('\n')
            elif c == 13:
                pass
            elif c == 24 or c == 30 or c == 31:  # 하이픈·묶음 빈칸·고정폭 빈칸
                s.append(' ' if c != 24 else '-')
            i += 1; continue
        s.append(chr(c)); i += 1
    return ''.join(s)


def parse(path):
    ole = Ole(open(path, 'rb').read())
    hdr = ole.read('FileHeader')
    compressed = struct.unpack_from('<I', hdr, 36)[0] & 1
    sections = sorted((p for p in ole.paths() if p.startswith('BodyText/Section')), key=lambda p: int(p[16:]))
    recs = []
    for sp in sections:
        raw = ole.read(sp)
        recs += records(zlib.decompress(raw, -15) if compressed else raw)
    return recs


def to_blocks(recs):
    """문단과 표를 문서 순서대로 [('p', 글) | ('table', grid)] 로 만든다."""
    blocks = []
    i = 0

    def read_paras(i, base_level):
        """base_level 의 문단들을 읽어 [(텍스트, i)] 와 끝 위치를 돌려준다. 중첩 표는 블록으로 넣는다."""
        texts = []
        while i < len(recs):
            tag, lv, d = recs[i]
            if lv < base_level:
                break
            if tag == PARA_HEADER and lv == base_level:
                txt = ''
                j = i + 1
                while j < len(recs) and recs[j][1] > base_level:
                    if recs[j][0] == PARA_TEXT and recs[j][1] == base_level + 1:
                        txt += para_text(recs[j][2])
                    j += 1
                texts.append((txt, i, j))
                i = j
            else:
                i += 1
        return texts, i

    def table_at(k):
        """CTRL_HEADER('tbl ') 위치 k 에서 표를 읽는다."""
        lv = recs[k][1]
        rows = cols = 0
        cells = []
        j = k + 1
        while j < len(recs) and recs[j][1] > lv:
            tag, l, d = recs[j]
            if tag == TABLE and l == lv + 1:
                rows, cols = struct.unpack_from('<HH', d, 4)
            elif tag == LIST_HEADER and l == lv + 1 and len(d) >= 16:
                col, row, cs, rs = struct.unpack_from('<HHHH', d, 8)
                # 셀 안 문단
                txts = []
                m = j + 1
                while m < len(recs) and recs[m][1] > lv and not (recs[m][0] == LIST_HEADER and recs[m][1] == lv + 1):
                    if recs[m][0] == PARA_TEXT and recs[m][1] == lv + 2:
                        txts.append(para_text(recs[m][2]))
                    m += 1
                cells.append((row, col, rs, cs, '\n'.join(t for t in txts)))
            j += 1
        grid = [[''] * cols for _ in range(rows)]
        for r, c, rs, cs, t in cells:
            if r < rows and c < cols:
                grid[r][c] = t
        return grid, j

    lv0 = min((l for t, l, _ in recs if t == PARA_HEADER), default=0)
    while i < len(recs):
        tag, lv, d = recs[i]
        if tag == PARA_HEADER and lv == lv0:
            txt, j = '', i + 1
            tables = []
            while j < len(recs) and recs[j][1] > lv0:
                t2, l2, d2 = recs[j]
                if t2 == PARA_TEXT and l2 == lv0 + 1:
                    txt += para_text(d2)
                if t2 == CTRL_HEADER and l2 == lv0 + 1 and d2[:4][::-1] == b'tbl ':
                    g, j2 = table_at(j)
                    tables.append(g); j = j2; continue
                j += 1
            if txt.strip():
                blocks.append(('p', txt))
            for g in tables:
                blocks.append(('table', g))
            i = j
        else:
            i += 1
    return blocks


def cell(s):
    s = re.sub(r'\s*\n\s*', '<br>', s.replace('\xa0', ' ').strip())
    return s.replace('|', '\\|')


def md_table(grid):
    if not grid or not grid[0]:
        return ''
    w = max(len(r) for r in grid)
    rows = [[cell(c) for c in r] + [''] * (w - len(r)) for r in grid]
    out = ['| ' + ' | '.join(rows[0]) + ' |', '|' + ' --- |' * w]
    out += ['| ' + ' | '.join(r) + ' |' for r in rows[1:]]
    return '\n'.join(out)


if __name__ == '__main__':
    src, dst = sys.argv[1], sys.argv[2]
    title = sys.argv[3] if len(sys.argv) > 3 else os.path.splitext(os.path.basename(src))[0]
    blocks = to_blocks(parse(src))
    out = [f'# {title}', '']
    first_heading = True
    for kind, v in blocks:
        if kind == 'p':
            t = '\n'.join(l.strip() for l in v.replace('\xa0', ' ').split('\n') if l.strip())
            if first_heading and re.match(r'^\[별표\s*\d+\]', t):
                out += ['## ' + t.replace('\n', ' '), '']
                first_heading = False
            else:
                out += [t, '']
        else:
            out += [md_table(v), '']
    open(dst, 'w', encoding='utf-8', newline='\n').write(re.sub(r'\n{3,}', '\n\n', '\n'.join(out)).rstrip() + '\n')
    print('blocks', len(blocks), 'tables', sum(1 for k, _ in blocks if k == 'table'))
