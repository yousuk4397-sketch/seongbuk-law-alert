// 시연 장면 모음: 화면 위쪽 「시연 기준일」에서 고른다. 기본값은 장면 1(2019. 12. 31.).
import * as s1 from './_case.js';
import * as s2 from './_scene2.js';

export const SCENES = [
  {
    id: '2019-12-31',
    label: '2019. 12. 31.',
    name: '과거 사례',
    regDt: '20191231',
    intro: '이 날짜로 돌아간 상태입니다. 법령은 개정되었지만 성북구 조례는 아직 고쳐지지 않았습니다. 고쳐야 할 조문과 개정 초안을 이 서비스로 찾아봅니다.',
    s3Lede: '법률 → 시행규칙 → 조례로 이어지는 위임 관계를 보고, 조례의 어느 조문을 고쳐야 하는지 찾습니다.',
    badges: ['검토 필요', '조례 미정비'],
    pending: [],
    items: s1.ITEMS,
    ordinance: { ...s1.ORDINANCE, state: '정비 전 모습' },
    demoLive: s1.DEMO_LIVE,
    demoAnalysis: s1.demoAnalysis,
    waitText: '보통 35~50초 걸립니다. 앞 AI가 응답하지 못하면 다음 AI로 넘어갑니다.',
  },
  {
    id: '2026-11-12',
    label: '2026. 11. 12.',
    name: '최근 사례',
    regDt: '20261112',
    intro: '오늘 시행된 폐기물관리법(법률 제21129호)과 시행령(대통령령 제36811호) 개정을 바로 살펴봅니다. 현행 성북구 조례에서 검토할 곳을 찾고, 필요하면 개정 초안을 참고로 봅니다. 개정이 꼭 필요한지는 담당자가 판단합니다.',
    s3Lede: '오늘 시행된 법률·시행령과 현행 성북구 조례(제1628호)를 대조해, 검토할 조문과 그 이유를 찾습니다.',
    badges: ['검토 필요'],
    pending: s2.PENDING,
    items: s2.ITEMS,
    ordinance: s2.ORDINANCE,
    demoLive: s2.DEMO_LIVE,
    demoAnalysis: s2.demoAnalysis,
    context: s2.CONTEXT,
    articleIndex: s2.ARTICLE_INDEX, // AI에게 넘기는 현행 조례 전체 조문 번호 목록
    writingRules: s2.WRITING_RULES, // 조례 작성 규칙(AI 답변 규칙 지시문과 별도)
    checkDrafts: true, // AI 초안을 서버가 검사(번호 충돌·상위 법령 위임 문장·단정 표현)
    // AI마다 쓸 시간: 앞 AI가 늦어도 정해진 시간 뒤 다음 AI로 넘어간다(합계 85초, vercel.json maxDuration 90초)
    aiSlots: { Claude: 40000, Groq: 25000, Gemini: 20000 },
    saveAnswers: true, // 같은 항목의 AI 답을 저장해 두고 다시 누르면 바로 보여 준다
    waitText: '보통 40~50초 걸립니다. 앞 AI가 늦으면 다음 AI로 넘어가 최대 약 90초 걸릴 수 있습니다. 한 번 받은 답은 저장되어 다음부터 바로 나옵니다.',
  },
];

export const getScene = (id) => SCENES.find((s) => s.id === id) || SCENES[0];

// 화면에 보낼 장면 정보(목록·안내 문구)
export function publicScene(s) {
  return {
    id: s.id,
    label: s.label,
    name: s.name,
    intro: s.intro,
    s3Lede: s.s3Lede,
    waitText: s.waitText,
    saveAnswers: !!s.saveAnswers,
    pending: s.pending,
    scenes: SCENES.map((x) => ({ id: x.id, label: x.label, name: x.name })),
    ordinance: {
      name: s.ordinance.name,
      label: s.ordinance.label,
      enforced: s.ordinance.enforced,
      note: s.ordinance.note,
      shortNote: s.ordinance.shortNote,
    },
    items: s.items.map((it) => ({
      id: it.id,
      kind: it.kind,
      lawName: it.lawName,
      article: it.article,
      title: it.title,
      change: it.change,
      promulgated: it.promulgated,
      enforced: it.enforced,
      summary: it.summary,
      status: '검토 필요',
      badges: it.pending ? [...s.badges, '확인 필요'] : s.badges,
      verdictBadge: it.verdictBadge || '검토 필요',
      reviewLine: it.reviewLine || '',
      pending: !!it.pending,
      ordinance: s.ordinance.name,
    })),
  };
}
