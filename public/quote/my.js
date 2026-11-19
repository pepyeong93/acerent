// 견적 사용자: 내 견적 · 심사 (/quote 의 '내 견적 · 심사' 탭)
//   내가 발행한 견적 목록 → 견적을 열어 심사 서류(운전면허증 · 운전경력증명서 · 소득증빙 · 부채증빙 · 등본 · 기타서류)를 올리고 심사 요청
//   상태: 견적진행 → 심사진행 → 승인 / 부결 (승인 · 부결은 관리자가 처리)
import { api, $, $$, esc, won } from '/assets/common.js';

const ST = { quote: ['견적진행', 'st-quote'], review: ['심사진행', 'st-review'], approved: ['승인', 'st-ok'], rejected: ['부결', 'st-no'] };
const stBadge = (s) => `<span class="q-st ${(ST[s] || ST.quote)[1]}">${(ST[s] || ST.quote)[0]}</span>`;
// 서버 시각(UTC 'YYYY-MM-DD HH:MM:SS') → 한국시간
const kst = (s) => (s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '');
const kb = (n) => (n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB');
const view = $('#myView');

function toast(msg, err) { const t = $('#toast'); t.textContent = msg; t.classList.toggle('err', !!err); t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3500); }
function fail(e) { if (/로그인/.test(e.message)) return location.reload(); toast(e.message, true); }

// ── 탭 전환 ──
function setTab(my) {
  $('#tabNew').classList.toggle('on', !my); $('#tabNew').setAttribute('aria-selected', String(!my));
  $('#tabMy').classList.toggle('on', my); $('#tabMy').setAttribute('aria-selected', String(my));
  $('.q-wrap').hidden = my; view.hidden = !my;
  for (const id of ['resetBtn', 'jpgBtn', 'issueBtn']) $('#' + id).hidden = my;
  if (!my) history.replaceState(null, '', location.pathname);
}
$('#tabNew').addEventListener('click', () => setTab(false));
$('#tabMy').addEventListener('click', () => { setTab(true); openList(); });

// 상태 단계 표시: 견적진행 > 심사진행 > 승인/부결
function steps(s) {
  const at = { quote: 1, review: 2, approved: 3, rejected: 3 }[s] || 1;
  const last = s === 'approved' ? '승인' : s === 'rejected' ? '부결' : '승인 / 부결';
  return `<ol class="q-steps">${['견적진행', '심사진행', last].map((t, i) => `<li class="${i + 1 < at ? 'done' : i + 1 === at ? 'cur' + (s === 'rejected' ? ' no' : '') : ''}">${t}</li>`).join('')}</ol>`;
}

