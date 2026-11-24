import { api, $, $$, esc, won, shortDt, defaultPeriod, initLayout, setBusy, classImage, validBirth, trackConversion } from './common.js';

const qs = new URLSearchParams(location.search);
// 주단위렌트(?days=7) · 월렌트(?days=30) 메뉴 · 광고
const qDays = parseInt(qs.get('days'), 10);
const daysMode = qDays > 0 && qDays <= 60 ? qDays : 0;
// 월 · 주단위는 공항보다 집 근처 인수가 많아 장소 기본값을 '경기도지역'(4)으로
const initLoc = qs.get('loc') || (daysMode ? '4' : '');
const [df, dt] = defaultPeriod();
const initFrom = qs.get('from') || df;
let initTo = qs.get('to') || dt;
if (daysMode && !qs.get('to')) {
  const d = new Date(initFrom.slice(0, 10) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + daysMode);
  initTo = d.toISOString().slice(0, 10) + initFrom.slice(10);
}
// 장소가 정해져 있으면(광고 도착 주소) 사이트 정보와 동시에 차량 조회를 시작 — 첫 목록이 빨리 뜨게
const searchUrl = (from, to, loc) => `/api/short/search?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&location=${loc}`;
let prefetch = initLoc ? { url: searchUrl(initFrom, initTo, initLoc), p: api(searchUrl(initFrom, initTo, initLoc)) } : null;
if (prefetch) prefetch.p.catch(() => {});

const site = await initLayout();
const st = { models: [], days: 0, hours: 0, periodText: '', cls: '전체', modelId: null, insId: null };
const locs = ((site && site.locations) || []).filter((l) => l.can_pickup);
const ins = (site && site.insurance) || [];
if (site && site.driverNote) $('#driverNote').textContent = site.driverNote;

$('#loc').innerHTML = locs.length
  ? locs.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('')
  : '<option value="">예약 장소 준비 중</option>';
if (initLoc && locs.some((l) => String(l.id) === initLoc)) $('#loc').value = initLoc;
// 딜리버리 지역(서울 등)은 탁송비 별도 안내
const locNote = () => { const l = locs.find((x) => String(x.id) === $('#loc').value); $('#locNote').hidden = !(l && l.type === '딜리버리'); };
locNote();
$('#loc').addEventListener('change', locNote);
$('#from').value = initFrom;
$('#to').value = initTo;
// 주단위 · 월렌트: 제목 · 메뉴 표시를 바꿈
const modeName = daysMode === 7 ? '주단위렌트' : daysMode === 30 ? '월렌트' : daysMode ? `${daysMode}일 렌트` : '';
if (daysMode) {
  $('#pageTitle').textContent = `${modeName} 실시간 예약`;
  $('#crumb').innerHTML = `홈 &gt; ${esc(modeName)} &gt; 실시간 예약`;
  document.title = `${modeName} 실시간 예약 | 에이스렌터카`;
  const cur = $(`.gnb a[href="/short.html?days=${daysMode}"]`);
  if (cur) {
    $$('.gnb a').forEach((a) => { a.classList.remove('on'); a.removeAttribute('aria-current'); });
    cur.classList.add('on');
    cur.setAttribute('aria-current', 'page');
  }
}
$('#from').min = df.slice(0, 10) + 'T00:00';

