#!/usr/bin/env node
// A demo agency with enough history that every screen has something real on
// it: work in flight, a deliverable sitting with a client, two revision rounds
// burned, and one project already past its agreed rounds so the scope warning
// is visible on the very first load.
const db = require('../db');
const { controlPool, hashPin, getTenantPool } = db;
const { asSystem } = require('../lib/rls');
const { evictTenantPool } = require('../lib/tenant-pool');

const CODE = process.env.DEMO_CODE || 'DEMO';
const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

async function main() {
  await db.init();

  const existing = (await controlPool.query('SELECT * FROM tenants WHERE code=$1', [CODE])).rows[0];
  if (existing) {
    console.log(`Removing the previous ${CODE} demo…`);
    await controlPool.query('DELETE FROM users WHERE tenant_id=$1', [existing.id]);
    await controlPool.query('DELETE FROM tenants WHERE id=$1', [existing.id]);
    await evictTenantPool(existing.db_name);
    const c = await controlPool.connect();
    try {
      await c.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1`, [existing.db_name]);
      await c.query(`DROP DATABASE IF EXISTS "${existing.db_name}"`);
    } finally { c.release(); }
  }

  const { tenant, ownerId } = await db.provisionTenant({
    name: 'Studio Nur', code: CODE,
    ownerName: 'Dilnoza Karimova', ownerPhone: '+998901112233', ownerPin: '1234',
  });

  const addUser = async (name, phone, role, opts = {}) => (await controlPool.query(
    `INSERT INTO users(tenant_id,name,phone,pin_hash,role,company_id,craft)
     VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [tenant.id, name, phone, hashPin(opts.pin || '1234'), role, opts.companyId || null, opts.craft || ''])).rows[0].id;

  const accountant = await addUser('Nodira Yusupova', '+998901112234', 'accountant');
  const designer   = await addUser('Jasur Rahimov',   '+998901112235', 'teammate', { craft: 'designer' });
  const smm        = await addUser('Malika Tosheva',  '+998901112236', 'teammate', { craft: 'smm' });
  const copy       = await addUser('Sardor Aliyev',   '+998901112237', 'teammate', { craft: 'copywriter' });
  const motion     = await addUser('Aziza Nazarova',  '+998901112238', 'teammate', { craft: 'motion' });

  const pool = getTenantPool(tenant.db_name);
  const ids = await asSystem(pool, async c => {
    const q = (t, p) => c.query(t, p).then(r => r.rows[0]);

    const osiyo = await q(`INSERT INTO companies(name,contact_name,contact_phone,telegram_username,internal_notes)
      VALUES('Osiyo Coffee','Aziz Umarov','+998935550101','azizumarov',
             'Pays 2 weeks late every time. Do not start round 3 without a signed PO.') RETURNING id`);
    const silk = await q(`INSERT INTO companies(name,contact_name,contact_phone,telegram_username,internal_notes)
      VALUES('Silk Road Travel','Kamola Rashidova','+998935550102','kamolar',
             'Lovely to work with. Decides fast. Upsell the video package in Q4.') RETURNING id`);
    const zamin = await q(`INSERT INTO companies(name,contact_name,contact_phone,internal_notes)
      VALUES('Zamin Bank','Timur Sodiqov','+998935550103',
             'Committee approvals — expect three rounds minimum. Price accordingly.') RETURNING id`);

    // Two rounds included, deliberately: the third request is the whole point.
    const ramadan = await q(`INSERT INTO projects(company_id,name,description,stage,revisions_included,owner_id,
                                                  starts_on,due_date,client_due_date,budget_amount)
      VALUES($1,'Ramadan campaign','Key visual, 6 posts, one 20s cut.','production',2,$2,$3,$4,$5,48000000) RETURNING id`,
      [osiyo.id, ownerId, day(-21), day(6), day(9)]);
    const rebrand = await q(`INSERT INTO projects(company_id,name,description,stage,revisions_included,owner_id,
                                                  starts_on,due_date,client_due_date,budget_amount,client_visible)
      VALUES($1,'Rebrand — phase 1','Naming territory and logo routes.','brief',3,$2,$3,$4,$5,90000000,false) RETURNING id`,
      [osiyo.id, ownerId, day(-5), day(30), day(35)]);
    const summer = await q(`INSERT INTO projects(company_id,name,description,stage,revisions_included,owner_id,
                                                 starts_on,due_date,client_due_date,budget_amount)
      VALUES($1,'Summer promo','Landing page and a 3-week paid social burst.','review',2,$2,$3,$4,$5,36000000) RETURNING id`,
      [silk.id, ownerId, day(-30), day(-2), day(3)]);
    const cards = await q(`INSERT INTO projects(company_id,name,description,stage,revisions_included,owner_id,
                                                starts_on,due_date,client_due_date,budget_amount)
      VALUES($1,'Card launch','Product film and in-branch posters.','production',2,$2,$3,$4,$5,120000000) RETURNING id`,
      [zamin.id, ownerId, day(-14), day(11), day(14)]);

    for (const [p, u, craft] of [
      [ramadan.id, designer, 'designer'], [ramadan.id, smm, 'smm'], [ramadan.id, copy, 'copywriter'],
      [rebrand.id, designer, 'designer'], [rebrand.id, copy, 'copywriter'],
      [summer.id, smm, 'smm'], [summer.id, designer, 'designer'],
      [cards.id, motion, 'motion'], [cards.id, designer, 'designer'], [cards.id, copy, 'copywriter'],
    ]) await c.query('INSERT INTO project_members(project_id,user_id,craft) VALUES($1,$2,$3)', [p, u, craft]);

    const task = async (project, title, o = {}) => (await q(
      `INSERT INTO tasks(project_id,title,description,status,visibility,assignee_id,due_date,client_due_date,
                         is_deliverable,created_by,position)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [project, title, o.description || '', o.status || 'todo', o.visibility || 'internal',
       o.assignee || null, o.due || null, o.clientDue || null,
       o.deliverable !== false, ownerId, o.pos || 0])).id;

    // ---- Osiyo / Ramadan: the flagship story ------------------------------
    const keyVisual = await task(ramadan.id, 'Key visual', {
      description: 'Master lockup for the campaign, adapted to 3 formats.',
      status: 'awaiting_client', visibility: 'client_visible',
      assignee: designer, due: day(-4), clientDue: day(-1), pos: 1 });
    const posts = await task(ramadan.id, '6 feed posts', {
      status: 'in_progress', visibility: 'client_visible', assignee: smm, due: day(3), clientDue: day(6), pos: 2 });
    const film = await task(ramadan.id, '20s cut', {
      status: 'todo', visibility: 'client_visible', assignee: motion, due: day(5), clientDue: day(8), pos: 3 });
    await task(ramadan.id, 'Concepts we are NOT showing them', {
      description: 'Route B was a mess. Keep for the retro, never send.',
      status: 'completed', visibility: 'internal', assignee: designer, deliverable: false, pos: 9 });

    await c.query(`INSERT INTO comments(task_id,author_id,body,visibility,created_at) VALUES
      ($1,$2,'Third font trial. If they bounce this one we are into extra scope.','internal', now() - interval '9 days'),
      ($1,$2,'Updated the lockup and the Ramadan crescent weight as discussed.','client_visible', now() - interval '2 days')`,
      [keyVisual, designer]);

    // Two rounds used, then a third — which trips the scope warning on load.
    await c.query(`INSERT INTO task_versions(task_id,version_no,note,sent_by,sent_at)
      VALUES($1,1,'First route',$2, now() - interval '12 days'),
             ($1,2,'Bigger logo as asked',$2, now() - interval '7 days'),
             ($1,3,'Back to the tighter lockup',$2, now() - interval '3 days')`, [keyVisual, designer]);

    return { osiyo: osiyo.id, silk: silk.id, zamin: zamin.id,
             ramadan: ramadan.id, rebrand: rebrand.id, summer: summer.id, cards: cards.id,
             keyVisual, posts, film };
  });

  // The client's own decisions, made as the client, so the trigger chain runs
  // exactly as it will in production rather than being faked into the tables.
  const clientAziz = await addUser('Aziz Umarov', '+998935550101', 'client', { companyId: ids.osiyo, pin: '1111' });
  const clientKamola = await addUser('Kamola Rashidova', '+998935550102', 'client', { companyId: ids.silk, pin: '2222' });
  const { withRls } = require('../lib/rls');
  const asAziz = fn => withRls(pool, { userId: clientAziz, role: 'client', companyId: ids.osiyo }, fn);

  await asAziz(c => c.query(
    `INSERT INTO approvals(task_id,version_no,decision,decided_by,decided_by_name,note,decided_at)
     VALUES($1,1,'changes_requested',$2,'Aziz Umarov','Logo feels small next to the crescent.', now() - interval '10 days')`,
    [ids.keyVisual, clientAziz]));
  await asAziz(c => c.query(
    `INSERT INTO approvals(task_id,version_no,decision,decided_by,decided_by_name,note,decided_at)
     VALUES($1,2,'changes_requested',$2,'Aziz Umarov','Now it is too big. Sorry — somewhere in between.', now() - interval '6 days')`,
    [ids.keyVisual, clientAziz]));
  await asAziz(c => c.query(
    `INSERT INTO approvals(task_id,version_no,decision,decided_by,decided_by_name,note,decided_at)
     VALUES($1,3,'changes_requested',$2,'Aziz Umarov','Closer. Can we try the gold on the crescent?', now() - interval '1 day')`,
    [ids.keyVisual, clientAziz]));

  // Put it back in front of the client so the portal has a live decision to make.
  await asSystem(pool, async c => {
    await c.query(`INSERT INTO task_versions(task_id,version_no,note,sent_by) VALUES($1,4,'Gold crescent',$2)`,
      [ids.keyVisual, designer]);

    await c.query(`INSERT INTO invoices(company_id,project_id,number,issued_on,due_on,status)
      VALUES($1,$2,'INV-1041',CURRENT_DATE - 20, CURRENT_DATE - 6,'sent') RETURNING id`, [ids.osiyo, ids.ramadan]);
    await c.query(`INSERT INTO invoice_lines(invoice_id,description,qty,unit_amount)
      VALUES((SELECT id FROM invoices WHERE number='INV-1041'),'Ramadan campaign — 50% on brief',1,24000000)`);
    await c.query(`INSERT INTO invoices(company_id,project_id,number,issued_on,due_on,status)
      VALUES($1,$2,'INV-1042',CURRENT_DATE - 12, CURRENT_DATE + 2,'sent')`, [ids.silk, ids.summer]);
    await c.query(`INSERT INTO invoice_lines(invoice_id,description,qty,unit_amount)
      VALUES((SELECT id FROM invoices WHERE number='INV-1042'),'Summer promo — full fee',1,36000000)`);
    await c.query(`INSERT INTO payments(company_id,invoice_id,amount,paid_on,method,recorded_by)
      VALUES($1,(SELECT id FROM invoices WHERE number='INV-1042'),36000000,CURRENT_DATE - 3,'transfer',$2)`,
      [ids.silk, accountant]);
    await c.query(`UPDATE invoices SET status='paid' WHERE number='INV-1042'`);
  });

  console.log(`
✓ Demo agency "Studio Nur" (${CODE}) is ready.

  Account manager   +998901112233  PIN 1234    everything
  Accountant        +998901112234  PIN 1234    finance and clients only
  Designer          +998901112235  PIN 1234    two projects
  SMM               +998901112236  PIN 1234
  Copywriter        +998901112237  PIN 1234
  Motion            +998901112238  PIN 1234

  CLIENT  Osiyo Coffee     +998935550101  PIN 1111   → a decision is waiting
  CLIENT  Silk Road Travel +998935550102  PIN 2222

  "Key visual" is on revision round 3 of an agreed 2, so the scope warning is
  live on the dashboard the moment you sign in as the account manager.
`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
