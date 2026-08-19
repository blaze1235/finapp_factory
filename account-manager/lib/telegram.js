// Telegram is where this agency already lives: briefs arrive there as voice
// notes and clients answer there rather than in any portal. So the bot is not
// a notification pipe bolted on the side — it is a first-class surface for the
// three moments that matter, each of which resolves in a single tap:
//
//   * a voice note becomes a task, attached, filed under the right client
//   * a client approves or requests changes without opening anything
//   * the owner absorbs or bills extra scope the moment it happens
//
// Everything degrades quietly: with no TELEGRAM_BOT_TOKEN set, every function
// here becomes a no-op and the rest of the product is unaffected.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const API = TOKEN ? `https://api.telegram.org/bot${TOKEN}` : null;
const enabled = () => !!TOKEN;

async function api(method, body) {
  if (!API) return null;
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) console.error(`telegram ${method} failed:`, json.description || res.status);
  return json.result;
}

const send = (chat_id, text, extra = {}) =>
  api('sendMessage', { chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });

const buttons = rows => ({ reply_markup: { inline_keyboard: rows } });
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------------------------------------------------------------------------
// Mini App authentication.
// Telegram signs initData with a key derived from the bot token; verifying it
// is what lets the Mini App skip the login screen entirely without trusting
// anything the client sent about who they are.
// ---------------------------------------------------------------------------
function validateInitData(initData) {
  if (!TOKEN || !initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const checkString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  const expect = crypto.createHmac('sha256', secret).update(checkString).digest('hex');
  if (expect.length !== hash.length ||
      !crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(hash))) return null;
  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || Date.now() / 1000 - authDate > 86400) return null;   // a day, then sign in again
  try { return JSON.parse(params.get('user') || 'null'); } catch { return null; }
}

