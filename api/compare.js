// 신구법 비교: 새로 생긴 조문은 「신설」로 표시하고, 번호만 옮겨진 조문은 바뀐 낱말을 표시한다.
import { send, getQuery } from './_util.js';
import { ITEMS, chunkRef } from './_case.js';
import { diffSegments, allAdded } from './_diff.js';

export default async function handler(req, res) {
  const { item } = getQuery(req);
  const it = ITEMS.find((x) => x.id === item);
  if (!it) return send(res, 404, { error: '알 수 없는 항목입니다.' });

  const after = chunkRef(it.after);
  const out = {
    id: it.id,
    lawName: it.lawName,
    article: it.article,
    change: it.change,
    // 개정 전 판에 같은 조문이 없으면 새로 생긴 조문이다
    isNew: !it.before,
    // 「본조신설」 날짜는 공포일이고, 효력은 시행일부터다
    dates: {
      promulgated: it.promulgated,
      enforced: it.enforced,
      note: it.promulgated === it.enforced
        ? `공포일과 시행일이 같습니다(${it.enforced}). 이 서비스는 시행일을 기준으로 봅니다.`
        : `원문의 「본조신설 ${it.promulgated}」은 공포일입니다. 법적 효력은 시행일(${it.enforced})부터이고, 이 서비스는 시행일을 기준으로 봅니다.`,
    },
    newArticle: after ? { ...after, segments: allAdded(after.body) } : null,
    moved: null,
  };

  if (it.before) {
    // 같은 조문이 있었던 경우: 바뀐 낱말 표시
    const before = chunkRef(it.before);
    const d = diffSegments(before.body, after.body);
    out.compare = { before: { ...before, segments: d.before }, after: { ...after, segments: d.after } };
  }

  if (it.moved) {
    const b = chunkRef(it.moved.before);
    const a = chunkRef(it.moved.after);
    if (b && a) {
      const d = diffSegments(b.body, a.body);
      out.moved = {
        fromArticle: it.moved.before.article,
        toArticle: it.moved.after.article,
        before: { ...b, segments: d.before },
        after: { ...a, segments: d.after },
      };
    }
  }
  send(res, 200, out);
}
