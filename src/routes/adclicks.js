// 광고 클릭 기록 — 부정 클릭(같은 사람이 광고를 반복해서 눌러 광고비를 쓰게 하는 것) 확인용
//   고객 화면(common.js)이 광고 유입(gclid · NaPm · n_* · utm_medium=cpc 등)을 감지하면 POST /api/track/ad
//   관리자 '광고 클릭 기록'에서 IP별로 모아 보고, 의심 IP를 네이버 · 구글 광고의 IP 차단 목록에 넣는다.
//   (홈페이지에서 막아도 광고비는 클릭 순간 청구되므로 차단은 광고 플랫폼에서 해야 함)
import { json, readJson, cleanText, int } from '../lib/util.js';

const KEEP_DAYS = 90;

// 90일 지난 기록 삭제 (scheduled 에서 호출)
export async function purgeAdClicks(env) {
  await env.DB.prepare(`DELETE FROM ad_clicks WHERE created_at < datetime('now', ?)`).bind(`-${KEEP_DAYS} days`).run();
}

export function registerAdClicks(r) {
  // 광고 유입 기록 (고객 화면)
  r.post('/api/track/ad', async ({ env, request }) => {
    const b = await readJson(request).catch(() => ({}));
    const ip = request.headers.get('cf-connecting-ip') || '';
    const source = cleanText(b.source, 30).toLowerCase();
    if (!ip || !source) return json({ ok: true });
    const clickId = cleanText(b.clickId, 200);
    const keyword = cleanText(b.keyword, 100);
    // 같은 클릭(같은 gclid · NaPm — 새로고침 · 뒤로가기)은 한 번만,
    // 클릭 ID 가 없으면 같은 IP · 매체 · 검색어로 10초 안에 다시 온 것만 중복으로 봄
    const dup = await env.DB.prepare(
      clickId
        ? `SELECT 1 FROM ad_clicks WHERE ip = ? AND click_id = ? LIMIT 1`
        : `SELECT 1 FROM ad_clicks WHERE ip = ? AND source = ? AND keyword = ? AND created_at > datetime('now', '-10 seconds') LIMIT 1`
    ).bind(...(clickId ? [ip, clickId] : [ip, source, keyword])).first();
    if (dup) return json({ ok: true });
    await env.DB.prepare(
      `INSERT INTO ad_clicks (ip, source, keyword, campaign, click_id, landing, referrer, ua, country) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      ip, source, keyword, cleanText(b.campaign, 100), clickId, cleanText(b.landing, 300), cleanText(b.referrer, 300),
      cleanText(request.headers.get('user-agent'), 300), cleanText(request.cf && request.cf.country, 4)
    ).run();
    return json({ ok: true });
  });

  // 관리자: 기간 · 기준 횟수로 IP별 요약 + 매체별 합계
  r.get('/api/admin/ad-clicks/summary', async ({ env, url }) => {
    const days = Math.min(KEEP_DAYS, Math.max(1, int(url.searchParams.get('days')) || 7));
    const min = Math.max(1, int(url.searchParams.get('min')) || 3); // 하루 최대 클릭 수가 이 이상이면 의심
    const since = `-${days} days`;
    const [ips, bySource, total] = await Promise.all([
      env.DB.prepare(
        `WITH d AS (
           SELECT ip, date(created_at, '+9 hours') AS day, COUNT(*) AS n FROM ad_clicks WHERE created_at >= datetime('now', ?) GROUP BY ip, day
         )
         SELECT a.ip, COUNT(*) AS clicks, (SELECT MAX(n) FROM d WHERE d.ip = a.ip) AS max_day,
                (SELECT COUNT(*) FROM d WHERE d.ip = a.ip) AS days,
                MIN(a.created_at) AS first_at, MAX(a.created_at) AS last_at,
                GROUP_CONCAT(DISTINCT a.source) AS sources, GROUP_CONCAT(DISTINCT NULLIF(a.keyword, '')) AS keywords,
                MAX(a.country) AS country, MAX(a.ua) AS ua
         FROM ad_clicks a WHERE a.created_at >= datetime('now', ?)
         GROUP BY a.ip HAVING max_day >= ? ORDER BY max_day DESC, clicks DESC LIMIT 300`
      ).bind(since, since, min).all(),
      env.DB.prepare(
        `SELECT source, COUNT(*) AS clicks, COUNT(DISTINCT ip) AS ips FROM ad_clicks WHERE created_at >= datetime('now', ?) GROUP BY source ORDER BY clicks DESC`
      ).bind(since).all(),
      env.DB.prepare(`SELECT COUNT(*) AS clicks, COUNT(DISTINCT ip) AS ips FROM ad_clicks WHERE created_at >= datetime('now', ?)`).bind(since).first(),
    ]);
    return json({ days, min, total, bySource: bySource.results, ips: ips.results });
  });

  // 관리자: 최근 기록 (IP 지정 시 그 IP만)
  r.get('/api/admin/ad-clicks', async ({ env, url }) => {
    const ip = cleanText(url.searchParams.get('ip'), 60);
    const sql = `SELECT id, ip, source, keyword, campaign, landing, referrer, ua, country, created_at FROM ad_clicks ${ip ? 'WHERE ip = ?' : ''} ORDER BY id DESC LIMIT 200`;
    const st = env.DB.prepare(sql);
    const { results } = await (ip ? st.bind(ip) : st).all();
    return json({ items: results });
  });
}
