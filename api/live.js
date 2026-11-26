// 최신 확인: 법제처·국민참여입법센터를 실시간으로 불러 본다. 실패하면 이유와 시연 값을 함께 준다.
import { send, getQuery } from './_util.js';
import { liveLookup } from './_law.js';

export default async function handler(req, res) {
  const { kind } = getQuery(req);
  send(res, 200, await liveLookup(kind));
}
