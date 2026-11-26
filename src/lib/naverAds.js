// 네이버 검색광고 API (https://api.searchad.naver.com)
//   인증: X-Timestamp · X-API-KEY(엑세스라이선스) · X-Customer(고객 ID) · X-Signature
//   서명 = Base64( HMAC-SHA256( 비밀키, "{timestamp}.{METHOD}.{경로}" ) ) — 경로는 쿼리 제외
//   키는 Cloudflare 비밀값으로만: NAVER_AD_API_KEY · NAVER_AD_SECRET · NAVER_AD_CUSTOMER_ID (코드 · DB · GitHub 에 넣지 않음)

const BASE = 'https://api.searchad.naver.com';
const enc = new TextEncoder();

export function adsEnabled(env) {
  return !!(env.NAVER_AD_API_KEY && env.NAVER_AD_SECRET && env.NAVER_AD_CUSTOMER_ID);
}

async function signature(secret, message) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
  let bin = '';
  for (const b of sig) bin += String.fromCharCode(b);
  return btoa(bin);
}

export async function adsApi(env, method, path, { query, body } = {}) {
  if (!adsEnabled(env)) throw new Error('네이버 광고 API 키가 설정되지 않았습니다.');
  const ts = String(Date.now());
  const sig = await signature(env.NAVER_AD_SECRET, `${ts}.${method}.${path}`);
  const qs = query ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString() : '';
  const res = await fetch(BASE + path + qs, {
    method,
    headers: {
      'X-Timestamp': ts,
      'X-API-KEY': env.NAVER_AD_API_KEY,
      'X-Customer': String(env.NAVER_AD_CUSTOMER_ID),
      'X-Signature': sig,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try { const j = JSON.parse(text); msg = j.title || j.message || j.detail || text; } catch {}
    throw new Error(`네이버 광고 API 오류 ${res.status}: ${String(msg).slice(0, 200)}`);
  }
  return text ? JSON.parse(text) : null;
}

// ── 조회 ──
export const listCampaigns = (env) => adsApi(env, 'GET', '/ncc/campaigns');
export const listAdgroups = (env, campaignId) => adsApi(env, 'GET', '/ncc/adgroups', { query: { nccCampaignId: campaignId } });
export const listKeywords = (env, adgroupId) => adsApi(env, 'GET', '/ncc/keywords', { query: { nccAdgroupId: adgroupId } });

// 성과: ids 최대 100개씩. 날짜는 'YYYY-MM-DD' (한국시간)
export const STAT_FIELDS = ['impCnt', 'clkCnt', 'salesAmt', 'avgRnk', 'ccnt'];
export async function getStats(env, ids, since, until) {
  const out = [];
  for (let i = 0; i < ids.length; i += 100) {
    const r = await adsApi(env, 'GET', '/stats', {
      query: { ids: ids.slice(i, i + 100).join(','), fields: JSON.stringify(STAT_FIELDS), timeRange: JSON.stringify({ since, until }) },
    });
    out.push(...((r && r.data) || []));
  }
  return out;
}

// 연관 키워드 (힌트 최대 5개) → [{ relKeyword, monthlyPcQcCnt, monthlyMobileQcCnt, compIdx, plAvgDepth, ... }]
export async function keywordTool(env, hints) {
  const r = await adsApi(env, 'GET', '/keywordstool', { query: { hintKeywords: hints.slice(0, 5).join(','), showDetail: 1 } });
  return (r && r.keywordList) || [];
}

// 원하는 평균 순위에 필요한 예상 입찰가 → { 키워드: 입찰가 }
export async function estimateBids(env, keywords, position, device = 'MOBILE') {
  if (!keywords.length) return {};
  const r = await adsApi(env, 'POST', '/estimate/average-position-bid/keyword', {
    body: { device, items: keywords.slice(0, 100).map((key) => ({ key, position })) },
  });
  const map = {};
  for (const e of (r && r.estimate) || []) map[e.keyword] = e.bid;
  return map;
}

// ── 변경 ──
export const updateKeywordBid = (env, kw, bid) =>
  adsApi(env, 'PUT', `/ncc/keywords/${kw.keyword_id}`, {
    query: { fields: 'bidAmt' },
    body: { nccKeywordId: kw.keyword_id, nccAdgroupId: kw.adgroup_id, bidAmt: bid, useGroupBidAmt: false },
  });
export const pauseKeyword = (env, kw, paused = true) =>
  adsApi(env, 'PUT', `/ncc/keywords/${kw.keyword_id}`, {
    query: { fields: 'userLock' },
    body: { nccKeywordId: kw.keyword_id, nccAdgroupId: kw.adgroup_id, userLock: paused },
  });
export const addKeywords = (env, adgroupId, items) =>
  adsApi(env, 'POST', '/ncc/keywords', {
    query: { nccAdgroupId: adgroupId },
    body: items.map((x) => ({ nccAdgroupId: adgroupId, keyword: String(x.keyword).replace(/s+/g, ''), bidAmt: x.bid, useGroupBidAmt: false })), // 띄어쓰기 없이
  });
export const updateCampaignBudget = (env, campaign, dailyBudget) =>
  adsApi(env, 'PUT', `/ncc/campaigns/${campaign.nccCampaignId}`, {
    query: { fields: 'budget' },
    body: { ...campaign, useDailyBudget: true, dailyBudget },
  });
