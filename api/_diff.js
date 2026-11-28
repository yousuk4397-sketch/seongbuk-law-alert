// 두 조문 본문의 달라진 곳을 낱말 단위로 찾는다(LCS). 같은 부분은 same, 빠진 부분은 del, 새로 생긴 부분은 add.
const tok = (s) => s.match(/\S+|\s+/g) || [];
// 둥근 따옴표(“ ”)와 곧은 따옴표(")는 같은 글자로 본다(자료마다 따옴표 모양만 다른 경우가 있다)
const norm = (t) => t.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");

// opts.renames: [[옛 낱말, 새 낱말]] — 이번 개정과 무관한 이름 변경(예: 정부조직 개편). 같은 낱말로 보고 「other」(회색)로 표시한다.
// opts.ignore: 이번 개정과 무관한 표기 차이(예: 「[본조신설 2019. 4. 16.]」). 빠진 것으로 나와도 「other」(회색)로 표시한다.
export function diffSegments(before, after, opts = {}) {
  const renames = opts.renames || [];
  const ignore = (opts.ignore || []).map((x) => x.trim());
  const rename = (t) => renames.reduce((s, [o, n]) => (s.includes(n) ? s : s.split(o).join(n)), t);
  const a = tok(before);
  const b = tok(after);
  const na = a.map((t) => rename(norm(t))), nb = b.map(norm);
  if (a.length * b.length > 4_000_000) {
    // 너무 길면 통째로 다른 것으로 본다
    return { before: [{ t: 'del', s: before }], after: [{ t: 'add', s: after }] };
  }
  const n = a.length, m = b.length;
  const w = m + 1;
  const dp = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = na[i] === nb[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }
  const left = [], right = [];
  const push = (arr, t, s) => { const last = arr[arr.length - 1]; if (last && last.t === t) last.s += s; else arr.push({ t, s }); };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (na[i] === nb[j]) { const t = a[i] === b[j] || norm(a[i]) === norm(b[j]) ? 'same' : 'other'; push(left, t, a[i]); push(right, t, b[j]); i++; j++; }
    else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) { push(left, 'del', a[i]); i++; }
    else { push(right, 'add', b[j]); j++; }
  }
  while (i < n) push(left, 'del', a[i++]);
  while (j < m) push(right, 'add', b[j++]);
  // 무관한 표기 차이는 「빠진 것」 대신 회색으로
  const left2 = left.map((x) => (x.t === 'del' && ignore.includes(x.s.trim()) ? { ...x, t: 'other' } : x));
  return { before: left2, after: right };
}

export const allAdded = (text) => [{ t: 'add', s: text }];