// ---------------------------------------------------------------------------
function createTelegram({ controlPool, getTenantPool, withRls, asSystem, sign, FILES_DIR }) {
  const t = {};

  const userByChat = async chat_id => (await controlPool.query(
    `SELECT u.*, t.db_name, t.name AS tenant_name, t.currency FROM users u
       JOIN tenants t ON t.id = u.tenant_id
      WHERE u.telegram_chat_id = $1 AND u.active`, [chat_id])).rows[0] || null;

  const asUser = (u, fn) => withRls(getTenantPool(u.db_name), { userId: u.id, role: u.role, companyId: u.company_id }, fn);

  const setPending = (chat_id, action, payload) => controlPool.query(
    `INSERT INTO pending_actions(chat_id,action,payload) VALUES($1,$2,$3)
     ON CONFLICT (chat_id) DO UPDATE SET action=$2, payload=$3, created_at=now()`,
    [chat_id, action, payload]);
  const takePending = async chat_id => {
    const { rows } = await controlPool.query(
      `DELETE FROM pending_actions WHERE chat_id=$1 AND created_at > now() - interval '1 hour' RETURNING *`, [chat_id]);
    return rows[0] || null;
  };

  // ---- outbound ----------------------------------------------------------
  // A deliverable is waiting on the client: two taps, no login, no portal.
  t.notifyUser = async ({ tenantId, companyId, kind, payload }) => {
    if (!enabled()) return;
    const { rows } = await controlPool.query(
      `SELECT id, telegram_chat_id, name FROM users
        WHERE tenant_id=$1 AND company_id=$2 AND role='client' AND active AND telegram_chat_id IS NOT NULL`,
      [tenantId, companyId]);
    if (kind !== 'approval_request') return;
    const { task, version } = payload;
    for (const u of rows) {
      await send(u.telegram_chat_id,
        `<b>Ready for your review</b>\n${esc(task.title)}\n<i>${esc(task.project)}</i>` +
        (task.client_due_date ? `\nNeeded by ${esc(task.client_due_date)}` : ''),
        buttons([
          [{ text: '✅ Approve', callback_data: `ap:${task.id}:${version}` }],
          [{ text: '✏️ Request changes', callback_data: `rc:${task.id}:${version}` }],
          ...(process.env.PUBLIC_URL ? [[{ text: 'Open', web_app: { url: `${process.env.PUBLIC_URL}/tg/` } }]] : []),
        ]));
    }
  };

  // A decision landed: the assignee and the owner hear about it immediately.
  t.notifyStaff = async ({ tenantId, kind, payload }) => {
    if (!enabled() || kind !== 'decision') return;
    const { rows } = await controlPool.query(
      `SELECT telegram_chat_id FROM users
        WHERE tenant_id=$1 AND role IN ('owner','teammate') AND active AND telegram_chat_id IS NOT NULL`, [tenantId]);
    const text = payload.decision === 'approved'
      ? `✅ <b>${esc(payload.who)} approved</b>\n${esc(payload.title)}`
      : `✏️ <b>${esc(payload.who)} requested changes</b>\n${esc(payload.title)}\n\n<i>${esc(payload.note || '')}</i>`;
    for (const u of rows) await send(u.telegram_chat_id, text);
  };

  // The scope warning, delivered where the owner already is, with the two
  // buttons the brief calls for attached to the moment it happened.
  t.notifyScope = async ({ tenantId, alert, project, task }) => {
    if (!enabled()) return;
    const { rows } = await controlPool.query(
      `SELECT telegram_chat_id FROM users WHERE tenant_id=$1 AND role='owner'
         AND active AND telegram_chat_id IS NOT NULL`, [tenantId]);
    for (const u of rows) {
      await send(u.telegram_chat_id,
        `⚠️ <b>Beyond agreed revisions</b>\n${esc(task)}\n<i>${esc(project)}</i>\n\n` +
        `Round <b>${alert.revision_round}</b>; the scope includes <b>${alert.revisions_included}</b>.`,
        buttons([[
          { text: '🤝 Absorb it', callback_data: `sc:${alert.id}:absorb` },
          { text: '💵 Bill it', callback_data: `sc:${alert.id}:bill` },
        ]]));
    }
  };

  // ---- inbound -----------------------------------------------------------
  t.handleUpdate = async update => {
    if (!enabled()) return;
    if (update.callback_query) return handleCallback(update.callback_query);
    const msg = update.message;
    if (!msg) return;
    const chat = msg.chat.id;
    const user = await userByChat(chat);

    if (msg.text && msg.text.startsWith('/start')) {
      const code = (msg.text.split(' ')[1] || '').trim().toUpperCase();
      if (user && !code) return greet(user, chat);
      if (!code) return send(chat,
        'Hello! Open Account Manager on the web, go to <b>Settings → Telegram</b>, and send me the code it shows you.');
      return bind(chat, code, msg.from);
    }
    if (!user) return send(chat, 'I do not know you yet. Send me the code from <b>Settings → Telegram</b>.');

    // Answering a "why?" prompt, or naming an amount to bill.
    const pending = await takePending(chat);
    if (pending && msg.text) return resolvePending(user, chat, pending, msg.text.trim());

    if (msg.voice || msg.audio || msg.video_note) return captureBrief(user, chat, msg);
    if (msg.text === '/week' || msg.text === '/report') return sendWeek(user, chat);
    if (msg.text === '/waiting') return sendWaiting(user, chat);
    if (msg.text === '/me' || msg.text === '/mine') return sendMine(user, chat);
    return greet(user, chat);
  };

  async function bind(chat, code, from) {
    const { rows } = await controlPool.query(
      `UPDATE link_codes SET used_at = now()
        WHERE code=$1 AND used_at IS NULL AND expires_at > now() RETURNING user_id`, [code]);
    if (!rows.length) return send(chat, 'That code is expired or already used. Generate a fresh one in the app.');
    await controlPool.query('UPDATE users SET telegram_chat_id=$1 WHERE id=$2', [chat, rows[0].user_id]);
    await controlPool.query(
      `INSERT INTO telegram_links(chat_id,user_id,username,tenant_id)
       SELECT $1,$2,$3,tenant_id FROM users WHERE id=$2
       ON CONFLICT (chat_id) DO UPDATE SET user_id=$2, username=$3`,
      [chat, rows[0].user_id, from?.username || '']);
    const u = await userByChat(chat);
    return greet(u, chat, true);
  }

  function greet(u, chat, justLinked = false) {
    const lines = [justLinked ? `Linked. Hello, <b>${esc(u.name)}</b>.` : `Hello, <b>${esc(u.name)}</b>.`];
    if (u.role === 'client') {
      lines.push('', 'I will message you the moment something needs your review, and you can approve it right here.',
                 '', '/waiting — what is with you now');
    } else if (u.role === 'owner') {
      lines.push('', '🎙 Send me a <b>voice note</b> and I will file it as a brief under the right client.',
                 '', '/waiting — sitting with clients', '/week — the weekly report', '/mine — my open work');
    } else {
      lines.push('', '🎙 Send me a <b>voice note</b> to file a brief.', '', '/mine — my open work');
    }
    const kb = process.env.PUBLIC_URL
      ? buttons([[{ text: 'Open Account Manager', web_app: { url: `${process.env.PUBLIC_URL}/tg/` } }]]) : {};
    return send(chat, lines.join('\n'), kb);
  }

  // ---- the voice-note brief ----------------------------------------------
  // Briefs arrive as voice notes and currently die in a chat thread. Caught
  // here, the audio is stored and attached to a real task the moment the
  // sender taps a client — no transcription service, no monthly bill, and the
  // recording stays available for whoever picks the work up.
  async function captureBrief(u, chat, msg) {
    if (u.role === 'client') return send(chat, 'Thanks! Send briefs to your account manager and they will file them.');
    const media = msg.voice || msg.audio || msg.video_note;
    const stored = await downloadTelegramFile(media.file_id).catch(() => null);
    if (!stored) return send(chat, 'I could not save that recording. Try sending it again?');

    const fileRow = await asUser(u, async c => (await c.query(
      `INSERT INTO files(name, storage_path, mime, size_bytes, kind, visibility, uploaded_by)
       VALUES($1,$2,$3,$4,'voice_brief','internal',$5) RETURNING id`,
      [`Voice brief ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
       stored.name, media.mime_type || 'audio/ogg', media.file_size || 0, u.id])).rows[0]);

    const projects = await asUser(u, async c => (await c.query(
      `SELECT p.id, p.name, co.name AS company FROM projects p JOIN companies co ON co.id=p.company_id
        WHERE NOT p.archived ORDER BY p.id DESC LIMIT 8`)).rows);
    if (!projects.length) return send(chat, 'Saved — but there are no active projects to file it under yet.');

    return send(chat, `🎙 <b>Brief saved</b> (${Math.round((media.duration || 0))}s). Which project is it for?`,
      buttons(projects.map(p => [{ text: `${p.company} — ${p.name}`.slice(0, 60),
                                   callback_data: `vb:${fileRow.id}:${p.id}` }])));
  }

  async function downloadTelegramFile(fileId) {
    const meta = await api('getFile', { file_id: fileId });
    if (!meta?.file_path) return null;
    const res = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${meta.file_path}`);
    if (!res.ok) return null;
    const name = crypto.randomBytes(8).toString('hex') + path.extname(meta.file_path);
    fs.mkdirSync(FILES_DIR, { recursive: true });
    fs.writeFileSync(path.join(FILES_DIR, name), Buffer.from(await res.arrayBuffer()));
    return { name };
  }

  // ---- callbacks ---------------------------------------------------------
  async function handleCallback(cq) {
    const chat = cq.message.chat.id;
    const u = await userByChat(chat);
    const ack = (text, alert = false) => api('answerCallbackQuery', { callback_query_id: cq.id, text, show_alert: alert });
    if (!u) return ack('Link your account first');

    const [kind, a, b] = String(cq.data || '').split(':');
    const stripButtons = () => api('editMessageReplyMarkup',
      { chat_id: chat, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});

    if (kind === 'vb') {   // voice brief → a real task
      const task = await asUser(u, async c => {
        const t = (await c.query(
          `INSERT INTO tasks(project_id,title,description,status,visibility,created_by,is_deliverable)
           VALUES($1,$2,$3,'todo','internal',$4,true) RETURNING id,title`,
          [Number(b), `Brief — ${new Date().toLocaleDateString('en-GB')}`,
           'Filed from a Telegram voice note. Listen to the attachment.', u.id])).rows[0];
        await c.query('UPDATE files SET task_id=$1, project_id=$2 WHERE id=$3', [t.id, Number(b), Number(a)]);
        return t;
      });
      await stripButtons();
      await ack('Filed');
      return send(chat, `✅ Filed as <b>${esc(task.title)}</b> with the recording attached.`);
    }

    if (kind === 'ap' || kind === 'rc') {
      if (u.role !== 'client') return ack('Only the client can decide this', true);
      if (kind === 'rc') {
        await setPending(chat, 'changes_note', { task_id: Number(a), version: Number(b) });
        await ack();
        return send(chat, 'What needs changing? Reply with a sentence and I will pass it on.',
          { reply_markup: { force_reply: true } });
      }
      await recordDecision(u, Number(a), Number(b), 'approved', '');
      await stripButtons();
      await ack('Approved ✅');
      return send(chat, '✅ Approved. The team has been told.');
    }

    if (kind === 'sc') {   // the scope decision, two taps from the warning
      if (u.role !== 'owner') return ack('Only the account manager decides this', true);
      if (b === 'bill') {
        await setPending(chat, 'scope_amount', { alert_id: Number(a) });
        await ack();
        return send(chat, 'How much for the extra round? Reply with a number.',
          { reply_markup: { force_reply: true } });
      }
      await asUser(u, c => c.query(
        `UPDATE scope_alerts SET resolution='absorbed', amount=0, decided_by=$1, decided_at=now()
          WHERE id=$2 AND resolution='pending'`, [u.id, Number(a)]));
      await stripButtons();
      await ack('Absorbed');
      return send(chat, '🤝 Absorbed internally. Nothing will be billed.');
    }
    return ack();
  }

  async function resolvePending(u, chat, pending, text) {
    if (pending.action === 'changes_note') {
      const { task_id, version } = pending.payload;
      await recordDecision(u, task_id, version, 'changes_requested', text);
      return send(chat, '✏️ Passed on to the team. They will come back to you with a new version.');
    }
    if (pending.action === 'scope_amount') {
      const amount = Number(String(text).replace(/[^\d]/g, ''));
      if (!(amount > 0)) {
        await setPending(chat, 'scope_amount', pending.payload);
        return send(chat, 'I need a number — how much for the extra round?', { reply_markup: { force_reply: true } });
      }
      await asUser(u, c => c.query(
        `UPDATE scope_alerts SET resolution='billed', amount=$1, decided_by=$2, decided_at=now()
          WHERE id=$3 AND resolution='pending'`, [amount, u.id, pending.payload.alert_id]));
      return send(chat, `💵 Booked as extra scope: <b>${amount.toLocaleString('en-US')} ${esc(u.currency)}</b>. ` +
                        'It is on the client\'s draft invoice.');
    }
  }

  // Goes through the same approvals table as the portal, so the trigger chain —
  // counter, revision task, scope alert — fires identically. There is no
  // "Telegram path" that skips the counting.
  async function recordDecision(u, taskId, version, decision, note) {
    const out = await asUser(u, async c => {
      const a = (await c.query(
        `INSERT INTO approvals(task_id,version_no,decision,decided_by,decided_by_name,note,source)
         VALUES($1,$2,$3,$4,$5,$6,'telegram') RETURNING id`,
        [taskId, version || 1, decision, u.id, u.name, note])).rows[0];
      const title = (await c.query(`SELECT title FROM v_client_tasks WHERE id=$1`, [taskId])).rows[0];
      const scope = (await c.query(
        `SELECT s.*, p.name AS project, tk.title AS task FROM scope_alerts s
           JOIN projects p ON p.id=s.project_id JOIN tasks tk ON tk.id=s.task_id
          WHERE s.approval_id=$1`, [a.id])).rows[0] || null;
      return { title: title?.title || '', scope };
    });
    await t.notifyStaff({ tenantId: u.tenant_id, kind: 'decision',
                          payload: { decision, title: out.title, who: u.name, note } }).catch(() => {});
    if (out.scope)
      await t.notifyScope({ tenantId: u.tenant_id, alert: out.scope,
                            project: out.scope.project, task: out.scope.task }).catch(() => {});
    return out;
  }

  // ---- read-only commands -------------------------------------------------
  async function sendWaiting(u, chat) {
    const rows = await asUser(u, async c => u.role === 'client'
      ? (await c.query(`SELECT title, due FROM v_client_tasks WHERE needs_you ORDER BY due NULLS LAST`)).rows
      : (await c.query(
          `SELECT t.title, co.name AS company,
                  EXTRACT(day FROM now() - COALESCE((SELECT MAX(sent_at) FROM task_versions v WHERE v.task_id=t.id), t.created_at))::int AS days
             FROM tasks t JOIN projects p ON p.id=t.project_id JOIN companies co ON co.id=p.company_id
            WHERE t.status='awaiting_client' ORDER BY days DESC`)).rows);
    if (!rows.length) return send(chat, u.role === 'client' ? 'Nothing needs you right now. 🎉' : 'Nothing is sitting with clients.');
    return send(chat, u.role === 'client'
      ? `<b>Waiting on you</b>\n\n${rows.map(r => `• ${esc(r.title)}${r.due ? ` — by ${esc(r.due)}` : ''}`).join('\n')}`
      : `<b>Sitting with clients</b>\n\n${rows.map(r => `• ${esc(r.title)} — ${esc(r.company)} (${r.days}d)`).join('\n')}`);
  }

  async function sendMine(u, chat) {
    const rows = await asUser(u, async c => (await c.query(
      `SELECT t.title, t.status, t.due_date, p.name AS project FROM tasks t JOIN projects p ON p.id=t.project_id
        WHERE t.assignee_id=$1 AND t.status NOT IN ('approved','completed')
        ORDER BY t.due_date NULLS LAST LIMIT 15`, [u.id])).rows);
    if (!rows.length) return send(chat, 'Nothing open on you. 🎉');
    return send(chat, `<b>Your open work</b>\n\n${rows.map(r =>
      `• ${esc(r.title)} — <i>${esc(r.project)}</i>${r.due_date ? ` · ${esc(String(r.due_date).slice(0, 10))}` : ''}`).join('\n')}`);
  }

  async function sendWeek(u, chat) {
    if (u.role === 'client') return send(chat, 'That report is for the agency team.');
    const { weeklyReport } = require('../routes/reports');
    const rep = await weeklyReport(fn => asUser(u, fn), { days: 7 });
    return send(chat, t.formatWeekly(rep));
  }

  t.formatWeekly = rep => {
    const L = [`<b>This week</b>`, ''];
    L.push(`✅ Shipped: <b>${rep.shipped.length}</b>`);
    L.push(`⏳ Sitting with clients: <b>${rep.waiting.length}</b>`);
    L.push(`🔴 Past their date: <b>${rep.slipped.length}</b>`);
    L.push(`✏️ Revision rounds burned: <b>${rep.revisions.rounds}</b> across ${rep.revisions.on_tasks} deliverables`);
    const billed = rep.scope.find(s => s.resolution === 'billed');
    const absorbed = rep.scope.find(s => s.resolution === 'absorbed');
    if (billed || absorbed)
      L.push(`💵 Extra scope: ${billed ? `${Number(billed.amount).toLocaleString('en-US')} billed` : 'none billed'}` +
             `${absorbed ? `, ${absorbed.n} absorbed` : ''}`);
    if (rep.waiting.length) {
      L.push('', '<b>Longest with clients</b>');
      for (const w of rep.waiting.slice(0, 5)) L.push(`• ${esc(w.title)} — ${esc(w.company)} (${w.days_waiting}d)`);
    }
    if (rep.slipped.length) {
      L.push('', '<b>Past their date</b>');
      for (const s of rep.slipped.slice(0, 5)) L.push(`• ${esc(s.title)} — ${esc(s.company)} (${s.days_late}d late)`);
    }
    // Deliberately no per-person counts: the report measures the agency.
    return L.join('\n');
  };

  t.pushWeeklyReports = async () => {
    if (!enabled()) return;
    const tenants = (await controlPool.query('SELECT * FROM tenants')).rows;
    const { weeklyReport } = require('../routes/reports');
    for (const tn of tenants) {
      const owners = (await controlPool.query(
        `SELECT telegram_chat_id FROM users WHERE tenant_id=$1 AND role IN ('owner','accountant')
           AND active AND telegram_chat_id IS NOT NULL`, [tn.id])).rows;
      if (!owners.length) continue;
      const pool = getTenantPool(tn.db_name);
      const rep = await weeklyReport(fn => asSystem(pool, fn), { days: 7 }).catch(() => null);
      if (!rep) continue;
      for (const o of owners) await send(o.telegram_chat_id, t.formatWeekly(rep));
    }
  };

  t.setWebhook = async url => enabled() ? api('setWebhook', { url, allowed_updates: ['message', 'callback_query'] }) : null;
  t.enabled = enabled;
  t.validateInitData = validateInitData;
  return t;
}

module.exports = { createTelegram, validateInitData, enabled };
