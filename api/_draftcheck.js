// AI 개정 초안 검사(장면 2): 조례 담당자가 바로 알아챌 오류를 서버가 먼저 걸러 낸다.
// ① 번호 충돌: 이미 쓰인 조문 번호(삭제된 번호 포함)를 신설하거나 그 번호로 옮기는가
// ② 상위 법령 위임 문장: 조례 문안이 「…부령·대통령령·시행령·시행규칙으로 정한다」처럼 상위 법령에 위임하는가
// ③ 단정 표현: 결론·조문 대조에 「반드시」, 「반영 필요」, 「개정해야」 같은 단정이 있는가 (「검토 필요」, 「확인 필요」는 괜찮다)

const ART = '제\\d+조(?:의\\d+)?';
const NEW_MARK = /^\s*[(<]\s*신\s*설\s*[)>]\s*$/;

// 「제8조의2와 제8조의3」, 「제8조의2, 제8조의3」 → ['제8조의2', '제8조의3']
const arts = (s) => String(s).match(new RegExp(ART, 'g')) || [];

export function numberConflicts(draft, used) {
  const usedSet = new Set(used);
  const text = `${draft.position || ''}\n${draft.amendment || ''}`;
  // 번호를 옮기면 옮겨 간 자리는 비고(from), 옮겨 오는 자리(to)는 새로 차지한다
  const from = new Set();
  const to = [];
  const moveRe = new RegExp(`종전\\s*((?:${ART}(?:\\s*(?:와|과|,|및)\\s*)?)+)\\s*(?:은|는)\\s*(?:각각\\s*)?((?:${ART}(?:\\s*(?:와|과|,|및)\\s*)?)+)\\s*(?:으로|로)`, 'g');
  for (const m of text.matchAll(moveRe)) { arts(m[1]).forEach((a) => from.add(a)); to.push(...arts(m[2])); }
  const taken = (a) => usedSet.has(a) && !from.has(a);
  const found = new Set();
  // 「제8조의3을 신설」
  for (const m of text.matchAll(new RegExp(`(${ART})\\s*(?:을|를)\\s*(?:새로\\s*)?신설`, 'g'))) if (taken(m[1])) found.add(`${m[1]} 신설`);
  // 「종전 제8조의2는 제8조의4로 한다」
  for (const a of to) if (taken(a)) found.add(`${a}로 이동`);
  // 신구조문대비표에서 현행이 (신설)인데 개정안 조문 번호가 이미 있는 경우
  for (const row of draft.table || []) {
    const head = (String(row.proposed || '').match(new RegExp(`^\\s*(${ART})\\(`)) || [])[1];
    if (head && NEW_MARK.test(String(row.current || '')) && taken(head)) found.add(`${head} 신설`);
  }
  return [...found];
}

const DELEGATE = /(?:[가-힣]*부령|대통령령|총리령|시행령|시행규칙)\s*(?:으로|로)\s*정(?:한다|하는|하며|함|합니다)/g;
export function upperDelegation(draft) {
  const text = [draft.amendment, ...(draft.table || []).map((r) => r.proposed)].join('\n');
  return [...new Set(text.match(DELEGATE) || [])];
}

const ACTIONS = '(?:반영|개정|신설|정비|보완|마련|수정)';
const ASSERT = new RegExp([
  // 「반드시 고쳐야 하는 것은 아닙니다」, 「반드시 고쳐야 하는지는」처럼 부정·물음이면 단정이 아니다
  '반드시(?![^.]{0,25}(?:아니|아닙|아님|않|는지|인지))',
  `${ACTIONS}\\s*(?:이|가)?\\s*필요(?:하다|합니다|함|해|$|[.\\s,)])(?!\\s*없)`,
  `${ACTIONS}(?:을|를)?\\s*(?:해야|하여야)\\s*(?:한다|합니다|함|할)`,
].join('|'), 'g');
export function assertive(d) {
  const texts = [d.conclusion?.headline, d.conclusion?.target, d.summary,
    ...(d.comparisons || []).flatMap((c) => [c.status, c.reason])];
  return [...new Set(texts.flatMap((t) => String(t || '').match(ASSERT) || []).map((s) => s.trim()))];
}

// 반환: 문제가 없으면 '', 있으면 「검사: …」 한 줄(어느 AI가 왜 탈락했는지 화면에 그대로 보인다)
export function checkDraft(d, used) {
  const problems = [];
  const conflicts = (d.drafts || []).flatMap((x) => numberConflicts(x, used));
  if (conflicts.length) problems.push(`번호 충돌(${[...new Set(conflicts)].join(', ')})`);
  const deleg = (d.drafts || []).flatMap(upperDelegation);
  if (deleg.length) problems.push(`상위 법령 위임 문장(${[...new Set(deleg)].join(', ')})`);
  const strong = assertive(d);
  if (strong.length) problems.push(`단정 표현(${strong.join(', ')})`);
  return problems.length ? `검사: ${problems.join(' / ')}` : '';
}

export const CHECK_LABELS = ['번호 충돌', '상위 법령 위임 문장', '단정 표현'];
