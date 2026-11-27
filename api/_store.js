// AI 답 저장소: Vercel Blob 저장소가 연결되어 있으면(BLOB_READ_WRITE_TOKEN) 거기에, 없으면 서버 메모리에 둔다.
// 서버 메모리는 서버가 쉬거나 다시 배포되면 사라진다. 키 값은 다루지 않고, Blob 도구가 환경 변수에서 직접 읽는다.
import { put, get } from '@vercel/blob';

const memory = new Map();
const hasBlob = () => !!process.env.BLOB_READ_WRITE_TOKEN;
const path = (key) => `analysis/${key}.json`;
// 저장소 종류(공개·비공개)는 Vercel 화면에서 정한다. 비공개를 먼저 써 보고, 안 되면 공개로 쓴다.
let access = null;
const ACCESS_TRY = ['private', 'public'];

export const storageKind = () => (hasBlob() ? 'Vercel Blob' : '서버 메모리');

export async function loadAnswer(key) {
  if (memory.has(key)) return memory.get(key);
  if (!hasBlob()) return null;
  for (const a of access ? [access] : ACCESS_TRY) {
    try {
      const r = await get(path(key), { access: a, useCache: false, abortSignal: AbortSignal.timeout(5000) });
      if (!r || r.statusCode !== 200) return null;
      access = a;
      const value = JSON.parse(await new Response(r.stream).text());
      memory.set(key, value);
      return value;
    } catch { /* 다음 방식으로 */ }
  }
  return null;
}

export async function saveAnswer(key, value) {
  memory.set(key, value);
  if (!hasBlob()) return '서버 메모리';
  for (const a of access ? [access] : ACCESS_TRY) {
    try {
      await put(path(key), JSON.stringify(value), {
        access: a, addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json',
        abortSignal: AbortSignal.timeout(5000),
      });
      access = a;
      return 'Vercel Blob';
    } catch { /* 다음 방식으로 */ }
  }
  return '서버 메모리'; // Blob 저장에 실패해도 답은 메모리에 남는다
}
