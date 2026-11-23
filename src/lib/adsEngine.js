// 네이버 검색광고 자동 관리: 동기화 · 분석 · 제안 · 승인 적용 · 일별 리포트 · 새 키워드 추천
//   제안만 만들고, 실제 변경은 관리자가 승인했을 때만 (applyProposal)
//   설정: settings.ads_config (JSON) — DEFAULT_CONFIG 와 합쳐서 사용
import {
  adsEnabled, listCampaigns, listAdgroups, listKeywords, getStats, keywordTool, estimateBids,
  updateKeywordBid, pauseKeyword, addKeywords, updateCampaignBudget,
} from './naverAds.js';
import { notifyAdmins, buildMailHtml } from './mail.js';
import { createSetup, deleteCampaign, ensureSetupAds, SETUP_PLAN } from './adsSetup.js';
import { adsApi } from './naverAds.js';

export const DEFAULT_CONFIG = {
  dailyBudget: 50000,        // 하루 최대 광고비 (원) — 캠페인 하루 예산 합이 넘으면 낮추자고 제안
  maxBid: 3000,              // 키워드 최고 입찰가 (이보다 높게는 절대 제안하지 않음)
  minBid: 70,                // 네이버 최저 입찰가
  targetRank: 3,             // 전환이 나오는 키워드의 목표 평균 순위
  maxChangePct: 30,          // 한 번에 바꾸는 입찰가 폭 (%)
  wasteCost: 15000,          // 최근 7일 이 금액 이상 쓰고
  wasteClicks: 10,           //   이 클릭 이상인데 전환이 0이면 입찰가 인하 · 중지 제안
  discoveryMinVolume: 30,    // 새 키워드 추천: 월간 검색수 최소
  discoveryLimit: 15,        // 하루 추천 개수 (유입 확대를 위해 넉넉히)
  defaultAdgroupId: '',      // 새 키워드를 넣을 광고그룹 (비우면 가장 비슷한 광고그룹)
  seeds: ['인천공항 렌트카', '김포공항 렌트카', '월렌트', '한달 렌트카', '일주일 렌트카', '일산 렌트카', '고양 렌트카', '공항 렌터카', '단기렌트'],
  mustContain: ['렌트', '렌터카', '렌트카', '대여', '카셰어'],
  negatives: ['무료', '알바', '채용', '구인', '중고차', '매매', '할부', '보험료', '사고', '면허', '게임', '장난감', '자전거', '오토바이', '캠핑카', '버스', '트럭', '제주', '부산', '대구', '광주', '대전', '울산', '강릉', '여수', '해외', '괌', '오사카', '하와이'],
};

const KST = 9 * 3600 * 1000;
export const kstDay = (offsetDays = 0) => new Date(Date.now() + KST + offsetDays * 86400000).toISOString().slice(0, 10);
const kstHour = () => new Date(Date.now() + KST).getUTCHours();
const r10 = (n) => Math.round(n / 10) * 10;
const won = (n) => Number(n || 0).toLocaleString('ko-KR') + '원';

export async function loadConfig(db) {
  const row = await db.prepare(`SELECT value FROM settings WHERE key = 'ads_config'`).first();
  let saved = {};
  try { saved = JSON.parse((row && row.value) || '{}'); } catch {}
  return { ...DEFAULT_CONFIG, ...saved };
}

async function logRun(db, kind, ok, message) {
  await db.prepare('INSERT INTO ad_runs (kind, ok, message) VALUES (?, ?, ?)').bind(kind, ok ? 1 : 0, String(message || '').slice(0, 500)).run();
  await db.prepare(`DELETE FROM ad_runs WHERE created_at < datetime('now', '-30 days')`).run();
}

