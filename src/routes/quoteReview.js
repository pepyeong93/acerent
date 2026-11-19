// 견적 심사 진행
//  - /api/quote/my/*           : 견적 사용자 본인이 발행한 견적 목록 · 상세, 심사 서류 올리기 · 지우기 · 보기, 심사 요청
//  - /api/admin/quote-docs/*   : 관리자 서류 보기
//  - /api/admin/quote-logs/:id/decide : 관리자 승인 · 부결 (· 되돌리기)
// 상태(quote_logs.review_status): quote 견적진행 → review 심사진행 → approved 승인 / rejected 부결
// 서류 파일은 R2 private/quote-docs/ 아래 — 공개 주소(/img/*, serveImage 의 키 형식)와 겹치지 않아 본인 · 관리자 API 로만 열림
import { HttpError, bad, json, readJson, cleanText, int } from '../lib/util.js';
import { notifyAdmins, buildMailHtml } from '../lib/mail.js';
import { toPublic } from '../lib/rentcalc.js';
import { requireQuoteUser } from '../lib/quoteAuth.js';

export const DOC_TYPES = [
  ['license', '운전면허증'], ['career', '운전경력증명서'], ['income', '소득증빙'],
  ['debt', '부채증빙'], ['resident', '등본'], ['etc', '기타서류'],
];
const DOC_NAME = Object.fromEntries(DOC_TYPES);
const FILE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const MAX_BYTES = 15 * 1024 * 1024;
const MAX_PER_TYPE = 10;

async function ownLog(env, me, id) {
  const row = await env.DB.prepare('SELECT * FROM quote_logs WHERE id = ? AND user_id = ?').bind(int(id), me.id).first();
  if (!row) throw new HttpError(404, '견적을 찾을 수 없습니다.');
  return row;
}
export const docList = async (env, logId) =>
  (await env.DB.prepare('SELECT id, doc_type, file_name, content_type, size, created_at FROM quote_docs WHERE log_id = ? ORDER BY id').bind(logId).all()).results;

// 파일 내려주기: 올릴 때 허용한 형식(사진 · PDF)만 그 형식으로, nosniff · 캐시 안 함
async function streamDoc(env, doc) {
  const obj = await env.IMAGES.get(doc.file_key);
  if (!obj) throw new HttpError(404, '파일을 찾을 수 없습니다.');
  const type = FILE_TYPES[doc.content_type] ? doc.content_type : 'application/octet-stream';
  const name = encodeURIComponent(doc.file_name || `document.${FILE_TYPES[type] || 'bin'}`);
  return new Response(obj.body, {
    headers: {
      'content-type': type,
      'content-disposition': `inline; filename*=UTF-8''${name}`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'x-robots-tag': 'noindex',
    },
  });
}

// 회원 화면용 상세 (금리 · 원가 등 내부 값은 toPublic 으로 빼고)
function publicLog(row, docs) {
  let input = {}, result = {};
  try { input = JSON.parse(row.input_json || '{}'); } catch {}
  try { result = JSON.parse(row.result_json || '{}'); } catch {}
  return {
    id: row.id, no: row.no, created_at: row.created_at, customer_type: row.customer_type, customer_name: row.customer_name,
    vehicle: row.vehicle, price: row.price, summary: row.summary,
    review_status: row.review_status, review_requested_at: row.review_requested_at, review_decided_at: row.review_decided_at, review_note: row.review_note,
    input, result: result.ok ? toPublic(result) : { ok: false }, docs,
  };
}

