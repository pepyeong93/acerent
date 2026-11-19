// 메인 첫 화면 팝업: 보유 차량 소개 (24~25년식 신형급 기아 차량)
//   '오늘 하루 보지 않기' 를 누르면 그날(한국시간)은 다시 안 뜸 — 브라우저에만 기록
//   차종 · 문구를 바꾸려면 아래 CARS · 문구를 고치면 됨

const CARS = [
  { name: '레이', cls: '경차', img: '/assets/models/ray.png' },
  { name: '더뉴 K3', cls: '준중형', img: '/assets/models/k3.png' },
  { name: '더뉴 K5', cls: '중형', img: '/assets/models/k5.png' },
  { name: 'K8', cls: '준대형', img: '/assets/models/k8.png' },
  { name: '셀토스', cls: 'SUV', img: '/assets/models/seltos.png' },
  { name: '스포티지', cls: 'SUV', img: '/assets/models/sportage.png' },
  { name: '쏘렌토', cls: 'SUV', img: '/assets/models/sorento.png' },
  { name: '카니발', cls: '승합 9인승', img: '/assets/models/carnival.png' },
];

const KEY = 'ace_popup_hide';
const today = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

const CSS = `
.pp-wrap { position: fixed; inset: 0; z-index: 200; background: rgba(0,0,0,.55); display: flex; align-items: center; justify-content: center; padding: 16px; }
.pp { background: #fff; width: 100%; max-width: 560px; max-height: 92vh; overflow: auto; display: flex; flex-direction: column; }
.pp-head { background: #C8102E; color: #fff; padding: 26px 26px 22px; position: relative; }
.pp-tag { display: inline-block; border: 1px solid rgba(255,255,255,.7); font-size: 13px; font-weight: 700; padding: 3px 10px; letter-spacing: .5px; }
.pp-head h2 { margin: 12px 0 0; font-size: 26px; line-height: 1.35; letter-spacing: -.5px; color: #fff; }
.pp-head h2 em { font-style: normal; background: #fff; color: #C8102E; padding: 0 6px; }
.pp-head p { margin: 8px 0 0; font-size: 14px; line-height: 1.6; opacity: .95; }
.pp-x { position: absolute; right: 12px; top: 12px; width: 36px; height: 36px; border: 0; background: transparent; color: #fff; font-size: 26px; line-height: 1; cursor: pointer; }
.pp-points { display: grid; grid-template-columns: repeat(3, 1fr); border-bottom: 1px solid var(--line, #ddd); }
.pp-points div { padding: 14px 8px; text-align: center; border-right: 1px solid var(--line, #ddd); }
.pp-points div:last-child { border-right: 0; }
.pp-points strong { display: block; font-size: 17px; color: #111; }
.pp-points span { font-size: 12px; color: #777; }
.pp-cars { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; padding: 16px; }
.pp-car { display: flex; flex-direction: column; align-items: center; gap: 2px; border: 1px solid var(--line, #ddd); padding: 8px 4px 10px; color: inherit; }
.pp-car:hover { border-color: #C8102E; }
.pp-car img { width: 100%; aspect-ratio: 4 / 3; object-fit: contain; }
.pp-car strong { font-size: 14px; }
.pp-car span { font-size: 11px; color: #888; }
.pp-cta { padding: 0 16px 16px; }
.pp-cta a { display: flex; align-items: center; justify-content: center; height: 50px; background: #111; color: #fff; font-size: 16px; font-weight: 700; }
.pp-foot { display: flex; border-top: 1px solid var(--line, #ddd); }
.pp-foot button { flex: 1; height: 46px; border: 0; background: #f5f5f5; font-size: 14px; cursor: pointer; color: #444; }
.pp-foot button + button { border-left: 1px solid var(--line, #ddd); background: #fff; color: #111; font-weight: 700; }
@media (max-width: 480px) {
  .pp-head { padding: 22px 18px 18px; }
  .pp-head h2 { font-size: 21px; }
  .pp-cars { grid-template-columns: repeat(4, 1fr); gap: 6px; padding: 12px; }
  .pp-car strong { font-size: 12px; }
  .pp-car span { font-size: 10px; }
  .pp-points strong { font-size: 15px; }
}`;

export function showCarPopup() {
  try { if (localStorage.getItem(KEY) === today()) return; } catch {}
  if (document.getElementById('ppWrap')) return;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const w = document.createElement('div');
  w.id = 'ppWrap';
  w.className = 'pp-wrap';
  w.innerHTML = `<div class="pp" role="dialog" aria-modal="true" aria-labelledby="ppTitle">
<div class="pp-head">
<span class="pp-tag">에이스렌터카 보유 차량</span>
<h2 id="ppTitle">전 차량 <em>24~25년식</em><br>신형급 기아 차량으로 모십니다</h2>
<p>주행거리가 짧은 최신 연식 차량을 깨끗하게 관리해서 출고합니다.</p>
<button type="button" class="pp-x" aria-label="닫기" data-pp-close>×</button>
</div>
<div class="pp-points">
<div><strong>24~25년식</strong><span>최신 연식</span></div>
<div><strong>짧은 주행거리</strong><span>컨디션 좋은 차량</span></div>
<div><strong>깨끗한 차량</strong><span>세차 후 출고</span></div>
</div>
<div class="pp-cars">${CARS.map((c) => `<a class="pp-car" href="/short.html"><img src="${c.img}" alt="기아 ${c.name}"><strong>${c.name}</strong><span>${c.cls}</span></a>`).join('')}</div>
<div class="pp-cta"><a href="/short.html">실시간 예약 가능한 차량 보기</a></div>
<div class="pp-foot"><button type="button" data-pp-today>오늘 하루 보지 않기</button><button type="button" data-pp-close>닫기</button></div>
</div>`;
  document.body.appendChild(w);
  const close = () => { w.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  w.addEventListener('click', (e) => {
    if (e.target === w || e.target.closest('[data-pp-close]')) close();
    if (e.target.closest('[data-pp-today]')) { try { localStorage.setItem(KEY, today()); } catch {} close(); }
  });
  w.querySelector('[data-pp-close]').focus();
}
