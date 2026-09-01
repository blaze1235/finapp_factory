// Projects, tasks, comments and the approval chain — the agency-facing surface.
// Every query runs through req.q / req.sql, which means it runs inside an RLS
// session. There is no unscoped connection reachable from here.
const express = require('express');
const { suggestStage, STAGES } = require('../lib/domain');

module.exports = ({ auth, only, wrap, getNameMap, notifyUser }) => {
  const r = express.Router();
  // RLS already returns a client nothing here, but an internal endpoint should
  // say no rather than answer politely with an empty list.
  r.use(auth, only('owner', 'accountant', 'teammate', 'editor'));

  const nameMap = req => getNameMap(req.user.tenant_id);

  // ---- the command centre (§2) -------------------------------------------
  // One call. The first screen of the day should not be six spinners, and
  // every count here is a link to the thing it counts.
  r.get('/dashboard', only('owner', 'teammate', 'editor'), wrap(async (req, res) => {
    const me = req.user.id;
    const isOwner = req.user.role === 'owner';
    const data = await req.q(async c => {
      const q = (t, p) => c.query(t, p).then(x => x.rows);
      const one = async (t, p) => (await c.query(t, p)).rows[0];

      // "Needs your attention" — the counts, each one clickable in the UI.
      const attention = await one(`
        SELECT
          (SELECT count(*) FROM tasks t WHERE t.parent_task_id IS NOT NULL
                                          AND t.status NOT IN ('approved','completed'))::int AS client_requests,
          (SELECT count(*) FROM tasks t WHERE t.status NOT IN ('approved','completed')
                                          AND t.due_date < CURRENT_DATE)::int               AS overdue_tasks,
          (SELECT count(*) FROM tasks t WHERE t.status='in_review')::int                     AS awaiting_approval,
          (SELECT count(*) FROM tasks t WHERE t.status='awaiting_client')::int               AS waiting_on_client,
          (SELECT count(*) FROM tasks t WHERE t.status NOT IN ('approved','completed')
                                          AND t.due_date = CURRENT_DATE + 1)::int            AS due_tomorrow,
          ${isOwner ? `(SELECT count(*) FROM transactions x
                         WHERE x.direction='in' AND NOT x.settled AND x.due_on < CURRENT_DATE)::int`
                    : '0'}                                                                   AS overdue_invoices,
          (SELECT count(*) FROM scope_alerts s WHERE s.resolution='pending')::int            AS scope_pending`);

      const scope = await q(`SELECT s.id, s.task_id, s.revision_round, s.revisions_included, s.created_at,
                  t.title AS task, p.name AS project, p.id AS project_id, co.name AS company
             FROM scope_alerts s JOIN tasks t ON t.id=s.task_id
             JOIN projects p ON p.id=s.project_id JOIN companies co ON co.id=p.company_id
            WHERE s.resolution='pending' ORDER BY s.created_at DESC`);

      // Client activity, split the way the spec asks: what is still on us,
      // versus what we have already dealt with.
      const waitingOnYou = await q(`
        SELECT a.id, a.decision, a.note, a.decided_by_name, a.decided_at, a.task_id,
               t.title AS task, co.name AS company, t.status
          FROM approvals a JOIN tasks t ON t.id=a.task_id
          JOIN projects p ON p.id=t.project_id JOIN companies co ON co.id=p.company_id
         WHERE a.decision='changes_requested'
           AND EXISTS (SELECT 1 FROM tasks rt WHERE rt.parent_task_id=t.id
                         AND rt.status NOT IN ('approved','completed'))
         ORDER BY a.decided_at DESC LIMIT 12`);
      const handled = await q(`
        SELECT a.id, a.decision, a.note, a.decided_by_name, a.decided_at, a.task_id,
               t.title AS task, co.name AS company
          FROM approvals a JOIN tasks t ON t.id=a.task_id
          JOIN projects p ON p.id=t.project_id JOIN companies co ON co.id=p.company_id
         WHERE a.decision='approved'
            OR NOT EXISTS (SELECT 1 FROM tasks rt WHERE rt.parent_task_id=t.id
                             AND rt.status NOT IN ('approved','completed'))
         ORDER BY a.decided_at DESC LIMIT 8`);

      // Sitting with the client — the "where is it?" answer, pre-computed.
      const waiting = await q(`SELECT t.id, t.title, t.client_due_date, t.revision_round, p.name AS project, co.name AS company,
                  (SELECT MAX(version_no) FROM task_versions v WHERE v.task_id=t.id) AS version,
                  (SELECT MAX(sent_at)    FROM task_versions v WHERE v.task_id=t.id) AS sent_at
             FROM tasks t JOIN projects p ON p.id=t.project_id JOIN companies co ON co.id=p.company_id
            WHERE t.status='awaiting_client' ORDER BY sent_at NULLS LAST`);

      // Today, tomorrow and anything already late — one list, ordered.
      const todayTomorrow = await q(`
        SELECT t.id, t.title, t.status, t.due_date, t.assignee_id, t.difficulty,
               p.name AS project, co.name AS company,
               CASE WHEN t.due_date < CURRENT_DATE THEN 'overdue'
                    WHEN t.due_date = CURRENT_DATE THEN 'today'
                    ELSE 'tomorrow' END AS bucket
          FROM tasks t JOIN projects p ON p.id=t.project_id JOIN companies co ON co.id=p.company_id
         WHERE t.status NOT IN ('approved','completed')
           AND t.due_date IS NOT NULL AND t.due_date <= CURRENT_DATE + 1
           ${isOwner ? '' : 'AND t.assignee_id = $1'}
         ORDER BY t.due_date`, isOwner ? [] : [me]);

      const mine = await q(`SELECT t.id, t.title, t.status, t.due_date, t.client_due_date, t.revision_round,
                  t.difficulty, p.name AS project, p.id AS project_id
             FROM tasks t JOIN projects p ON p.id=t.project_id
            WHERE t.assignee_id=$1 AND t.status NOT IN ('approved','completed')
            ORDER BY t.due_date NULLS LAST, t.position`, [me]);

      // Project cards for the grid at the bottom of the page.
      const projects = await q(`
        SELECT p.id, p.name, p.stage, p.client_due_date, p.due_date, co.name AS company_name,
               pr.pct, pr.done, pr.total,
               ARRAY(SELECT m.user_id FROM project_members m WHERE m.project_id=p.id) AS member_ids
          FROM projects p JOIN companies co ON co.id=p.company_id
          CROSS JOIN LATERAL project_progress(p.id) pr
         WHERE NOT p.archived ORDER BY p.due_date NULLS LAST LIMIT 12`);

      // The sparkline strip: shipped versus slipped, six weeks.
      const strip = await q(`
        SELECT to_char(w.week, 'MM-DD') AS week,
               (SELECT count(*) FROM tasks t
                 WHERE t.completed_at >= w.week AND t.completed_at < w.week + interval '7 days'
                   ${isOwner ? '' : 'AND t.assignee_id = $1'})::int AS shipped,
               (SELECT count(*) FROM tasks t
                 WHERE t.due_date >= w.week::date AND t.due_date < (w.week + interval '7 days')::date
                   AND (t.completed_at IS NULL OR t.completed_at::date > t.due_date)
                   ${isOwner ? '' : 'AND t.assignee_id = $1'})::int AS slipped
          FROM generate_series(date_trunc('week', CURRENT_DATE) - interval '5 weeks',
                               date_trunc('week', CURRENT_DATE), interval '1 week') AS w(week)
         ORDER BY w.week`, isOwner ? [] : [me]);

      const stats = await one(`
        SELECT (SELECT count(*) FROM tasks WHERE assignee_id=$1 AND status NOT IN ('approved','completed'))::int AS open,
               (SELECT count(*) FROM tasks WHERE assignee_id=$1 AND status NOT IN ('approved','completed')
                  AND due_date <= CURRENT_DATE + 7)::int AS due_this_week,
               (SELECT count(*) FROM tasks WHERE assignee_id=$1 AND status IN ('approved','completed')
                  AND completed_at >= now() - interval '7 days')::int AS done_7d,
               (SELECT count(*) FROM project_members WHERE user_id=$1)::int AS projects`, [me]);

      const recent = await q(`SELECT a.verb, a.detail, a.actor_name, a.actor_id, a.created_at, p.name AS project
             FROM activity a LEFT JOIN projects p ON p.id=a.project_id
            ORDER BY a.created_at DESC LIMIT 12`);
      const unread = await q(`SELECT id, title, body, kind, link, params, created_at FROM notifications
            WHERE NOT read ORDER BY created_at DESC LIMIT 20`);

      return { attention, scope, client_activity: { waiting_on_you: waitingOnYou, handled },
               waiting, today_tomorrow: todayTomorrow, mine, projects, strip, stats, recent, unread };
    });

    const names = await nameMap(req);
    const label = id => names.get(id) || null;
    for (const t of data.today_tomorrow) t.assignee = label(t.assignee_id);
    for (const a of data.recent) a.actor_name = a.actor_name || label(a.actor_id) || '';
    for (const p of data.projects) p.members = (p.member_ids || []).map(label).filter(Boolean);
    res.json(data);
  }));

  // ---- my tasks (§4) -------------------------------------------------------
  r.get('/my-tasks', only('owner', 'teammate', 'editor'), wrap(async (req, res) => {
    res.json(await req.sql(`
      SELECT t.id, t.title, t.description, t.status, t.due_date, t.client_due_date,
             t.difficulty, t.revision_round, t.requires_file, t.visibility,
             p.name AS project_name, p.id AS project_id, co.name AS company_name,
             (SELECT count(*) FROM files f WHERE f.task_id=t.id)::int AS file_count
        FROM tasks t JOIN projects p ON p.id=t.project_id JOIN companies co ON co.id=p.company_id
       WHERE t.assignee_id=$1 ${req.query.all === '1' ? '' : "AND t.status NOT IN ('approved','completed')"}
       ORDER BY t.status='approved', t.due_date NULLS LAST, t.id`, [req.user.id]));
  }));

  // ---- projects -----------------------------------------------------------
  r.get('/projects', wrap(async (req, res) => {
    const rows = await req.sql(
      `SELECT p.*, co.name AS company_name,
              pr.pct, pr.done, pr.total,
              (SELECT count(*) FROM tasks t WHERE t.project_id=p.id AND t.status='awaiting_client') AS awaiting,
              (SELECT count(*) FROM scope_alerts s WHERE s.project_id=p.id AND s.resolution='pending') AS scope_pending
         FROM projects p
         JOIN companies co ON co.id=p.company_id
         CROSS JOIN LATERAL project_progress(p.id) pr
        WHERE NOT p.archived
        ORDER BY p.due_date NULLS LAST, p.id`);
    const names = await nameMap(req);
    res.json(rows.map(p => ({ ...p, owner_name: names.get(p.owner_id) || null })));
  }));

  r.post('/projects', only('owner'), wrap(async (req, res) => {
    const b = req.body || {};
    if (!b.company_id || !b.name) return res.status(400).json({ error: 'Client and project name are required' });
    // Open question 3: revisions_included is captured at creation, from the
    // signed scope. Left unset it silently disables the scope warning, so the
    // API refuses the shortcut rather than defaulting quietly.
    if (b.revisions_included === undefined || b.revisions_included === null || b.revisions_included === '')
      return res.status(400).json({ error: 'Set the number of revision rounds the signed scope includes' });
    const rounds = Number(b.revisions_included);
    if (!Number.isInteger(rounds) || rounds < 0) return res.status(400).json({ error: 'Revision rounds must be 0 or more' });

    const [p] = await req.sql(
      `INSERT INTO projects(company_id,name,description,stage,revisions_included,owner_id,
                            starts_on,due_date,client_due_date,budget_amount)
       VALUES($1,$2,$3,COALESCE($4,'brief'),$5,$6,$7,$8,$9,COALESCE($10,0)) RETURNING *`,
      [b.company_id, b.name, b.description || '', b.stage, rounds, req.user.id,
       b.starts_on || null, b.due_date || null, b.client_due_date || null, b.budget_amount || 0]);
    res.json(p);
  }));

  r.get('/projects/:id', wrap(async (req, res) => {
    const id = Number(req.params.id);
    const out = await req.q(async c => {
      const q = (t, p) => c.query(t, p).then(x => x.rows);
      const [project] = await q(
        `SELECT p.*, co.name AS company_name, co.contact_name, co.telegram_username
           FROM projects p JOIN companies co ON co.id=p.company_id WHERE p.id=$1`, [id]);
      if (!project) return null;
      const [internal] = await q(`SELECT * FROM project_progress($1,false)`, [id]);
      const [client]   = await q(`SELECT * FROM project_progress($1,true)`, [id]);
      const tasks = await q(
        `SELECT t.*, (SELECT MAX(version_no) FROM task_versions v WHERE v.task_id=t.id) AS latest_version,
                (SELECT count(*) FROM comments cm WHERE cm.task_id=t.id) AS comment_count
           FROM tasks t WHERE t.project_id=$1 ORDER BY t.position, t.id`, [id]);
      const members  = await q(`SELECT * FROM project_members WHERE project_id=$1`, [id]);
      const activity = await q(`SELECT * FROM activity WHERE project_id=$1 ORDER BY created_at DESC LIMIT 40`, [id]);
      const scope    = await q(`SELECT * FROM scope_alerts WHERE project_id=$1 ORDER BY created_at DESC`, [id]);
      return { project, progress: { internal, client }, tasks, members, activity, scope };
    });
    if (!out) return res.status(404).json({ error: 'Not found' });
    const names = await nameMap(req);
    out.members = out.members.map(m => ({ ...m, name: names.get(m.user_id) || `#${m.user_id}` }));
    out.tasks = out.tasks.map(t => ({ ...t, assignee_name: names.get(t.assignee_id) || null }));
    out.activity = out.activity.map(a => ({ ...a, actor_name: a.actor_name || names.get(a.actor_id) || '' }));
    out.suggested_stage = suggestStage(out.project, out.tasks);
    res.json(out);
  }));

  r.patch('/projects/:id', only('owner'), wrap(async (req, res) => {
    const allowed = ['name', 'description', 'stage', 'revisions_included', 'due_date',
                     'client_due_date', 'starts_on', 'client_visible', 'budget_amount', 'archived', 'owner_id'];
    const sets = [], vals = [];
    for (const k of allowed) if (k in req.body) { sets.push(`${k}=$${sets.length + 1}`); vals.push(req.body[k]); }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    if (req.body.stage && !STAGES.includes(req.body.stage)) return res.status(400).json({ error: 'Unknown stage' });
    vals.push(Number(req.params.id));
    const rows = await req.sql(`UPDATE projects SET ${sets.join(',')} WHERE id=$${vals.length} RETURNING *`, vals);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  }));

  r.post('/projects/:id/members', only('owner'), wrap(async (req, res) => {
    const rows = await req.sql(
      `INSERT INTO project_members(project_id,user_id,craft) VALUES($1,$2,COALESCE($3,'designer'))
       ON CONFLICT (project_id,user_id) DO UPDATE SET craft=EXCLUDED.craft RETURNING *`,
      [Number(req.params.id), Number(req.body.user_id), req.body.craft]);
    res.json(rows[0]);
  }));

  r.delete('/projects/:id/members/:userId', only('owner'), wrap(async (req, res) => {
    await req.sql('DELETE FROM project_members WHERE project_id=$1 AND user_id=$2',
      [Number(req.params.id), Number(req.params.userId)]);
    res.json({ ok: true });
  }));

  // ---- tasks --------------------------------------------------------------
  r.get('/tasks', wrap(async (req, res) => {
    const where = [], vals = [];
    if (req.query.project)  { vals.push(Number(req.query.project));  where.push(`t.project_id=$${vals.length}`); }
    if (req.query.assignee) { vals.push(Number(req.query.assignee)); where.push(`t.assignee_id=$${vals.length}`); }
    if (req.query.status)   { vals.push(req.query.status);           where.push(`t.status=$${vals.length}`); }
    if (req.query.open === '1') where.push(`t.status NOT IN ('approved','completed')`);
    const rows = await req.sql(
      `SELECT t.*, p.name AS project_name, co.name AS company_name
         FROM tasks t JOIN projects p ON p.id=t.project_id JOIN companies co ON co.id=p.company_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY t.due_date NULLS LAST, t.position, t.id`, vals);
    const names = await nameMap(req);
    res.json(rows.map(t => ({ ...t, assignee_name: names.get(t.assignee_id) || null })));
  }));

  r.get('/tasks/:id', wrap(async (req, res) => {
    const id = Number(req.params.id);
    const out = await req.q(async c => {
      const q = (t, p) => c.query(t, p).then(x => x.rows);
      const [task] = await q(
        `SELECT t.*, p.name AS project_name, p.id AS project_id, p.revisions_included,
                co.name AS company_name
           FROM tasks t JOIN projects p ON p.id=t.project_id JOIN companies co ON co.id=p.company_id
          WHERE t.id=$1`, [id]);
      if (!task) return null;
      const comments  = await q(`SELECT * FROM comments WHERE task_id=$1 ORDER BY created_at`, [id]);
      const files     = await q(`SELECT * FROM files WHERE task_id=$1 ORDER BY created_at DESC`, [id]);
      const approvals = await q(`SELECT * FROM approvals WHERE task_id=$1 ORDER BY decided_at DESC`, [id]);
      const versions  = await q(`SELECT * FROM task_versions WHERE task_id=$1 ORDER BY version_no DESC`, [id]);
      return { task, comments, files, approvals, versions };
    });
    if (!out) return res.status(404).json({ error: 'Not found' });
    const names = await nameMap(req);
    out.task.assignee_name = names.get(out.task.assignee_id) || null;
    out.comments = out.comments.map(cm => ({ ...cm, author_name: names.get(cm.author_id) || 'Client' }));
    res.json(out);
  }));

  r.post('/tasks', only('owner', 'teammate', 'editor'), wrap(async (req, res) => {
    const b = req.body || {};
    if (!b.project_id || !b.title) return res.status(400).json({ error: 'Project and title are required' });
    // A teammate may only create internal tasks; the RLS policy enforces this
    // too, but failing here gives a readable message instead of a policy error.
    const visibility = req.user.role === 'owner' ? (b.visibility || 'internal') : 'internal';
    // A member may only put work on themselves; assigning to someone else is
    // what separates an editor from a member (§8). Naming somebody else does
    // not silently produce an unassigned task — it lands on the member.
    const assignee = req.user.role === 'teammate'
      ? req.user.id
      : (b.assignee_id || null);
    const rows = await req.sql(
      `INSERT INTO tasks(project_id,title,description,status,visibility,assignee_id,due_date,
                         client_due_date,is_deliverable,difficulty,requires_file,position,created_by)
       VALUES($1,$2,$3,COALESCE($4,'todo'),$5,$6,$7,$8,COALESCE($9,true),
              COALESCE($10,'medium'),COALESCE($11,false),
              COALESCE((SELECT MAX(position)+1 FROM tasks WHERE project_id=$1),0),$12)
       RETURNING *`,
      [b.project_id, b.title, b.description || '', b.status, visibility,
       assignee, b.due_date || null, b.client_due_date || null,
       b.is_deliverable, b.difficulty, b.requires_file, req.user.id]);
    res.json(rows[0]);
  }));

  r.patch('/tasks/:id', wrap(async (req, res) => {
    const allowed = ['title', 'description', 'status', 'visibility', 'assignee_id',
                     'due_date', 'client_due_date', 'is_deliverable', 'position',
                     'difficulty', 'requires_file', 'missed'];
    const sets = [], vals = [];
    for (const k of allowed) if (k in req.body) { sets.push(`${k}=$${sets.length + 1}`); vals.push(req.body[k]); }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    const id = Number(req.params.id);
    if (['approved', 'completed'].includes(req.body.status)) {
      const [t] = await req.sql(
        `SELECT requires_file, (SELECT count(*) FROM files f WHERE f.task_id=t.id) AS files
           FROM tasks t WHERE t.id=$1`, [id]);
      if (t && t.requires_file && Number(t.files) === 0)
        return res.status(400).json({ error: 'This task needs a file attached before it can be closed' });
    }
    vals.push(id);
    try {
      const rows = await req.sql(`UPDATE tasks SET ${sets.join(',')} WHERE id=$${vals.length} RETURNING *`, vals);
      if (!rows.length) return res.status(404).json({ error: 'Not found, or not yours to change' });
      res.json(rows[0]);
    } catch (e) {
      // The field guard raises a plain-language reason; pass it through rather
      // than turning a deliberate rule into a 500.
      if (/account manager|Revision rounds|cannot be moved|editor|Difficulty/.test(e.message))
        return res.status(403).json({ error: e.message });
      throw e;
    }
  }));

  r.post('/tasks/:id/comments', only('owner', 'teammate', 'editor'), wrap(async (req, res) => {
    const body = (req.body.body || '').trim();
    if (!body) return res.status(400).json({ error: 'Empty comment' });
    const visibility = req.user.role === 'owner'
      ? (req.body.visibility || 'internal')
      : (req.body.visibility === 'client_visible' ? 'client_visible' : 'internal');
    const rows = await req.sql(
      `INSERT INTO comments(task_id,author_id,author_kind,body,visibility) VALUES($1,$2,'staff',$3,$4) RETURNING *`,
      [Number(req.params.id), req.user.id, body, visibility]);
    res.json(rows[0]);
  }));

  // ---- send for approval --------------------------------------------------
  // Opening a version is the single act that makes a deliverable client-visible
  // and puts the ball in their court; the trigger does both halves atomically.
  r.post('/tasks/:id/send-for-approval', only('owner', 'teammate', 'editor'), wrap(async (req, res) => {
    const id = Number(req.params.id);
    const out = await req.q(async c => {
      const cur = await c.query(`SELECT COALESCE(MAX(version_no),0)+1 AS next FROM task_versions WHERE task_id=$1`, [id]);
      const v = await c.query(
        `INSERT INTO task_versions(task_id,version_no,note,sent_by) VALUES($1,$2,$3,$4) RETURNING *`,
        [id, cur.rows[0].next, req.body.note || '', req.user.id]);
      const t = await c.query(
        `SELECT t.id,t.title,t.client_due_date,p.company_id,p.name AS project
           FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=$1`, [id]);
      return { version: v.rows[0], task: t.rows[0] };
    });
    if (!out.task) return res.status(404).json({ error: 'Not found' });
    // Tell the client it is waiting on them, on the channel they actually read.
    notifyUser({ tenantId: req.user.tenant_id, companyId: out.task.company_id, kind: 'approval_request',
                 payload: { task: out.task, version: out.version.version_no } }).catch(() => {});
    res.json(out);
  }));

  // ---- scope decision -----------------------------------------------------
  r.get('/scope-alerts', only('owner', 'accountant'), wrap(async (req, res) => {
    res.json(await req.sql(
      `SELECT s.*, t.title AS task, p.name AS project, co.name AS company, co.id AS company_id
         FROM scope_alerts s JOIN tasks t ON t.id=s.task_id
         JOIN projects p ON p.id=s.project_id JOIN companies co ON co.id=p.company_id
        ORDER BY s.resolution='pending' DESC, s.created_at DESC`));
  }));

  // Two buttons, one decision, recorded. Billing it creates the extra-scope
  // line right there, so the money reaches the invoice without anyone having
  // to remember it three weeks later.
  r.post('/scope-alerts/:id/resolve', only('owner'), wrap(async (req, res) => {
    const id = Number(req.params.id);
    const { resolution, amount } = req.body || {};
    if (!['absorbed', 'billed'].includes(resolution))
      return res.status(400).json({ error: 'Decide: absorbed or billed' });
    if (resolution === 'billed' && !(Number(amount) > 0))
      return res.status(400).json({ error: 'An amount is required to bill extra scope' });

    const out = await req.q(async c => {
      const upd = await c.query(
        `UPDATE scope_alerts SET resolution=$1, amount=$2, decided_by=$3, decided_at=now()
          WHERE id=$4 AND resolution='pending' RETURNING *`,
        [resolution, resolution === 'billed' ? Number(amount) : 0, req.user.id, id]);
      if (!upd.rows.length) return null;
      const s = upd.rows[0];
      const info = await c.query(
        `SELECT t.title, p.company_id, p.name AS project, co.name AS company_name
           FROM scope_alerts s JOIN tasks t ON t.id=s.task_id
           JOIN projects p ON p.id=s.project_id JOIN companies co ON co.id=p.company_id
          WHERE s.id=$1`, [id]);
      await c.query(
        `INSERT INTO activity(project_id,task_id,actor_id,verb,detail,visibility)
         VALUES($1,$2,$3,$4,$5,'internal')`,
        [s.project_id, s.task_id, req.user.id,
         resolution === 'billed' ? 'billed extra scope' : 'absorbed extra scope',
         `round ${s.revision_round}`]);

      if (resolution === 'billed') {
        // Posts as money owed to us but not yet moved: it lifts profit for the
        // month and leaves cash alone, and shows up in the accountant's
        // "unpaid to us" without anyone having to be told about it.
        const tx = (await c.query(
          `INSERT INTO transactions(direction,counterparty,description,category,amount,settled,
                                    due_on,company_id,project_id,scope_alert_id,created_by)
           VALUES('in',$1,$2,'project_fee',$3,false,CURRENT_DATE + 14,$4,$5,$6,$7) RETURNING id`,
          [info.rows[0].company_name || '',
           `Extra scope — revision round ${s.revision_round} on "${info.rows[0].title}"`,
           Number(amount), info.rows[0].company_id, s.project_id, s.id, req.user.id])).rows[0];
        return { alert: s, transaction_id: tx.id };
      }
      return { alert: s };
    });
    if (!out) return res.status(409).json({ error: 'Already decided' });
    res.json(out);
  }));

  // ---- notifications ------------------------------------------------------
  r.get('/notifications', wrap(async (req, res) => {
    res.json(await req.sql(
      `SELECT id,title,body,kind,link,params,read,created_at FROM notifications
        ORDER BY read, created_at DESC LIMIT 50`));
  }));
  r.post('/notifications/read', wrap(async (req, res) => {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number) : null;
    await req.sql(ids ? `UPDATE notifications SET read=true WHERE id = ANY($1)` : `UPDATE notifications SET read=true`,
      ids ? [ids] : undefined);
    res.json({ ok: true });
  }));

  return r;
};
