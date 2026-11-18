-- 준대형(K8 · 그랜저)은 자차 보상한도 400만원, 대형(K9) · 승합은 700만원 (2026-11-18)
UPDATE short_models SET self_ins_limit = 0 WHERE name LIKE '%K8%' OR name LIKE '%그랜저%';
UPDATE posts SET body = REPLACE(body, '자차 보상한도: 소 · 중형 400만원 / 대형 · 승합 700만원', '자차 보상한도: 경 · 소 · 중형 · 준대형 · SUV 400만원 / 대형 · 승합 700만원')
  WHERE body LIKE '%자차 보상한도: 소 · 중형 400만원%';