// ── 1. 동기화: 캠페인 → 광고그룹 → 키워드 ──
//   무료 요금제는 한 번 실행에 바깥 요청이 50개로 제한되어, 광고그룹을 한 번에 최대 GROUPS_PER_STEP 개씩 나눠 읽음
//   진행 상태는 settings.ads_sync 에 저장 → 10분마다 도는 작업이 이어서 처리. 한 바퀴가 끝나면 1시간 뒤 다시 처음부터
const GROUPS_PER_STEP = 25;
async function loadSync(db) {
  const row = await db.prepare(`SELECT value FROM settings WHERE key = 'ads_sync'`).first();
  try { return JSON.parse((row && row.value) || 'null'); } catch { return null; }
}
async function saveSync(db, st) {
  await db.prepare(`INSERT INTO settings (key, value) VALUES ('ads_sync', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(JSON.stringify(st)).run();
}
export async function syncStep(env, force = false) {
  const db = env.DB;
  let st = await loadSync(db);
  const now = Date.now();
  // 새 한 바퀴 시작: 처음이거나, 지난 바퀴가 끝난 지 50분 지났거나, 강제
  if (!st || (st.done && (force || now - (st.doneAt || 0) > 50 * 60 * 1000))) {
    const campaigns = ((await listCampaigns(env)) || []).filter((c) => !c.campaignTp || c.campaignTp === 'WEB_SITE');
    let groups = [];
    try {
      groups = (await listAdgroups(env)) || []; // 계정 전체 광고그룹 한 번에
    } catch {
      for (const c of campaigns.slice(0, 20)) groups.push(...((await listAdgroups(env, c.nccCampaignId)) || []));
    }
    const camp = Object.fromEntries(campaigns.map((c) => [c.nccCampaignId, c]));
    st = {
      startedAt: now, done: false, idx: 0,
      campaigns: campaigns.map((c) => ({ nccCampaignId: c.nccCampaignId, name: c.name, userLock: !!c.userLock, useDailyBudget: !!c.useDailyBudget, dailyBudget: c.dailyBudget || 0, campaignTp: c.campaignTp || '' })),
      groups: groups.filter((g) => camp[g.nccCampaignId]).map((g) => ({ id: g.nccAdgroupId, name: g.name || '', bid: g.bidAmt || 0, lock: g.userLock || camp[g.nccCampaignId].userLock ? 1 : 0, cid: g.nccCampaignId, cname: camp[g.nccCampaignId].name || '' })),
    };
  }
  if (st.done) return st;
  const slice = st.groups.slice(st.idx, st.idx + GROUPS_PER_STEP);
  const stmts = [];
  let processed = 0;
  for (const g of slice) {
    // 키워드가 아주 많은 광고그룹은 DB 저장 요청이 한도를 넘지 않게 한 번에 최대 약 1,500개(500개 넘으면 멈춤)까지만 처리하고 다음 실행으로 넘김
    if (stmts.length > 500) break;
    processed++;
    const kws = (await listKeywords(env, g.id)) || [];
    for (const k of kws) {
      stmts.push(db.prepare(
        `INSERT INTO ad_keywords (keyword_id, keyword, adgroup_id, adgroup_name, campaign_id, campaign_name, bid, use_group_bid, paused, status, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(keyword_id) DO UPDATE SET keyword = excluded.keyword, adgroup_id = excluded.adgroup_id, adgroup_name = excluded.adgroup_name,
           campaign_id = excluded.campaign_id, campaign_name = excluded.campaign_name, bid = excluded.bid, use_group_bid = excluded.use_group_bid,
           paused = excluded.paused, status = excluded.status, synced_at = excluded.synced_at`
      ).bind(k.nccKeywordId, k.keyword, g.id, g.name, g.cid, g.cname, k.useGroupBidAmt ? g.bid : k.bidAmt || 0, k.useGroupBidAmt ? 1 : 0, k.userLock || g.lock ? 1 : 0, k.status || ''));
    }
  }
  for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100));
  st.idx += processed;
  if (st.idx >= st.groups.length) {
    st.done = true;
    st.doneAt = Date.now();
    // 이번 바퀴에서 다시 보이지 않은 키워드(광고 계정에서 삭제됨)는 목록에서 삭제
    await db.prepare(`DELETE FROM ad_keywords WHERE synced_at < datetime(?, 'unixepoch')`).bind(Math.floor(st.startedAt / 1000) - 60).run();
  }
  await saveSync(db, st);
  return st;
}

// ── 2. 성과 수집 (하루 단위) ──
export async function collectStats(env, day) {
  const db = env.DB;
  // 꺼진 키워드는 성과가 없으므로 제외 (요청 수 한도 보호), 최대 3,000개
  const { results: kws } = await db.prepare('SELECT keyword_id FROM ad_keywords WHERE paused = 0 LIMIT 3000').all();
  if (!kws.length) return 0;
  const data = await getStats(env, kws.map((k) => k.keyword_id), day, day);
  const stmts = data.map((d) =>
    db.prepare(
      `INSERT INTO ad_stats_daily (day, keyword_id, imp, clk, cost, avg_rank, conv, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(day, keyword_id) DO UPDATE SET imp = excluded.imp, clk = excluded.clk, cost = excluded.cost, avg_rank = excluded.avg_rank, conv = excluded.conv, updated_at = excluded.updated_at`
    ).bind(day, d.id, Math.round(d.impCnt || 0), Math.round(d.clkCnt || 0), Math.round(d.salesAmt || 0), Number(d.avgRnk || 0), Math.round(d.ccnt || 0))
  );
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
  return data.length;
}

// 최근 N일 합계 (오늘 포함)
async function recentStats(db, days) {
  const since = kstDay(-(days - 1));
  const { results } = await db.prepare(
    `SELECT k.*, COALESCE(SUM(s.imp),0) imp, COALESCE(SUM(s.clk),0) clk, COALESCE(SUM(s.cost),0) cost, COALESCE(SUM(s.conv),0) conv,
            CASE WHEN SUM(s.imp) > 0 THEN SUM(s.avg_rank * s.imp) / SUM(s.imp) ELSE 0 END rank
     FROM ad_keywords k LEFT JOIN ad_stats_daily s ON s.keyword_id = k.keyword_id AND s.day >= ?
     GROUP BY k.keyword_id`
  ).bind(since).all();
  return results;
}

class Proposer {
  constructor(db) { this.db = db; this.keys = null; this.queue = []; }
  async load() {
    if (this.keys) return;
    const { results } = await this.db.prepare(`SELECT type, keyword_id, keyword FROM ad_proposals WHERE status = 'pending'`).all();
    this.keys = new Set(results.map((r) => `${r.type}|${r.keyword_id}|${r.keyword}`));
  }
  async add(p) {
    await this.load();
    const key = `${p.type}|${p.keyword_id || ''}|${p.keyword || ''}`;
    if (this.keys.has(key)) return false;
    this.keys.add(key);
    this.queue.push(this.db.prepare(
      `INSERT INTO ad_proposals (type, keyword_id, keyword, adgroup_id, adgroup_name, campaign_id, from_value, to_value, reason, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(p.type, p.keyword_id || '', p.keyword || '', p.adgroup_id || '', p.adgroup_name || '', p.campaign_id || '', p.from_value || 0, p.to_value || 0, p.reason, JSON.stringify(p.data || {})));
    return true;
  }
  async flush() {
    for (let i = 0; i < this.queue.length; i += 80) await this.db.batch(this.queue.slice(i, i + 80));
    this.queue = [];
  }
}

// ── 3. 입찰가 분석 → 제안 ──
export async function analyzeBids(env, cfg, pr) {
  const db = env.DB;
  await db.prepare(`UPDATE ad_proposals SET status = 'expired' WHERE status = 'pending' AND type IN ('bid','pause') AND created_at < datetime('now', '-24 hours')`).run();
  const rows = (await recentStats(db, 7)).filter((k) => !k.paused);
  const step = Math.max(5, Math.min(50, cfg.maxChangePct)) / 100;
  const made = [];
  const add = async (k, type, to, reason, data) => {
    if (type === 'bid') {
      to = Math.max(cfg.minBid, Math.min(cfg.maxBid, r10(to)));
      if (to === k.bid) return;
    }
    const ok = await pr.add({ type, keyword_id: k.keyword_id, keyword: k.keyword, adgroup_id: k.adgroup_id, adgroup_name: k.adgroup_name, campaign_id: k.campaign_id, from_value: k.bid, to_value: type === 'bid' ? to : 0, reason, data });
    if (ok) made.push({ type, keyword: k.keyword, from: k.bid, to, reason });
  };
  const today = await db.prepare('SELECT COALESCE(SUM(cost),0) c FROM ad_stats_daily WHERE day = ?').bind(kstDay()).first();
  const budgetRoom = today.c < cfg.dailyBudget * 0.6; // 오늘 예산 60% 미만 사용 → 유입 늘릴 여유 있음
  const noImpKeys = [];
  for (const k of rows) {
    const d = { imp7: k.imp, clk7: k.clk, cost7: k.cost, conv7: k.conv, rank7: Math.round(k.rank * 10) / 10 };
    const cpa = k.conv ? Math.round(k.cost / k.conv) : 0;
    if (k.conv > 0 && k.rank > cfg.targetRank && k.bid < cfg.maxBid) {
      await add(k, 'bid', k.bid * (1 + step), `최근 7일 전환 ${k.conv}건(전환당 ${won(cpa)})인데 평균 ${d.rank7}위 → 목표 ${cfg.targetRank}위 안으로 입찰가 인상`, d);
    } else if (k.conv === 0 && k.clk >= cfg.wasteClicks && k.cost >= cfg.wasteCost) {
      if (k.bid <= cfg.minBid * 2) await add(k, 'pause', 0, `최근 7일 클릭 ${k.clk}회 · 비용 ${won(k.cost)} 썼지만 전환 0건, 입찰가도 이미 낮음 → 키워드 중지`, d);
      else await add(k, 'bid', k.bid * (1 - step), `최근 7일 클릭 ${k.clk}회 · 비용 ${won(k.cost)} 썼지만 전환 0건 → 입찰가 인하`, d);
    } else if (k.conv > 0 && k.rank > 0 && k.rank <= 1.5 && k.bid > cfg.minBid * 3) {
      await add(k, 'bid', k.bid * (1 - step / 2), `평균 ${d.rank7}위로 1위권 유지 중(전환 ${k.conv}건) → 순위는 지키면서 비용 절감을 위해 소폭 인하`, d);
    } else if (budgetRoom && k.imp >= 20 && k.rank > 5 && k.bid < cfg.maxBid && !(k.clk >= cfg.wasteClicks && k.cost >= cfg.wasteCost)) {
      await add(k, 'bid', k.bid * (1 + step), `최근 7일 노출 ${k.imp}회인데 평균 ${d.rank7}위로 순위가 낮아 클릭이 적음(${k.clk}회) → 유입을 늘리려 입찰가 인상 (오늘 예산 여유 있음)`, d);
    } else if (k.imp === 0) {
      const age = (Date.now() - Date.parse(String(k.first_seen).replace(' ', 'T') + 'Z')) / 86400000;
      if (age >= 2) noImpKeys.push({ k, d });
    }
  }
  // 노출이 없는 키워드: 5위 예상 입찰가로 올리자고 제안
  if (noImpKeys.length) {
    let est = {};
    try { est = await estimateBids(env, noImpKeys.map((x) => x.k.keyword), 5); } catch {}
    const unreachable = [];
    for (const { k, d } of noImpKeys) {
      const e = est[k.keyword];
      // 5위 예상 입찰가가 최고 입찰가보다 비싸면 올려도 닿지 않음 → 인상 제안 대신 '경쟁이 비싸 노출 어려움'으로 기록 (일별 리포트에 표시)
      if (e && e > cfg.maxBid) unreachable.push({ keyword: k.keyword, adgroup_name: k.adgroup_name, bid: k.bid, estimate5: e });
      else if (e && e > k.bid) await add(k, 'bid', Math.min(e, k.bid * (1 + step * 2)), `최근 7일 노출 0회 → 모바일 5위 예상 입찰가 ${won(e)} 쪽으로 인상`, { ...d, estimate5: e });
    }
    await db.prepare(`INSERT INTO settings (key, value) VALUES ('ads_unreachable', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .bind(JSON.stringify({ checkedAt: new Date().toISOString(), items: unreachable })).run();
  }
  // 하루 예산 속도: 오후 3시 전에 하루 예산의 80%를 넘게 쓰면 전환 없는 고비용 키워드 인하
  if (today.c >= cfg.dailyBudget * 0.8 && kstHour() < 15) {
    const top = rows.filter((k) => k.conv === 0 && k.cost > 0).sort((a, b) => b.cost - a.cost).slice(0, 3);
    for (const k of top) await add(k, 'bid', k.bid * (1 - step), `오늘 오후 3시 전에 이미 ${won(today.c)} 사용(하루 한도 ${won(cfg.dailyBudget)}의 80% 이상) → 전환 없는 고비용 키워드 인하`, { today: today.c });
  }
  return made;
}

// 캠페인 하루 예산이 한도보다 크면 낮추자고 제안
async function checkBudgets(env, cfg, campaigns, pr) {
  const made = [];
  const live = campaigns.filter((c) => !c.userLock && (!c.campaignTp || c.campaignTp === 'WEB_SITE'));
  for (const c of live) {
    const b = c.useDailyBudget ? c.dailyBudget : 0;
    if (!c.useDailyBudget || b > cfg.dailyBudget) {
      const ok = await pr.add({
        type: 'budget', keyword_id: c.nccCampaignId, keyword: c.name, campaign_id: c.nccCampaignId, from_value: b, to_value: cfg.dailyBudget,
        reason: c.useDailyBudget ? `캠페인 하루 예산 ${won(b)}이 설정한 한도 ${won(cfg.dailyBudget)}보다 큼` : `캠페인 하루 예산이 '제한 없음' → 한도 ${won(cfg.dailyBudget)}로 제한`,
      });
      if (ok) made.push({ type: 'budget', keyword: c.name, from: b, to: cfg.dailyBudget });
    }
  }
  return made;
}

// ── 4. 새 키워드 추천 ──
export async function discoverKeywords(env, cfg, pr) {
  const db = env.DB;
  const { results: mine } = await db.prepare('SELECT keyword, adgroup_id, adgroup_name, campaign_id FROM ad_keywords').all();
  const { results: proposed } = await db.prepare(`SELECT keyword FROM ad_proposals WHERE type = 'add_keyword' AND status IN ('pending','rejected') AND created_at > datetime('now', '-30 days')`).all();
  const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
  const exist = new Set([...mine.map((x) => norm(x.keyword)), ...proposed.map((x) => norm(x.keyword))]);
  const vol = (v) => (typeof v === 'number' ? v : parseInt(String(v).replace(/[^\d]/g, ''), 10) || 5);
  const cands = new Map();
  for (let i = 0; i < cfg.seeds.length; i += 5) {
    let list = [];
    try { list = await keywordTool(env, cfg.seeds.slice(i, i + 5)); } catch { continue; }
    for (const x of list) {
      const kw = String(x.relKeyword || '').trim();
      const n = norm(kw);
      if (!kw || exist.has(n) || cands.has(n)) continue;
      if (!cfg.mustContain.some((t) => n.includes(norm(t)))) continue;
      if (cfg.negatives.some((t) => n.includes(norm(t)))) continue;
      const total = vol(x.monthlyPcQcCnt) + vol(x.monthlyMobileQcCnt);
      if (total < cfg.discoveryMinVolume) continue;
      cands.set(n, { keyword: kw, pc: vol(x.monthlyPcQcCnt), mobile: vol(x.monthlyMobileQcCnt), total, comp: x.compIdx || '', depth: x.plAvgDepth || 0 });
    }
  }
  const top = [...cands.values()].sort((a, b) => b.total - a.total).slice(0, cfg.discoveryLimit);
  if (!top.length) return [];
  let est = {};
  try { est = await estimateBids(env, top.map((x) => x.keyword), 5); } catch {}
  // 넣을 광고그룹: 설정값 → 단어가 가장 많이 겹치는 광고그룹
  const groups = [];
  for (const m of mine) if (!groups.find((g) => g.adgroup_id === m.adgroup_id)) groups.push({ ...m, words: [] });
  for (const m of mine) groups.find((g) => g.adgroup_id === m.adgroup_id).words.push(norm(m.keyword));
  const pick = (kw) => {
    if (cfg.defaultAdgroupId) return groups.find((g) => g.adgroup_id === cfg.defaultAdgroupId) || { adgroup_id: cfg.defaultAdgroupId, adgroup_name: '' };
    const n = norm(kw);
    let best = null, score = -1;
    for (const g of groups) {
      const s = g.words.reduce((a, w) => a + [...new Set(w.match(/.{2}/g) || [])].filter((bi) => n.includes(bi)).length, 0) / Math.max(1, g.words.length);
      if (s > score) { score = s; best = g; }
    }
    return best;
  };
  const made = [];
  for (const c of top) {
    if (est[c.keyword] && est[c.keyword] > cfg.maxBid) continue; // 5위 예상가가 최고 입찰가보다 비싼 키워드는 추가해도 노출이 어려워 추천하지 않음
    const g = pick(c.keyword);
    if (!g) continue;
    const bid = Math.max(cfg.minBid, Math.min(cfg.maxBid, r10(est[c.keyword] || Math.min(cfg.maxBid, 500))));
    const ok = await pr.add({
      type: 'add_keyword', keyword: c.keyword, adgroup_id: g.adgroup_id, adgroup_name: g.adgroup_name, campaign_id: g.campaign_id || '', to_value: bid,
      reason: `월간 검색 ${c.total.toLocaleString('ko-KR')}회(모바일 ${c.mobile.toLocaleString('ko-KR')}) · 경쟁 ${c.comp || '-'} · 아직 등록되지 않은 키워드 → '${g.adgroup_name || g.adgroup_id}' 광고그룹에 모바일 5위 예상 입찰가 ${won(bid)}로 추가`,
      data: c,
    });
    if (ok) made.push({ type: 'add_keyword', keyword: c.keyword, to: bid });
  }
  return made;
}

// ── 5. 승인 → 바로 적용 ──
export async function applyProposal(env, id, adminName) {
  if (!adsEnabled(env)) throw new Error('네이버 광고 API 키가 아직 연결되지 않았습니다.'); // 키 없으면 제안 상태는 그대로 둠
  const db = env.DB;
  const p = await db.prepare('SELECT * FROM ad_proposals WHERE id = ?').bind(id).first();
  if (!p) throw new Error('제안을 찾을 수 없습니다.');
  if (p.status !== 'pending') throw new Error('이미 처리된 제안입니다.');
  const cfg = await loadConfig(db);
  try {
    if (p.type === 'bid') {
      if (p.to_value > cfg.maxBid) throw new Error(`최고 입찰가 ${cfg.maxBid}원을 넘어 적용하지 않았습니다.`);
      await updateKeywordBid(env, p, p.to_value);
      await db.prepare('UPDATE ad_keywords SET bid = ?, use_group_bid = 0 WHERE keyword_id = ?').bind(p.to_value, p.keyword_id).run();
    } else if (p.type === 'pause') {
      await pauseKeyword(env, p, true);
      await db.prepare('UPDATE ad_keywords SET paused = 1 WHERE keyword_id = ?').bind(p.keyword_id).run();
    } else if (p.type === 'add_keyword') {
      await addKeywords(env, p.adgroup_id, [{ keyword: p.keyword, bid: Math.min(p.to_value, cfg.maxBid) }]);
    } else if (p.type === 'delete_campaign') {
      await deleteCampaign(env, p.campaign_id);
      await db.prepare('DELETE FROM ad_keywords WHERE campaign_id = ?').bind(p.campaign_id).run();
      await db.prepare(`DELETE FROM settings WHERE key = 'ads_sync'`).run(); // 다음 실행에서 처음부터 다시 동기화
    } else if (p.type === 'setup' || p.type === 'setup_fix') {
      const msg = p.type === 'setup' ? await createSetup(env) : await ensureSetupAds(env);
      await db.prepare(`DELETE FROM settings WHERE key = 'ads_sync'`).run();
      await db.prepare(`UPDATE ad_proposals SET status = 'applied', result = ?, decided_at = datetime('now'), decided_by = ? WHERE id = ?`).bind(msg.slice(0, 300), adminName || '', id).run();
      await logRun(db, 'apply', true, `#${id} setup ${msg}`);
      return { ok: true, message: msg };
    } else if (p.type === 'budget') {
      const camp = ((await listCampaigns(env)) || []).find((c) => c.nccCampaignId === p.campaign_id); // 캠페인 목록 1회
      if (!camp) throw new Error('캠페인을 찾을 수 없습니다.');
      await updateCampaignBudget(env, camp, p.to_value);
    } else throw new Error('알 수 없는 제안 종류입니다.');
    await db.prepare(`UPDATE ad_proposals SET status = 'applied', result = '적용 완료', decided_at = datetime('now'), decided_by = ? WHERE id = ?`).bind(adminName || '', id).run();
    await logRun(db, 'apply', true, `#${id} ${p.type} ${p.keyword}`);
    return { ok: true };
  } catch (e) {
    await db.prepare(`UPDATE ad_proposals SET status = 'failed', result = ?, decided_at = datetime('now'), decided_by = ? WHERE id = ?`).bind(String(e.message || e).slice(0, 300), adminName || '', id).run();
    await logRun(db, 'apply', false, `#${id} ${e.message || e}`);
    throw e;
  }
}

const TYPE_NAME = { bid: '입찰가 변경', pause: '키워드 중지', add_keyword: '새 키워드 추가', budget: '캠페인 하루 예산', delete_campaign: '캠페인 삭제', setup: '새 캠페인 만들기', setup_fix: '빠진 광고 문구 채우기' };
function proposalMail(made) {
  return made.map((m) => [TYPE_NAME[m.type] || m.type, `${m.keyword}${m.type === 'bid' ? ` : ${won(m.from)} → ${won(m.to)}` : m.type === 'add_keyword' ? ` (입찰가 ${won(m.to)})` : m.type === 'budget' ? ` : ${won(m.from)} → ${won(m.to)}` : ''}`]);
}

// ── 광고 검수 상태: 우리 캠페인의 광고마다 검수 결과를 읽어 저장, 모두 통과하면(캠페인이 꺼져 있으면) 한 번 알림 ──
const INSPECT = { APPROVED: '검수 통과', UNDER_REVIEW: '검수 중', PENDING: '검수 대기', REJECTED: '검수 반려', LIMITED: '일부 제한' };
export async function checkReview(env, campaigns) {
  const db = env.DB;
  const camp = (campaigns || []).find((c) => c.name === SETUP_PLAN.campaign.name);
  if (!camp) return null;
  const { results: groups } = await db.prepare('SELECT DISTINCT adgroup_id, adgroup_name FROM ad_keywords WHERE campaign_id = ?').bind(camp.nccCampaignId).all();
  const ads = [];
  for (const g of groups.slice(0, 10)) {
    const list = (await adsApi(env, 'GET', '/ncc/ads', { query: { nccAdgroupId: g.adgroup_id } })) || [];
    for (const a of list) ads.push({ group: g.adgroup_name, inspect: a.inspectStatus || '', label: INSPECT[a.inspectStatus] || a.inspectStatus || '-', status: a.status || '', reason: a.statusReason || '' });
  }
  const row = await db.prepare(`SELECT value FROM settings WHERE key = 'ads_review'`).first();
  let prev = {};
  try { prev = JSON.parse((row && row.value) || '{}'); } catch {}
  const allApproved = ads.length > 0 && ads.every((a) => a.inspect === 'APPROVED');
  const rejected = ads.filter((a) => a.inspect === 'REJECTED');
  const rv = { checkedAt: new Date().toISOString(), campaignOn: !camp.userLock, ads, allApproved, notifiedApproved: prev.notifiedApproved || false, notifiedRejected: prev.notifiedRejected || '' };
  if (allApproved && camp.userLock && !rv.notifiedApproved) {
    rv.notifiedApproved = true;
    await notifyAdmins(env, { kind: '광고 제안', refNo: '', subject: '[네이버 광고] 광고 검수 통과 · 캠페인을 켤 수 있습니다', html: buildMailHtml({ title: '네이버 광고 검수 완료', linkUrl: 'https://www.acerentcar.co.kr/admin/#ads', linkText: '관리자 화면 보기', intro: `캠페인 '${camp.name}'의 광고 ${ads.length}개가 모두 검수를 통과했습니다. 네이버 광고시스템에서 캠페인을 켜면 광고가 나가기 시작합니다.`, rows: ads.map((a) => [a.group, a.label]) }) }).catch(() => {});
  }
  const rejKey = rejected.map((a) => a.group).join(',');
  if (rejected.length && rejKey !== rv.notifiedRejected) {
    rv.notifiedRejected = rejKey;
    await notifyAdmins(env, { kind: '광고 제안', refNo: '', subject: `[네이버 광고] 광고 검수 반려 ${rejected.length}건`, html: buildMailHtml({ title: '네이버 광고 검수 반려', linkUrl: 'https://www.acerentcar.co.kr/admin/#ads', linkText: '관리자 화면 보기', intro: '검수에서 반려된 광고가 있습니다. 문구를 고쳐야 합니다.', rows: rejected.map((a) => [a.group, a.reason || a.label]) }) }).catch(() => {});
  }
  await db.prepare(`INSERT INTO settings (key, value) VALUES ('ads_review', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(JSON.stringify(rv)).run();
  return rv;
}

// ── 매시간 ──
//   동기화가 아직 한 바퀴 안 끝났으면 이어서 동기화만 (다음 실행에서 분석)
export async function runHourly(env, { forceSync = false } = {}) {
  if (!adsEnabled(env)) return { skipped: true };
  const db = env.DB;
  try {
    const cfg = await loadConfig(db);
    const st = await syncStep(env, forceSync);
    if (!st.done) {
      await logRun(db, 'hourly', true, `키워드 불러오는 중 (광고그룹 ${st.idx}/${st.groups.length})`);
      return { ok: true, syncing: true, progress: `${st.idx}/${st.groups.length}` };
    }
    await collectStats(env, kstDay());
    if (kstHour() < 3) await collectStats(env, kstDay(-1)); // 자정 직후엔 전날 마무리
    const pr = new Proposer(db);
    const made = [...(await analyzeBids(env, cfg, pr)), ...(await checkBudgets(env, cfg, st.campaigns, pr))];
    await pr.flush();
    await checkReview(env, st.campaigns).catch(() => {});
    const kw = await db.prepare('SELECT COUNT(*) n FROM ad_keywords').first();
    await logRun(db, 'hourly', true, `키워드 ${kw.n}개 · 새 제안 ${made.length}건`);
    if (made.length) {
      await notifyAdmins(env, {
        kind: '광고 제안', refNo: '',
        subject: `[네이버 광고] 승인 대기 제안 ${made.length}건`,
        html: buildMailHtml({ title: '네이버 광고 승인 대기 제안', linkUrl: 'https://www.acerentcar.co.kr/admin/#ads', linkText: '관리자 화면에서 승인하기', intro: '네이버 광고 변경 제안이 있습니다. 관리자 화면 > 네이버 광고에서 승인하면 바로 적용됩니다.', rows: proposalMail(made) }),
      }).catch(() => {});
    }
    return { ok: true, keywords: kw.n, proposals: made.length };
  } catch (e) {
    await logRun(db, 'hourly', false, e.message || e);
    return { ok: false, error: String(e.message || e) };
  }
}

// ── 매일 (전날 리포트 + 새 키워드 추천) ──
export async function runDaily(env) {
  if (!adsEnabled(env)) return { skipped: true };
  const db = env.DB;
  const day = kstDay(-1);
  try {
    const cfg = await loadConfig(db);
    await collectStats(env, day);
    const { results: rows } = await db.prepare(
      `SELECT k.keyword, k.adgroup_name, k.bid, s.imp, s.clk, s.cost, s.avg_rank, s.conv FROM ad_stats_daily s JOIN ad_keywords k ON k.keyword_id = s.keyword_id WHERE s.day = ? ORDER BY s.cost DESC`
    ).bind(day).all();
    const tot = rows.reduce((a, r) => ({ imp: a.imp + r.imp, clk: a.clk + r.clk, cost: a.cost + r.cost, conv: a.conv + r.conv }), { imp: 0, clk: 0, cost: 0, conv: 0 });
    const prev = await db.prepare('SELECT COALESCE(SUM(imp),0) imp, COALESCE(SUM(clk),0) clk, COALESCE(SUM(cost),0) cost, COALESCE(SUM(conv),0) conv FROM ad_stats_daily WHERE day = ?').bind(kstDay(-2)).first();
    const best = rows.filter((r) => r.conv > 0).sort((a, b) => b.conv - a.conv || a.cost - b.cost).slice(0, 5);
    const waste = rows.filter((r) => r.conv === 0 && r.cost > 0).slice(0, 5);
    const pr = new Proposer(db);
    const found = await discoverKeywords(env, cfg, pr);
    await pr.flush();
    let unreachable = [];
    try { unreachable = (JSON.parse(((await db.prepare(`SELECT value FROM settings WHERE key = 'ads_unreachable'`).first()) || {}).value || '{}').items) || []; } catch {}
    const summary = {
      day, total: tot, prev, unreachable,
      ctr: tot.imp ? Math.round((tot.clk / tot.imp) * 10000) / 100 : 0,
      cpc: tot.clk ? Math.round(tot.cost / tot.clk) : 0,
      cpa: tot.conv ? Math.round(tot.cost / tot.conv) : 0,
      budgetUse: Math.round((tot.cost / cfg.dailyBudget) * 100),
      best, waste, newKeywords: found,
      keywords: rows.slice(0, 50),
    };
    await db.prepare(`INSERT INTO ad_reports (day, summary) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET summary = excluded.summary, created_at = datetime('now')`).bind(day, JSON.stringify(summary)).run();
    await logRun(db, 'daily', true, `${day} 리포트 · 새 키워드 추천 ${found.length}건`);
    await notifyAdmins(env, {
      kind: '광고 리포트', refNo: day,
      subject: `[네이버 광고] ${day} 성과 · 비용 ${won(tot.cost)} · 전환 ${tot.conv}건`,
      html: buildMailHtml({
        title: `네이버 광고 일별 리포트 · ${day}`, linkUrl: 'https://www.acerentcar.co.kr/admin/#ads', linkText: '관리자 화면에서 자세히 보기',
        intro: `${day} 네이버 광고 성과입니다. 자세한 내용과 추천 키워드는 관리자 화면 > 네이버 광고에서 확인하세요.`,
        rows: [
          ['노출 · 클릭', `${tot.imp.toLocaleString('ko-KR')}회 · ${tot.clk.toLocaleString('ko-KR')}회 (클릭률 ${summary.ctr}%)`],
          ['비용', `${won(tot.cost)} (하루 한도의 ${summary.budgetUse}%, 클릭당 ${won(summary.cpc)})`],
          ['전환', `${tot.conv}건${tot.conv ? ` (전환당 ${won(summary.cpa)})` : ''}`],
          ['성과 좋은 키워드', best.map((r) => `${r.keyword}(전환 ${r.conv})`).join(', ') || '-'],
          ['비용만 쓴 키워드', waste.map((r) => `${r.keyword}(${won(r.cost)})`).join(', ') || '-'],
          ['새 키워드 추천', found.map((r) => r.keyword).join(', ') || '-'],
          ['경쟁이 비싸 노출 어려운 키워드', unreachable.map((r) => `${r.keyword}(5위 ${won(r.estimate5)})`).join(', ') || '-'],
        ],
      }),
    }).catch(() => {});
    return { ok: true, day, newKeywords: found.length };
  } catch (e) {
    await logRun(db, 'daily', false, e.message || e);
    return { ok: false, error: String(e.message || e) };
  }
}

// 10분마다 도는 작업에서 호출: 동기화 진행 중이면 이어서 · 매시 정각 무렵 분석 · 한국시간 오전 9시 무렵 리포트
export async function adsScheduled(env, when = new Date()) {
  if (!adsEnabled(env)) return;
  const m = when.getUTCMinutes();
  const h = (when.getUTCHours() + 9) % 24;
  if (m < 10) {
    if (h === 9) await runDaily(env);
    await runHourly(env);
    return;
  }
  const st = await loadSync(env.DB);
  if (st && !st.done) await runHourly(env);
}
