import { api, $, initLayout, setBusy, trackConversion } from './common.js';

initLayout();

// 신차장기렌트 견적 신청 (예전 장기렌트 · 법인렌트 견적을 하나로)
//   구분: 개인 · 개인사업자 · 법인. 개인은 상호 · 사업자번호를 숨기고 '중장기 신청(person)'으로,
//   개인사업자 · 법인은 상호가 필수인 '법인 견적(corp)'으로 접수 (/api/long/applications)
const f = $('#corpForm');
function syncType() {
  const person = f.bizType.value === '개인';
  $('#companyField').hidden = person;
  $('#bizNoField').hidden = person;
  $('#nameLabel').textContent = person ? '이름' : '담당자 이름';
}
f.bizType.addEventListener('change', syncType);
syncType();

f.addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#corpMsg');
  msg.textContent = '';
  const person = f.bizType.value === '개인';
  if (!person && !f.company.value.trim()) return (msg.textContent = '법인명(상호)을 입력해 주세요.');
  if (!f.name.value.trim()) return (msg.textContent = '이름을 입력해 주세요.');
  if (f.phone.value.replace(/\D/g, '').length < 9) return (msg.textContent = '연락처를 확인해 주세요.');
  if (!f.agree.checked) return (msg.textContent = '개인정보 수집·이용에 동의해 주세요.');
  const btn = f.querySelector('button[type=submit]');
  setBusy(btn, true, '접수 중…');
  try {
    const request = `[신차 · ${f.bizType.value}] ${f.request.value}`.trim();
    const r = await api('/api/long/applications', {
      method: 'POST',
      body: {
        applicantType: person ? 'person' : 'corp',
        company: person ? '' : f.company.value, bizNo: person ? '' : f.bizNo.value,
        name: f.name.value, phone: f.phone.value, vehicleWish: f.vehicleWish.value, qty: f.qty.value,
        request, website: f.website.value, agree: true, marketing: f.marketing.checked,
      },
    });
    f.reset(); syncType();
    msg.style.color = 'var(--ink)';
    msg.textContent = `견적 요청이 접수되었습니다 (신청번호 ${r.no}). 담당자가 곧 연락드립니다.`;
    trackConversion('apply');
  } catch (err) {
    msg.style.color = '';
    msg.textContent = err.message;
  } finally {
    setBusy(btn, false);
  }
});
