// 모든 고객 화면에서 쓰는 공통 기능
export async function api(path, opts = {}) {
  const init = { ...opts, headers: { ...(opts.headers || {}) } };
  if (opts.body && !(opts.body instanceof FormData)) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, init);
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error(data.error || '요청을 처리하지 못했습니다.');
  return data;
}

// 차종 이미지가 아직 없을 때 쓰는 기본 그림 (차급별)
export function classImage(cls) {
  const c = String(cls || '');
  if (/경/.test(c)) return '/assets/cars/compact.svg';
  if (/SUV|RV/i.test(c)) return '/assets/cars/suv.svg';
  if (/승합|밴/.test(c)) return '/assets/cars/van.svg';
  if (/화물|트럭/.test(c)) return '/assets/cars/truck.svg';
  return '/assets/cars/sedan.svg';
}

export const won = (n) => Number(n || 0).toLocaleString('ko-KR');
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const nl = (s) => String(s ?? '').replace(/\\n/g, '\n');

// 'YYYY-MM-DDTHH:MM' → '11/14 10:00'
export function shortDt(v) {
  if (!v) return '';
  const [d, t] = v.split('T');
  const [, m, day] = d.split('-');
  return `${+m}/${+day} ${t}`;
}

// 기본 대여 일시: 내일 10시 ~ 3일 뒤 10시
export function defaultPeriod() {
  const k = new Date(Date.now() + 9 * 3600 * 1000);
  const d1 = new Date(k.getTime() + 86400000);
  const d2 = new Date(k.getTime() + 4 * 86400000);
  const f = (d) => d.toISOString().slice(0, 10) + 'T10:00';
  return [f(d1), f(d2)];
}

let siteCache;
export async function site() {
  if (!siteCache) siteCache = api('/api/site');
  return siteCache;
}

// 머리·꼬리 공통 처리: 모바일 메뉴, 전화번호·주소 채우기
// 광고로 들어온 방문 기록 (부정 클릭 확인용 · 관리자 '광고 클릭 기록')
//   구글: gclid · gbraid · wbraid (자동 태그) / 네이버 검색광고: NaPm · n_media · n_query (추적 기능)
//   그 외: utm_medium 이 cpc · ppc · paid · ad 등이면 utm_source 를 매체로
//   같은 탭에서 같은 주소를 다시 열어도(새로고침) 한 번만 보냄
function trackAdClick() {
  try {
    const q = new URLSearchParams(location.search);
    const g = q.get('gclid') || q.get('gbraid') || q.get('wbraid');
    const naver = q.get('NaPm') || q.get('n_media') || q.get('n_query') || q.get('n_keyword');
    const medium = (q.get('utm_medium') || '').toLowerCase();
    const paid = /^(cpc|ppc|paid|ad|ads|cpm|display|sa)$/.test(medium);
    let source = '';
    if (g) source = 'google';
    else if (naver) source = 'naver';
    else if (paid) source = (q.get('utm_source') || 'other').toLowerCase();
    if (!source) return;
    const clickId = g || q.get('NaPm') || '';
    const key = 'adtrk:' + (clickId || location.search);
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1'); } catch {}
    fetch('/api/track/ad', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        source,
        keyword: q.get('n_keyword') || q.get('n_query') || q.get('utm_term') || q.get('keyword') || '',
        campaign: q.get('utm_campaign') || q.get('n_campaign_type') || q.get('n_ad_group') || '',
        clickId,
        landing: location.pathname,
        referrer: document.referrer || '',
      }),
    }).catch(() => {});
  } catch {}
}

