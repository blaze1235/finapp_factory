// Finance (§9). One ledger, not two models.
//
// The spec describes accounts and a transactions ledger and never mentions
// invoice line items, so invoices/payments collapsed into this. The pivotal
// field is `settled`: an income row with settled = false IS "unpaid to us" —
// it moves profit and leaves cash alone. That gap is why the page shows profit
// and cash movement as two different numbers and says so out loud.
const express = require('express');

// Different lists for money in and money out, per the spec.
const CATEGORIES = {
  in:  ['project_fee', 'retainer', 'licensing', 'other_income'],
  out: ['payroll', 'production', 'outsourcing', 'software', 'rent', 'transport', 'tax', 'other_cost'],
};

module.exports = ({ auth, only, wrap }) => {
  const r = express.Router();
  r.use(auth, only('owner', 'accountant'));

  r.get('/categories', (req, res) => res.json(CATEGORIES));

  r.get('/summary', wrap(async (req, res) => {
    const out = await req.q(async c => {
      const one = async (t, p) => (await c.query(t, p)).rows[0];

      // Profit basis: everything booked to this month, settled or not.
      const profit = await one(`
        SELECT COALESCE(SUM(amount) FILTER (WHERE direction='in'),0)::bigint  AS earned,
               COALESCE(SUM(amount) FILTER (WHERE direction='out'),0)::bigint AS spent
          FROM transactions WHERE period = date_trunc('month', CURRENT_DATE)::date`);

      // Cash basis: only money that actually moved, and only this month.
      const cash = await one(`
        SELECT COALESCE(SUM(amount) FILTER (WHERE direction='in'),0)::bigint  AS received,
               COALESCE(SUM(amount) FILTER (WHERE direction='out'),0)::bigint AS paid
          FROM transactions
         WHERE settled AND paid_on >= date_trunc('month', CURRENT_DATE)::date
           AND paid_on < (date_trunc('month', CURRENT_DATE) + interval '1 month')::date`);

      const owed = await one(`
        SELECT COALESCE(SUM(amount),0)::bigint AS unpaid,
               COALESCE(SUM(amount) FILTER (WHERE due_on < CURRENT_DATE),0)::bigint AS overdue
          FROM transactions WHERE direction='in' AND NOT settled`);

      const onHand = await one(`
        SELECT COALESCE(SUM(a.opening_balance),0)::bigint
             + COALESCE((SELECT SUM(CASE WHEN direction='in' THEN amount ELSE -amount END)
                           FROM transactions WHERE settled),0)::bigint AS cash_on_hand
          FROM accounts a WHERE a.active`);

      const scope = await one(
        `SELECT count(*)::int AS pending FROM scope_alerts WHERE resolution='pending'`);
      return { profit, cash, owed, onHand, scope };
    });

    res.json({
      net_profit: Number(out.profit.earned) - Number(out.profit.spent),
      earned: Number(out.profit.earned),
      spent: Number(out.profit.spent),
      cash_movement: Number(out.cash.received) - Number(out.cash.paid),
      received: Number(out.cash.received),
      paid: Number(out.cash.paid),
      unpaid_to_us: Number(out.owed.unpaid),
      overdue_to_us: Number(out.owed.overdue),
      cash_on_hand: Number(out.onHand.cash_on_hand),
      scope_pending: out.scope.pending,
    });
  }));

  r.get('/accounts', wrap(async (req, res) => {
    res.json(await req.sql(`
      SELECT a.*,
             (a.opening_balance
              + COALESCE((SELECT SUM(CASE WHEN t.direction='in' THEN t.amount ELSE -t.amount END)
                            FROM transactions t WHERE t.account_id = a.id AND t.settled), 0))::bigint AS balance
        FROM accounts a ORDER BY a.position, a.id`));
  }));

  r.post('/accounts', wrap(async (req, res) => {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: 'Account name is required' });
    const rows = await req.sql(
      `INSERT INTO accounts(name,purpose,currency,opening_balance,position)
       VALUES($1,$2,COALESCE($3,'UZS'),COALESCE($4,0),
              COALESCE((SELECT MAX(position)+1 FROM accounts),0)) RETURNING *`,
      [b.name, b.purpose || '', b.currency, b.opening_balance || 0]);
    res.json(rows[0]);
  }));

  r.patch('/accounts/:id', wrap(async (req, res) => {
    const sets = [], vals = [];
    for (const k of ['name', 'purpose', 'currency', 'opening_balance', 'active'])
      if (k in req.body) { sets.push(`${k}=$${sets.length + 1}`); vals.push(req.body[k]); }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    vals.push(Number(req.params.id));
    const rows = await req.sql(`UPDATE accounts SET ${sets.join(',')} WHERE id=$${vals.length} RETURNING *`, vals);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  }));

  // ---- the ledger ---------------------------------------------------------
  r.get('/transactions', wrap(async (req, res) => {
    const where = [], vals = [];
    if (req.query.from) { vals.push(req.query.from); where.push(`t.period >= $${vals.length}`); }
    if (req.query.to)   { vals.push(req.query.to);   where.push(`t.period <= $${vals.length}`); }
    if (req.query.company) { vals.push(Number(req.query.company)); where.push(`t.company_id = $${vals.length}`); }
    if (req.query.direction) { vals.push(req.query.direction); where.push(`t.direction = $${vals.length}`); }
    res.json(await req.sql(`
      SELECT t.*, a.name AS account_name, co.name AS company_name, p.name AS project_name,
             transaction_status(t.settled, t.direction, t.due_on) AS status
        FROM transactions t
        LEFT JOIN accounts a ON a.id = t.account_id
        LEFT JOIN companies co ON co.id = t.company_id
        LEFT JOIN projects p ON p.id = t.project_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY COALESCE(t.paid_on, t.period) DESC, t.id DESC LIMIT 400`, vals));
  }));

  r.post('/transactions', wrap(async (req, res) => {
    const b = req.body || {};
    const dir = b.direction;
    if (!['in', 'out'].includes(dir)) return res.status(400).json({ error: 'Money in or money out?' });
    if (!(Number(b.amount) > 0)) return res.status(400).json({ error: 'Enter an amount' });
    if (b.category && !CATEGORIES[dir].includes(b.category))
      return res.status(400).json({ error: `"${b.category}" is not a ${dir === 'in' ? 'income' : 'cost'} category` });

    const settled = b.settled !== false;
    const rows = await req.sql(
      `INSERT INTO transactions(direction,counterparty,description,category,account_id,period,
                                paid_on,amount,settled,due_on,company_id,project_id,created_by)
       VALUES($1,$2,$3,COALESCE($4,'other'),$5,
              COALESCE($6, date_trunc('month', CURRENT_DATE)::date),
              $7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [dir, b.counterparty || '', b.description || '', b.category, b.account_id || null,
       b.period || null,
       // Unsettled money has not moved, so it has no payment date by definition.
       settled ? (b.paid_on || new Date().toISOString().slice(0, 10)) : null,
       Number(b.amount), settled, b.due_on || null,
       b.company_id || null, b.project_id || null, req.user.id]);
    res.json(rows[0]);
  }));

  // Settling is the common edit: an unpaid invoice arrives as money.
  r.post('/transactions/:id/settle', wrap(async (req, res) => {
    const rows = await req.sql(
      `UPDATE transactions SET settled=true, paid_on=COALESCE($1,CURRENT_DATE), account_id=COALESCE($2,account_id)
        WHERE id=$3 AND NOT settled RETURNING *`,
      [req.body.paid_on || null, req.body.account_id || null, Number(req.params.id)]);
    if (!rows.length) return res.status(409).json({ error: 'Already settled, or not found' });
    res.json(rows[0]);
  }));

  // The × button. Deliberately narrow: your own entry, within the hour — which
  // is what "added in the current session" means in practice. The owner can
  // remove anything, because somebody has to be able to.
  r.delete('/transactions/:id', wrap(async (req, res) => {
    const rows = await req.sql(
      req.user.role === 'owner'
        ? `DELETE FROM transactions WHERE id=$1 RETURNING id`
        : `DELETE FROM transactions WHERE id=$1 AND created_by=$2
             AND created_at > now() - interval '1 hour' RETURNING id`,
      req.user.role === 'owner' ? [Number(req.params.id)] : [Number(req.params.id), req.user.id]);
    if (!rows.length) return res.status(403).json({ error: 'Only the account manager can remove an older entry' });
    res.json({ ok: true });
  }));

  // ---- charts -------------------------------------------------------------
  r.get('/monthly', wrap(async (req, res) => {
    res.json(await req.sql(`
      SELECT to_char(m.month, 'YYYY-MM') AS month,
             COALESCE(SUM(t.amount) FILTER (WHERE t.direction='in'),0)::bigint  AS income,
             COALESCE(SUM(t.amount) FILTER (WHERE t.direction='out'),0)::bigint AS costs
        FROM generate_series(date_trunc('month', CURRENT_DATE) - interval '5 months',
                             date_trunc('month', CURRENT_DATE), interval '1 month') AS m(month)
        LEFT JOIN transactions t ON t.period = m.month::date
       GROUP BY m.month ORDER BY m.month`));
  }));

  r.get('/by-category', wrap(async (req, res) => {
    const months = Number(req.query.months) || 1;
    res.json(await req.sql(`
      SELECT direction, category, SUM(amount)::bigint AS amount, count(*)::int AS n
        FROM transactions
       WHERE period > date_trunc('month', CURRENT_DATE) - ($1 || ' months')::interval
       GROUP BY direction, category ORDER BY direction, amount DESC`, [months]));
  }));

  r.get('/companies/:id/statement', wrap(async (req, res) => {
    res.json(await req.sql(`
      SELECT t.*, transaction_status(t.settled,t.direction,t.due_on) AS status,
             a.name AS account_name
        FROM transactions t LEFT JOIN accounts a ON a.id=t.account_id
       WHERE t.company_id=$1 ORDER BY COALESCE(t.paid_on,t.period) DESC`, [Number(req.params.id)]));
  }));

  return r;
};
module.exports.CATEGORIES = CATEGORIES;
