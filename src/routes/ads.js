// 관리자: 네이버 광고 자동 관리 (/api/admin/ads/*, 로그인 필요)
import { json, readJson, bad, int } from '../lib/util.js';
import { adsEnabled } from '../lib/naverAds.js';
import { loadConfig, DEFAULT_CONFIG, runHourly, runDaily, applyProposal, kstDay } from '../lib/adsEngine.js';

const numKeys = ['dailyBudget', 'maxBid', 'minBid', 'targetRank', 'maxChangePct', 'wasteCost', 'wasteClicks', 'discoveryMinVolume', 'discoveryLimit'];
const listKeys = ['seeds', 'mustContain', 'negatives'];

export function registerAds(r) {
  // 상태: 연결 여부 · 설정 · 오늘 비용 · 승인 대기 · 최근 실행
  r.get('/api/admin/ads/status', async ({ env }) => {
    const db = env.DB;
    const [cfg, today, pending, runs, kwCount] = await Promise.all([
      loadConfig(db),
      db.prepare('SELECT COALESCE(SUM(imp),0) imp, COALESCE(SUM(clk),0) clk, COALESCE(SUM(cost),0) cost, COALESCE(SUM(conv),0) conv FROM ad_stats_daily WHERE day = ?').bind(kstDay()).first(),
      db.prepare(`SELECT COUNT(*) n FROM ad_proposals WHERE status = 'pending'`).first(),
      db.prepare('SELECT kind, ok, message, created_at FROM ad_runs ORDER BY id DESC LIMIT 10').all(),
      db.prepare('SELECT COUNT(*) n, SUM(paused = 0) live FROM ad_keywords').first(),
    ]);
    return json({ enabled: adsEnabled(env), config: cfg, today, pending: pending.n, runs: runs.results, keywords: kwCount });
  });

  // 지금 바로 분석 / 리포트
  r.post('/api/admin/ads/run', async ({ env, request }) => {
    if (!adsEnabled(env)) throw bad('네이버 광고 API 키가 아직 연결되지 않았습니다.');
    const b = await readJson(request).catch(() => ({}));
    const res = b.what === 'daily' ? await runDaily(env) : await runHourly(env);
    if (res && res.ok === false) throw bad(res.error);
    return json(res);
  });

  // 제안 목록
  r.get('/api/admin/ads/proposals', async ({ env, url }) => {
    const st = url.searchParams.get('status') || 'pending';
    const sql = st === 'all'
      ? 'SELECT * FROM ad_proposals ORDER BY id DESC LIMIT 200'
      : st === 'done' ? `SELECT * FROM ad_proposals WHERE status != 'pending' ORDER BY id DESC LIMIT 200` : `SELECT * FROM ad_proposals WHERE status = 'pending' ORDER BY id DESC`;
    const { results } = await env.DB.prepare(sql).all();
    return json({ items: results.map((x) => ({ ...x, data: safe(x.data) })) });
  });

  // 승인 → 바로 적용 / 거절
  r.post('/api/admin/ads/proposals/:id/approve', async ({ env, params, admin }) => {
    try {
      return json(await applyProposal(env, int(params.id), admin && (admin.name || admin.username)));
    } catch (e) {
      throw bad(String(e.message || e));
    }
  });
  r.post('/api/admin/ads/proposals/:id/reject', async ({ env, params, admin }) => {
    await env.DB.prepare(`UPDATE ad_proposals SET status = 'rejected', decided_at = datetime('now'), decided_by = ? WHERE id = ? AND status = 'pending'`)
      .bind((admin && (admin.name || admin.username)) || '', int(params.id)).run();
    return json({ ok: true });
  });

  // 키워드 현황 (최근 7일)
  r.get('/api/admin/ads/keywords', async ({ env }) => {
    const since = kstDay(-6);
    const { results } = await env.DB.prepare(
      `SELECT k.keyword_id, k.keyword, k.adgroup_name, k.campaign_name, k.bid, k.paused,
              COALESCE(SUM(s.imp),0) imp, COALESCE(SUM(s.clk),0) clk, COALESCE(SUM(s.cost),0) cost, COALESCE(SUM(s.conv),0) conv,
              CASE WHEN SUM(s.imp) > 0 THEN ROUND(SUM(s.avg_rank * s.imp) / SUM(s.imp), 1) ELSE 0 END rank
       FROM ad_keywords k LEFT JOIN ad_stats_daily s ON s.keyword_id = k.keyword_id AND s.day >= ?
       GROUP BY k.keyword_id ORDER BY cost DESC, imp DESC`
    ).bind(since).all();
    return json({ items: results });
  });

  // 일별 리포트
  r.get('/api/admin/ads/reports', async ({ env }) => {
    const { results } = await env.DB.prepare('SELECT day, summary, created_at FROM ad_reports ORDER BY day DESC LIMIT 30').all();
    return json({ items: results.map((x) => ({ ...x, summary: safe(x.summary) })) });
  });

  // 설정 저장
  r.put('/api/admin/ads/config', async ({ env, request }) => {
    const b = await readJson(request);
    const cur = await loadConfig(env.DB);
    const next = { ...cur };
    for (const k of numKeys) if (b[k] !== undefined) next[k] = Math.max(0, int(b[k], DEFAULT_CONFIG[k]));
    for (const k of listKeys) if (b[k] !== undefined) next[k] = String(Array.isArray(b[k]) ? b[k].join(',') : b[k]).split(/[,\n]/).map((x) => x.trim()).filter(Boolean).slice(0, 100);
    if (b.defaultAdgroupId !== undefined) next.defaultAdgroupId = String(b.defaultAdgroupId || '').trim().slice(0, 60);
    if (next.maxBid < next.minBid) throw bad('최고 입찰가가 최저 입찰가보다 낮습니다.');
    await env.DB.prepare(`INSERT INTO settings (key, value) VALUES ('ads_config', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(JSON.stringify(next)).run();
    return json({ ok: true, config: next });
  });
}

function safe(s) {
  try { return JSON.parse(s || '{}'); } catch { return {}; }
}
