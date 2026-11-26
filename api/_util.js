// 공통 도구: 키 값 가리기, 응답 보내기, 요청 본문 읽기
const SECRET_NAMES = [
  'CLAUDE_API_KEY', 'GROQ_API_KEY', 'GEMINI_API_KEY',
  'LAW_OC', 'LAWMAKING_OC', 'NA_OPEN_LEGIS_NOTICE', 'NA_CLOSED_LEGIS_NOTICE',
];

// 응답에 키·OC 값이 섞여 나가지 않도록 문자열에서 지운다
export function scrub(text) {
  let s = String(text ?? '');
  for (const name of SECRET_NAMES) {
    const v = process.env[name];
    if (v && v.length >= 4) s = s.split(v).join('***');
  }
  return s;
}

export function scrubDeep(value) {
  return JSON.parse(scrub(JSON.stringify(value)));
}

export function send(res, code, obj) {
  const body = JSON.stringify(scrubDeep(obj));
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

export async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return {}; }
}

export function getQuery(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  return Object.fromEntries(new URL(req.url, 'http://x').searchParams);
}

export function keyState(name) {
  return process.env[name] ? '있음' : '비어 있음';
}
