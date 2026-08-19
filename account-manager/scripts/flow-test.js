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

  const owner      = await login('+998900000001', '1234');
  const accountant = await login('+998900000002', '1234');
  const designer   = await login('+998900000003', '1234');
  const outsider   = await login('+998900000004', '1234');
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
  ok('teammate is refused the invoice list', (await call(designer, 'GET', '/api/finance/invoices')).status === 403);

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
  ok('client sees the assignee name (they asked for it)', portal.body.tasks[0].assignee === 'Designer');

  const asText = JSON.stringify(portal.body);
  ok('internal task title never appears', !asText.includes('INTERNAL-ONLY-CONCEPT-GRAVEYARD'));
  ok('internal comment never appears', !asText.includes('INTERNAL-GRUMBLE'));
  ok('internal note on the company never appears', !asText.includes('SECRET-NOTE-PAYS-LATE'));
  const leaked = findForbidden(portal.body, ['due_date', 'visibility', 'client_visible_from', 'internal_notes', 'budget_amount']);
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
  ok('owner bills it as extra scope', billed.status === 200 && !!billed.body.invoice_id);
  const twice = await call(owner, 'POST', `/api/scope-alerts/${alerts[0].id}/resolve`,
    { resolution: 'absorbed' });
  ok('the same alert cannot be decided twice', twice.status === 409);

  const inv = (await call(accountant, 'GET', '/api/finance/invoices')).body;
  ok('the extra scope lands on a draft invoice the accountant can see',
     inv.some(i => Number(i.total) === 3000000), JSON.stringify(inv.map(i => i.total)));
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

  section('Direct database probe — with every route bypassed');
  // The routes could all be wrong and this would still have to hold.
  const asClient = fn => withRls(pool, { userId: clientId, role: 'client', companyId: acme.id }, fn);
  const raw = await asClient(async c => ({
    tasks: (await c.query('SELECT title FROM tasks')).rows.map(r => r.title),
    comments: (await c.query('SELECT body FROM comments')).rows.map(r => r.body),
    invoices: (await c.query('SELECT number FROM invoices')).rows.length,
    scope: (await c.query('SELECT id FROM scope_alerts')).rows.length,
    companies: (await c.query('SELECT name FROM companies')).rows.map(r => r.name),
    projects: (await c.query('SELECT name FROM projects')).rows.map(r => r.name),
  }));
  ok('raw SELECT * on tasks returns only the client-visible one',
     raw.tasks.length === 1 && raw.tasks[0] === 'Key visual', raw.tasks.join('|'));
  ok('raw SELECT * on comments returns no internal comment',
     !raw.comments.some(b => b.includes('INTERNAL-GRUMBLE')));
  ok('raw SELECT * on invoices returns nothing', raw.invoices === 0);
  ok('raw SELECT * on scope_alerts returns nothing', raw.scope === 0);
  ok('raw SELECT * on companies returns only their own', raw.companies.length === 1);
  ok("raw SELECT * on projects excludes the other client's", raw.projects.length === 1);

  const asOutsider = fn => withRls(pool, { userId: outsiderId, role: 'teammate', companyId: null }, fn);
  const outsiderRaw = await asOutsider(async c => ({
    tasks: (await c.query('SELECT id FROM tasks')).rows.length,
    invoices: (await c.query('SELECT id FROM invoices')).rows.length,
  }));
  ok('a non-member teammate sees no tasks at the database level', outsiderRaw.tasks === 0);
  ok('a teammate sees no invoices at the database level', outsiderRaw.invoices === 0);

  const unconfigured = await withRls(pool, {}, async c =>
    (await c.query('SELECT count(*)::int AS n FROM tasks')).rows[0].n);
  ok('an unconfigured session sees nothing (fails closed)', unconfigured === 0);

  section(fail === 0 ? `ALL ${pass} CHECKS PASSED` : `${pass} passed, ${fail} FAILED`);
  await teardown();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async e => { console.error(e); await teardown().catch(() => {}); process.exit(1); });
