// 네이버 검색광고 새 캠페인 구성 (2026-11-19 사장님 확인)
//   관리자 '네이버 광고' 승인 대기의 '새 캠페인 만들기' 제안을 승인하면 createSetup() 이 실행됨
//   캠페인은 꺼진 상태(userLock)로 만들어, 광고 검수 · 최종 확인 후 켬
//   광고 문구에는 가운뎃점(·) 같은 특수문자를 쓸 수 없음 (네이버: 한글 · 영문 · 일부 특수문자만)
import { adsApi } from './naverAds.js';

const SITE = 'https://www.acerentcar.co.kr';
export const SETUP_PLAN = {
  campaign: { name: '에이스렌터카_파워링크', dailyBudget: 50000 },
  negatives: ['무료', '중고차', '매매', '알바', '채용', '구인', '제주', '부산', '대구', '광주', '해외', '캠핑카'],
  groups: [
    {
      name: '인천공항', url: `${SITE}/short?loc=1`, bid: 800,
      keywords: [['인천공항 렌트카', 1000], ['인천공항 렌터카', 1000], ['인천공항렌트카', 900], ['인천공항 렌트카 가격', 800], ['인천공항 렌트카 추천', 800], ['인천공항 1터미널 렌트카', 800], ['인천공항 2터미널 렌트카', 800], ['영종도 렌트카', 700]],
      ad: { headline: '인천공항 렌트카 에이스', description: '자차보험 포함, 배회차비 0원. 신형급 기아 차량, 예약금 없이 실시간 예약' },
    },
    {
      name: '김포공항', url: `${SITE}/short?loc=3`, bid: 700,
      keywords: [['김포공항 렌트카', 900], ['김포공항 렌터카', 900], ['김포공항렌트카', 800], ['김포공항 렌트카 가격', 700], ['김포 렌트카', 700]],
      ad: { headline: '김포공항 렌트카 에이스', description: '자차보험 포함, 배회차비 0원. 김포공항 인도, 예약금 없이 실시간 예약' },
    },
    {
      name: '월렌트', url: `${SITE}/short?days=30`, bid: 600,
      keywords: [['월렌트', 800], ['월렌트카', 800], ['한달 렌트카', 800], ['한달렌트카', 700], ['한달 렌트 가격', 700], ['월렌트 가격', 700], ['월렌트 저렴한곳', 600], ['레이 월렌트', 600], ['SUV 월렌트', 600]],
      ad: { headline: '월렌트 에이스렌터카', description: '레이 월 60만원부터, 자차보험 포함 확정가. 공항, 일산 인도' },
    },
    {
      name: '주단위', url: `${SITE}/short?days=7`, bid: 500,
      keywords: [['일주일 렌트카', 700], ['일주일 렌트', 600], ['주단위 렌트', 600], ['7일 렌트카', 600], ['일주일 렌트카 가격', 500]],
      ad: { headline: '주단위 렌트 에이스', description: '레이 7일 32만원부터, 자차보험 포함. 인천, 김포공항 인도' },
    },
    {
      name: '일산·고양', url: `${SITE}/short?loc=4`, bid: 500,
      keywords: [['일산 렌트카', 500], ['고양 렌트카', 500], ['일산 렌터카', 500], ['화정 렌트카', 500], ['대화동 렌트카', 500]],
      ad: { headline: '일산 렌트카 에이스', description: '자차보험 포함, 일산 본점 인도. 신형급 기아 차량, 예약금 없이 실시간 예약' },
    },
  ],
};

// 홈페이지(사이트) 비즈채널 찾기
async function siteChannelId(env) {
  const list = (await adsApi(env, 'GET', '/ncc/channels')) || [];
  const site = list.find((c) => c.channelTp === 'SITE' && /acerentcar\.co\.kr/i.test(String(c.channelKey || c.name || '')));
  if (!site) throw new Error('네이버 광고에 www.acerentcar.co.kr 사이트(비즈채널)가 등록돼 있지 않습니다. 광고시스템 > 정보 관리 > 비즈채널 관리에서 먼저 등록해 주세요.');
  return site.nccBusinessChannelId;
}

