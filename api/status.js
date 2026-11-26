// 키 이름별 상태만 알려 준다(값은 내보내지 않는다)
import { send, keyState } from './_util.js';
import { aiKeyStates } from './_ai.js';
import { KIND_LIST } from './_law.js';

export default async function handler(req, res) {
  send(res, 200, {
    ai: aiKeyStates(),
    public: [
      { name: 'LAW_OC', state: keyState('LAW_OC') },
      { name: 'LAWMAKING_OC', state: keyState('LAWMAKING_OC') },
    ],
    liveKinds: KIND_LIST,
  });
}
