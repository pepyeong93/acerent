import { api, $, $$, esc, won, initLayout, setBusy, classImage } from './common.js';
import { quote } from './longcalc.js';

initLayout();

// 예전 법인렌트 주소(/long.html#corp)는 신차장기렌트 견적으로
if (location.hash === '#corp') location.replace('/newcar.html');

// ── 즉시출고 차량 목록 ──
const st = { sort: 'low', list: [] };
$('#sort').addEventListener('change', (e) => { st.sort = e.target.value; draw(); });
function priceOf(v) {
  // 관리자가 고른 대표 이용금액 줄 (없으면 예전 자동계산)
  if (v.mainPlan && v.mainPlan.monthly) return { term: v.mainPlan.term, monthly: v.mainPlan.monthly, deposit: v.mainPlan.deposit, km: v.mainPlan.km_year };
  if (!v.bases || !v.bases.length) return null;
  const term = Math.max(...v.bases.map((b) => b.term));
  return { term, monthly: quote(v, v.pricing, v.bases, { term }).monthly };
}
const ST = (v) => (v.status === 'reserved' ? '계약 진행 중' : v.status === 'soon' ? '출고 예정' + (v.avail_note ? ' · ' + v.avail_note : '') : v.badge);
function draw() {
  const list = st.list.map((v) => ({ ...v, p: priceOf(v) }));
  if (st.sort === 'low') list.sort((a, b) => (a.p ? a.p.monthly : 9e9) - (b.p ? b.p.monthly : 9e9));
  if (st.sort === 'new') list.sort((a, b) => (b.year || 0) - (a.year || 0));
  if (st.sort === 'km') list.sort((a, b) => a.km - b.km);
  $('#count').textContent = list.length;
  $('#grid').innerHTML = list.length
    ? list.map((v) => `<a class="car-card" href="/car.html?id=${v.id}">
<div class="photo">${v.photo ? `<img src="${esc(v.photo)}" alt="${esc(v.name)} 실차 사진" loading="lazy">` : `<img src="${classImage(v.class)}" alt="" style="object-fit:contain">`}</div>
<div style="display:flex;flex-direction:column;gap:4px">
<span class="badge">${esc(ST(v))}</span>
<strong class="name">${esc(v.name)}</strong>
${v.plate ? `<span class="meta" style="color:var(--ink);font-weight:500">차량번호 ${esc(v.plate)}</span>` : ""}
<span class="meta">${v.year ? v.year + '년식 | ' : ''}${won(v.km)}km | ${esc(v.fuel)}</span></div>
<dl>${v.p && v.p.deposit !== undefined ? `<dt>보증금</dt><dd>${v.p.deposit ? won(Math.round(v.p.deposit / 10000)) + '만원' : '없음'}${v.p.km ? ` · 연 ${v.p.km / 10000}만km` : ''}</dd>` : `<dt>현재 차량가격</dt><dd>${v.car_value ? won(v.car_value) + '원' : '-'}</dd>`}
<dt>월 렌트료${v.p ? ` (${v.p.term}개월)` : ''}</dt><dd>${v.p ? `<strong class="price">${won(v.p.monthly)}</strong>원~` : '<span class="muted">상담</span>'}</dd></dl></a>`).join('')
    : '<p class="empty" style="grid-column:1/-1">지금 즉시출고 가능한 차량을 준비 중입니다. 1644-8891로 문의하시거나 신차장기렌트 견적을 신청해 주세요.</p>';
}
api('/api/long').then((d) => { st.list = d.vehicles; draw(); }).catch((e) => ($('#grid').innerHTML = `<p class="empty" style="grid-column:1/-1">${esc(e.message)}</p>`));
