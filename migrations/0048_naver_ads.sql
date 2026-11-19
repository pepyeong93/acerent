-- 네이버 검색광고 자동 관리 (2026-11-19)
--   매시간: 키워드 · 입찰가 · 성과를 네이버 검색광고 API 로 읽어 분석 → 입찰가 변경 · 중지 제안 (관리자 승인 시 바로 적용)
--   매일 오전: 전날 성과 리포트 + 아직 등록하지 않은 효과적인 키워드 추천
--   API 키는 Cloudflare 비밀값(NAVER_AD_API_KEY · NAVER_AD_SECRET · NAVER_AD_CUSTOMER_ID)에만 저장
--   설정은 settings.ads_config (JSON) — src/lib/adsEngine.js DEFAULT_CONFIG

-- 광고 계정의 키워드 목록 (매시간 새로 읽음)
CREATE TABLE ad_keywords (
  keyword_id    TEXT PRIMARY KEY,           -- nccKeywordId
  keyword       TEXT NOT NULL,
  adgroup_id    TEXT NOT NULL DEFAULT '',
  adgroup_name  TEXT NOT NULL DEFAULT '',
  campaign_id   TEXT NOT NULL DEFAULT '',
  campaign_name TEXT NOT NULL DEFAULT '',
  bid           INTEGER NOT NULL DEFAULT 0, -- 현재 입찰가 (그룹 입찰가 사용 시 그룹 값)
  use_group_bid INTEGER NOT NULL DEFAULT 0,
  paused        INTEGER NOT NULL DEFAULT 0, -- userLock 또는 그룹 · 캠페인 꺼짐
  status        TEXT NOT NULL DEFAULT '',
  first_seen    TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 키워드별 하루 성과 (날짜는 한국시간 'YYYY-MM-DD')
CREATE TABLE ad_stats_daily (
  day        TEXT NOT NULL,
  keyword_id TEXT NOT NULL,
  imp        INTEGER NOT NULL DEFAULT 0,   -- 노출수
  clk        INTEGER NOT NULL DEFAULT 0,   -- 클릭수
  cost       INTEGER NOT NULL DEFAULT 0,   -- 비용 (원, VAT 제외)
  avg_rank   REAL NOT NULL DEFAULT 0,      -- 평균 노출 순위
  conv       INTEGER NOT NULL DEFAULT 0,   -- 전환수 (프리미엄 로그분석)
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (day, keyword_id)
);

-- 변경 제안 (승인하면 바로 네이버 광고에 적용)
CREATE TABLE ad_proposals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT NOT NULL,                -- bid 입찰가 변경 / pause 키워드 중지 / add_keyword 키워드 추가 / budget 캠페인 하루 예산
  keyword_id  TEXT NOT NULL DEFAULT '',
  keyword     TEXT NOT NULL DEFAULT '',
  adgroup_id  TEXT NOT NULL DEFAULT '',
  adgroup_name TEXT NOT NULL DEFAULT '',
  campaign_id TEXT NOT NULL DEFAULT '',
  from_value  INTEGER NOT NULL DEFAULT 0,
  to_value    INTEGER NOT NULL DEFAULT 0,
  reason      TEXT NOT NULL DEFAULT '',
  data        TEXT NOT NULL DEFAULT '{}',   -- 근거 수치 (JSON)
  status      TEXT NOT NULL DEFAULT 'pending', -- pending 승인 대기 / applied 적용 완료 / rejected 거절 / failed 적용 실패 / expired 기간 지남
  result      TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at  TEXT,
  decided_by  TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_ad_proposals_status ON ad_proposals(status, id);

-- 일별 분석 리포트
CREATE TABLE ad_reports (
  day        TEXT PRIMARY KEY,              -- 분석 대상 날짜 (전날)
  summary    TEXT NOT NULL DEFAULT '{}',    -- JSON
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 실행 기록 (마지막 동기화 · 오류 확인용)
CREATE TABLE ad_runs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,                 -- hourly / daily / apply
  ok         INTEGER NOT NULL DEFAULT 1,
  message    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 알림 메일 종류에 '광고 제안' · '광고 리포트' 추가
UPDATE settings SET value = json_insert(json_insert(value, '$[#]', '광고 제안'), '$[#]', '광고 리포트')
  WHERE key = 'notify_kinds' AND json_valid(value) AND value NOT LIKE '%광고 제안%';
