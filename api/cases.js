// 「검토 필요」 목록 (고른 시연 기준일 시점의 모습만 내보낸다)
import { send, getQuery } from './_util.js';
import { getScene, publicScene } from './_scenes.js';

export default async function handler(req, res) {
  const s = getScene(getQuery(req).scene);
  const p = publicScene(s);
  send(res, 200, { baseDate: s.id, baseDateLabel: s.label, ...p });
}