// 첫 화면 안내: 어떤 광고 · 메뉴로 들어왔는지(월 · 주단위 / 장소)에 맞춰 가격 · 조건을 보여 줌
// 가격은 조회 결과의 가장 싼 차 기준으로 채움 (요금표가 바뀌어도 자동으로 맞음)
function promo() {
  const l = loc();
  const cheapest = st.models.reduce((a, m) => (!a || m.rent < a.rent ? m : a), null);
  const price = cheapest ? `${won(cheapest.rent)}원` : '';
  const km = cheapest && cheapest.kmText ? cheapest.kmText.split(' (')[0] : '';
  // 일반 단기: '하루 N원부터' (차종 요금표의 1일 요금 중 최저)
  const day1 = st.models.map((m) => (m.samples ? m.samples[0][1] : m.tiers[0])).filter((v) => v > 0);
  const dayPrice = day1.length ? `하루 ${won(Math.min(...day1))}원` : '';
  let title, items;
  if (daysMode === 30 || daysMode === 7) {
    const unit = daysMode === 30 ? '한 달' : '일주일';
    title = price ? `${modeName} ${unit} <span class="nw"><em>${price}</em>부터</span>` : `${modeName} (${daysMode}일)`;
    items = [km && `주행 ${km} 포함`, '자차보험 포함', '예약금 없이 신청', '전화 · 카톡 상담 가능'];
  } else if (l && l.type === '공항') {
    title = `${esc(l.name.replace(/ 제\dT?터미널/, ''))} 렌트카${dayPrice ? ` <span class="nw"><em>${dayPrice}</em>부터</span>` : ''}`;
    items = [`${esc(l.name)} 인수 · 반납`, l.hours === '24시간' ? '24시간 운영' : '', '자차보험 포함', '예약금 없이 신청'];
  } else if (l && String(l.id) === '4') {
    title = `고양 · 일산 렌트카${dayPrice ? ` <span class="nw"><em>${dayPrice}</em>부터</span>` : ''}`;
    items = ['일산 대화동 본사', l.hours === '24시간' ? '24시간 상담' : '', '자차보험 포함', '예약금 없이 신청'];
  } else {
    title = dayPrice ? `<span class="nw"><em>${dayPrice}</em>부터</span>` : '';
    items = ['자차보험 포함', '예약금 없이 신청', '전화 · 카톡 상담 가능'];
  }
  $('#promo').hidden = !title;
  if (title) $('#promo').innerHTML = `<strong>${title}</strong><ul>${items.filter(Boolean).map((t) => `<li>${t}</li>`).join('')}</ul>`;
}

// 모바일: 입력칸 대신 한 줄 요약 (변경을 누르면 펼침)
function searchSum() {
  const l = loc();
  $('#searchSumText').textContent = `${l ? l.name : ''} · ${shortDt($('#from').value)} ~ ${shortDt($('#to').value)}${st.periodText ? ` · ${st.periodText}` : ''}`;
}
$('#searchEdit').addEventListener('click', () => {
  const open = $('#searchForm').classList.toggle('folded') === false;
  $('#searchEdit').textContent = open ? '접기' : '변경';
});

// 보험 선택지 (기본: 두 번째 = 일반 자차)
st.insId = ins.length > 1 ? ins[1].id : ins[0] ? ins[0].id : null;
$('#insBox').insertAdjacentHTML(
  'beforeend',
  ins
    .map(
      (i) => `<label class="check"><input type="radio" name="ins" value="${i.id}" ${i.id === st.insId ? 'checked' : ''}><span class="ins-name" data-id="${i.id}">${esc(i.name)}</span><span class="p">${insPriceText(i)}</span></label>`
    )
    .join('')
);
$$('input[name=ins]').forEach((r) => r.addEventListener('change', () => { st.insId = +r.value; summary(); }));
$$('input[name=opt]').forEach((r) => r.addEventListener('change', summary));

// 보험 요금 표시: 정액은 '+20,000원', 1일 요금은 '1일 N원'
function insPriceText(i) {
  const parts = [];
  if (i.per_day) parts.push(`1일 ${won(i.per_day)}원`);
  if (i.flat_fee) parts.push(`+${won(i.flat_fee)}원`);
  return parts.join(' ') || '0원';
}

const loc = () => locs.find((l) => String(l.id) === $('#loc').value);
const model = () => st.models.find((m) => m.id === st.modelId);
const insCur = () => ins.find((i) => i.id === st.insId);
// 차종별 자차 한도 (예: 카니발 700만원) — 보험 이름의 '자차한도 N만원'을 바꿔 보여 줌
const insName = (i) => { const lim = model()?.insLimit || 0; return lim > 0 ? i.name.replace(/자차한도\s*[\d,]+\s*만원/, `자차한도 ${lim}만원`) : i.name; };

let timer;
['loc', 'from', 'to'].forEach((id) => $('#' + id).addEventListener('change', () => { clearTimeout(timer); timer = setTimeout(search, 150); }));
$('#searchForm').addEventListener('submit', (e) => { e.preventDefault(); search(); });

