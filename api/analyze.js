// 조문 대조·결론·개정 초안: 검색된 조문으로만 답하게 하고, 어느 AI가 답했는지 남긴다.
import { send, readBody } from './_util.js';
import { askAI } from './_ai.js';
import { ITEMS, ORDINANCE, demoAnalysis } from './_case.js';
import { findChunk, searchChunks, publicChunk, articleList } from './_docs.js';

const LAW = { number: '법률 제16318호', article: '제14조의5' };
const RULE = { number: '환경부령 제843호', article: '제16조의3' };

const SYSTEM = `당신은 성북구 조례 담당 공무원을 돕는 법령 검토 보조 AI입니다. 읽는 사람은 공무원이므로 쉬운 말로 짧게 씁니다.
규칙:
- 아래 [검색된 조문]에 있는 내용으로만 답합니다. 거기에 없으면 "검색된 조문에서는 확인되지 않습니다"라고 쓰고 담당자가 원문을 확인하도록 안내합니다. 「근거 조각」, 「조각」 같은 내부 용어는 쓰지 않고 「검색된 조문」이라고 씁니다.
- 법률 → 시행규칙 → 조례로 이어지는 위임 관계를 봅니다. 시행규칙이 조례로 정하도록 맡긴 문구(위임 문구)를 conclusion.delegation에 그대로 인용하고, 어느 조문인지 delegationArticle에 씁니다. 항목이 법률이어도 [검색된 조문]에 시행규칙이 있으면 반드시 함께 봅니다.
- 개정이 필요한지 단정하지 않고 verdict에 「개정 검토 필요」 「개정 불필요 가능성」 「확인 필요」 중 하나로 참고 의견만 씁니다. 최종 판단은 담당자가 합니다.
- comparisons에는 이번 위임과 직접 관련 있는 조례 조문만 넣습니다. 관련 없는 조문은 넣지 않습니다. 상태는 「없음」 「일부 있음」 「있음」 「확인 필요」 중 하나입니다.
- 개정 초안(drafts)은 서로 다른 접근으로 2안 또는 3안입니다. 안마다 다음을 모두 씁니다.
  · reason: 개정이유서에 쓸 수 있는 문장 1~2개
  · position: 개정 위치를 하나로 분명히 적습니다. 예) 「제8조 다음에 제8조의2를 신설하고, 종전 제8조의2는 제8조의3으로 한다.」 번호가 밀리면 밀리는 조문을 모두 적습니다. 호 번호가 모순되지 않게(예: 1호 신설인데 11.로 쓰지 않기) 씁니다.
  · amendment: 신설하거나 고치는 조문 전체. 줄바꿈은 \\n 으로 씁니다.
  · table: 신구조문대비표 줄들. current는 현행 조문(없으면 「(신설)」), proposed는 개정안 조문.
  · tradeoff: 장점과 단점 한 줄씩
- 조례 조문 번호와 제목은 [조례 조문 목록]에 있는 것만 씁니다. 지어내지 않습니다.
- 근거로 쓴 조문의 id를 sources에 넣습니다. 주어진 id만 씁니다.
- 반드시 JSON 하나만 출력합니다. 문자열 안에서는 큰따옴표(") 대신 「」를 씁니다. 형식:
{"conclusion":{"verdict":"","headline":"결론 한 줄","target":"고칠 조례 조문과 방향","delegationArticle":"","delegation":"","sources":[]},
 "summary":"법령이 바꾼 것 2문장","comparisons":[{"article":"","status":"","reason":"","sources":[]}],
 "drafts":[{"title":"1안. ...","reason":"","position":"","amendment":"","table":[{"current":"","proposed":""}],"tradeoff":"","sources":[]}],
 "cautions":["담당자가 확인할 점"]}`;