// ── 목록 ──
async function openList(page = 1) {
  history.replaceState(null, '', '#my');
  view.innerHTML = '<p class="muted" style="padding:40px 0;text-align:center">불러오는 중…</p>';
  let d;
  try { d = await api('/api/quote/my?page=' + page); } catch (e) { return fail(e); }
  const pages = Math.max(1, Math.ceil(d.total / d.size));
  view.innerHTML = `<section class="q-box">
<h2>내 견적 · 심사 <span class="tag">${d.total}건</span></h2>
<p class="small muted" style="margin:-4px 0 12px">견적서 PDF · JPG 를 내려받은 견적이 여기에 저장됩니다. 견적을 눌러 심사 서류를 올리고 심사를 요청하세요.</p>
<div class="q-scroll"><table class="q-list"><thead><tr><th>견적번호 · 발행일시</th><th>고객</th><th>차량</th><th>조건 · 월 렌트료</th><th>서류</th><th>상태</th></tr></thead>
<tbody>${d.logs.length ? d.logs.map((x) => `<tr class="click" data-id="${x.id}" tabindex="0"><td><strong>${esc(x.no)}</strong><br><span class="muted small">${kst(x.created_at)}</span></td><td>${esc(x.customer_name || '-')}<br><span class="muted small">${esc(x.customer_type)}</span></td><td>${esc(x.vehicle)}<br><span class="muted small">${won(x.price)}원</span></td><td class="small">${esc(x.summary)}</td><td>${x.docs ? x.docs + '개' : '<span class="muted">없음</span>'}</td><td>${stBadge(x.review_status)}</td></tr>`).join('')
    : '<tr><td colspan="6" class="muted" style="padding:40px;text-align:center">아직 발행한 견적이 없습니다. \'견적 작성\'에서 견적서를 내려받으면 여기에 저장됩니다.</td></tr>'}</tbody></table></div>
${pages > 1 ? `<div class="q-pager">${page > 1 ? `<button class="btn btn-sm" data-pg="${page - 1}">이전</button>` : ''}<span class="muted small">${page} / ${pages}</span>${page < pages ? `<button class="btn btn-sm" data-pg="${page + 1}">다음</button>` : ''}</div>` : ''}
</section>`;
  $$('tr[data-id]', view).forEach((tr) => {
    const go = () => openDetail(+tr.dataset.id);
    tr.addEventListener('click', go);
    tr.addEventListener('keydown', (e) => e.key === 'Enter' && go());
  });
  $$('[data-pg]', view).forEach((b) => b.addEventListener('click', () => openList(+b.dataset.pg)));
}

