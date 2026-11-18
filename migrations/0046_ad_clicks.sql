-- 광고 클릭 기록 (부정 클릭 확인용) (2026-11-18)
--   네이버 · 구글 등 광고로 들어온 방문을 IP · 시간 · 검색어별로 기록 → 관리자 '광고 클릭 기록'에서 의심 IP 확인 후
--   광고 플랫폼의 IP 차단 목록에 등록. 90일 지난 기록은 10분마다 도는 작업에서 삭제 (src/index.js scheduled)
CREATE TABLE ad_clicks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ip         TEXT NOT NULL DEFAULT '',
  source     TEXT NOT NULL DEFAULT '',   -- naver / google / kakao / 그 외 utm_source
  keyword    TEXT NOT NULL DEFAULT '',
  campaign   TEXT NOT NULL DEFAULT '',
  click_id   TEXT NOT NULL DEFAULT '',   -- gclid · NaPm 등 (같은 클릭 중복 기록 방지)
  landing    TEXT NOT NULL DEFAULT '',   -- 들어온 페이지
  referrer   TEXT NOT NULL DEFAULT '',
  ua         TEXT NOT NULL DEFAULT '',
  country    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_ad_clicks_ip ON ad_clicks(ip, created_at);
CREATE INDEX idx_ad_clicks_time ON ad_clicks(created_at);
