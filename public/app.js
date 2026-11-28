// 성북 법령개정 알리미 화면. 서버(api)만 부르고, 키는 다루지 않는다.
const view = document.getElementById('view');
const baseDateEl = document.getElementById('base-date');
const STORE = 'seongbuk-board-v2';
const STATUSES = ['확인 전', '검토 중', '부서 협의 중', '개정안 작성 중', '검토 완료'];
const FIELD_LABEL = { status: '진행 상태', owner: '담당자', due: '기한', dept: '협의 부서', memo: '메모' };

const DEFAULT_SCENE = '2019-12-31'; // 기본 시연 기준일: 과거 사례
const state = { scene: DEFAULT_SCENE, data: null, selected: null, analysis: {}, compare: {}, filter: { q: '', status: '전체', sort: 'due' } };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = async (path, opts) => {
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error(`요청 실패 (${r.status})`);
  return r.json();
};
const skeleton = (n = 4) => Array.from({ length: n }, (_, i) => `<div class="skeleton" style="width:${95 - i * 12}%"></div>`).join('');
const linkBtn = (href, text, cls = 'primary') => `<a class="btn ${cls}" style="display:inline-flex;align-items:center;text-decoration:none" href="${href}">${text}</a>`;

/* ---------- 현황판 저장 (브라우저 localStorage) ---------- */
const blank = () => ({ status: STATUSES[0], owner: '', due: '', dept: '', memo: '', history: [] });
const loadBoard = () => { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; } };
const saveBoard = (b) => localStorage.setItem(STORE, JSON.stringify(b));
const entry = (board, id) => ({ ...blank(), ...(board[id] || {}) });

