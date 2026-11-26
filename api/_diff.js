// 두 조문 본문의 달라진 곳을 낱말 단위로 찾는다(LCS). 같은 부분은 same, 빠진 부분은 del, 새로 생긴 부분은 add.
const tok = (s) => s.match(/\S+|\s+/g) || [];

export function diffSegments(before, after) {
  const a = tok(before);
  const b = tok(after);
  if (a.length * b.length > 4_000_000) {
    // 너무 길면 통째로 다른 것으로 본다
    return { before: [{ t: 'del', s: before }], after: [{ t: 'add', s: after }] };
  }
  const n = a.length, m = b.length;
  const w = m + 1;
  const dp = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }
  const left = [], right = [];
  const push = (arr, t, s) => { const last = arr[arr.length - 1]; if (last && last.t === t) last.s += s; else arr.push({ t, s }); };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { push(left, 'same', a[i]); push(right, 'same', b[j]); i++; j++; }
    else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) { push(left, 'del', a[i]); i++; }
    else { push(right, 'add', b[j]); j++; }
  }
  while (i < n) push(left, 'del', a[i++]);
  while (j < m) push(right, 'add', b[j++]);
  return { before: left, after: right };
}

export const allAdded = (text) => [{ t: 'add', s: text }];