export function registerQuoteReview(r) {
  // ── 견적 사용자 본인 ─────────────────────────────────
  r.get('/api/quote/my', async ({ env, request, url }) => {
    const me = await requireQuoteUser(request, env.DB);
    const page = Math.max(1, int(url.searchParams.get('page'), 1));
    const size = 30;
    const [rows, cnt] = await Promise.all([
      env.DB.prepare(
        `SELECT l.id, l.no, l.customer_type, l.customer_name, l.vehicle, l.price, l.summary, l.created_at, l.review_status, l.review_note,
                (SELECT COUNT(*) FROM quote_docs d WHERE d.log_id = l.id) AS docs
           FROM quote_logs l WHERE l.user_id = ? ORDER BY l.id DESC LIMIT ? OFFSET ?`
      ).bind(me.id, size, (page - 1) * size).all(),
      env.DB.prepare('SELECT COUNT(*) AS n FROM quote_logs WHERE user_id = ?').bind(me.id).first(),
    ]);
    return json({ logs: rows.results, total: cnt.n, page, size, docTypes: DOC_TYPES }, 200, { 'cache-control': 'private, no-store' });
  });

  r.get('/api/quote/my/:id', async ({ env, request, params }) => {
    const me = await requireQuoteUser(request, env.DB);
    const row = await ownLog(env, me, params.id);
    return json({ log: publicLog(row, await docList(env, row.id)), docTypes: DOC_TYPES }, 200, { 'cache-control': 'private, no-store' });
  });

  r.post('/api/quote/my/:id/docs', async ({ env, request, params }) => {
    const me = await requireQuoteUser(request, env.DB);
    const row = await ownLog(env, me, params.id);
    if (row.review_status !== 'quote') throw bad('심사 요청 후에는 서류를 바꿀 수 없습니다.');
    const form = await request.formData().catch(() => null);
    if (!form) throw bad('파일을 다시 선택해 주세요.');
    const type = String(form.get('type') || '');
    if (!DOC_NAME[type]) throw bad('서류 종류를 확인해 주세요.');
    const files = form.getAll('file').filter((f) => f && typeof f === 'object' && f.size);
    if (!files.length) throw bad('파일을 선택해 주세요.');
    const have = await env.DB.prepare('SELECT COUNT(*) AS n FROM quote_docs WHERE log_id = ? AND doc_type = ?').bind(row.id, type).first();
    if (have.n + files.length > MAX_PER_TYPE) throw bad(`${DOC_NAME[type]}은(는) ${MAX_PER_TYPE}개까지 올릴 수 있습니다.`);
    for (const f of files) {
      if (!FILE_TYPES[f.type]) throw bad('JPG · PNG · WEBP 사진이나 PDF 파일만 올릴 수 있습니다.');
      if (f.size > MAX_BYTES) throw bad('파일 하나는 15MB 이하로 올려 주세요.');
    }
    for (const f of files) {
      const key = `private/quote-docs/${row.id}/${crypto.randomUUID()}.${FILE_TYPES[f.type]}`;
      await env.IMAGES.put(key, f.stream(), { httpMetadata: { contentType: f.type } });
      await env.DB.prepare('INSERT INTO quote_docs (log_id, doc_type, file_key, file_name, content_type, size) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(row.id, type, key, cleanText(f.name, 120), f.type, f.size).run();
    }
    return json({ ok: true, docs: await docList(env, row.id) });
  });

  r.delete('/api/quote/my/:id/docs/:docId', async ({ env, request, params }) => {
    const me = await requireQuoteUser(request, env.DB);
    const row = await ownLog(env, me, params.id);
    if (row.review_status !== 'quote') throw bad('심사 요청 후에는 서류를 바꿀 수 없습니다.');
    const doc = await env.DB.prepare('SELECT * FROM quote_docs WHERE id = ? AND log_id = ?').bind(int(params.docId), row.id).first();
    if (!doc) throw new HttpError(404, '서류를 찾을 수 없습니다.');
    await env.IMAGES.delete(doc.file_key);
    await env.DB.prepare('DELETE FROM quote_docs WHERE id = ?').bind(doc.id).run();
    return json({ ok: true, docs: await docList(env, row.id) });
  });

  r.get('/api/quote/my/:id/docs/:docId', async ({ env, request, params }) => {
    const me = await requireQuoteUser(request, env.DB);
    const row = await ownLog(env, me, params.id);
    const doc = await env.DB.prepare('SELECT * FROM quote_docs WHERE id = ? AND log_id = ?').bind(int(params.docId), row.id).first();
    if (!doc) throw new HttpError(404, '서류를 찾을 수 없습니다.');
    return streamDoc(env, doc);
  });

  r.post('/api/quote/my/:id/review', async ({ env, request, params, ctx, url }) => {
    const me = await requireQuoteUser(request, env.DB);
    const row = await ownLog(env, me, params.id);
    if (row.review_status !== 'quote') throw bad('이미 심사를 요청한 견적입니다.');
    const docs = await docList(env, row.id);
    if (!docs.length) throw bad('심사 서류를 하나 이상 올린 뒤 요청해 주세요.');
    const up = await env.DB.prepare("UPDATE quote_logs SET review_status = 'review', review_requested_at = datetime('now') WHERE id = ? AND review_status = 'quote'").bind(row.id).run();
    if (!up.meta.changes) throw bad('이미 심사를 요청한 견적입니다.');
    const have = DOC_TYPES.filter(([k]) => docs.some((d) => d.doc_type === k)).map(([, n]) => n).join(', ');
    const html = buildMailHtml({
      title: '견적 심사 요청',
      intro: '견적 사용자가 서류를 올리고 심사를 요청했습니다. 관리자 화면에서 서류를 확인하고 승인 · 부결해 주세요.',
      rows: [['견적번호', row.no], ['요청자', `${me.name || me.username}${me.company ? ' · ' + me.company : ''}`], ['고객', `${row.customer_name || '-'} (${row.customer_type})`], ['차량', row.vehicle], ['조건', row.summary], ['제출 서류', have]],
      linkUrl: `${url.origin}/admin/#quotelogs/${row.id}`, linkText: '심사하러 가기',
    });
    ctx.waitUntil(notifyAdmins(env, { kind: '심사 요청', refNo: row.no, subject: `[심사 요청] ${row.no} · ${row.customer_name || '-'} · ${row.vehicle}`, html }).catch(() => {}));
    return json({ ok: true });
  });

  // ── 관리자 ──────────────────────────────────────────
  r.get('/api/admin/quote-docs/:docId', async ({ env, params }) => {
    const doc = await env.DB.prepare('SELECT * FROM quote_docs WHERE id = ?').bind(int(params.docId)).first();
    if (!doc) throw new HttpError(404, '서류를 찾을 수 없습니다.');
    return streamDoc(env, doc);
  });

  r.post('/api/admin/quote-logs/:id/decide', async ({ env, params, request, admin }) => {
    const b = await readJson(request);
    const decision = b.decision;
    if (!['approved', 'rejected', 'review'].includes(decision)) throw bad('처리 결과를 확인해 주세요.');
    const row = await env.DB.prepare('SELECT id, review_status FROM quote_logs WHERE id = ?').bind(int(params.id)).first();
    if (!row) throw new HttpError(404, '견적 기록을 찾을 수 없습니다.');
    if (row.review_status === 'quote') throw bad('아직 심사 요청이 들어오지 않은 견적입니다.');
    if (decision === 'review') {
      // 승인 · 부결을 되돌려 다시 심사진행으로
      await env.DB.prepare("UPDATE quote_logs SET review_status = 'review', review_decided_at = '', review_decided_by = '', review_note = '' WHERE id = ?").bind(row.id).run();
    } else {
      await env.DB.prepare("UPDATE quote_logs SET review_status = ?, review_decided_at = datetime('now'), review_decided_by = ?, review_note = ? WHERE id = ?")
        .bind(decision, admin.name || admin.username, cleanText(b.note, 300), row.id).run();
    }
    return json({ ok: true });
  });
}