// 헤더 메신저 버튼: 카카오톡 · 라인 · 위챗 (모바일은 로고와 메뉴 버튼 사이, PC 는 전화번호 왼쪽)
//   연결 주소(관리자 회사 정보)가 있으면 그 주소로, 없으면 라인은 line.me/ti/p/~ID, 카카오톡 · 위챗은 ID 안내 창(복사 버튼)
const MSG_ICONS = {
  kakao: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="#3C1E1E" d="M12 3.5c-5 0-9 3.2-9 7.1 0 2.5 1.6 4.7 4.1 5.9l-.8 3.1c-.1.3.2.5.5.3l3.7-2.4c.5.1 1 .1 1.5.1 5 0 9-3.2 9-7.1S17 3.5 12 3.5z"/></svg>',
  line: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="#fff" d="M12 3.6c-5 0-9.1 3.3-9.1 7.3 0 3.6 3.2 6.6 7.5 7.2.3.1.7.2.8.5.1.2.1.6 0 .9l-.1.8c0 .2-.2.9.8.5s5.5-3.3 7.5-5.6c1.4-1.5 2-3 2-4.6 0-4-4.1-7.3-9.1-7.3zM8.3 13.2H6.5c-.3 0-.5-.2-.5-.5V9.2c0-.3.2-.5.5-.5s.5.2.5.5v3h1.3c.3 0 .5.2.5.5s-.2.5-.5.5zm1.8-.5c0 .3-.2.5-.5.5s-.5-.2-.5-.5V9.2c0-.3.2-.5.5-.5s.5.2.5.5v3.5zm4.3 0c0 .2-.1.4-.3.5h-.2c-.2 0-.3-.1-.4-.2l-1.8-2.4v2.1c0 .3-.2.5-.5.5s-.5-.2-.5-.5V9.2c0-.2.1-.4.3-.5h.2c.2 0 .3.1.4.2l1.8 2.4V9.2c0-.3.2-.5.5-.5s.5.2.5.5v3.5zm2.9-2.2c.3 0 .5.2.5.5s-.2.5-.5.5h-1.3v.8h1.3c.3 0 .5.2.5.5s-.2.5-.5.5h-1.8c-.3 0-.5-.2-.5-.5V9.2c0-.3.2-.5.5-.5h1.8c.3 0 .5.2.5.5s-.2.5-.5.5h-1.3v.8h1.3z"/></svg>',
  wechat: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="#fff" d="M9.2 4.5C5.2 4.5 2 7.2 2 10.5c0 1.9 1 3.6 2.7 4.7l-.7 2.1 2.5-1.3c.9.3 1.8.4 2.7.4h.6c-.2-.6-.3-1.2-.3-1.8 0-3.3 3.1-5.9 6.9-5.9h.6c-.6-2.4-3.4-4.2-6.8-4.2zM6.8 9.3c-.5 0-.9-.4-.9-.9s.4-.9.9-.9.9.4.9.9-.4.9-.9.9zm4.8 0c-.5 0-.9-.4-.9-.9s.4-.9.9-.9.9.4.9.9-.4.9-.9.9zM22 14.6c0-2.8-2.7-5-6.1-5s-6.1 2.2-6.1 5 2.7 5 6.1 5c.7 0 1.4-.1 2.1-.3l2 1.1-.6-1.8c1.6-1 2.6-2.4 2.6-4zm-8.1-.7c-.4 0-.7-.3-.7-.7s.3-.7.7-.7.7.3.7.7-.3.7-.7.7zm4 0c-.4 0-.7-.3-.7-.7s.3-.7.7-.7.7.3.7.7-.3.7-.7.7z"/></svg>',
};
const MSG_NAMES = { kakao: '카카오톡', line: '라인', wechat: '위챗' };
function msgDialog(type, id) {
  document.getElementById('msgDlg')?.remove();
  const d = document.createElement('div');
  d.id = 'msgDlg';
  d.className = 'msg-dlg';
  d.innerHTML = `<div class="msg-dlg-box" role="dialog" aria-modal="true" aria-labelledby="msgDlgT">
<strong id="msgDlgT">${MSG_NAMES[type]} 상담</strong>
<p>${MSG_NAMES[type]} 앱에서 아래 아이디를 친구 추가해 주세요.<br><span class="small muted">${type === 'kakao' ? '카카오톡 → 친구 추가 → ID로 추가' : '위챗 → 친구 추가 → 위챗 ID 검색'}</span></p>
<div class="msg-dlg-id">${esc(id)}</div>
<div class="msg-dlg-btns"><button type="button" class="btn btn-red" data-copy>아이디 복사</button><button type="button" class="btn" data-close>닫기</button></div>
</div>`;
  document.body.appendChild(d);
  const close = () => d.remove();
  d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-close]')) close(); });
  d.querySelector('[data-copy]').addEventListener('click', async (e) => {
    try { await navigator.clipboard.writeText(id); e.target.textContent = '복사했습니다'; } catch { window.prompt('아이디를 복사하세요.', id); }
  });
  d.querySelector('[data-copy]').focus();
}
function renderMsgLinks(s) {
  const head = $('.header .wrap');
  if (!head || $('.msg-links', head)) return;
  const id = (s && s.messenger) || 'ace16448891';
  const url = {
    kakao: (s && s.kakaoUrl) || '',
    line: (s && s.lineUrl) || `https://line.me/ti/p/~${encodeURIComponent(id)}`,
    wechat: (s && s.wechatUrl) || '',
  };
  const box = document.createElement('div');
  box.className = 'msg-links';
  box.innerHTML = ['kakao', 'line', 'wechat']
    .map((t) => url[t]
      ? `<a class="msg-btn msg-${t}" href="${esc(url[t])}" target="_blank" rel="noopener" aria-label="${MSG_NAMES[t]} 상담">${MSG_ICONS[t]}</a>`
      : `<button type="button" class="msg-btn msg-${t}" data-msg="${t}" aria-label="${MSG_NAMES[t]} 상담">${MSG_ICONS[t]}</button>`)
    .join('');
  $('.logo', head).insertAdjacentElement('afterend', box);
  $$('[data-msg]', box).forEach((b) => b.addEventListener('click', () => msgDialog(b.dataset.msg, id)));
}

