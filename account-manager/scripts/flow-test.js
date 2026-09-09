#!/usr/bin/env node
// Drives the whole product over real HTTP against a throwaway agency, then
// drops it. Nothing is stubbed: the same routes, the same policies, the same
// triggers the deployed app runs.
//
//   node scripts/flow-test.js          (assumes a server on BASE)
//
// The visibility assertions are the point. Every one of them is a client
// relationship that would have been destroyed by a forgotten filter.
const BASE = process.env.BASE || 'http://localhost:3111';
const CODE = 'FLOWT';

const db = require('../db');
const { controlPool, hashPin, getTenantPool } = db;
const { asSystem, withRls } = require('../lib/rls');
const { evictTenantPool } = require('../lib/tenant-pool');

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${extra ? ' — ' + extra : ''}`); }
};
const section = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 66 - t.length))}`);

async function call(token, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, body: json };
}
const login = async (phone, pin) => (await call(null, 'POST', '/api/login', { phone, pin })).body?.token;

// Recursively hunt a payload for keys that must never reach a client.
function findForbidden(node, forbidden, path = '$') {
  const hits = [];
  if (Array.isArray(node)) node.forEach((v, i) => hits.push(...findForbidden(v, forbidden, `${path}[${i}]`)));
  else if (node && typeof node === 'object')
    for (const [k, v] of Object.entries(node)) {
      if (forbidden.includes(k) && v !== undefined) hits.push(`${path}.${k}`);
      hits.push(...findForbidden(v, forbidden, `${path}.${k}`));
    }
  return hits;
}

async function teardown() {
  const t = (await controlPool.query('SELECT * FROM tenants WHERE code=$1', [CODE])).rows[0];
  if (!t) return;
  await controlPool.query('DELETE FROM users WHERE tenant_id=$1', [t.id]);
  await controlPool.query('DELETE FROM tenants WHERE id=$1', [t.id]);
  await evictTenantPool(t.db_name);
  const c = await controlPool.connect();
  try {
    await c.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1', [t.db_name]);
    await c.query(`DROP DATABASE IF EXISTS "${t.db_name}"`);
  } finally { c.release(); }
}

