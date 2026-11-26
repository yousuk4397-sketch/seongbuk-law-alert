// 「검토 필요」 목록 (시연 기준일 시점의 모습만 내보낸다)
import { send } from './_util.js';
import { BASE_DATE, ORDINANCE, listItems } from './_case.js';

export default async function handler(req, res) {
  send(res, 200, {
    baseDate: BASE_DATE,
    baseDateLabel: '2019. 12. 31.',
    ordinance: {
      name: ORDINANCE.name,
      label: ORDINANCE.label,
      enforced: ORDINANCE.enforced,
      note: ORDINANCE.note,
      shortNote: ORDINANCE.shortNote,
    },
    items: listItems(),
  });
}
