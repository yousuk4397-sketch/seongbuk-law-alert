// 근거 조각(docs/답변참고문서/청킹)과 서비스 데이터(docs/서비스데이터) 읽기
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const CHUNK_DIR = path.join(ROOT, 'docs', '답변참고문서', '청킹');
const DATA_DIR = path.join(ROOT, 'docs', '서비스데이터');

let chunkCache = null;

function parseChunk(file, text) {
  const lines = text.split(/\r?\n/);
  const sep = [];
  lines.forEach((l, i) => { if (l.trim() === '---') sep.push(i); });
  const head = lines.slice(0, sep[0] ?? 0);
  const metaLines = lines.slice((sep[0] ?? -1) + 1, sep[1] ?? 0);
  const body = lines.slice((sep[1] ?? -1) + 1).join('\n').trim();
  const field = (arr, key) => {
    const l = arr.find((x) => x.startsWith(key + ':'));
    return l ? l.slice(key.length + 1).trim() : '';
  };
  const meta = {};
  for (const l of metaLines) {
    const i = l.indexOf(':');
    if (i > 0) meta[l.slice(0, i).trim()] = l.slice(i + 1).trim();
  }
  return {
    id: file.replace(/\.md$/, ''),
    keywords: field(head, '키워드').split(',').map((s) => s.trim()).filter(Boolean),
    meta,
    body,
  };
}

// 폐기물 사례에 필요한 조각만 읽는다(법령 + 성북구 폐기물 관리 조례)
export function loadChunks() {
  if (chunkCache) return chunkCache;
  const files = fs.readdirSync(CHUNK_DIR).filter(
    (f) => f.endsWith('.md') && (f.startsWith('폐기물관리법') || f.startsWith('서울특별시 성북구 폐기물 관리 조례')),
  );
  chunkCache = files.map((f) => parseChunk(f, fs.readFileSync(path.join(CHUNK_DIR, f), 'utf8')));
  return chunkCache;
}

export function findChunk({ number, article }) {
  return loadChunks().find(
    (c) => c.meta['번호'] === number && (c.meta['조문'] || '').startsWith(article),
  ) || null;
}

// 시연 기준일(이 서비스가 되돌아간 날). 이보다 뒤에 시행된 판은 「대체 자료」로 표시한다.
export const BASE_DATE = '2019-12-31';

// 화면에 보일 본문: 마크다운 기호(#)와 머리 표시(【…】)를 뺀다
export function cleanBody(body) {
  return String(body)
    .split(/\r?\n/)
    .filter((l) => !/^\s*【.*】\s*$/.test(l))
    .map((l) => l.replace(/^\s*#{1,6}\s*/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// '2020. 12. 31.' → '2020-12-31'
function toIso(s) {
  const m = String(s).match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : '';
}

export function publicChunk(c, maxChars) {
  if (!c) return null;
  const clean = cleanBody(c.body);
  const body = maxChars && clean.length > maxChars ? clean.slice(0, maxChars) + ' …(이하 생략)' : clean;
  const enforced = c.meta['시행일'] || '';
  const iso = toIso(enforced);
  return {
    id: c.id,
    docType: c.meta['문서 종류'] || '',
    source: c.meta['화면용 출처'] || '',
    link: c.meta['원문 링크'] || '',
    articleTitle: c.meta['조문'] || '',
    enforced,
    afterBase: !!iso && iso > BASE_DATE, // 기준일보다 뒤에 시행된 판인가
    body,
  };
}

// 조례 조문 목록(AI가 없는 조문 번호를 지어내지 않도록 알려 준다)
export function articleList(number) {
  return loadChunks()
    .filter((c) => c.meta['번호'] === number && c.meta['조문'] && c.meta['조문'] !== '-')
    .map((c) => c.meta['조문']);
}

// 검색어 확장 사전: 이용자 말 → 법령 용어
export function expandQuery(q) {
  let extra = [];
  try {
    const t = fs.readFileSync(path.join(DATA_DIR, '검색어확장사전.md'), 'utf8');
    for (const line of t.split(/\r?\n/)) {
      if (!line.startsWith('|')) continue;
      const cells = line.split('|').map((s) => s.trim()).filter(Boolean);
      if (cells.length === 2 && cells[0] !== '이용자 말' && !/^-+$/.test(cells[0]) && q.includes(cells[0])) extra.push(cells[1]);
    }
  } catch { /* 사전이 없으면 확장 없이 검색 */ }
  return [q, ...extra].join(' ');
}

// 조각 검색: 키워드·출처·본문에 검색어가 얼마나 들어 있는지로 점수
export function searchChunks(query, { ordinanceNumber, limit = 4 } = {}) {
  const terms = expandQuery(query).split(/\s+/).filter((t) => t.length >= 2);
  return loadChunks()
    .filter((c) => !ordinanceNumber || c.meta['번호'] === ordinanceNumber)
    .map((c) => {
      let score = 0;
      for (const t of terms) {
        if (c.keywords.some((k) => k.includes(t))) score += 3;
        if ((c.meta['조문'] || '').includes(t)) score += 2;
        if (c.body.includes(t)) score += 1;
      }
      return { c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.c);
}