// ── 상세: 견적 내용 · 서류 · 심사 요청 ──
async function openDetail(id) {
  let d;
  try { d = await api('/api/quote/my/' + id); } catch (e) { return fail(e); }
  const x = d.log, editable = x.review_status === 'quote';
  const ps = (x.result.products || []).filter((o) => o.on && !o.error);
  const docs = x.docs || [];
  const statusNote = {
    quote: '서류를 올린 뒤 <strong>심사진행 요청</strong>을 눌러 주세요. 요청 후에는 서류를 바꿀 수 없습니다.',
    review: `심사를 요청했습니다${x.review_requested_at ? ` (${kst(x.review_requested_at)})` : ''}. 결과가 나오면 여기에 표시됩니다.`,
    approved: `심사가 <strong>승인</strong>되었습니다${x.review_decided_at ? ` (${kst(x.review_decided_at)})` : ''}.`,
    rejected: `심사가 <strong>부결</strong>되었습니다${x.review_decided_at ? ` (${kst(x.review_decided_at)})` : ''}.`,
  }[x.review_status] || '';
  view.innerHTML = `<div class="q-my-head"><button class="btn btn-sm" type="button" id="myBack">← 목록으로</button><h2>견적 ${esc(x.no)} ${stBadge(x.review_status)}</h2></div>
<section class="q-box">${steps(x.review_status)}
<p class="q-note${x.review_status === 'rejected' ? ' no' : ''}">${statusNote}${x.review_note ? `<br>사유 · 안내: ${esc(x.review_note)}` : ''}</p></section>
<section class="q-box"><h2>견적 내용</h2>
<dl class="q-dl"><dt>발행일시</dt><dd>${kst(x.created_at)}</dd><dt>고객</dt><dd>${esc(x.customer_name || '-')} (${esc(x.customer_type)})</dd><dt>차량</dt><dd>${esc(x.vehicle)}</dd><dt>차량가격</dt><dd>${won(x.price)}원 (VAT 포함)</dd>${x.result.prod ? `<dt>상품구분</dt><dd>${esc(x.result.prod.name)}</dd>` : ''}</dl>
${ps.length ? `<div class="q-scroll" style="margin-top:12px"><table class="q-list"><thead><tr><th>기간</th><th>약정거리</th><th class="num">선납금</th><th class="num">보증금</th><th class="num">월 렌트료 (VAT포함)</th><th class="num">출고 전 납입</th></tr></thead>
<tbody>${ps.map((o) => `<tr><td>${o.n}개월</td><td>${won(o.km)}km/년</td><td class="num">${won(o.pre)}</td><td class="num">${won(o.dep)}</td><td class="num"><strong>${won(o.month)}</strong></td><td class="num">${won(o.upfront)}</td></tr>`).join('')}</tbody></table></div>` : ''}</section>
<section class="q-box"><h2>심사 서류 <span class="tag">${docs.length}개</span></h2>
<p class="small muted" style="margin:-4px 0 12px">JPG · PNG · WEBP 사진이나 PDF 파일, 하나에 15MB 까지 올릴 수 있습니다. 휴대폰으로 찍은 사진도 됩니다.</p>
<div class="q-docs">${d.docTypes.map(([k, name]) => {
    const mine = docs.filter((f) => f.doc_type === k);
    return `<div class="q-doc"><div class="q-doc-h"><strong>${esc(name)}</strong>${mine.length ? `<span class="q-st st-ok">${mine.length}개 등록</span>` : '<span class="q-st st-quote">미등록</span>'}</div>
<ul>${mine.map((f) => `<li><a href="/api/quote/my/${x.id}/docs/${f.id}" target="_blank" rel="noopener">${esc(f.file_name || '파일')}</a> <span class="muted small">${kb(f.size)}</span>${editable ? ` <button type="button" class="btn-link" data-del="${f.id}">삭제</button>` : ''}</li>`).join('')}</ul>
${editable ? `<label class="btn btn-sm q-up"><span>파일 올리기</span><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple data-type="${k}" hidden></label>` : ''}</div>`;
  }).join('')}</div>
${editable ? `<div class="q-review"><span class="small muted">${docs.length ? '서류를 다 올렸으면 심사를 요청해 주세요.' : '서류를 하나 이상 올리면 심사를 요청할 수 있습니다.'}</span><button class="btn btn-red btn-lg" type="button" id="reqReview"${docs.length ? '' : ' disabled'}>심사진행 요청</button></div>` : ''}
</section>`;
  history.replaceState(null, '', '#my/' + x.id);
  $('#myBack').addEventListener('click', () => openList());
  $$('input[type=file][data-type]', view).forEach((inp) => inp.addEventListener('change', async () => {
    if (!inp.files.length) return;
    const fd = new FormData();
    fd.append('type', inp.dataset.type);
    for (const f of inp.files) fd.append('file', f);
    $('span', inp.parentElement).textContent = '올리는 중…';
    try { await api(`/api/quote/my/${x.id}/docs`, { method: 'POST', body: fd }); toast('서류를 올렸습니다.'); }
    catch (e) { fail(e); }
    openDetail(x.id);
  }));
  $$('[data-del]', view).forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('이 서류를 지울까요?')) return;
    try { await api(`/api/quote/my/${x.id}/docs/${b.dataset.del}`, { method: 'DELETE' }); toast('서류를 지웠습니다.'); }
    catch (e) { fail(e); }
    openDetail(x.id);
  }));
  $('#reqReview')?.addEventListener('click', async (e) => {
    if (!confirm('심사를 요청할까요? 요청 후에는 서류를 바꿀 수 없습니다.')) return;
    e.target.disabled = true;
    try { await api(`/api/quote/my/${x.id}/review`, { method: 'POST' }); toast('심사를 요청했습니다. 결과가 나오면 이 화면에 표시됩니다.'); }
    catch (err) { fail(err); }
    openDetail(x.id);
  });
}

// 주소에 #my 또는 #my/123 이 있으면 로그인 화면이 열린 뒤 바로 그 화면으로
function fromHash() {
  const m = location.hash.match(/^#my(?:\/(\d+))?$/);
  if (!m || $('#appView').hidden) return;
  setTab(true);
  if (m[1]) openDetail(+m[1]); else openList();
}
new MutationObserver(fromHash).observe($('#appView'), { attributes: true, attributeFilter: ['hidden'] });
fromHash();