async function search() {
  const from = $('#from').value, to = $('#to').value;
  if (!from || !to) return;
  // 조회 중에는 '0대' 대신 '…' (0대가 먼저 보이면 차가 없는 줄 알고 나가는 경우가 있음)
  $('#availCount').textContent = '…';
  $('#carList').innerHTML = '<p class="loading">예약 가능한 차량을 확인하고 있습니다…</p>';
  searchSum();
  try {
    const url = searchUrl(from, to, $('#loc').value);
    const r = prefetch && prefetch.url === url ? await prefetch.p : await api(url);
    prefetch = null;
    st.models = r.models;
    st.days = r.days;
    st.hours = r.hours || 0;
    st.periodText = r.periodText || `${r.days}일`;
    if (!model()) st.modelId = null;
    $('#period').textContent = `총 ${st.periodText}`;
    $('#soldOut').innerHTML = r.soldOut.length ? `<strong style="color:var(--ink)">예약 마감</strong> &nbsp; ${r.soldOut.map((n) => `<span style="text-decoration:line-through">${esc(n)}</span>`).join(' &nbsp; ')}` : '';
    history.replaceState(null, '', `?loc=${$('#loc').value}&from=${from}&to=${to}${daysMode ? `&days=${daysMode}` : ''}`);
    render();
    promo();
    searchSum();
  } catch (e) {
    prefetch = null;
    st.models = [];
    promo();
    $('#period').textContent = '-';
    $('#carList').innerHTML = `<p class="empty">${esc(e.message)}</p>`;
    $('#availCount').textContent = '0';
    summary();
  }
}

