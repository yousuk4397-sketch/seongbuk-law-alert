// AI 호출: CLAUDE_API_KEY → GROQ_API_KEY → GEMINI_API_KEY 순서. 앞이 실패하면 다음으로 넘어간다.
import { scrub } from './_util.js';

// 모델 이름은 각 키로 모델 목록을 조회해 정했다 (2026-11-19)
const PROVIDERS = [
  { name: 'Claude', keyName: 'CLAUDE_API_KEY', model: 'claude-sonnet-5-5', call: callClaude },
  { name: 'Groq', keyName: 'GROQ_API_KEY', model: 'openai/gpt-oss-120b', call: callGroq },
  { name: 'Gemini', keyName: 'GEMINI_API_KEY', model: 'gemini-3.1-flash-lite', call: callGemini },
];

const TIMEOUT_MS = 45000;

// Claude는 도구 호출 형식으로 받아 JSON 깨짐을 막는다(문안 속 따옴표 때문에 글 형식 JSON이 자주 깨졌다)
const S = { type: 'string' };
const IDS = { type: 'array', items: S };
const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    conclusion: {
      type: 'object',
      properties: { verdict: S, headline: S, target: S, delegationArticle: S, delegation: S, sources: IDS },
      required: ['verdict', 'headline', 'target'],
    },
    summary: S,
    comparisons: { type: 'array', items: { type: 'object', properties: { article: S, status: S, reason: S, sources: IDS }, required: ['article', 'status', 'reason'] } },
    drafts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: S, reason: S, position: S, amendment: S,
          table: { type: 'array', items: { type: 'object', properties: { current: S, proposed: S }, required: ['current', 'proposed'] } },
          tradeoff: S, sources: IDS,
        },
        required: ['title', 'reason', 'position', 'amendment', 'table', 'tradeoff'],
      },
    },
    cautions: IDS,
  },
  required: ['conclusion', 'summary', 'comparisons', 'drafts', 'cautions'],
};

async function callClaude(key, model, system, user) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model, max_tokens: 6000,
      system: `${system}\n결과는 반드시 report 도구로 보고합니다.`,
      tools: [{ name: 'report', description: '검토 결과를 보고한다', input_schema: ANSWER_SCHEMA }],
      tool_choice: { type: 'auto' }, // 이 모델은 도구 강제 지정(type: tool)을 지원하지 않는다
      messages: [{ role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`HTTP ${r.status} ${j?.error?.message || ''}`);
  const tool = (j.content || []).find((p) => p.type === 'tool_use');
  if (tool) return JSON.stringify(tool.input);
  return (j.content || []).map((p) => p.text || '').join(''); // 도구를 안 썼으면 글에서 JSON을 찾는다
}

async function callGroq(key, model, system, user) {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: 4000,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`HTTP ${r.status} ${j?.error?.message || ''}`);
  return j.choices?.[0]?.message?.content || '';
}

async function callGemini(key, model, system, user) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 8000 },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`HTTP ${r.status} ${j?.error?.message || ''}`);
  return (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
}

export function parseJson(text) {
  const t = String(text).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('JSON 형식이 아님');
  return JSON.parse(t.slice(start, end + 1));
}

// 반환: { ok, provider, model, data, attempts:[{provider, ok, reason}] }
export async function askAI(system, user, validate) {
  const attempts = [];
  for (const p of PROVIDERS) {
    const key = process.env[p.keyName];
    if (!key) { attempts.push({ provider: p.name, ok: false, reason: '키 비어 있음' }); continue; }
    try {
      const text = await p.call(key, p.model, system, user);
      const data = parseJson(text);
      const bad = validate ? validate(data) : '';
      if (bad) throw new Error(bad);
      attempts.push({ provider: p.name, ok: true });
      return { ok: true, provider: p.name, model: p.model, data, attempts };
    } catch (e) {
      const msg = scrub(e?.message || String(e));
      const reason = e?.name === 'TimeoutError' || e?.name === 'AbortError' ? '시간 초과' : `오류: ${msg.slice(0, 120)}`;
      attempts.push({ provider: p.name, ok: false, reason });
    }
  }
  return { ok: false, attempts };
}

export function aiKeyStates() {
  return PROVIDERS.map((p) => ({ name: p.keyName, provider: p.name, model: p.model, state: process.env[p.keyName] ? '있음' : '비어 있음' }));
}
