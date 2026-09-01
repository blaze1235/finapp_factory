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
const doneAt = n => new Date(Date.now() + n * 86400000);

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

  const { pickColor } = require('../routes/people');
  const addUser = async (name, phone, role, opts = {}) => {
    const id = (await controlPool.query(
      `INSERT INTO users(tenant_id,name,phone,pin_hash,role,company_id,craft,title,
                         responsibility,email,work_mode,birthdate)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11,'office'),$12) RETURNING id`,
      [tenant.id, name, phone, hashPin(opts.pin || '1234'), role, opts.companyId || null,
       opts.craft || '', opts.title || '', opts.responsibility || '', opts.email || '',
       opts.workMode, opts.birthdate || null])).rows[0].id;
    await controlPool.query('UPDATE users SET avatar_color=$1 WHERE id=$2', [pickColor(id), id]);
    return id;
  };

  const accountant = await addUser('Nodira Yusupova', '+998901112234', 'accountant',
    { title: 'Accountant', responsibility: 'Invoicing, payroll, tax', email: 'nodira@studionur.uz', workMode: 'office', birthdate: '1990-04-12' });
  // An Editor: same data scope as a member, but may assign work to others.
  const designer   = await addUser('Jasur Rahimov',   '+998901112235', 'editor',
    { craft: 'designer', title: 'Art director', responsibility: 'Key visuals, art direction', email: 'jasur@studionur.uz', workMode: 'hybrid', birthdate: '1993-09-02' });
  const smm        = await addUser('Malika Tosheva',  '+998901112236', 'teammate',
    { craft: 'smm', title: 'SMM lead', responsibility: 'Content calendars, community', email: 'malika@studionur.uz', workMode: 'remote', birthdate: '1997-01-25' });
  const copy       = await addUser('Sardor Aliyev',   '+998901112237', 'teammate',
    { craft: 'copywriter', title: 'Copywriter', responsibility: 'Scripts, captions, naming', email: 'sardor@studionur.uz', workMode: 'office', birthdate: '1995-06-30' });
  const motion     = await addUser('Aziza Nazarova',  '+998901112238', 'teammate',
    { craft: 'motion', title: 'Motion designer', responsibility: 'Edits, animation, sound', email: 'aziza@studionur.uz', workMode: 'hybrid', birthdate: '1998-11-08' });

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
                         is_deliverable,difficulty,requires_file,created_by,position,completed_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,'medium'),COALESCE($11,false),$12,$13,$14) RETURNING id`,
      [project, title, o.description || '', o.status || 'todo', o.visibility || 'internal',
       o.assignee || null, o.due || null, o.clientDue || null,
       o.deliverable !== false, o.difficulty, o.requiresFile, ownerId, o.pos || 0,
       o.completedAt || null])).id;

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
      status: 'completed', visibility: 'internal', assignee: designer, deliverable: false, pos: 9,
      difficulty: 'easy', due: day(-16), completedAt: doneAt(-17) });

    // Closed work across the team, so the leaderboard and the owner's stats
    // table both have something real in them on first load.
    const history = [
      [summer.id, 'Landing page design',   designer, 'hard',   -20, -22],
      [summer.id, 'Paid social set — wk1', smm,      'medium', -18, -18],
      [summer.id, 'Paid social set — wk2', smm,      'medium', -12, -13],
      [summer.id, 'Launch copy',           copy,     'easy',   -15, -14],   // late
      [cards.id,  'Product film — script', copy,     'medium', -9,  -11],
      [cards.id,  'Storyboard',            designer, 'medium', -6,  -7],
      [cards.id,  'Poster adaptations',    designer, 'easy',   -4,  -4],
      [ramadan.id,'Moodboard',             smm,      'easy',   -19, -20],
      [ramadan.id,'Tone of voice notes',   copy,     'easy',   -17, -17],
    ];
    for (const [proj, title, who, difficulty, due, done] of history)
      await task(proj, title, { status: 'completed', assignee: who, difficulty,
        due: day(due), completedAt: doneAt(done), visibility: 'internal' });

    // One written off as missed, so the penalty path is visible too.
    const dropped = await task(cards.id, 'Radio spot (dropped by client)', {
      status: 'todo', assignee: motion, difficulty: 'medium', due: day(-8), visibility: 'internal' });
    await c.query('UPDATE tasks SET missed = true WHERE id = $1', [dropped]);

    await c.query(`INSERT INTO comments(task_id,author_id,body,visibility,created_at) VALUES
      ($1,$2,'Third font trial. If they bounce this one we are into extra scope.','internal', now() - interval '9 days'),
      ($1,$2,'Updated the lockup and the Ramadan crescent weight as discussed.','client_visible', now() - interval '2 days')`,
      [keyVisual, designer]);

    // Two rounds used, then a third — which trips the scope warning on load.
    await c.query(`INSERT INTO task_versions(task_id,version_no,note,sent_by,sent_at)
      VALUES($1,1,'First route',$2, now() - interval '12 days'),
             ($1,2,'Bigger logo as asked',$2, now() - interval '7 days'),
             ($1,3,'Back to the tighter lockup',$2, now() - interval '3 days')`, [keyVisual, designer]);

    // Several people at each client, one of them the main contact.
    await c.query(`INSERT INTO client_contacts(company_id,name,position,email,phone,is_main) VALUES
      ($1,'Aziz Umarov','Marketing director','aziz@osiyo.uz','+998935550101',true),
      ($1,'Nigora Saidova','Brand manager','nigora@osiyo.uz','+998935550111',false),
      ($2,'Kamola Rashidova','CMO','kamola@silkroad.uz','+998935550102',true),
      ($2,'Bekzod Tursunov','Head of digital','bekzod@silkroad.uz','+998935550112',false),
      ($3,'Timur Sodiqov','Head of retail','timur@zamin.uz','+998935550103',true)`,
      [osiyo.id, silk.id, zamin.id]);
    await c.query(`UPDATE companies SET industry=$2, since_date=$3 WHERE id=$1`, [osiyo.id, 'Coffee & retail', day(-400)]);
    await c.query(`UPDATE companies SET industry=$2, since_date=$3 WHERE id=$1`, [silk.id, 'Travel', day(-220)]);
    await c.query(`UPDATE companies SET industry=$2, since_date=$3 WHERE id=$1`, [zamin.id, 'Banking', day(-95)]);

    // Phases drive the single-project timeline.
    await c.query(`INSERT INTO project_phases(project_id,name,starts_on,ends_on,position) VALUES
      ($1,'Concept',$2,$3,0), ($1,'Production',$4,$5,1), ($1,'Delivery',$6,$7,2)`,
      [ramadan.id, day(-21), day(-8), day(-9), day(4), day(3), day(9)]);
    await c.query(`INSERT INTO project_phases(project_id,name,starts_on,ends_on,position) VALUES
      ($1,'Pre-production',$2,$3,0), ($1,'Shoot',$4,$5,1), ($1,'Post',$6,$7,2)`,
      [cards.id, day(-14), day(-5), day(-4), day(2), day(3), day(14)]);

    await c.query(`INSERT INTO accounts(name,purpose,currency,opening_balance,position) VALUES
      ('Ipoteka Bank — main','Client transfers and payroll','UZS',120000000,0),
      ('Payme','Small and fast client payments','UZS',8000000,1),
      ('Cash desk','Petty cash, transport, props','UZS',3000000,2)`);

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

    // The ledger. Note the two unsettled income rows: those are "unpaid to us",
    // and they lift profit for the month without touching cash on hand.
    const acct = (await c.query(`SELECT id FROM accounts ORDER BY position LIMIT 1`)).rows[0].id;
    await c.query(`INSERT INTO transactions(direction,counterparty,description,category,account_id,
                                            period,paid_on,amount,settled,due_on,company_id,project_id,created_by) VALUES
      ('in','Osiyo Coffee','Ramadan campaign — 50% on brief','project_fee',$1,
        date_trunc('month',CURRENT_DATE)::date,NULL,24000000,false,CURRENT_DATE - 6,$2,$3,$4),
      ('in','Zamin Bank','Card launch — first stage','project_fee',$1,
        date_trunc('month',CURRENT_DATE)::date,NULL,60000000,false,CURRENT_DATE + 9,$5,$6,$4),
      ('in','Silk Road Travel','Summer promo — full fee','project_fee',$1,
        date_trunc('month',CURRENT_DATE)::date,GREATEST(date_trunc('month',CURRENT_DATE)::date,CURRENT_DATE - 3),36000000,true,NULL,$7,$8,$4),
      ('in','Osiyo Coffee','Retainer — social','retainer',$1,
        date_trunc('month',CURRENT_DATE)::date,GREATEST(date_trunc('month',CURRENT_DATE)::date,CURRENT_DATE - 12),12000000,true,NULL,$2,NULL,$4),
      ('out','Team','Salaries','payroll',$1,
        date_trunc('month',CURRENT_DATE)::date,NULL,42000000,false,CURRENT_DATE + 6,NULL,NULL,$4),
      ('out','Studio 42','Film shoot — crew and kit','production',$1,
        date_trunc('month',CURRENT_DATE)::date,GREATEST(date_trunc('month',CURRENT_DATE)::date,CURRENT_DATE - 5),18000000,true,NULL,$5,$6,$4),
      ('out','Adobe','Creative Cloud — team','software',$1,
        date_trunc('month',CURRENT_DATE)::date,GREATEST(date_trunc('month',CURRENT_DATE)::date,CURRENT_DATE - 9),4200000,true,NULL,NULL,NULL,$4),
      ('out','Landlord','Office rent','rent',$1,
        date_trunc('month',CURRENT_DATE)::date,GREATEST(date_trunc('month',CURRENT_DATE)::date,CURRENT_DATE - 14),9000000,true,NULL,NULL,NULL,$4)`,
      [acct, ids.osiyo, ids.ramadan, accountant, ids.zamin, ids.cards, ids.silk, ids.summer]);

    // A month of history for the six-month chart.
    for (let m = 1; m <= 5; m++)
      await c.query(`INSERT INTO transactions(direction,counterparty,description,category,account_id,
                                              period,paid_on,amount,settled,created_by) VALUES
        ('in','Various','Monthly fees','project_fee',$1,
          (date_trunc('month',CURRENT_DATE) - ($2||' months')::interval)::date,
          (date_trunc('month',CURRENT_DATE) - ($2||' months')::interval)::date + 12,
          $3,true,$4),
        ('out','Team','Salaries','payroll',$1,
          (date_trunc('month',CURRENT_DATE) - ($2||' months')::interval)::date,
          (date_trunc('month',CURRENT_DATE) - ($2||' months')::interval)::date + 28,
          $5,true,$4)`,
        [acct, m, 52000000 + m * 3000000, accountant, 38000000 + m * 900000]);

    // Last week's starting percentages, so "progress moved" has a baseline.
    await c.query(`INSERT INTO progress_snapshots(project_id, week_start, pct)
      SELECT p.id, date_trunc('week', CURRENT_DATE)::date, GREATEST(pr.pct - 12, 0)
        FROM projects p CROSS JOIN LATERAL project_progress(p.id) pr
       ON CONFLICT DO NOTHING`);
  });

  console.log(`
✓ Demo agency "Studio Nur" (${CODE}) is ready.

  Account manager   +998901112233  PIN 1234    everything
  Accountant        +998901112234  PIN 1234    finance, clients, projects
  Art director      +998901112235  PIN 1234    EDITOR — can assign work
  SMM lead          +998901112236  PIN 1234    Member
  Copywriter        +998901112237  PIN 1234    Member
  Motion designer   +998901112238  PIN 1234    Member

  CLIENT  Osiyo Coffee     +998935550101  PIN 1111   → a decision is waiting
  CLIENT  Silk Road Travel +998935550102  PIN 2222

  "Key visual" is on revision round 3 of an agreed 2, so the scope warning is
  live on the dashboard the moment you sign in as the account manager.
`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