function render() {
  const classes = ['전체', ...new Set(st.models.map((m) => m.class).filter(Boolean))];
  if (!classes.includes(st.cls)) st.cls = '전체';
  $('#classTabs').innerHTML = classes.map((c) => `<button type="button" class="${c === st.cls ? 'on' : ''}" aria-pressed="${c === st.cls}" data-c="${esc(c)}">${esc(c)}</button>`).join('');
  $$('#classTabs button').forEach((b) => b.addEventListener('click', () => { st.cls = b.dataset.c; render(); }));
  const list = st.models.filter((m) => st.cls === '전체' || m.class === st.cls);
  $('#availCount').textContent = list.reduce((s, m) => s + m.left, 0);
  $('#carList').innerHTML = list.length
    ? list
        .map(
          (m) => `<article class="car-row ${st.modelId && m.id !== st.modelId ? 'other' : ''}">
<div class="photo"><img src="${esc(m.image || classImage(m.class))}" alt="${esc(m.maker + ' ' + m.name)}" loading="lazy" style="object-fit:contain;background:#fff"></div>
<div class="info"><span class="small muted">${[m.class, m.fuel, m.seats ? m.seats + '인승' : ''].filter(Boolean).map(esc).join(' · ')}</span><strong style="font-size:18px">${esc(m.maker)} ${esc(m.name)}</strong>
${m.features ? `<span class="small muted">${esc(m.features)}</span>` : ''}<span class="small muted">${m.samples ? `대여료 ${m.samples.map(([d, v]) => `${d}일 ${won(v)}`).join(' · ')}` : `1일 요금 1~2일 ${won(m.tiers[0])} · 3~4일 ${won(m.tiers[1])} · 5~6일 ${won(m.tiers[2])} · 7일째부터 ${won(m.tiers[3])}`}</span>${m.kmText ? `<span class="small" style="font-weight:700">${esc(m.planName)} 주행 가능 거리 ${esc(m.kmText)}</span>` : ''}<span class="small red" style="font-weight:700">잔여 ${m.left}대</span></div>
<div class="pay"><span class="small muted">${esc(m.rentLabel || `${st.periodText} 대여료`)}</span><strong>${won(m.rent)}원</strong>
<button type="button" class="btn ${m.id === st.modelId ? 'btn-red' : ''} btn-block" style="height:42px;margin-top:8px" data-id="${m.id}" aria-pressed="${m.id === st.modelId}">${m.id === st.modelId ? '선택됨' : '선택'}</button></div>
</article>`
        )
        .join('') + (st.modelId ? '<div class="show-all" style="justify-content:center;padding:14px 0"><button type="button" class="btn" id="showAll" style="height:42px">다른 차량 보기</button></div>' : '')
    : '<p class="empty">선택하신 기간에 예약 가능한 차량이 없습니다. 날짜를 바꾸거나 1644-8891로 문의해 주세요.</p>';
  $$('#carList button[data-id]').forEach((b) => b.addEventListener('click', () => {
    st.modelId = +b.dataset.id;
    render();
    // 차량번호는 고르지 않음 (차종만 선택 → 서버가 빈 차량 자동 배정)
    if (innerWidth < 760) $('.summary').scrollIntoView({ behavior: 'smooth' });
  }));
  // 모바일에서는 고른 차만 보여 줌 (화면 폭 760px 이하, CSS 로 처리)
  $('#carList').classList.toggle('picked', !!model());
  $('#showAll')?.addEventListener('click', () => { st.modelId = null; render(); $('#carList').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  summary();
}

function amounts() {
  const m = model(), i = insCur(), l = loc();
  const rent = m ? m.rent : 0;
  const insAmt = i ? i.per_day * st.days + (i.flat_fee || 0) : 0;
  // 배회차비는 서버가 대여료(rent)에 포함해서 내려줌 — 따로 더하지 않음
  return { rent, insAmt, total: rent + insAmt };
}

function summary() {
  const m = model();
  $('#noCar').hidden = !!m;
  $('#sumBody').hidden = !m;
  if (!m) return;
  const a = amounts();
  $$('.ins-name').forEach((el) => { const i = ins.find((x) => String(x.id) === el.dataset.id); if (i) el.textContent = insName(i); });
  $('#sumCar').textContent = `${m.maker} ${m.name}`;
  $('#sumPeriod').textContent = `${shortDt($('#from').value)} ~ ${shortDt($('#to').value)} · ${st.periodText}`;
  $('#sumRent').textContent = won(a.rent) + '원';
  $('#sumIns').textContent = won(a.insAmt) + '원';
  $('#sumTotal').textContent = won(a.total) + '원';
  $('#sumKmT').hidden = $('#sumKm').hidden = !m.kmText;
  $('#sumKm').textContent = m.kmText || '';
}

function step(n) {
  $('#stepSelect').hidden = n !== 1;
  $('#stepInfo').hidden = n !== 2;
  $('#stepDone').hidden = n !== 3;
  ['#st1', '#st2', '#st3'].forEach((s, i) => $(s).classList.toggle('on', i === n - 1));
  $('.searchbar').style.display = n === 1 ? '' : 'none';
  $('#searchSum').style.display = n === 1 ? '' : 'none';
  $('#promo').parentElement.style.display = n === 1 ? '' : 'none';
  scrollTo({ top: 0, behavior: 'smooth' });
}

$('#goInfo').addEventListener('click', () => {
  const m = model(), a = amounts(), i = insCur();
  const opts = $$('input[name=opt]:checked').map((x) => x.value);
  $('#cCar').textContent = `${m.maker} ${m.name}`;
  $('#cLoc').textContent = loc() ? loc().name : '';
  $('#cPeriod').textContent = `${$('#from').value.replace('T', ' ')} ~ ${$('#to').value.replace('T', ' ')} (${st.periodText})`;
  $('#cIns').textContent = [i ? insName(i) : '', ...opts].filter(Boolean).join(' · ');
  $('#cTotal').textContent = won(a.total) + '원';
  $('#cKmRow').hidden = !m.kmText;
  $('#cKm').textContent = m.kmText ? `${m.planName} ${m.kmText}` : '';
  step(2);
});
$('#backSelect').addEventListener('click', () => step(1));

$('#submitRes').addEventListener('click', async () => {
  const f = $('#infoForm');
  const err = $('#infoErr');
  err.textContent = '';
  if (!f.name.value.trim()) return (err.textContent = '이름을 입력해 주세요.'), f.name.focus();
  if (!/^01\d{9}$/.test(f.phone.value.replace(/\D/g, ''))) return (err.textContent = '휴대폰 번호 11자리를 입력해 주세요. (예: 010-1234-5678)'), f.phone.focus();
  if (f.birth.value && !validBirth(f.birth.value)) return (err.textContent = '생년월일 8자리를 입력해 주세요. (예: 1990-01-01)'), f.birth.focus();
  if (!$('#agree1').checked || !$('#agree2').checked) return (err.textContent = '필수 확인 항목에 체크해 주세요.');
  const btn = $('#submitRes');
  setBusy(btn, true, '접수 중…');
  try {
    const r = await api('/api/short/reservations', {
      method: 'POST',
      body: {
        locationId: +$('#loc').value, pickupAt: $('#from').value, returnAt: $('#to').value, modelId: st.modelId, insuranceId: st.insId,
        options: $$('input[name=opt]:checked').map((x) => x.value),
        name: f.name.value, phone: f.phone.value, birth: f.birth.value, license: f.license.value, flight: f.flight.value, request: f.request.value,
        website: f.website.value, agree: true, marketing: $('#agree3').checked,
      },
    });
    $('#dNo').textContent = r.no;
    $('#dCar').textContent = r.model;
    $('#dPeriod').textContent = `${r.location} · ${r.pickupAt.replace('T', ' ')} ~ ${r.returnAt.replace('T', ' ')} (${r.periodText || r.days + '일'})`;
    $('#dTotal').textContent = won(r.total) + '원';
    step(3);
    trackConversion('reserve', r.total);
  } catch (e) {
    err.textContent = e.message;
    if (/마감/.test(e.message)) setTimeout(() => { step(1); search(); }, 1500);
  } finally {
    setBusy(btn, false);
  }
});

search();