// 새 캠페인 · 광고그룹 · 키워드 · 광고 · 제외 키워드 만들기 → 결과 요약 문자열
export async function createSetup(env, plan = SETUP_PLAN) {
  const notes = [];
  const channel = await siteChannelId(env);
  const camp = await adsApi(env, 'POST', '/ncc/campaigns', {
    body: { customerId: Number(env.NAVER_AD_CUSTOMER_ID), campaignTp: 'WEB_SITE', name: plan.campaign.name, useDailyBudget: true, dailyBudget: plan.campaign.dailyBudget, userLock: true },
  });
  const cid = camp.nccCampaignId;
  let kwCount = 0;
  for (const g of plan.groups) {
    try {
      const grp = await adsApi(env, 'POST', '/ncc/adgroups', {
        body: { nccCampaignId: cid, name: g.name, pcChannelId: channel, mobileChannelId: channel, bidAmt: g.bid, useDailyBudget: false, adgroupType: 'WEB_SITE' },
      });
      const gid = grp.nccAdgroupId;
      const kws = await adsApi(env, 'POST', '/ncc/keywords', {
        query: { nccAdgroupId: gid },
        body: g.keywords.map(([keyword, bid]) => ({ nccAdgroupId: gid, keyword, bidAmt: bid, useGroupBidAmt: false })),
      });
      kwCount += (kws || []).length;
      await adsApi(env, 'POST', '/ncc/ads', {
        body: { nccAdgroupId: gid, type: 'TEXT_45', ad: { headline: g.ad.headline, description: g.ad.description, pc: { final: g.url }, mobile: { final: g.url } } },
      });
      try {
        await adsApi(env, 'POST', `/ncc/adgroups/${gid}/restricted-keywords`, {
          body: plan.negatives.map((keyword) => ({ nccAdgroupId: gid, keyword, type: 'KEYWORD_PLUS_RESTRICT' })),
        });
      } catch (e) {
        notes.push(`${g.name} 제외 키워드 등록 실패(광고시스템에서 직접 등록 필요): ${String(e.message || e).slice(0, 80)}`);
      }
    } catch (e) {
      notes.push(`${g.name} 광고그룹 만들기 실패: ${String(e.message || e).slice(0, 120)}`);
    }
  }
  return `캠페인 '${plan.campaign.name}' 생성(꺼진 상태) · 광고그룹 ${plan.groups.length}개 · 키워드 ${kwCount}개${notes.length ? ' / ' + notes.join(' / ') : ''}`;
}

export const deleteCampaign = (env, campaignId) => adsApi(env, 'DELETE', `/ncc/campaigns/${campaignId}`);

// 빠진 광고 · 제외 키워드 채우기: 캠페인의 광고그룹마다 광고가 없으면 만들고, 제외 키워드가 없으면 등록
export async function ensureSetupAds(env, plan = SETUP_PLAN) {
  const camps = (await adsApi(env, 'GET', '/ncc/campaigns')) || [];
  const camp = camps.find((c) => c.name === plan.campaign.name);
  if (!camp) throw new Error(`캠페인 '${plan.campaign.name}'을 찾을 수 없습니다.`);
  const groups = (await adsApi(env, 'GET', '/ncc/adgroups', { query: { nccCampaignId: camp.nccCampaignId } })) || [];
  const done = [], notes = [];
  for (const g of plan.groups) {
    const grp = groups.find((x) => x.name === g.name);
    if (!grp) { notes.push(`${g.name} 광고그룹 없음`); continue; }
    try {
      const ads = (await adsApi(env, 'GET', '/ncc/ads', { query: { nccAdgroupId: grp.nccAdgroupId } })) || [];
      if (!ads.length) {
        await adsApi(env, 'POST', '/ncc/ads', {
          body: { nccAdgroupId: grp.nccAdgroupId, type: 'TEXT_45', ad: { headline: g.ad.headline, description: g.ad.description, pc: { final: g.url }, mobile: { final: g.url } } },
        });
        done.push(`${g.name} 광고`);
      }
    } catch (e) { notes.push(`${g.name} 광고 실패: ${String(e.message || e).slice(0, 80)}`); }
    try {
      const neg = (await adsApi(env, 'GET', `/ncc/adgroups/${grp.nccAdgroupId}/restricted-keywords`)) || [];
      if (!neg.length) {
        await adsApi(env, 'POST', `/ncc/adgroups/${grp.nccAdgroupId}/restricted-keywords`, {
          body: plan.negatives.map((keyword) => ({ nccAdgroupId: grp.nccAdgroupId, keyword, type: 'KEYWORD_PLUS_RESTRICT' })),
        });
        done.push(`${g.name} 제외 키워드`);
      }
    } catch (e) { notes.push(`${g.name} 제외 키워드 실패: ${String(e.message || e).slice(0, 80)}`); }
  }
  return `채움: ${done.join(', ') || '없음(이미 모두 있음)'}${notes.length ? ' / ' + notes.join(' / ') : ''}`;
}
