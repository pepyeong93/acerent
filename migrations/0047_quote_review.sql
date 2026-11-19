-- 견적 사용자 심사 진행 (2026-11-19)
--   견적 사용자가 발행한 견적(quote_logs)에 서류를 올리고 심사를 요청 → 관리자가 승인 / 부결
--   상태: quote 견적진행 → review 심사진행 → approved 승인 / rejected 부결
ALTER TABLE quote_logs ADD COLUMN review_status TEXT NOT NULL DEFAULT 'quote';
ALTER TABLE quote_logs ADD COLUMN review_requested_at TEXT NOT NULL DEFAULT '';
ALTER TABLE quote_logs ADD COLUMN review_decided_at TEXT NOT NULL DEFAULT '';
ALTER TABLE quote_logs ADD COLUMN review_decided_by TEXT NOT NULL DEFAULT '';
ALTER TABLE quote_logs ADD COLUMN review_note TEXT NOT NULL DEFAULT '';   -- 승인 · 부결 사유 (사용자에게 보임)
CREATE INDEX idx_quote_logs_review ON quote_logs(review_status, id);

-- 심사 서류 (운전면허증 · 운전경력증명서 · 소득증빙 · 부채증빙 · 등본 · 기타서류)
--   파일은 R2 의 private/quote-docs/ 아래에 두고, 공개 주소(/img/*)로는 열리지 않음 — 본인 · 관리자만 API 로 내려받음
CREATE TABLE quote_docs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  log_id       INTEGER NOT NULL,
  doc_type     TEXT NOT NULL,                     -- license / career / income / debt / resident / etc
  file_key     TEXT NOT NULL,
  file_name    TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL DEFAULT '',
  size         INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_quote_docs_log ON quote_docs(log_id, doc_type);

-- 관리자 알림 메일 종류에 '심사 요청' 추가 (지금 받는 종류는 그대로 두고 덧붙임)
UPDATE settings SET value = json_insert(value, '$[#]', '심사 요청')
 WHERE key = 'notify_kinds' AND json_valid(value) AND value NOT LIKE '%심사 요청%';
