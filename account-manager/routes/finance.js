// Finance: its own tables, its own policies, never joined into a shared query.
// Two roles reach it and the database agrees — a teammate hitting these routes
// gets an empty result even if a role check above were removed.
const express = require('express');

module.exports = ({ auth, only, wrap }) => {
  const r = express.Router();
  r.use(auth, only('owner', 'accountant'));

  r.get('/summary', wrap(async (req, res) => {
    const [row] = await req.sql(`
      WITH inv AS (
        SELECT i.id, i.company_id, i.status,
               COALESCE(SUM(l.qty * l.unit_amount), 0)::bigint AS total
          FROM invoices i LEFT JOIN invoice_lines l ON l.invoice_id = i.id
         GROUP BY i.id
      )
      SELECT
        COALESCE(SUM(total) FILTER (WHERE status IN ('sent','paid')), 0)::bigint AS invoiced,
        COALESCE(SUM(total) FILTER (WHERE status = 'draft'), 0)::bigint          AS draft,
        (SELECT COALESCE(SUM(amount),0)::bigint FROM payments)                   AS collected,
        (SELECT COALESCE(SUM(amount),0)::bigint FROM scope_alerts
          WHERE resolution='billed')                                            AS extra_scope_billed,
        (SELECT count(*) FROM scope_alerts WHERE resolution='pending')::int      AS scope_pending
      FROM inv`);
    // Outstanding is derived, never stored, so it cannot go stale.
    row.outstanding = Number(row.invoiced) - Number(row.collected);
    res.json(row);
  }));

  r.get('/invoices', wrap(async (req, res) => {
    res.json(await req.sql(`
      SELECT i.*, co.name AS company_name, p.name AS project_name,
             COALESCE(SUM(l.qty * l.unit_amount), 0)::bigint AS total,
             COALESCE((SELECT SUM(amount) FROM payments pay WHERE pay.invoice_id = i.id), 0)::bigint AS paid
        FROM invoices i
        JOIN companies co ON co.id = i.company_id
        LEFT JOIN projects p ON p.id = i.project_id
        LEFT JOIN invoice_lines l ON l.invoice_id = i.id
       GROUP BY i.id, co.name, p.name
       ORDER BY i.issued_on DESC, i.id DESC`));
  }));

  r.get('/invoices/:id', wrap(async (req, res) => {
    const out = await req.q(async c => {
      const [inv] = (await c.query(
        `SELECT i.*, co.name AS company_name FROM invoices i
           JOIN companies co ON co.id=i.company_id WHERE i.id=$1`, [Number(req.params.id)])).rows;
      if (!inv) return null;
      const lines = (await c.query(`SELECT * FROM invoice_lines WHERE invoice_id=$1 ORDER BY id`, [inv.id])).rows;
      const pays  = (await c.query(`SELECT * FROM payments WHERE invoice_id=$1 ORDER BY paid_on`, [inv.id])).rows;
      return { invoice: inv, lines, payments: pays };
    });
    if (!out) return res.status(404).json({ error: 'Not found' });
    res.json(out);
  }));

  r.post('/invoices', wrap(async (req, res) => {
    const b = req.body || {};
    if (!b.company_id) return res.status(400).json({ error: 'Client is required' });
    const out = await req.q(async c => {
      const inv = (await c.query(
        `INSERT INTO invoices(company_id,project_id,number,issued_on,due_on,status,note)
         VALUES($1,$2,$3,COALESCE($4,CURRENT_DATE),$5,COALESCE($6,'draft'),$7) RETURNING *`,
        [b.company_id, b.project_id || null, b.number || `INV-${Date.now().toString().slice(-8)}`,
         b.issued_on || null, b.due_on || null, b.status, b.note || ''])).rows[0];
      for (const l of (b.lines || []))
        await c.query(`INSERT INTO invoice_lines(invoice_id,description,qty,unit_amount) VALUES($1,$2,$3,$4)`,
          [inv.id, l.description || '', l.qty || 1, l.unit_amount || 0]);
      return inv;
    });
    res.json(out);
  }));

  r.patch('/invoices/:id', wrap(async (req, res) => {
    const allowed = ['status', 'due_on', 'note', 'number', 'project_id'];
    const sets = [], vals = [];
    for (const k of allowed) if (k in req.body) { sets.push(`${k}=$${sets.length + 1}`); vals.push(req.body[k]); }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    vals.push(Number(req.params.id));
    const rows = await req.sql(`UPDATE invoices SET ${sets.join(',')} WHERE id=$${vals.length} RETURNING *`, vals);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  }));

  r.post('/invoices/:id/lines', wrap(async (req, res) => {
    const rows = await req.sql(
      `INSERT INTO invoice_lines(invoice_id,description,qty,unit_amount) VALUES($1,$2,$3,$4) RETURNING *`,
      [Number(req.params.id), req.body.description || '', req.body.qty || 1, req.body.unit_amount || 0]);
    res.json(rows[0]);
  }));

  r.post('/payments', wrap(async (req, res) => {
    const b = req.body || {};
    if (!b.company_id || !(Number(b.amount) > 0))
      return res.status(400).json({ error: 'Client and a positive amount are required' });
    const out = await req.q(async c => {
      const pay = (await c.query(
        `INSERT INTO payments(invoice_id,company_id,amount,paid_on,method,note,recorded_by)
         VALUES($1,$2,$3,COALESCE($4,CURRENT_DATE),COALESCE($5,'transfer'),$6,$7) RETURNING *`,
        [b.invoice_id || null, b.company_id, Number(b.amount), b.paid_on || null,
         b.method, b.note || '', req.user.id])).rows[0];
      // Settle the invoice automatically once it is covered — a status nobody
      // has to remember to flip is a status that stays true.
      if (pay.invoice_id) {
        await c.query(`
          UPDATE invoices SET status='paid'
           WHERE id=$1 AND status <> 'void'
             AND (SELECT COALESCE(SUM(amount),0) FROM payments WHERE invoice_id=$1)
               >= (SELECT COALESCE(SUM(qty*unit_amount),0) FROM invoice_lines WHERE invoice_id=$1)`,
          [pay.invoice_id]);
      }
      return pay;
    });
    res.json(out);
  }));

  r.get('/companies/:id/statement', wrap(async (req, res) => {
    const id = Number(req.params.id);
    const out = await req.q(async c => ({
      invoices: (await c.query(`
        SELECT i.*, COALESCE(SUM(l.qty*l.unit_amount),0)::bigint AS total
          FROM invoices i LEFT JOIN invoice_lines l ON l.invoice_id=i.id
         WHERE i.company_id=$1 GROUP BY i.id ORDER BY i.issued_on DESC`, [id])).rows,
      payments: (await c.query(`SELECT * FROM payments WHERE company_id=$1 ORDER BY paid_on DESC`, [id])).rows,
    }));
    res.json(out);
  }));

  return r;
};