const srcLinks = (list, title = '참고한 조문') => (list || []).length
  ? `<p class="source">${title}:<br>${list.map((s) => `${String(s.docType).startsWith('해설') ? '<span class="badge demo">해설(비공식)</span> ' : ''}${esc(s.source)}${s.afterBase ? ' <span class="badge warn">기준일보다 뒤 판</span>' : ''}${/^https?:\/\//.test(s.link || '') ? ` · <a href="${esc(s.link)}" target="_blank" rel="noopener">원문 보기</a>` : /확인 필요/.test(s.link || '') ? ' · <span class="badge demo">원문 링크 확인 필요</span>' : ''}`).join('<br>')}</p>`
  : '';

const item = () => state.data.items.find((i) => i.id === state.selected);

/* ---------- 장면별 배지·「확인 필요」 안내 ---------- */
const badgesHtml = (i) => (i.badges || ['검토 필요']).map((b) => `<span class="badge ${b === '확인 필요' ? 'demo' : 'warn'}">${esc(b)}</span>`).join(' ');
const pendingNotice = (onlyItem) => {
  const list = state.data.pending || [];
  if (!list.length || (onlyItem && !onlyItem.pending)) return '';
  return `<div class="notice warn"><strong>확인 필요</strong>${list.map((x) => esc(x)).join('<br>')}</div>`;
};

/* ---------- 검토 대상·대조 조례 안내 줄 (2~4단계 맨 위) ---------- */
function contextBar() {
  const d = state.data, i = item();
  return `<div class="ctx">
    <div class="ctx-row"><label for="ctx-item">검토 대상</label>
      <select id="ctx-item" data-act-change="pick">${d.items.map((x) => `<option value="${esc(x.id)}"${x.id === i.id ? ' selected' : ''}>${esc(x.lawName)} ${esc(x.article)} (${esc(x.change)})</option>`).join('')}</select></div>
    <div class="ctx-row"><span class="ctx-k">대조 조례</span><span>${esc(d.ordinance.label)}${d.ordinance.shortNote ? ` <span class="badge warn">${esc(d.ordinance.shortNote)}</span>` : ''}</span></div>
  </div>`;
}

/* ---------- 법제처 최신 확인 상자 ---------- */
const LIVE = {
  history: { title: '법제처 변경이력에서 찾기', btn: () => `${state.data.baseDateLabel} 변경 법령 조회`, desc: () => `법제처에 등록된 ${state.data.baseDateLabel} 변경분 중에서 폐기물관리법과 하위 법령을 찾습니다.` },
  compare: { title: '법제처 신구법 비교 목록', btn: '신구법 비교 목록 조회', desc: '법제처가 제공하는 폐기물관리법 시행규칙의 신구법 비교 목록을 가져옵니다. 오늘 기준 정보입니다.' },
  notice: { title: '개정 전 단계(입법예고) 열람', btn: '입법예고 조회', desc: '국민참여입법센터의 입법예고 목록을 가져옵니다. 현재 승인 대기라 조회되지 않을 수 있습니다.' },
  ordin: { title: '조례의 최신 시행일', btn: '조례 시행일 조회', desc: '법제처에서 성북구 폐기물 관리 조례의 최신 시행일을 가져옵니다. 오늘 기준 정보입니다.' },
};
function liveBox(kind) {
  const l = LIVE[kind];
  const txt = (v) => (typeof v === 'function' ? v() : v);
  return `<div class="live-box" data-live="${kind}">
    <div class="row"><strong>${esc(l.title)}</strong>
      <button class="btn small" data-act="live" data-kind="${kind}">${esc(txt(l.btn))}</button></div>
    <div class="live-out muted">${esc(txt(l.desc))} 조회하지 못하면 이유와 시연 값을 함께 보여 줍니다.</div>
  </div>`;
}
async function runLive(box, kind) {
  const out = box.querySelector('.live-out');
  out.innerHTML = `<p class="kv muted">법제처에 조회하는 중입니다. 응답이 느리면 최대 20초 걸릴 수 있습니다.</p>${skeleton(3)}`;
  try {
    const r = await api(`/api/live?kind=${kind}&scene=${encodeURIComponent(state.scene)}`, { signal: AbortSignal.timeout(30000) });
    const badge = r.source === 'live' ? '<span class="badge live">실시간</span>' : '<span class="badge demo">시연 값</span>';
    const reason = r.reason ? `<p class="kv"><b>실시간으로 가져오지 못한 이유:</b> ${esc(r.reason)}</p>` : '';
    const note = r.note ? `<p class="kv muted">${esc(r.note)}</p>` : '';
    const rows = (r.rows || []).length
      ? r.rows.map((row) => `<p class="kv">${Object.entries(row).map(([k, v]) => `<b>${esc(k)}</b> ${esc(v)}`).join(' · ')}</p>`).join('')
      : '<p class="kv">보여 줄 시연 값이 없습니다. (확인 필요: 이 사례에 맞는 자료가 지금 남아 있는지 확인 전입니다.)</p>';
    out.className = 'live-out';
    out.innerHTML = `${badge} <span class="muted">${esc(r.label)}</span>${reason}${note}${rows}`;
  } catch (e) {
    out.innerHTML = `<div class="notice danger"><strong>조회하지 못했습니다.</strong>${esc(e.message)}</div>`;
  }
}

/* ---------- 사용 방법 (두 장면 공통) ---------- */
const HELP_SEEN = 'seongbuk-help-seen'; // 처음 온 사람 안내를 닫았거나 사용 방법을 본 적이 있는가 (이 브라우저에만 저장)
const helpSeen = () => { try { return localStorage.getItem(HELP_SEEN) === '1'; } catch { return false; } };
const markHelpSeen = () => { try { localStorage.setItem(HELP_SEEN, '1'); } catch { /* 저장이 막혀 있으면 이번에만 숨긴다 */ } };
const HELP_STEPS = [
  { n: 1, title: '검토 필요 목록', desc: '바뀐 법령과 연결된 우리 구 조례를 확인합니다.' },
  { n: 2, title: '신구법 비교', desc: '법령이 어떻게 바뀌었는지 봅니다.' },
  { n: 3, title: '조문 대조와 사유', desc: 'AI가 조례에서 검토할 조문과 이유를 찾습니다. (약 40초)' },
  { n: 4, title: '개정 초안', desc: '조례 개정 초안을 보고 신구조문대비표로 복사하거나 Word로 내려받습니다.' },
  { n: 5, title: '현황판', desc: '진행 상태, 담당자, 기한을 기록합니다.' },
];
function renderHelp() {
  markHelpSeen();
  view.innerHTML = `
    <h2>사용 방법</h2>
    <p class="lede">법령이 바뀌면, 고쳐야 할 성북구 조례 조문과 개정 초안을 알려 줍니다.</p>
    <ol class="help-steps">${HELP_STEPS.map((x) => `
      <li class="card help-step">
        <span class="help-num" aria-hidden="true">${x.n}</span>
        <h3>${esc(x.title)}</h3>
        <p>${esc(x.desc)}</p>
        ${linkBtn(`#s${x.n}`, '이 화면으로 가기', 'small')}
      </li>`).join('')}
    </ol>
    <div class="notice"><strong>시연 기준일 (맨 위 오른쪽에서 고릅니다)</strong>
      2019. 12. 31. 과거 사례: 조례 반영까지 645일 걸린 사례<br>
      2026. 11. 12. 최근 사례: 오늘 시행된 개정</div>
    <div class="notice warn"><strong>꼭 알아 둘 점</strong>
      <ul class="plain help-notes">
        <li>AI 판단은 참고용이며 최종 판단은 담당자가 합니다.</li>
        <li>법령 원문으로 꼭 확인합니다.</li>
        <li>현황판 내용은 이 브라우저에만 저장됩니다.</li>
      </ul></div>
    <div class="actions">${linkBtn('#s1', '검토 필요 목록부터 시작하기')}</div>`;
}
const firstVisitBar = () => (helpSeen() ? '' : `<div class="first-visit" id="first-visit">
    <span>처음이신가요? <a href="#help">사용 방법 보기</a></span>
    <button class="first-visit-close" data-act="close-first" aria-label="안내 닫기">×</button></div>`);

/* ---------- 1단계: 검토 필요 목록 ---------- */
function renderS1() {
  const d = state.data;
  const cards = d.items.map((i) => `
    <div class="card item-card">
      <div class="item-head">
        <div><h3>${esc(i.lawName)} ${esc(i.article)}</h3><p class="muted">${esc(i.title)} · ${esc(i.change)}</p></div>
        <div class="badges">${badgesHtml(i)}</div>
      </div>
      <p>${esc(i.summary)}</p>
      <p class="kv"><b>공포</b> ${esc(i.promulgated)} · <b>시행</b> ${esc(i.enforced)}</p>
      <p class="kv"><b>연결 조례</b> ${esc(i.ordinance)}</p>
      <div class="actions"><button class="btn primary" data-act="open" data-id="${esc(i.id)}">신구법 비교 보기</button></div>
    </div>`).join('');
  view.innerHTML = `
    ${firstVisitBar()}
    <h2>검토 필요 목록</h2>
    <p class="lede">법령 변경이력에서 개정된 법령과, 그와 연결된 성북구 조례를 모았습니다. 항목을 고르면 바뀌기 전과 후의 법령을 비교합니다.</p>
    <div class="notice"><strong>시연 기준일: ${esc(d.baseDateLabel)} (${esc(d.name)})</strong>${esc(d.intro)}</div>
    ${pendingNotice()}
    ${cards}
    ${liveBox('history')}`;
}

/* ---------- 2단계: 신구법 비교 ---------- */
async function renderS2() {
  if (!state.selected) return needItem();
  const i = item();
  view.innerHTML = `<h2>신구법 비교</h2>${contextBar()}${skeleton(6)}`;
  try {
    const c = state.compare[i.id] || (state.compare[i.id] = await api(`/api/compare?item=${encodeURIComponent(i.id)}&scene=${encodeURIComponent(state.scene)}`));
    if (!location.hash.startsWith('#s2')) return; // 기다리는 사이 다른 화면으로 옮겼으면 그리지 않는다
    const segs = (x) => x.segments.map((s) => s.t === 'same' ? esc(s.s) : `<mark class="${s.t}">${esc(s.s)}</mark>`).join('');
    const box = (t, x, badge) => `<div class="card"><h3>${t} ${badge || ''}</h3><div class="law-text">${segs(x)}</div>${srcLinks([x], '출처')}</div>`;
    const legend = '<p class="muted"><mark class="add">초록 밑줄</mark>은 새로 생긴 내용, <mark class="del">빨간 취소선</mark>은 없어진 내용입니다.</p>';
    const dates = `<div class="notice"><strong>날짜 보는 법</strong><table class="mini"><tbody>
      <tr><th>공포일</th><td>${esc(c.dates.promulgated)}</td></tr><tr><th>시행일</th><td>${esc(c.dates.enforced)}</td></tr></tbody></table>${esc(c.dates.note)}</div>`;
    let body;
    if (c.isNew) {
      body = `<div class="notice warn"><strong>새로 생긴 조문입니다 (신설)</strong>${esc(i.lawName)} ${esc(i.article)}은 개정 전 판에 없던 조문입니다. 비교할 이전 내용이 없어 전체가 새 내용입니다.</div>
        ${box('바뀐 후 (전체가 새 내용)', c.newArticle, '<span class="badge warn">신설</span>')}${pendingNotice(i)}${legend}${dates}`;
      if (c.moved) {
        body += `<h3 style="margin-top:32px">번호가 옮겨진 조문: ${esc(c.moved.fromArticle)} → ${esc(c.moved.toArticle)}</h3>
          <div class="notice"><strong>종전 ${esc(c.moved.fromArticle)} 조문이 ${esc(c.moved.toArticle)}로 옮겨졌습니다</strong>안전기준 조문이 ${esc(i.article)}에 들어오면서 뒤 조문 번호가 밀렸습니다. 아래는 옮겨진 조문의 바뀐 곳입니다.</div>
          <div class="cols">${box('바뀌기 전 (' + esc(c.moved.fromArticle) + ')', c.moved.before)}${box('바뀐 후 (' + esc(c.moved.toArticle) + ')', c.moved.after)}</div>`;
      }
    } else {
      body = `<div class="cols">${box('바뀌기 전', c.compare.before)}${box('바뀐 후', c.compare.after)}</div>${legend}${dates}`;
    }
    view.innerHTML = `
      <h2>신구법 비교</h2>
      ${contextBar()}
      <p class="lede">${esc(i.lawName)} ${esc(i.article)}(${esc(i.title)})의 바뀌기 전과 후입니다.</p>
      ${body}
      ${liveBox('compare')}
      ${liveBox('notice')}
      <div class="actions">${linkBtn('#s3', '조문 대조로 이동')}</div>`;
  } catch (e) { view.innerHTML = `<div class="notice danger"><strong>불러오지 못했습니다.</strong>${esc(e.message)}</div>`; }
}

/* ---------- AI 분석 (3·4단계가 함께 사용) ---------- */
async function analyze(id, refresh = false) {
  if (state.analysis[id] && !refresh) return state.analysis[id];
  const r = await api('/api/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ item: id, scene: state.scene, refresh }) });
  state.analysis[id] = r;
  return r;
}
const aiBadge = (r) => r.source === 'live'
  ? `<span class="badge live">실시간</span> <span class="badge info">${esc(r.provider)}가 답했습니다</span>`
  : '<span class="badge demo">시연 값</span>';
const attemptsList = (r) => (r.attempts || []).filter((a) => !a.ok).length
  ? `<p class="kv"><b>넘어간 AI:</b> ${r.attempts.filter((a) => !a.ok).map((a) => `${esc(a.provider)}(${esc(a.reason)})`).join(', ')}</p>` : '';
// 저장된 답: 생성 시각과 「다시 분석」 버튼 (장면 2)
const fmtAt = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ko-KR', { hour12: false }); };
const savedLine = (r) => (r.saved
  ? `<div class="saved-line"><span class="badge ${r.saved.fromSaved ? 'info' : 'ok'}">${r.saved.fromSaved ? '저장된 답' : '새로 받은 답 · 저장함'}</span> <span class="muted">생성 시각 ${esc(fmtAt(r.saved.at))} · 저장 위치 ${esc(r.saved.storage)}</span> <button class="btn small" data-act="reanalyze">다시 분석</button></div>`
  : '');
const baseWarn = () => (state.data.ordinance.note ? `<div class="notice warn"><strong>기준일 확인 필요</strong>${esc(state.data.ordinance.note)}</div>` : '');
const noteBadge = (r) => (r.basis.ordinanceNote ? ` <span class="badge warn">${esc(r.basis.ordinanceNote)}</span>` : '');
const statusClass = (s) => (s === '없음' ? 'warn' : s === '일부 있음' ? 'info' : s === '있음' ? 'ok' : 'demo');

async function renderS3() {
  if (!state.selected) return needItem();
  const i = item();
  const head = `<h2>조문 대조와 사유</h2>${contextBar()}`;
  if (!state.analysis[i.id]) {
    view.innerHTML = `${head}${baseWarn()}<p class="lede">${esc(state.data.s3Lede)}</p>${pendingNotice()}
      <button class="btn primary" data-act="analyze">AI로 조문 대조하기</button>
      <p class="muted" style="margin-top:12px">검색된 조문으로만 답하며, 개정이 필요한지는 단정하지 않습니다. ${esc(state.data.waitText)}</p>
      ${liveBox('ordin')}`;
    return;
  }
  view.innerHTML = `${head}${skeleton(5)}`;
  try {
    const r = await analyze(i.id);
    if (!location.hash.startsWith('#s3')) return; // 기다리는 사이 다른 화면으로 옮겼으면 그리지 않는다
    const a = r.result, c = a.conclusion;
    const delegation = c.delegation ? `<blockquote class="quote"><strong>위임 문구 (${esc(c.delegationArticle || '')})</strong><br>${esc(c.delegation)}</blockquote>` : '';
    const rows = (a.comparisons || []).map((x) => `<tr><td><strong>${esc(x.article)}</strong></td><td><span class="badge ${statusClass(x.status)}">${esc(x.status)}</span></td><td>${esc(x.reason)}${srcLinks(x.sources)}</td></tr>`).join('');
    view.innerHTML = `${head}
      ${r.reason ? `<div class="notice warn"><strong>${r.checkFailed ? 'AI 초안 검사' : 'AI 응답 실패'}</strong>${esc(r.reason)}</div>` : ''}
      <div class="card selected verdict">
        <p><span class="badge warn">${esc(c.verdictLabel || c.verdict)}</span> <span class="muted">참고 의견입니다. 최종 판단은 담당자가 합니다.</span></p>
        <p class="headline">${esc(c.headline)}</p>
        <p><strong>고칠 곳</strong> ${esc(c.target)}</p>
        ${delegation}
        <p class="kv"><b>대조 기준</b> ${esc(r.basis.item)} ↔ ${esc(r.basis.ordinance)}${noteBadge(r)}</p>
        <div class="actions">${linkBtn('#s4', '개정 초안 보기')}</div>
      </div>
      ${baseWarn()}
      <details open class="more"><summary>조례 조문별 대조 (${(a.comparisons || []).length}건)</summary>
        <div class="table-wrap"><table><thead><tr><th>조례 조문</th><th>위임 사항</th><th>이유</th></tr></thead><tbody>${rows}</tbody></table></div></details>
      <details class="more"><summary>법령이 바꾼 것과 확인할 점</summary>
        ${r.source === 'live' ? '<p class="muted">아래 내용은 AI가 정리한 것으로, 출처 조문이 연결되어 있지 않습니다. 근거 문서에 없는 내용이 섞일 수 있으니 원문으로 확인하세요.</p>' : ''}
        <p>${esc(a.summary)}</p>
        ${(a.cautions || []).length ? `<ul class="plain">${a.cautions.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</details>
      <details class="more"><summary>AI가 참고한 조문 (${(r.sources || []).length}건)</summary>${srcLinks(r.sources, '참고한 조문')}</details>
      <p class="kv">${aiBadge(r)}</p>${attemptsList(r)}${savedLine(r)}
      ${liveBox('ordin')}`;
  } catch (e) { view.innerHTML = `${head}<div class="notice danger"><strong>분석하지 못했습니다.</strong>${esc(e.message)}</div><button class="btn" data-act="analyze">다시 시도</button>`; }
}

/* ---------- 4단계: 개정 초안 ---------- */
function draftText(r, d) {
  const lines = [
    `[조례 개정 초안 ${d.title}]`,
    `검토 대상: ${r.basis.item}`,
    `대조 조례: ${r.basis.ordinance}${r.basis.ordinanceNote ? ` (${r.basis.ordinanceNote})` : ''}`,
    '', '■ 개정이유', d.reason, '', '■ 개정 위치', d.position, '', '■ 개정 문안', d.amendment, '', '■ 신구조문대비표', '현행\t개정안',
    ...(d.table || []).map((t) => `${t.current}\t${t.proposed}`), '', '■ 장단점', d.tradeoff, '', '※ AI가 만든 참고용 초안입니다. 문안과 개정 여부는 담당자가 확인해 결정합니다.',
  ];
  return lines.join('\n');
}
function draftHtml(r, d) {
  const p = (t) => `<p>${esc(t).replace(/\n/g, '<br>')}</p>`;
  return `<h2>조례 개정 초안 ${esc(d.title)}</h2>
    <p>검토 대상: ${esc(r.basis.item)}<br>대조 조례: ${esc(r.basis.ordinance)}${r.basis.ordinanceNote ? ` (${esc(r.basis.ordinanceNote)})` : ''}</p>
    <h3>개정이유</h3>${p(d.reason)}<h3>개정 위치</h3>${p(d.position)}<h3>개정 문안</h3>${p(d.amendment)}
    <h3>신구조문대비표</h3><table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;width:100%"><tr><th width="50%">현행</th><th width="50%">개정안</th></tr>
    ${(d.table || []).map((t) => `<tr><td>${esc(t.current).replace(/\n/g, '<br>')}</td><td>${esc(t.proposed).replace(/\n/g, '<br>')}</td></tr>`).join('')}</table>
    <h3>장단점</h3>${p(d.tradeoff)}<p><i>※ AI가 만든 참고용 초안입니다. 문안과 개정 여부는 담당자가 확인해 결정합니다.</i></p>`;
}
/* ---------- 신구조문대비표 복사 (한글 문서에 붙여 넣기용) ---------- */
// 「(생 략)」「(현행과 같음)」「(신설)」「<신 설>」은 관례상 밑줄을 긋지 않는 표시어라 한 덩어리로 다룬다
const KEEP = /^(?:\((?:생\s*략|현행과\s*같음|신\s*설)\)|<\s*신\s*설\s*>)$/;
const tokens = (s) => String(s || '').match(/\((?:생\s*략|현행과\s*같음|신\s*설)\)|<\s*신\s*설\s*>|\S+|\s+/g) || [];
// 두 칸의 낱말을 비교해 바뀐 낱말에 표시한다(서버 api/_diff.js 와 같은 방식)
function markChanges(cur, pro) {
  const a = tokens(cur), b = tokens(pro);
  const ma = a.map(() => true), mb = b.map(() => true);
  if (a.length * b.length <= 1_000_000) {
    const n = a.length, m = b.length, w = m + 1, dp = new Uint16Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { ma[i] = mb[j] = false; i++; j++; } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++; else j++;
    }
  }
  const html = (toks, marks) => toks.map((t, k) => {
    const e = esc(t).replace(/\n/g, '<br>');
    return marks[k] && /\S/.test(t) && !KEEP.test(t) ? `<u>${e}</u>` : e;
  }).join('').replace(/<\/u>(\s+)<u>/g, '$1'); // 붙은 밑줄은 이어서 긋는다
  return { cur: html(a, ma), pro: html(b, mb) };
}
function compareTable(d) {
  const cell = 'border:1px solid #000;padding:6px 8px;vertical-align:top;width:50%';
  const head = `<tr><th style="${cell};text-align:center;background:#F2F2F2">현행</th><th style="${cell};text-align:center;background:#F2F2F2">개정안</th></tr>`;
  const rows = (d.table || []).map((t) => { const x = markChanges(t.current, t.proposed); return `<tr><td style="${cell}">${x.cur}</td><td style="${cell}">${x.pro}</td></tr>`; }).join('');
  const html = `<table style="border-collapse:collapse;width:100%;font-family:'Malgun Gothic',sans-serif;font-size:11pt">${head}${rows}</table>`;
  // 일반 글자 표: 칸 사이는 탭, 칸 안 줄바꿈이 있으면 큰따옴표로 묶는다(엑셀·한글 표 붙여 넣기 관례)
  const q = (v) => { const t = String(v ?? ''); return /[\t\n"]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const text = ['현행\t개정안', ...(d.table || []).map((t) => `${q(t.current)}\t${q(t.proposed)}`)].join('\r\n');
  return { html, text };
}
async function copyRich(html, text) {
  try {
    if (!window.ClipboardItem || !navigator.clipboard?.write) throw new Error('지원 안 함');
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
    return true;
  } catch {
    // 클립보드 권한이 없을 때: 복사 순간에 두 형식을 직접 넣는다
    let ok = false;
    const on = (e) => { e.clipboardData.setData('text/html', html); e.clipboardData.setData('text/plain', text); e.preventDefault(); ok = true; };
    document.addEventListener('copy', on);
    try { document.execCommand('copy'); } catch { ok = false; }
    document.removeEventListener('copy', on);
    return ok;
  }
}
function toast(msg, kind = 'ok') {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); document.body.appendChild(el); }
  el.className = `toast ${kind} show`;
  el.textContent = msg;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.className = `toast ${kind}`; }, 3000);
}

function download(name, html) {
  const doc = `<html><head><meta charset="utf-8"><title>${esc(name)}</title></head><body style="font-family:'Malgun Gothic',sans-serif">${html}</body></html>`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿', doc], { type: 'application/msword' }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function renderS4() {
  if (!state.selected) return needItem();
  const i = item();
  const head = `<h2>개정 초안</h2>${contextBar()}`;
  if (!state.analysis[i.id]) {
    view.innerHTML = `${head}<div class="notice"><strong>먼저 조문 대조가 필요합니다.</strong>초안은 조문 대조 결과를 바탕으로 만듭니다.</div>${linkBtn('#s3', '조문 대조로 이동')}`;
    return;
  }
  const r = state.analysis[i.id];
  const drafts = r.result.drafts || [];
  view.innerHTML = `${head}
    <div class="notice"><strong>이 초안의 기준</strong>${esc(r.basis.item)} → ${esc(r.basis.ordinance)}${noteBadge(r)}</div>
    <p class="lede">조례 개정 초안 ${drafts.length}안입니다. 안마다 개정이유, 개정 위치, 개정 문안, 신구조문대비표를 담았습니다.</p>
    <p>${aiBadge(r)}</p>
    ${drafts.map((d, n) => `<div class="card draft">
      <h3>${esc(d.title)}</h3>
      <h4>개정이유</h4><p>${esc(d.reason)}</p>
      <h4>개정 위치</h4><p>${esc(d.position)}</p>
      <h4>개정 문안</h4><div class="law-text">${esc(d.amendment)}</div>
      <h4>신구조문대비표</h4>
      <div class="table-wrap"><table><thead><tr><th>현행</th><th>개정안</th></tr></thead><tbody>${(d.table || []).map((t) => `<tr><td class="pre">${esc(t.current)}</td><td class="pre">${esc(t.proposed)}</td></tr>`).join('')}</tbody></table></div>
      <h4>장단점</h4><p>${esc(d.tradeoff)}</p>
      ${srcLinks(d.sources)}
      <div class="actions"><button class="btn small" data-act="table-copy" data-n="${n}">신구조문대비표 복사</button> <button class="btn small" data-act="copy" data-n="${n}">문안 복사</button> <button class="btn small primary" data-act="word" data-n="${n}">Word로 내려받기</button></div>
    </div>`).join('')}
    <div class="notice warn"><strong>초안은 참고용입니다.</strong>문안과 개정 여부는 담당자가 법령·조례 원문과 법제 심사 기준으로 확인해 결정합니다.</div>
    <div class="actions"><button class="btn" data-act="word-all">${drafts.length}안 모두 Word로 내려받기</button> ${linkBtn('#s5', '현황판으로 이동')}</div>`;
}

/* ---------- 5단계: 현황판 ---------- */
const fmtNow = () => new Date().toLocaleString('ko-KR', { hour12: false });

function boardCard(i, b) {
  const f = (name, label, input) => `<div class="field"><label for="${name}-${esc(i.id)}">${label}</label>${input}</div>`;
  const inp = (name, type = 'text', ph = '') => `<input id="${name}-${esc(i.id)}" type="${type}" value="${esc(b[name])}" placeholder="${ph}" data-board="${esc(i.id)}" data-field="${name}">`;
  return `<div class="card board-card" data-card="${esc(i.id)}">
    <div class="item-head"><div><h3>${esc(i.lawName)} ${esc(i.article)}</h3><p class="muted">${esc(i.ordinance)} · 시행 ${esc(i.enforced)}</p></div>
      <div class="badges">${badgesHtml(i)}</div></div>
    <div class="grid-form">
      ${f('status', '진행 상태', `<select id="status-${esc(i.id)}" data-board="${esc(i.id)}" data-field="status">${STATUSES.map((s) => `<option${s === b.status ? ' selected' : ''}>${s}</option>`).join('')}</select>`)}
      ${f('owner', '담당자', inp('owner', 'text', '이름 또는 부서'))}
      ${f('due', '기한', inp('due', 'date'))}
      ${f('dept', '협의 부서', inp('dept', 'text', '예: 청소행정과, 법무 담당'))}
    </div>
    ${f('memo', '메모', `<textarea id="memo-${esc(i.id)}" data-board="${esc(i.id)}" data-field="memo" placeholder="협의 내용, 확인할 사항">${esc(b.memo)}</textarea>`)}
    <details class="more"><summary>변경 이력 (<span id="hc-${esc(i.id)}">${b.history.length}</span>건)</summary><ul class="plain" id="hist-${esc(i.id)}">${histHtml(b)}</ul></details>
  </div>`;
}
const histHtml = (b) => (b.history.length ? b.history.slice().reverse().map((h) => `<li>${esc(h.at)} · ${esc(h.text)}</li>`).join('') : '<li class="muted">아직 변경 이력이 없습니다.</li>');

function boardListHtml() {
  const board = loadBoard();
  const { q, status, sort } = state.filter;
  let list = state.data.items.map((i) => ({ i, b: entry(board, i.id) }));
  if (status !== '전체') list = list.filter((x) => x.b.status === status);
  if (q.trim()) {
    const t = q.trim();
    list = list.filter((x) => [x.i.lawName, x.i.article, x.b.owner, x.b.dept, x.b.memo].join(' ').includes(t));
  }
  list.sort((a, b) => (sort === 'due'
    ? (a.b.due || '9999').localeCompare(b.b.due || '9999')
    : a.i.enforced.replace(/\D/g, '').localeCompare(b.i.enforced.replace(/\D/g, ''))));
  return list.length ? list.map((x) => boardCard(x.i, x.b)).join('') : '<div class="notice"><strong>조건에 맞는 항목이 없습니다.</strong>검색어나 상태를 바꿔 보세요.</div>';
}

async function renderS5() {
  const f = state.filter;
  view.innerHTML = `
    <h2>현황판</h2>
    <p class="lede">확인할 조례와 진행 상태, 담당자, 기한, 협의 부서를 한 화면에서 봅니다.</p>
    <div class="notice warn"><strong>저장 위치 안내</strong>입력한 내용은 <u>이 브라우저에만</u> 저장됩니다. 다른 담당자와 공유하려면 아래 「파일로 내보내기」로 파일을 전달하고, 받는 쪽은 「파일 불러오기」를 쓰세요. 브라우저 데이터를 지우면 사라지므로 주기적으로 내보내 두세요. 여러 사람이 함께 쓰는 저장소(서버 저장)는 아직 없습니다.</div>
    <div class="toolbar">
      <div class="field"><label for="f-q">검색</label><input id="f-q" type="search" value="${esc(f.q)}" placeholder="법령·담당자·부서·메모"></div>
      <div class="field"><label for="f-status">진행 상태</label><select id="f-status"><option>전체</option>${STATUSES.map((s) => `<option${s === f.status ? ' selected' : ''}>${s}</option>`).join('')}</select></div>
      <div class="field"><label for="f-sort">정렬</label><select id="f-sort"><option value="due"${f.sort === 'due' ? ' selected' : ''}>기한 빠른 순</option><option value="enforced"${f.sort === 'enforced' ? ' selected' : ''}>법령 시행일 순</option></select></div>
    </div>
    <div id="board-list">${boardListHtml()}</div>
    <div class="actions">
      <button class="btn" data-act="csv">표(CSV)로 내보내기</button>
      <button class="btn" data-act="export">파일로 내보내기</button>
      <label class="btn" style="display:inline-flex;align-items:center;cursor:pointer">파일 불러오기<input type="file" id="import-file" accept="application/json,.json" hidden></label>
    </div>`;
  document.getElementById('f-status').value = f.status;
}

function exportBoard() {
  const blob = new Blob([JSON.stringify({ version: 2, savedAt: fmtNow(), board: loadBoard() }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '현황판_내보내기.json';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function exportCsv() {
  const board = loadBoard();
  const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const rows = [['법령', '조문', '연결 조례', '법령 시행일', '진행 상태', '담당자', '기한', '협의 부서', '메모'],
    ...state.data.items.map((i) => { const b = entry(board, i.id); return [i.lawName, i.article, i.ordinance, i.enforced, b.status, b.owner, b.due, b.dept, b.memo]; })];
  const blob = new Blob(['﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '현황판.csv';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function needItem() {
  view.innerHTML = `<h2>항목을 먼저 고르세요</h2><div class="notice"><strong>선택한 항목이 없습니다.</strong>검토 필요 목록에서 항목을 고르면 이 단계를 볼 수 있습니다.</div>${linkBtn('#s1', '검토 필요 목록으로 이동')}`;
}

/* ---------- 시연 기준일(장면) 고르기 ---------- */
async function loadScene(id) {
  state.data = await api(`/api/cases?scene=${encodeURIComponent(id)}`);
  state.scene = state.data.baseDate;
  // 단계 탭을 바로 눌러도 열리도록 기본 선택 (장면 1은 시행규칙 제16조의3)
  state.selected = state.data.items.find((x) => x.id === 'rule-16-3')?.id || state.data.items[0].id;
}
function renderSceneSelect() {
  const d = state.data;
  baseDateEl.innerHTML = `<label for="scene-pick">시연 기준일</label>
    <select id="scene-pick">${d.scenes.map((x) => `<option value="${esc(x.id)}"${x.id === d.baseDate ? ' selected' : ''}>${esc(x.label)} (${esc(x.name)})</option>`).join('')}</select>`;
}

/* ---------- 라우터·이벤트 ---------- */
const RENDER = { 1: renderS1, 2: renderS2, 3: renderS3, 4: renderS4, 5: renderS5 };
async function route() {
  const help = location.hash === '#help';
  const n = help ? 0 : Number((location.hash.match(/#s(\d)/) || [])[1]) || 1;
  document.querySelectorAll('#step-nav a').forEach((a) => {
    if (Number(a.dataset.step) === n) a.setAttribute('aria-current', 'step'); else a.removeAttribute('aria-current');
  });
  const hl = document.getElementById('help-link');
  if (help) hl.setAttribute('aria-current', 'page'); else hl.removeAttribute('aria-current');
  if (!state.data) return;
  await (help ? renderHelp() : RENDER[n]());
  window.scrollTo(0, 0);
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'open') { state.selected = b.dataset.id; location.hash = '#s2'; }
  if (act === 'live') runLive(b.closest('[data-live]'), b.dataset.kind);
  if (act === 'close-first') { markHelpSeen(); document.getElementById('first-visit')?.remove(); }
  if (act === 'csv') exportCsv();
  if (act === 'export') exportBoard();
  if (act === 'table-copy') {
    const r = state.analysis[state.selected]; const d = r?.result?.drafts?.[Number(b.dataset.n)];
    if (!d || !(d.table || []).length) { toast('이 안에는 신구조문대비표가 없습니다.', 'danger'); return; }
    const { html, text } = compareTable(d);
    const ok = await copyRich(html, text);
    toast(ok ? '복사했습니다. 한글 문서에 붙여 넣으세요' : '복사하지 못했습니다. 브라우저의 클립보드 권한을 확인하세요.', ok ? 'ok' : 'danger');
  }
  if (act === 'copy' || act === 'word' || act === 'word-all') {
    const r = state.analysis[state.selected]; const ds = r.result.drafts;
    if (act === 'copy') {
      const text = draftText(r, ds[Number(b.dataset.n)]);
      let ok = false;
      try { await navigator.clipboard.writeText(text); ok = true; } catch {
        // 클립보드 권한이 없을 때: 임시 입력칸으로 복사
        const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); try { ok = document.execCommand('copy'); } catch { ok = false; } ta.remove();
      }
      b.textContent = ok ? '복사했습니다' : '복사하지 못했습니다';
      setTimeout(() => { b.textContent = '문안 복사'; }, 1800);
    } else if (act === 'word') {
      const d = ds[Number(b.dataset.n)]; download(`조례개정초안_${d.title.split('.')[0]}.doc`, draftHtml(r, d));
    } else download('조례개정초안_전체.doc', ds.map((d) => draftHtml(r, d)).join('<br clear="all" style="page-break-before:always">'));
  }
  if (act === 'analyze' || act === 'reanalyze') {
    const i = item();
    const refresh = act === 'reanalyze';
    view.querySelectorAll('button[data-act="analyze"], button[data-act="reanalyze"]').forEach((x) => { x.disabled = true; });
    // 「다시 분석」이면 버튼 바로 아래에, 처음이면 화면 맨 아래에 기다림 안내를 둔다
    const host = refresh ? b.closest('.saved-line') : view;
    host.insertAdjacentHTML(refresh ? 'afterend' : 'beforeend', `<div id="wait" class="notice" style="margin-top:16px"><strong>AI가 조문을 대조하는 중입니다 (<span id="sec">0</span>초)</strong>${esc(state.data.waitText)}${skeleton(4)}</div>`);
    const t0 = Date.now();
    const timer = setInterval(() => { const s = document.getElementById('sec'); if (s) s.textContent = Math.round((Date.now() - t0) / 1000); }, 1000);
    try { await analyze(i.id, refresh); clearInterval(timer); } catch (err) { clearInterval(timer); document.getElementById('wait')?.remove(); view.insertAdjacentHTML('beforeend', `<div class="notice danger"><strong>분석하지 못했습니다.</strong>${esc(err.message)}</div>`); return; }
    renderS3();
  }
});

document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.matches('[data-act-change="pick"]')) { state.selected = t.value; route(); return; }
  if (t.id === 'scene-pick') {
    view.innerHTML = skeleton(5);
    try { await loadScene(t.value); renderSceneSelect(); route(); } catch (err) {
      view.innerHTML = `<div class="notice danger"><strong>장면을 불러오지 못했습니다.</strong>${esc(err.message)}</div>`;
    }
    return;
  }
  if (t.id === 'f-status') { state.filter.status = t.value; document.getElementById('board-list').innerHTML = boardListHtml(); return; }
  if (t.id === 'f-sort') { state.filter.sort = t.value; document.getElementById('board-list').innerHTML = boardListHtml(); return; }
  if (t.id === 'import-file') {
    try {
      const j = JSON.parse(await t.files[0].text());
      if (!j.board || typeof j.board !== 'object') throw new Error('형식이 맞지 않습니다');
      saveBoard(j.board); renderS5();
    } catch (err) { alert(`불러오지 못했습니다: ${err.message}`); }
    return;
  }
  const bt = t.closest('[data-board]');
  if (!bt) return;
  const id = bt.dataset.board, field = bt.dataset.field;
  const board = loadBoard(); const cur = entry(board, id);
  if (cur[field] === bt.value) return;
  const show = (v) => (v === '' ? '(비어 있음)' : v.length > 40 ? `${v.slice(0, 40)}…` : v);
  cur.history = [...cur.history, { at: fmtNow(), text: `${FIELD_LABEL[field]}: ${show(cur[field])} → ${show(bt.value)}` }];
  cur[field] = bt.value;
  board[id] = cur; saveBoard(board);
  const hist = document.getElementById(`hist-${id}`); if (hist) hist.innerHTML = histHtml(cur);
  const hc = document.getElementById(`hc-${id}`); if (hc) hc.textContent = cur.history.length;
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'f-q') { state.filter.q = e.target.value; document.getElementById('board-list').innerHTML = boardListHtml(); }
});

window.addEventListener('hashchange', route);

(async function init() {
  view.innerHTML = skeleton(5);
  try {
    await loadScene(state.scene);
    renderSceneSelect();
    route();
  } catch (e) {
    view.innerHTML = `<div class="notice danger"><strong>목록을 불러오지 못했습니다.</strong>${esc(e.message)} 서버가 실행 중인지 확인하세요.</div>`;
  }
})();
