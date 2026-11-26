// 공공 API 호출(법제처 법령·조례, 국민참여입법센터 입법예고). 호출은 서버(api)에서만 한다.
import { scrub } from './_util.js';
import { DEMO_LIVE } from './_case.js';

const DRF = 'https://www.law.go.kr/DRF/lawSearch.do';

const KINDS = {
  // match: 사례와 관계있는 줄만 남긴다(검색어가 느슨하게 맞은 다른 법령은 뺀다)
  history: { label: '법령 변경이력', key: 'LAW_OC', params: { target: 'lsHstInf', regDt: '20191231', query: '폐기물관리법' }, field: '법령명한글', test: (v) => v.startsWith('폐기물관리법') }, // 2019-12-31 변경분 중 폐기물관리법·시행규칙
  compare: { label: '신구법 비교', key: 'LAW_OC', params: { target: 'oldAndNew', query: '폐기물관리법 시행규칙' }, field: '신구법명', test: (v) => v === '폐기물관리법 시행규칙' || v === '폐기물관리법' },
  law: { label: '현행 법령', key: 'LAW_OC', params: { target: 'law', query: '폐기물관리법 시행규칙' }, field: '법령명한글', test: (v) => v === '폐기물관리법 시행규칙' || v === '폐기물관리법' },
  ordin: { label: '조례 본문·시행일', key: 'LAW_OC', params: { target: 'ordin', query: '성북구 폐기물 관리 조례' }, field: '자치법규명', test: (v) => v === '서울특별시 성북구 폐기물 관리 조례' },
  notice: { label: '입법예고', key: 'LAWMAKING_OC' },
};

export const KIND_LIST = Object.entries(KINDS).map(([id, k]) => ({ id, label: k.label }));

// 응답 안의 첫 배열에서 화면에 필요한 글자 항목만 뽑는다(링크는 OC가 들어 있어 뺀다)
function summarize(json, filter) {
  const root = Object.values(json)[0];
  const arr = root && typeof root === 'object'
    ? Object.values(root).find((v) => Array.isArray(v))
    : null;
  if (!arr) return [];
  return arr.filter((row) => !filter || filter.test(String(row[filter.field] || ''))).slice(0, 8).map((row) => {
    const o = {};
    for (const [k, v] of Object.entries(row)) {
      if (typeof v === 'string' && v && !/링크|URL|id$|코드|일련번호/i.test(k)) o[k] = [...new Set(v.split(','))].join(',');
    }
    return o;
  });
}

export async function liveLookup(kind) {
  const def = KINDS[kind];
  if (!def) return { kind, source: 'error', reason: '알 수 없는 종류', rows: [] };
  const out = { kind, label: def.label, keyName: def.key };
  const key = process.env[def.key];
  if (!key) return { ...out, source: 'demo', reason: '키 비어 있음', rows: DEMO_LIVE[kind] || [] };

  try {
    if (kind === 'notice') {
      const r = await fetch(`https://www.lawmaking.go.kr/rest/ogLmPp.xml?OC=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(15000) });
      const text = await r.text();
      const msg = (text.match(/<retMsg>(.*?)<\/retMsg>/) || [])[1];
      if (msg === '401') return { ...out, source: 'demo', reason: '승인 안 됨 (인증 실패 401)', rows: DEMO_LIVE.notice || [] };
      if (msg) return { ...out, source: 'demo', reason: `응답 코드 ${msg}`, rows: DEMO_LIVE.notice || [] };
      return { ...out, source: 'live', reason: '', rows: [{ 원문: scrub(text).replace(/\s+/g, ' ').slice(0, 300) }] };
    }

    // 변경이력은 한 쪽에 100건씩 나오고 그날 변경분이 수백 건이라 여러 쪽을 본다
    const getPage = async (page) => {
      const p = new URLSearchParams({ OC: key, type: 'JSON', display: '100', page: String(page), ...def.params });
      const r = await fetch(`${DRF}?${p}`, { signal: AbortSignal.timeout(10000) });
      const text = await r.text();
      if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { reasonText: `HTTP ${r.status}` });
      try { return JSON.parse(text); } catch {
        const reasonText = /검증|인증|미신청|승인|IP|도메인/.test(text) ? '승인 안 됨 (사용자 정보 검증 실패)' : '응답을 읽지 못함';
        throw Object.assign(new Error(reasonText), { reasonText });
      }
    };
    let rows;
    try {
      const first = await getPage(1);
      const total = Number(Object.values(first)[0]?.totalCnt || 0);
      const pages = [first];
      if (kind === 'history' && total > 100) {
        const more = Math.min(Math.ceil(total / 100), 6) - 1; // 나머지 쪽은 동시에 가져온다
        pages.push(...await Promise.all(Array.from({ length: more }, (_, i) => getPage(i + 2))));
      }
      rows = pages.flatMap((j) => summarize(j, { field: def.field, test: def.test }));
    } catch (e) {
      if (e.reasonText) return { ...out, source: 'demo', reason: e.reasonText, rows: DEMO_LIVE[kind] || [] };
      throw e;
    }
    if (!rows.length) return { ...out, source: 'demo', reason: '조회는 됐지만 이 사례의 법령이 결과에 없음', rows: DEMO_LIVE[kind] || [] };
    return { ...out, source: 'live', reason: '', note: kind === 'history' ? '' : '실시간 조회는 오늘 기준(현행) 정보라 시연 기준일(2019. 12. 31.)과 다를 수 있습니다.', rows };
  } catch (e) {
    const reason = e?.name === 'TimeoutError' || e?.name === 'AbortError' ? '시간 초과' : `연결 오류: ${scrub(e?.message).slice(0, 80)}`;
    return { ...out, source: 'demo', reason, rows: DEMO_LIVE[kind] || [] };
  }
}