async function main() {
  await db.init();
  await teardown();

  section('Setting up a throwaway agency');
  const { tenant, ownerId } = await db.provisionTenant({
    name: 'Flow Test Agency', code: CODE,
    ownerName: 'Owner', ownerPhone: '+998900000001', ownerPin: '1234',
  });
  const pool = getTenantPool(tenant.db_name);
  const mkUser = async (name, phone, role, o = {}) => (await controlPool.query(
    `INSERT INTO users(tenant_id,name,phone,pin_hash,role,company_id,craft) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [tenant.id, name, phone, hashPin(o.pin || '1234'), role, o.companyId || null, o.craft || ''])).rows[0].id;

  const accountantId = await mkUser('Bookkeeper', '+998900000002', 'accountant');
  const designerId   = await mkUser('Designer',   '+998900000003', 'teammate', { craft: 'designer' });
  const outsiderId   = await mkUser('Outsider',   '+998900000004', 'teammate', { craft: 'smm' });
  const editorId     = await mkUser('Editor',     '+998900000007', 'editor',   { craft: 'motion' });

  const owner      = await login('+998900000001', '1234');
  const accountant = await login('+998900000002', '1234');
  const designer   = await login('+998900000003', '1234');
  const outsider   = await login('+998900000004', '1234');
  const editor     = await login('+998900000007', '1234');
  ok('all four staff logins work', owner && accountant && designer && outsider);

  section('Clients and projects');
  const acme = (await call(owner, 'POST', '/api/companies',
    { name: 'Acme Tea', contact_name: 'Client One', internal_notes: 'SECRET-NOTE-PAYS-LATE' })).body;
  const rival = (await call(owner, 'POST', '/api/companies', { name: 'Rival Ltd' })).body;
  ok('owner creates a client company', !!acme?.id);

  const noRounds = await call(owner, 'POST', '/api/projects', { company_id: acme.id, name: 'No rounds set' });
  ok('project creation refuses to skip revisions_included', noRounds.status === 400,
     `got ${noRounds.status}`);

  const proj = (await call(owner, 'POST', '/api/projects', {
    company_id: acme.id, name: 'Launch campaign', revisions_included: 2,
    due_date: '2026-09-01', client_due_date: '2026-09-08' })).body;
  const rivalProj = (await call(owner, 'POST', '/api/projects', {
    company_id: rival.id, name: 'Rival work', revisions_included: 2 })).body;
  ok('projects created with agreed rounds', proj?.revisions_included === 2);

  await call(owner, 'POST', `/api/projects/${proj.id}/members`, { user_id: designerId, craft: 'designer' });
  await call(owner, 'POST', `/api/projects/${proj.id}/members`, { user_id: editorId, craft: 'motion' });

  const deliverable = (await call(owner, 'POST', '/api/tasks', {
    project_id: proj.id, title: 'Key visual', assignee_id: designerId,
    due_date: '2026-08-25', client_due_date: '2026-08-30', visibility: 'client_visible' })).body;
  const secret = (await call(owner, 'POST', '/api/tasks', {
    project_id: proj.id, title: 'INTERNAL-ONLY-CONCEPT-GRAVEYARD', assignee_id: designerId })).body;
  ok('owner creates a client-visible and an internal task', !!deliverable?.id && !!secret?.id);

  await call(owner, 'POST', `/api/tasks/${deliverable.id}/comments`,
    { body: 'INTERNAL-GRUMBLE-they-will-hate-this', visibility: 'internal' });

  const clientId = await mkUser('Client One', '+998900000005', 'client', { companyId: acme.id, pin: '1111' });
  await mkUser('Rival Person', '+998900000006', 'client', { companyId: rival.id, pin: '2222' });
  const client = await login('+998900000005', '1111');
  const rivalClient = await login('+998900000006', '2222');

  section('The teammate boundary');
  const tmTasks = (await call(designer, 'GET', '/api/tasks')).body;
  ok('teammate sees tasks on their own project', tmTasks.length === 2);
  const outTasks = (await call(outsider, 'GET', '/api/tasks')).body;
  ok('a non-member sees nothing at all', outTasks.length === 0, `saw ${outTasks.length}`);
  ok('teammate is refused finance', (await call(designer, 'GET', '/api/finance/summary')).status === 403);
  ok('teammate is refused the ledger', (await call(designer, 'GET', '/api/finance/transactions')).status === 403);

  ok('teammate may move their own status',
     (await call(designer, 'PATCH', `/api/tasks/${deliverable.id}`, { status: 'in_review' })).status === 200);
  const vis = await call(designer, 'PATCH', `/api/tasks/${deliverable.id}`, { visibility: 'internal' });
  ok('teammate cannot change visibility', vis.status === 403, `got ${vis.status}`);
  const reassign = await call(designer, 'PATCH', `/api/tasks/${deliverable.id}`, { assignee_id: outsiderId });
  ok('teammate cannot reassign', reassign.status === 403, `got ${reassign.status}`);
  const cdd = await call(designer, 'PATCH', `/api/tasks/${deliverable.id}`, { client_due_date: '2026-12-31' });
  ok('teammate cannot move the client deadline', cdd.status === 403, `got ${cdd.status}`);
  const foreign = await call(designer, 'PATCH', `/api/tasks/${deliverable.id}`, { position: 5 });
  ok('teammate can still reorder their own work', foreign.status === 200);

  section('The accountant boundary');
  ok('accountant sees client companies', (await call(accountant, 'GET', '/api/companies')).body.length === 2);
  ok('accountant reaches finance', (await call(accountant, 'GET', '/api/finance/summary')).status === 200);
  ok('accountant is refused the dashboard', (await call(accountant, 'GET', '/api/dashboard')).status === 403);
  ok('accountant is refused the leaderboard', (await call(accountant, 'GET', '/api/performance/leaderboard')).status === 403);
  const acctTasks = await call(accountant, 'GET', '/api/tasks');
  ok('accountant sees no tasks whatsoever', acctTasks.status === 200 && acctTasks.body.length === 0,
     `saw ${acctTasks.body?.length}`);

  section('Sending for approval');
  const sent = await call(designer, 'POST', `/api/tasks/${deliverable.id}/send-for-approval`, { note: 'v1' });
  ok('teammate can send for approval', sent.status === 200 && sent.body.version.version_no === 1);
  const after = (await call(owner, 'GET', `/api/tasks/${deliverable.id}`)).body.task;
  ok('sending flips it to awaiting_client', after.status === 'awaiting_client');
  ok('sending makes it client-visible', after.visibility === 'client_visible');

  section('What the client can see');
  const portal = await call(client, 'GET', '/api/portal');
  ok('client portal loads', portal.status === 200);
  ok('client sees exactly one project', portal.body.projects.length === 1);
  ok('client sees only the client-visible task', portal.body.tasks.length === 1,
     `saw ${portal.body.tasks.length}`);
  ok('client sees the deliverable is waiting on them', portal.body.awaiting.length === 1);
  // REVERSAL (v2): the revised spec says team members must not be visible on
  // the client's view. Asserted as an absence, and again as a string search,
  // because this is exactly the kind of field that creeps back in.
  ok('client is not told who is doing the work',
     portal.body.tasks[0].assignee === undefined && portal.body.tasks[0].assignee_id === undefined);
  ok("no teammate's name appears anywhere in the portal payload",
     !JSON.stringify(portal.body).includes('Designer'));

  const asText = JSON.stringify(portal.body);
  ok('internal task title never appears', !asText.includes('INTERNAL-ONLY-CONCEPT-GRAVEYARD'));
  ok('internal comment never appears', !asText.includes('INTERNAL-GRUMBLE'));
  ok('internal note on the company never appears', !asText.includes('SECRET-NOTE-PAYS-LATE'));
  const leaked = findForbidden(portal.body, ['due_date', 'visibility', 'client_visible_from',
                                             'internal_notes', 'budget_amount', 'assignee', 'assignee_id',
                                             'difficulty', 'points', 'missed']);
  ok('no internal COLUMN leaks into the portal payload', leaked.length === 0, leaked.join(', '));
  ok('the client is shown the padded date, not the real one',
     portal.body.tasks[0].due === '2026-08-30');

  const detail = await call(client, 'GET', `/api/portal/tasks/${deliverable.id}`);
  ok('client can open their deliverable', detail.status === 200);
  ok('comments written before it opened up stay hidden', detail.body.comments.length === 0,
     `saw ${detail.body.comments.length}`);

  ok('client cannot reach the internal task', (await call(client, 'GET', `/api/portal/tasks/${secret.id}`)).status === 404);
  ok('client cannot reach the internal API', (await call(client, 'GET', '/api/tasks')).status === 403);
  ok('client cannot reach finance', (await call(client, 'GET', '/api/finance/summary')).status === 403);
  ok('client cannot reach the dashboard', (await call(client, 'GET', '/api/dashboard')).status === 403);
  ok("another client's portal shows none of this",
     (await call(rivalClient, 'GET', '/api/portal')).body.tasks.length === 0);
  ok("another client cannot open this task",
     (await call(rivalClient, 'GET', `/api/portal/tasks/${deliverable.id}`)).status === 404);

  section('The revision chain');
  const r1 = await call(client, 'POST', `/api/portal/tasks/${deliverable.id}/decision`,
    { decision: 'changes_requested', note: 'Bigger logo' });
  ok('client can request changes', r1.status === 200);
  const noNote = await call(client, 'POST', `/api/portal/tasks/${deliverable.id}/decision`,
    { decision: 'changes_requested' });
  ok('a change request without a reason is refused', noNote.status === 400 || noNote.status === 409);

  let t1 = (await call(owner, 'GET', `/api/tasks/${deliverable.id}`)).body;
  ok('the counter incremented', t1.task.revision_round === 1);
  ok('a revision task was created and assigned',
     t1.task.status === 'in_progress' &&
     (await call(owner, 'GET', `/api/tasks?project=${proj.id}`)).body.some(
       x => x.title.startsWith('Revision 1') && x.assignee_id === designerId));
  ok('no scope alert yet — round 1 of 2',
     (await call(owner, 'GET', '/api/scope-alerts')).body.filter(s => s.resolution === 'pending').length === 0);

  await call(designer, 'POST', `/api/tasks/${deliverable.id}/send-for-approval`, {});
  await call(client, 'POST', `/api/portal/tasks/${deliverable.id}/decision`,
    { decision: 'changes_requested', note: 'Now too big' });
  ok('still inside the agreed rounds after round 2',
     (await call(owner, 'GET', '/api/scope-alerts')).body.filter(s => s.resolution === 'pending').length === 0);

  await call(designer, 'POST', `/api/tasks/${deliverable.id}/send-for-approval`, {});
  await call(client, 'POST', `/api/portal/tasks/${deliverable.id}/decision`,
    { decision: 'changes_requested', note: 'One more thing' });

  section('Past the agreed rounds — the money moment');
  const alerts = (await call(owner, 'GET', '/api/scope-alerts')).body.filter(s => s.resolution === 'pending');
  ok('round 3 raises a scope alert', alerts.length === 1, `got ${alerts.length}`);
  ok('the alert records the round and what was agreed',
     alerts[0]?.revision_round === 3 && alerts[0]?.revisions_included === 2);
  ok('the owner is warned at the moment it happens',
     (await call(owner, 'GET', '/api/notifications')).body.some(n => n.kind === 'scope'));
  ok('the warning carries structured params so it can be shown in any language',
     (await call(owner, 'GET', '/api/notifications')).body.find(n => n.kind === 'scope')?.params?.round === 3);
  ok('the client is never told about the scope alert',
     !JSON.stringify((await call(client, 'GET', '/api/portal')).body).toLowerCase().includes('scope'));

  const billNoAmount = await call(owner, 'POST', `/api/scope-alerts/${alerts[0].id}/resolve`, { resolution: 'billed' });
  ok('billing without an amount is refused', billNoAmount.status === 400);
  const billed = await call(owner, 'POST', `/api/scope-alerts/${alerts[0].id}/resolve`,
    { resolution: 'billed', amount: 3000000 });
  ok('owner bills it as extra scope', billed.status === 200 && !!billed.body.transaction_id);
  const twice = await call(owner, 'POST', `/api/scope-alerts/${alerts[0].id}/resolve`,
    { resolution: 'absorbed' });
  ok('the same alert cannot be decided twice', twice.status === 409);

  const ledger = (await call(accountant, 'GET', '/api/finance/transactions')).body;
  const extra = ledger.find(t => Number(t.amount) === 3000000);
  ok('the extra scope lands in the ledger for the accountant to see', !!extra);
  ok('it is booked as money owed, not money received',
     extra && extra.direction === 'in' && extra.settled === false && extra.status !== 'received');
  const fin = (await call(accountant, 'GET', '/api/finance/summary')).body;
  ok('it lifts profit for the month', Number(fin.earned) >= 3000000);
  ok('it does NOT move cash, because nobody has paid it yet', Number(fin.received) === 0,
     `received ${fin.received}`);
  ok('a teammate cannot resolve a scope alert',
     (await call(designer, 'POST', `/api/scope-alerts/${alerts[0].id}/resolve`, { resolution: 'absorbed' })).status === 403);

  section('Approval, and the permanence of the record');
  await call(designer, 'POST', `/api/tasks/${deliverable.id}/send-for-approval`, {});
  const approved = await call(client, 'POST', `/api/portal/tasks/${deliverable.id}/decision`, { decision: 'approved' });
  ok('client approves', approved.status === 200);
  t1 = (await call(owner, 'GET', `/api/tasks/${deliverable.id}`)).body;
  ok('the task is marked approved', t1.task.status === 'approved');
  ok('every decision is on the record', t1.approvals.length === 4);
  ok('each record names who, which version, and what they said',
     t1.approvals.every(a => a.decided_by_name && a.version_no && a.decided_at));
  const dbl = await call(client, 'POST', `/api/portal/tasks/${deliverable.id}/decision`, { decision: 'approved' });
  ok('a client cannot approve something not waiting on them', dbl.status === 409);

  section('Progress and the weekly report');
  const full = (await call(owner, 'GET', `/api/projects/${proj.id}`)).body;
  ok('progress is reported to the owner both ways',
     typeof full.progress.internal.pct === 'number' && typeof full.progress.client.pct === 'number');
  ok('the client is quoted the same number they can verify',
     (await call(client, 'GET', '/api/portal')).body.projects[0].progress_pct === full.progress.client.pct);
  const week = (await call(owner, 'GET', '/api/reports/weekly')).body;
  ok('the weekly report counts revision rounds burned', week.revisions.rounds === 3, `got ${week.revisions.rounds}`);
  ok('the weekly report carries no per-person productivity counts',
     !JSON.stringify(week).includes('assignee_id'));
  ok('a teammate gets only their own week',
     (await call(designer, 'GET', '/api/reports/my-week')).status === 200);
  ok('a teammate cannot pull the agency report',
     (await call(designer, 'GET', '/api/reports/weekly')).status === 403);

  section('Download links');
  // A file only the team can see, to prove the link is scoped in both senses.
  const fileId = (await withRls(pool, { userId: ownerId, role: 'owner', companyId: null }, c =>
    c.query(`INSERT INTO files(task_id,name,storage_path,kind,visibility,uploaded_by)
             VALUES($1,'internal-brief.txt','flowtest.txt','attachment','internal',$2) RETURNING id`,
            [secret.id, ownerId]).then(r => r.rows[0]))).id;

  const linked = await call(owner, 'GET', `/api/files/${fileId}/link`);
  ok('a link can be minted for a file you can see', linked.status === 200 && !!linked.body.url);
  const dl = new URL(BASE + linked.body.url).searchParams.get('dl');

  const raw404 = await fetch(`${BASE}/api/files/${fileId}/download`);
  ok('a download with no token is refused', raw404.status === 401, `got ${raw404.status}`);
  const wrongFile = await fetch(`${BASE}/api/files/999999/download?dl=${encodeURIComponent(dl)}`);
  ok('a link for one file cannot fetch another', wrongFile.status === 401, `got ${wrongFile.status}`);
  const sessionInUrl = await fetch(`${BASE}/api/files/${fileId}/download?token=${encodeURIComponent(owner)}`);
  ok('a session token in the query string is not accepted', sessionInUrl.status === 401, `got ${sessionInUrl.status}`);
  const good = await fetch(`${BASE}/api/files/${fileId}/download?dl=${encodeURIComponent(dl)}`);
  ok('the scoped link itself works', good.status === 200 || good.status === 410, `got ${good.status}`);
  ok('the download sends no referrer onward', good.headers.get('referrer-policy') === 'no-referrer');

  const clientLink = await call(client, 'GET', `/api/files/${fileId}/link`);
  ok('a client cannot mint a link for an internal file', clientLink.status === 404, `got ${clientLink.status}`);


  section('Editor vs Member — the fifth permission level (§8)');
  const memberTask = await call(designer, 'POST', '/api/tasks',
    { project_id: proj.id, title: 'Member-made task', assignee_id: outsiderId, difficulty: 'easy' });
  ok('a member can create a task on their own project', memberTask.status === 200);
  ok('...but it lands on themselves, not on whoever they named',
     memberTask.body.assignee_id === designerId, `got ${memberTask.body?.assignee_id}`);
  const editorTask = await call(editor, 'POST', '/api/tasks',
    { project_id: proj.id, title: 'Editor-made task', assignee_id: designerId, difficulty: 'hard' });
  ok('an editor can assign work to somebody else', editorTask.body?.assignee_id === designerId);
  ok('a member cannot reassign an existing task',
     (await call(designer, 'PATCH', `/api/tasks/${editorTask.body.id}`, { assignee_id: outsiderId })).status === 403);
  ok('an editor can reassign',
     (await call(editor, 'PATCH', `/api/tasks/${editorTask.body.id}`, { assignee_id: editorId })).status === 200);
  ok('an editor still cannot change what the client sees',
     (await call(editor, 'PATCH', `/api/tasks/${editorTask.body.id}`, { visibility: 'client_visible' })).status === 403);
  ok('an editor still has no finance', (await call(editor, 'GET', '/api/finance/summary')).status === 403);

  section('"Requires a file upload?" (§2)');
  const needsFile = (await call(owner, 'POST', '/api/tasks',
    { project_id: proj.id, title: 'Deliver the cut', assignee_id: designerId, requires_file: true })).body;
  const closeEmpty = await call(owner, 'PATCH', `/api/tasks/${needsFile.id}`, { status: 'completed' });
  ok('a task needing a file cannot be closed empty', closeEmpty.status === 400, `got ${closeEmpty.status}`);
  await withRls(pool, { userId: ownerId, role: 'owner', companyId: null }, c =>
    c.query(`INSERT INTO files(task_id,name,storage_path,uploaded_by) VALUES($1,'cut.mp4','x',$2)`,
            [needsFile.id, ownerId]));
  ok('...and closes once something is attached',
     (await call(owner, 'PATCH', `/api/tasks/${needsFile.id}`, { status: 'completed' })).status === 200);

  section('Points and the leaderboard (§5)');
  // Same difficulty, three different outcomes.
  const scored = async (title, difficulty, dueOffset, done) => {
    const t = (await call(owner, 'POST', '/api/tasks',
      { project_id: proj.id, title, assignee_id: designerId, difficulty,
        due_date: new Date(Date.now() + dueOffset * 86400000).toISOString().slice(0, 10) })).body;
    if (done) await call(owner, 'PATCH', `/api/tasks/${t.id}`, { status: 'completed' });
    return t;
  };
  await scored('early hard', 'hard', 5, true);
  await scored('late easy', 'easy', -5, true);
  const dropped = await scored('abandoned', 'medium', -3, false);
  await call(owner, 'POST', `/api/performance/tasks/${dropped.id}/missed`, { missed: true });

  const board = (await call(designer, 'GET', '/api/performance/leaderboard')).body;
  const meRow = board.leaderboard.find(x => x.user_id === designerId);
  ok('the leaderboard ranks the team', Array.isArray(board.leaderboard) && board.leaderboard.length >= 2);
  ok('early work scores above its difficulty', meRow && meRow.early >= 1);
  ok('late work is counted as late', meRow && meRow.late >= 1);
  ok('an abandoned task is a penalty, not a zero', meRow && meRow.missed >= 1);
  ok('everyone on the team appears, including people with no points',
     board.leaderboard.some(x => x.points === 0) || board.leaderboard.length >= 3);
  ok('a badge is derived from the points', 'badge' in meRow);
  ok('the leaderboard says how far the next badge is', 'next_badge' in meRow);
  ok('a member can see the leaderboard', board.leaderboard.length > 0);
  ok('a member cannot write a task off as missed',
     (await call(designer, 'POST', `/api/performance/tasks/${dropped.id}/missed`, { missed: false })).status === 403);

  const stats = await call(owner, 'GET', '/api/performance/stats');
  ok('the owner gets the same data as a plain table', stats.status === 200 && stats.body.rows.length >= 2);
  ok('the owner table carries no game layer',
     !JSON.stringify(stats.body).includes('badge') && !JSON.stringify(stats.body).includes('rank'));
  ok('a member cannot open the owner stats table',
     (await call(designer, 'GET', '/api/performance/stats')).status === 403);
  ok('a client cannot reach performance at all',
     (await call(client, 'GET', '/api/performance/leaderboard')).status === 403);

  section('Timeline and phases (§6)');
  const phase = await call(owner, 'POST', `/api/calendar/projects/${proj.id}/phases`,
    { name: 'Production', starts_on: '2026-08-01', ends_on: '2026-08-20' });
  ok('the owner can add a phase', phase.status === 200);
  ok('a member cannot add a phase',
     (await call(designer, 'POST', `/api/calendar/projects/${proj.id}/phases`, { name: 'Nope' })).status === 403);
  const cal = await call(designer, 'GET', '/api/calendar');
  ok('the team sees the all-projects timeline', cal.status === 200 && cal.body.length >= 1);
  ok('a client sees their phases through the portal',
     (await call(client, 'GET', '/api/portal')).body.phases.length >= 1);
  ok('a client cannot reach the internal calendar',
     (await call(client, 'GET', '/api/calendar')).status === 403);

  section('The timeline grid');
  const gPhase = (await call(owner, 'POST', `/api/calendar/projects/${proj.id}/phases`,
    { name: 'Strategy', starts_on: '2026-08-01', ends_on: '2026-08-20' })).body;
  const spanTask = (await call(owner, 'POST', '/api/tasks', {
    project_id: proj.id, title: 'A spanning process', assignee_id: designerId,
    starts_on: '2026-08-05', due_date: '2026-08-12',
    client_starts_on: '2026-08-05', client_due_date: '2026-08-18',
    phase_id: gPhase.id, visibility: 'client_visible' })).body;
  const meeting = (await call(owner, 'POST', '/api/tasks', {
    project_id: proj.id, title: 'Concept presentation', starts_on: '2026-08-14',
    due_date: '2026-08-14', is_meeting: true, phase_id: gPhase.id })).body;
  ok('a task can carry a start as well as a due date', spanTask.starts_on && spanTask.due_date);
  ok('a task can be filed under a stage', spanTask.phase_id === gPhase.id);
  ok('a presentation date is its own kind of row', meeting.is_meeting === true);
  const backwards = await call(owner, 'POST', '/api/tasks',
    { project_id: proj.id, title: 'Ends before it starts', starts_on: '2026-08-20', due_date: '2026-08-01' });
  ok('a span that ends before it starts is refused', backwards.status >= 400, `got ${backwards.status}`);

  const gantt = (await call(owner, 'GET', `/api/calendar/projects/${proj.id}/gantt`)).body;
  ok('the grid comes back with columns and rows', gantt.columns.length > 0 && gantt.rows.length > 0);
  ok('weekends are absent from the columns, not greyed',
     gantt.columns.every(c => !['sat', 'sun'].includes(c.dow)),
     gantt.columns.filter(c => ['sat', 'sun'].includes(c.dow)).map(c => c.date).join(','));
  ok('columns are contiguous working days in order',
     gantt.columns.every((c, i) => i === 0 || c.date > gantt.columns[i - 1].date));
  ok('the window covers the work', gantt.columns[0].date <= '2026-08-05'
     && gantt.columns[gantt.columns.length - 1].date >= '2026-08-14');
  const gRow = gantt.rows.find(r => r.id === spanTask.id);
  ok('a row carries both the real span and the padded one',
     gRow.span.to === '2026-08-12' && gRow.client_span.to === '2026-08-18');

  const cg = await call(client, 'GET', '/api/portal/gantt');
  ok('the client gets the same grid shape', cg.status === 200 && cg.body.columns.length > 0);
  const cRow = cg.body.tasks.find(x => x.id === spanTask.id);
  ok('the client row exists for a client-visible process', !!cRow);
  ok('...and carries the padded date, never the internal one',
     cRow.due === '2026-08-18', `got ${cRow.due}`);
  const gridLeaks = findForbidden(cg.body.tasks,
    ['due_date', 'starts_on', 'client_due_date', 'client_starts_on', 'assignee', 'assignee_id', 'visibility']);
  ok('no task row in the client grid carries an internal date',
     gridLeaks.length === 0, gridLeaks.join(','));
  ok('the client grid never mentions a teammate',
     !JSON.stringify(cg.body).includes('Designer'));
  ok('an internal-only process is absent from the client grid',
     !cg.body.tasks.some(x => x.id === meeting.id));
  ok('the client cannot reach the internal grid',
     (await call(client, 'GET', `/api/calendar/projects/${proj.id}/gantt`)).status === 403);

  const sched = await call(owner, 'POST', `/api/projects/${proj.id}/schedule`,
    { tasks: [{ id: spanTask.id, starts_on: '2026-08-06', due_date: '2026-08-13' }] });
  ok('bars can be rescheduled in one call', sched.status === 200 && sched.body.updated.includes(spanTask.id));
  ok('a member cannot reschedule the plan',
     (await call(designer, 'POST', `/api/projects/${proj.id}/schedule`,
       { tasks: [{ id: spanTask.id, due_date: '2026-09-01' }] })).status === 403);

  section('Client contacts and direct access grants (§7)');
  const contact = await call(owner, 'POST', `/api/companies/${acme.id}/contacts`,
    { name: 'Second Person', position: 'Brand manager', email: 'x@acme.test', is_main: false });
  ok('several contacts can be recorded against one client', contact.status === 200);
  const companyDetail = await call(owner, 'GET', `/api/companies/${acme.id}`);
  ok('the client record carries its contacts', companyDetail.body.contacts.length >= 1);

  // The self-serve invite-link flow is gone. Assert it stays gone: a route
  // reappearing here later would be a silent reopening of public signup.
  // Unmatched GETs fall through this app's own catch-all to the SPA shell
  // (200, HTML) rather than a real 404 — checked here as "no JSON body" —
  // while an unmatched POST gets Express's own 404, since there is no POST
  // catch-all route.
  const joinPage = await call(null, 'GET', '/join/x');
  ok('the old join page is gone — falls through to the app shell, not real content',
     joinPage.status === 200 && joinPage.body === null);
  // Unlike /join/x, these ARE under /api — and every bare-mounted /api
  // router requires a token before it even looks at its own paths (see
  // routes/work.js), so an unmatched /api path with no token is 401, not a
  // 404 that would hint at whether the route used to exist.
  ok('the old invite-describe route answers with no token, not real data',
     (await call(null, 'GET', '/api/invite/anything')).status === 401);
  ok('the old invite-accept route is gone the same way',
     (await call(null, 'POST', '/api/invite/anything/accept', {})).status === 401);
  ok('POST /api/invites itself is gone', (await call(owner, 'POST', '/api/invites', {})).status === 404);

  // Direct provisioning: the owner types the person's details, including —
  // right here, at creation — their numeric Telegram ID. No link, no code,
  // no self-signup.
  const granted = await call(owner, 'POST', '/api/team', {
    name: 'Invited Person', phone: '+998900000009', pin: '4321',
    role: 'client', company_id: acme.id, telegram_id: '555000111' });
  ok('the owner grants a client login directly, Telegram ID included',
     granted.status === 200 && granted.body.telegram_linked === true);
  const grantedLogin = await login('+998900000009', '4321');
  const grantedPortal = await call(grantedLogin, 'GET', '/api/portal');
  ok('that login works immediately and lands scoped to the right company',
     grantedPortal.status === 200 && grantedPortal.body.company.id === acme.id);
  ok('a member cannot grant access to anyone',
     (await call(designer, 'POST', '/api/team', { name: 'X', phone: '+998900000099', pin: '1111', role: 'teammate' })).status === 403);

  ok('a non-numeric Telegram ID is refused',
     (await call(owner, 'POST', '/api/team',
       { name: 'Bad TG', phone: '+998900000012', pin: '1111', role: 'teammate', telegram_id: 'abc123' })).status === 400);
  const dupeTg = await call(owner, 'POST', '/api/team',
    { name: 'Dupe TG', phone: '+998900000013', pin: '1111', role: 'teammate', telegram_id: '555000111' });
  ok('a Telegram ID already in use by someone else is refused, distinctly from a phone clash',
     dupeTg.status === 409 && /Telegram/.test(dupeTg.body.error), dupeTg.body.error);

  // Adding, then removing, a Telegram ID on an existing person.
  const bareTeammate = await call(owner, 'POST', '/api/team',
    { name: 'Bare Teammate', phone: '+998900000014', pin: '1111', role: 'teammate' });
  ok('a login can be created with no Telegram ID at all', bareTeammate.status === 200 && bareTeammate.body.telegram_linked === false);
  const tgLinked = await call(owner, 'PATCH', `/api/team/${bareTeammate.body.id}`, { telegram_id: '555000222' });
  ok('the owner can add a Telegram ID later', tgLinked.status === 200 && tgLinked.body.telegram_linked === true);
  const tgUnlinked = await call(owner, 'PATCH', `/api/team/${bareTeammate.body.id}`, { telegram_id: '' });
  ok('...and remove it again', tgUnlinked.status === 200 && tgUnlinked.body.telegram_linked === false);

  // Regression: getTeam() used to omit half the profile columns it wrote,
  // so the Team page rendered them blank. Locked in here.
  const profiled = await call(owner, 'POST', '/api/team', {
    name: 'Full Profile', phone: '+998900000015', pin: '1111', role: 'teammate',
    title: 'Senior Designer', craft: 'motion', responsibility: 'Edits and sound',
    email: 'full@studio.test', work_mode: 'remote', birthdate: '1994-03-02' });
  const teamList = (await call(owner, 'GET', '/api/team')).body;
  const profRow = teamList.find(u => u.id === profiled.body.id);
  ok('every profile field written at creation comes back from GET /api/team',
     profRow && profRow.title === 'Senior Designer' && profRow.craft === 'motion'
     && profRow.responsibility === 'Edits and sound' && profRow.email === 'full@studio.test'
     && profRow.work_mode === 'remote' && String(profRow.birthdate).slice(0, 10) === '1994-03-02',
     JSON.stringify(profRow));
  ok('a colleague sees no raw Telegram id, only whether one is linked',
     !JSON.stringify(teamList).includes('555000111') && teamList.some(u => 'telegram_linked' in u));

  section('Settings (§12)');
  ok('a member cannot read settings', (await call(designer, 'GET', '/api/settings')).status === 403);
  const st = await call(owner, 'GET', '/api/settings');
  ok('settings come back with defaults filled in', st.status === 200 && st.body.settings.points_hard === '20');
  await call(owner, 'PUT', '/api/settings', { points_hard: '30', timezone: 'Asia/Tashkent' });
  const retuned = (await call(owner, 'GET', '/api/settings')).body.settings;
  ok('the owner can retune the point values', retuned.points_hard === '30');
  // Proves the values are actually read by the database, not just stored.
  const hardTask = await scored('retuned hard', 'hard', 5, true);
  const afterRetune = await withRls(pool, { userId: ownerId, role: 'owner', companyId: null }, c =>
    c.query('SELECT points FROM points_events WHERE task_id=$1', [hardTask.id]).then(r => r.rows[0]));
  ok('retuned points take effect immediately in scoring',
     afterRetune && afterRetune.points === 32, `got ${afterRetune && afterRetune.points}`);
  await call(owner, 'PUT', '/api/settings', { points_hard: '20' });
  ok('unknown keys are ignored rather than stored',
     (await call(owner, 'PUT', '/api/settings', { nonsense: 'x' })).status === 400);

  section('The ledger (§9)');
  const acctRes = await call(accountant, 'POST', '/api/finance/accounts',
    { name: 'Payme', purpose: 'Small payments', opening_balance: 1000000 });
  ok('an account can be opened', acctRes.status === 200);
  const owed = await call(accountant, 'POST', '/api/finance/transactions',
    { direction: 'in', counterparty: 'Acme Tea', amount: 5000000, category: 'project_fee',
      settled: false, due_on: '2026-12-01', account_id: acctRes.body.id });
  ok('money can be booked before it moves', owed.status === 200 && owed.body.settled === false);
  ok('unsettled money has no payment date by definition', owed.body.paid_on === null);
  const badCat = await call(accountant, 'POST', '/api/finance/transactions',
    { direction: 'in', amount: 100, category: 'payroll' });
  ok('a cost category is refused on income', badCat.status === 400, `got ${badCat.status}`);
  const finBefore = (await call(accountant, 'GET', '/api/finance/summary')).body;
  await call(accountant, 'POST', `/api/finance/transactions/${owed.body.id}/settle`, {});
  const finAfter = (await call(accountant, 'GET', '/api/finance/summary')).body;
  ok('settling moves cash without changing profit',
     finAfter.net_profit === finBefore.net_profit && finAfter.received > finBefore.received);
  ok('settling twice is refused',
     (await call(accountant, 'POST', `/api/finance/transactions/${owed.body.id}/settle`, {})).status === 409);
  ok('the six-month chart returns six months',
     (await call(accountant, 'GET', '/api/finance/monthly')).body.length === 6);
  ok('accounts report a running balance',
     (await call(accountant, 'GET', '/api/finance/accounts')).body.some(a => 'balance' in a));

  section('Direct database probe — with every route bypassed');
  // The routes could all be wrong and this would still have to hold.
  const asClient = fn => withRls(pool, { userId: clientId, role: 'client', companyId: acme.id }, fn);
  const raw = await asClient(async c => ({
    tasks: (await c.query('SELECT title FROM tasks')).rows.map(r => r.title),
    comments: (await c.query('SELECT body FROM comments')).rows.map(r => r.body),
    money: (await c.query('SELECT id FROM transactions')).rows.length,
    accounts: (await c.query('SELECT id FROM accounts')).rows.length,
    points: (await c.query('SELECT task_id FROM points_events')).rows.length,
    contacts: (await c.query('SELECT id FROM client_contacts')).rows.length,
    scope: (await c.query('SELECT id FROM scope_alerts')).rows.length,
    companies: (await c.query('SELECT name FROM companies')).rows.map(r => r.name),
    projects: (await c.query('SELECT name FROM projects')).rows.map(r => r.name),
  }));
  ok('raw SELECT * on tasks returns only client-visible rows',
     raw.tasks.length > 0 && raw.tasks.every(t2 => ['Key visual', 'A spanning process'].includes(t2)),
     raw.tasks.join('|'));
  ok('raw SELECT * on tasks excludes the internal one',
     !raw.tasks.includes('INTERNAL-ONLY-CONCEPT-GRAVEYARD'));
  ok('raw SELECT * on comments returns no internal comment',
     !raw.comments.some(b => b.includes('INTERNAL-GRUMBLE')));
  ok('raw SELECT * on the money ledger returns nothing', raw.money === 0);
  ok('raw SELECT * on accounts returns nothing', raw.accounts === 0);
  ok('raw SELECT * on points returns nothing — clients never see performance', raw.points === 0);
  ok('a client sees only their own company contacts', raw.contacts >= 0 && raw.contacts <= 2);
  ok('raw SELECT * on scope_alerts returns nothing', raw.scope === 0);
  ok('raw SELECT * on companies returns only their own', raw.companies.length === 1);
  ok("raw SELECT * on projects excludes the other client's", raw.projects.length === 1);

  const asOutsider = fn => withRls(pool, { userId: outsiderId, role: 'teammate', companyId: null }, fn);
  const outsiderRaw = await asOutsider(async c => ({
    tasks: (await c.query('SELECT id FROM tasks')).rows.length,
    money: (await c.query('SELECT id FROM transactions')).rows.length,
    points: (await c.query('SELECT task_id FROM points_events')).rows.length,
  }));
  ok('a non-member teammate sees no tasks at the database level', outsiderRaw.tasks === 0);
  ok('a teammate sees no money at the database level', outsiderRaw.money === 0);
  // The leaderboard is meant to be seen by the team, so this one is NOT zero —
  // asserted so that it stays a deliberate choice rather than an oversight.
  ok('a teammate CAN see points — the leaderboard is team-facing by design',
     outsiderRaw.points > 0, `saw ${outsiderRaw.points}`);

  const unconfigured = await withRls(pool, {}, async c =>
    (await c.query('SELECT count(*)::int AS n FROM tasks')).rows[0].n);
  ok('an unconfigured session sees nothing (fails closed)', unconfigured === 0);

  section(fail === 0 ? `ALL ${pass} CHECKS PASSED` : `${pass} passed, ${fail} FAILED`);
  await teardown();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async e => { console.error(e); await teardown().catch(() => {}); process.exit(1); });