export async function initLayout() {
  trackAdClick();
  renderMsgLinks(null);
  const btn = $('.menu-btn');
  if (btn) btn.addEventListener('click', () => {
    const g = $('.gnb');
    g.classList.toggle('open');
    btn.setAttribute('aria-expanded', g.classList.contains('open'));
  });
  try {
    const s = await site();
    $$('[data-site="phone"]').forEach((el) => (el.textContent = s.phone));
    $$('[data-site="tel"]').forEach((el) => el.setAttribute('href', 'tel:' + String(s.phone).replace(/\D/g, '')));
    $$('[data-site="messenger"]').forEach((el) => (el.textContent = s.messenger));
    $('.msg-links')?.remove();
    renderMsgLinks(s);
    $$('[data-site="address"]').forEach((el) => (el.textContent = s.address));
    $$('[data-site="biz"]').forEach((el) => (el.textContent = s.bizNo || '393-81-01841'));
    $$('[data-site="ceo"]').forEach((el) => (el.textContent = s.ceo || '백은영'));
    return s;
  } catch {
    return null;
  }
}

export function setBusy(btn, busy, label) {
  if (!btn) return;
  if (busy) {
    btn.dataset.label = btn.textContent;
    btn.textContent = label || '처리 중…';
    btn.disabled = true;
  } else {
    btn.textContent = btn.dataset.label || btn.textContent;
    btn.disabled = false;
  }
}

// ── 입력 칸 자동 형식: 휴대폰 010-0000-0000 (숫자 11자리까지), 생년월일 1990-01-01 (숫자 8자리까지) ──
export function fmtPhone(v) {
  const d = String(v).replace(/\D/g, '').slice(0, 11);
  if (d.length < 4) return d;
  if (d.length < 8) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, d.length - 4)}-${d.slice(-4)}`;
}
export function fmtBirth(v) {
  const d = String(v).replace(/\D/g, '').slice(0, 8);
  if (d.length < 5) return d;
  if (d.length < 7) return `${d.slice(0, 4)}-${d.slice(4)}`;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
}
// 생년월일이 실제 있는 날짜인지 (1900년 이후 ~ 오늘)
export function validBirth(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || '');
  if (!m) return false;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3] && +m[1] >= 1900 && d <= new Date();
}
if (typeof document !== 'undefined' && !window.__aceMask) {
  window.__aceMask = true;
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement)) return;
    const kind = el.dataset.mask || (el.type === 'tel' ? 'phone' : '');
    if (!kind) return;
    const f = kind === 'birth' ? fmtBirth : kind === 'phone' ? fmtPhone : null;
    if (!f) return;
    const v = f(el.value);
    if (v !== el.value) el.value = v;
  });
}