function context(item) {
  const picked = [];
  const add = (c) => { if (c && !picked.some((p) => p.id === c.id)) picked.push(c); };
  // 법률과 시행규칙(위임 조문)은 어느 항목을 골라도 함께 본다
  add(findChunk(RULE));
  add(findChunk(LAW));
  add(findChunk({ number: ORDINANCE.number, article: '제8조' }));
  add(findChunk({ number: ORDINANCE.number, article: '제8조의2' }));
  for (const c of searchChunks('안전기준 주간작업 3명1조 야간작업 수집 운반 예외', { ordinanceNumber: ORDINANCE.number, limit: 3 })) add(c);
  return picked;
}

const cut = ({ source, link, docType, afterBase }) => ({ source, link, docType, afterBase });

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST 요청만 받습니다.' });
  const { item: itemId } = await readBody(req);
  const item = ITEMS.find((x) => x.id === itemId);
  if (!item) return send(res, 404, { error: '알 수 없는 항목입니다.' });

  const chunks = context(item);
  const allowed = new Map(chunks.map((c) => [c.id, publicChunk(c)]));
  const basis = {
    item: `${item.lawName} ${item.article} (${item.change}, 시행 ${item.enforced})`,
    ordinance: ORDINANCE.label,
    ordinanceAfterBase: true,
    ordinanceNote: ORDINANCE.shortNote,
  };
  const user = `[검토할 법령 변경]\n${basis.item}\n\n[연결 조례] ${ORDINANCE.name} (${ORDINANCE.label}, 정비 전 모습)\n\n[조례 조문 목록]\n${articleList(ORDINANCE.number).join(' / ')}\n\n[검색된 조문]\n` +
    chunks.map((c) => `id: ${c.id}\n문서 종류: ${c.meta['문서 종류']}\n출처: ${c.meta['화면용 출처']}\n${c.body.slice(0, 2000)}`).join('\n\n---\n\n');

  const check = (d) => {
    if (!d.conclusion?.headline || !d.conclusion?.verdict) return '결론 없음';
    if (!Array.isArray(d.comparisons) || !d.comparisons.length) return '조문 대조 없음';
    if (!Array.isArray(d.drafts) || d.drafts.length < 2) return '초안이 2안 미만';
    if (d.drafts.some((x) => !x.amendment || !Array.isArray(x.table) || !x.table.length || !x.position)) return '초안 형식 부족';
    return '';
  };
  const r = await askAI(SYSTEM, user, check);
  const mapSources = (ids) => (Array.isArray(ids) ? ids : []).map((id) => allowed.get(id)).filter(Boolean).map(cut);
  const allSources = chunks.map((c) => cut(publicChunk(c, 0)));

  if (!r.ok) {
    return send(res, 200, {
      source: 'demo',
      reason: 'AI 세 곳 모두 응답하지 못했습니다. 시연 값(예시)을 보여 줍니다.',
      attempts: r.attempts,
      basis,
      result: demoAnalysis(item.id),
      sources: allSources,
    });
  }

  const d = r.data;
  // 위임 문구는 AI가 고르게 두지 않고 시행규칙 원문에서 그대로 가져온다(AI마다 엉뚱한 조문을 인용한 적이 있다)
  const ruleBody = findChunk(RULE)?.body || '';
  const quote = (ruleBody.match(/다만,[^\n]*?그렇지 않다\./) || [''])[0];
  const conclusion = { ...d.conclusion, sources: mapSources(d.conclusion.sources) };
  if (quote) {
    conclusion.delegation = quote.replace(/^다만,\s*/, '');
    conclusion.delegationArticle = '폐기물관리법 시행규칙 제16조의3 제2항 제3호 단서';
  }
  const result = {
    conclusion,
    summary: d.summary || '',
    comparisons: (d.comparisons || [])
      .filter((c) => !/관련 없|해당 없/.test(`${c.status}${c.reason}`.slice(0, 40)))
      .map((c) => ({ ...c, sources: mapSources(c.sources) })),
    drafts: d.drafts.slice(0, 3).map((x) => ({ ...x, sources: mapSources(x.sources) })),
    cautions: d.cautions || [],
  };
  send(res, 200, { source: 'live', provider: r.provider, model: r.model, attempts: r.attempts, basis, result, sources: allSources });
}
