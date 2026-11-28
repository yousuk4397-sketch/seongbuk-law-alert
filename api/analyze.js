// 조문 대조·결론·개정 초안: 검색된 조문으로만 답하게 하고, 어느 AI가 답했는지 남긴다.
import { send, readBody, getQuery } from './_util.js';
import { askAI } from './_ai.js';
import { ORDINANCE } from './_case.js';
import { getScene } from './_scenes.js';
import { loadAnswer, saveAnswer, storageKind } from './_store.js';
import { checkDraft, CHECK_LABELS } from './_draftcheck.js';
import { loadData, findChunk, findChunkById, searchChunks, publicChunk, articleList } from './_docs.js';

const LAW = { number: '법률 제16318호', article: '제14조의5' };
const RULE = { number: '환경부령 제843호', article: '제16조의3' };
const VERDICTS = ['개정 검토 필요', '개정 불필요 가능성', '확인 필요'];

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

function context(item, scene) {
  const picked = [];
  const add = (c) => { if (c && !picked.some((p) => p.id === c.id)) picked.push(c); };
  // 장면 2처럼 근거 조각 목록을 항목마다 정해 둔 장면은 그 항목의 목록만 쓴다
  if (scene.context) {
    const ctx = scene.context[item.id];
    for (const spec of ctx.specs) add(findChunk(spec));
    for (const id of ctx.idPrefixes) add(findChunkById(id));
    return picked;
  }
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
  const { item: itemId, scene: sceneId, refresh } = await readBody(req);
  const scene = getScene(sceneId || getQuery(req).scene);
  const ord = scene.ordinance;
  const item = scene.items.find((x) => x.id === itemId);
  if (!item) return send(res, 404, { error: '알 수 없는 항목입니다.' });

  // 저장된 답이 있으면 AI를 부르지 않고 바로 보여 준다(「다시 분석」이면 새로 묻는다)
  const saveKey = `${scene.id}/${item.id}/v2`; // v2: 초안 검사를 넣은 뒤의 답(그 전에 저장된 답은 쓰지 않는다)
  if (scene.saveAnswers && !refresh) {
    const kept = await loadAnswer(saveKey);
    if (kept) return send(res, 200, { ...kept.response, saved: { at: kept.savedAt, storage: kept.storage, fromSaved: true } });
  }

  const chunks = context(item, scene);
  const allowed = new Map(chunks.map((c) => [c.id, publicChunk(c, 0, scene.id)]));
  const basis = {
    item: `${item.lawName} ${item.article} (${item.change}, 시행 ${item.enforced})`,
    ordinance: ord.label,
    ordinanceAfterBase: !!ord.shortNote,
    ordinanceNote: ord.shortNote,
  };
  // 장면 2: 현행 조례 전체 조문 번호 목록(삭제된 번호 포함)과 조례 작성 규칙을 함께 넘긴다
  const index = scene.articleIndex ? loadData(scene.articleIndex) : null;
  const usedNumbers = index ? index.조문.map((a) => a.번호) : [];
  const ordList = index
    ? `${index.조문.map((a) => `${a.번호}(${a.제목})`).join(' / ')}\n(${index.번호}, 시행 ${index.시행일}, 조문 ${index.조문수}개. 「삭제」도 이미 쓰인 번호)`
    : articleList(ord.number).join(' / ');
  const rules = scene.writingRules ? `[조례 작성 규칙]\n${scene.writingRules.map((x) => `- ${x}`).join('\n')}\n\n` : '';
  const user = `[검토할 법령 변경]\n${basis.item}\n\n[연결 조례] ${ord.name} (${ord.label}, ${ord.state})\n\n[조례 조문 목록]\n${ordList}\n\n${rules}[검색된 조문]\n` +
    chunks.map((c) => `id: ${c.id}\n문서 종류: ${c.meta['문서 종류']}\n출처: ${c.meta['화면용 출처']}\n${c.body.slice(0, 2000)}`).join('\n\n---\n\n');

  const check = (d) => {
    if (!d.conclusion?.headline || !d.conclusion?.verdict) return '결론 없음';
    if (!Array.isArray(d.comparisons) || !d.comparisons.length) return '조문 대조 없음';
    if (!Array.isArray(d.drafts) || d.drafts.length < 2) return '초안이 2안 미만';
    if (d.drafts.some((x) => !x.amendment || !Array.isArray(x.table) || !x.table.length || !x.position)) return '초안 형식 부족';
    // 장면 2: 번호 충돌·상위 법령 위임 문장·단정 표현이 있으면 이 AI 답은 쓰지 않고 다음 AI로 넘긴다
    if (scene.checkDrafts) return checkDraft(d, usedNumbers);
    return '';
  };
  const r = await askAI(SYSTEM, user, check, { slots: scene.aiSlots });
  const mapSources = (ids) => (Array.isArray(ids) ? ids : []).map((id) => allowed.get(id)).filter(Boolean).map(cut);
  const allSources = chunks.map((c) => cut(publicChunk(c, 0, scene.id)));

  if (!r.ok) {
    // 검사에 걸려 탈락한 AI가 있으면 그 이유를 알린다
    const caught = CHECK_LABELS.filter((l) => r.attempts.some((a) => String(a.reason || '').includes(`검사:`) && String(a.reason).includes(l)));
    return send(res, 200, {
      source: 'demo',
      checkFailed: caught.length > 0,
      reason: caught.length
        ? `AI 초안에 ${caught.join('·')}이 있어 검증된 초안을 보여 줍니다.`
        : 'AI 세 곳 모두 응답하지 못했습니다. 시연 값(예시)을 보여 줍니다.',
      attempts: r.attempts,
      basis,
      result: scene.demoAnalysis(item.id),
      sources: allSources,
    });
  }

  const d = r.data;
  // 위임 문구는 AI가 고르게 두지 않고 시행규칙 원문에서 그대로 가져온다(AI마다 엉뚱한 조문을 인용한 적이 있다)
  const ruleBody = findChunk(RULE)?.body || '';
  const quote = scene.context ? '' : (ruleBody.match(/다만,[^\n]*?그렇지 않다\./) || [''])[0];
  const conclusion = { ...d.conclusion, sources: mapSources(d.conclusion.sources) };
  // 판정은 정해진 세 가지 참고 의견 중 하나만 내보낸다. AI가 「개정해야 함」처럼 단정하면 「확인 필요」로 바꾼다.
  if (!VERDICTS.includes(String(conclusion.verdict || '').trim())) conclusion.verdict = '확인 필요';
  // 재량 항목(법이 「할 수 있다」로 정한 것)은 판정 배지를 「반영 검토 (재량)」으로 보여 준다(AI 글은 고치지 않는다)
  if (item.discretionary && conclusion.verdict === '개정 검토 필요') conclusion.verdictLabel = '반영 검토 (재량)';
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
    // 자료에서 아직 확인되지 않은 것은 AI 답과 별도로 「확인할 점」 맨 앞에 붙인다
    cautions: [...scene.pending, ...(d.cautions || [])],
  };
  const response = { source: 'live', provider: r.provider, model: r.model, attempts: r.attempts, basis, result, sources: allSources };
  if (scene.saveAnswers) {
    // AI가 실제로 답한 것만 저장한다(시연 값은 저장하지 않는다)
    const savedAt = new Date().toISOString();
    const storage = await saveAnswer(saveKey, { savedAt, storage: storageKind(), response });
    response.saved = { at: savedAt, storage, fromSaved: false };
  }
  send(res, 200, response);
}
