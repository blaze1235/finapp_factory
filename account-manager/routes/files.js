// Files. Open question 6: video deliverables will blow through any free
// storage tier in a week, so heavy work is *linked*, not stored — the API
// takes an external_url for anything big and keeps uploads to genuinely small
// assets. A cap that refuses politely beats a bill nobody expected.
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Busboy = require('busboy');

const FILES_DIR = process.env.FILES_DIR || path.join(__dirname, '..', 'data', 'files');
const MAX_BYTES = (Number(process.env.FILE_MAX_MB) || 25) * 1024 * 1024;

fs.mkdirSync(FILES_DIR, { recursive: true });

module.exports = ({ auth, only, wrap, sign, verify, controlPool, getTenantPool, withRls }) => {
  const r = express.Router();

  // ---- downloads ----------------------------------------------------------
  // A browser cannot put an Authorization header on an <a href>, and putting
  // the session token in the URL would leak it into server logs, browser
  // history and — worst — the Referer header of the external redirect below.
  // So a page asks for a token that grants exactly one file for five minutes.
  //
  // Registered before `r.use(auth)` so it can authenticate itself.
  // Not wrapped in `wrap`: that helper only forwards (req, res), and a
  // middleware needs its `next`.
  const downloadAuth = async (req, res, next) => {
    if (req.headers.authorization) return auth(req, res, next);
    const p = verify(String(req.query.dl || ''));
    if (!p || Number(p.fid) !== Number(req.params.id))
      return res.status(401).json({ error: 'This download link has expired' });
    const { rows } = await controlPool.query(
      `SELECT u.*, t.db_name FROM users u JOIN tenants t ON t.id = u.tenant_id
        WHERE u.id = $1 AND u.active`, [p.uid]);
    if (!rows.length) return res.status(401).json({ error: 'Not signed in' });
    const u = rows[0];
    req.user = u;
    const pool = getTenantPool(u.db_name);
    const ctx = { userId: u.id, role: u.role, companyId: u.company_id };
    req.sql = (text, params) => withRls(pool, ctx, c => c.query(text, params).then(x => x.rows));
    next();
  };

  // Still an RLS-scoped lookup: the row has to be visible to the person asking
  // before a path is ever resolved, so guessing an id gets a 404 rather than
  // somebody else's deliverable.
  r.get('/:id/download', downloadAuth, wrap(async (req, res) => {
    const id = Number(req.params.id);
    const table = req.user.role === 'client' ? 'v_client_files' : 'files';
    const rows = await req.sql(`SELECT id, external_url FROM ${table} WHERE id=$1`, [id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });

    // Nothing downstream needs to know where this link was clicked from.
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (rows[0].external_url) return res.redirect(rows[0].external_url);

    // v_client_files deliberately does not expose storage_path, so resolve it
    // separately under the same RLS session rather than widening the view.
    const [full] = await req.sql('SELECT storage_path, name, mime FROM files WHERE id=$1', [id]);
    if (!full || !full.storage_path) return res.status(404).json({ error: 'Not found' });
    const abs = path.join(FILES_DIR, path.basename(full.storage_path));
    if (!fs.existsSync(abs)) return res.status(410).json({ error: 'File is no longer stored' });
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(full.name)}"`);
    if (full.mime) res.type(full.mime);
    fs.createReadStream(abs).pipe(res);
  }));

  // ---- everything below needs a real session ------------------------------
  r.use(auth);

  r.get('/:id/link', wrap(async (req, res) => {
    const id = Number(req.params.id);
    const table = req.user.role === 'client' ? 'v_client_files' : 'files';
    const rows = await req.sql(`SELECT id FROM ${table} WHERE id=$1`, [id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const dl = sign({ uid: req.user.id, fid: id, exp: Date.now() + 5 * 60 * 1000 });
    res.json({ url: `/api/files/${id}/download?dl=${encodeURIComponent(dl)}` });
  }));

  r.post('/', only('owner', 'teammate'), (req, res) => {
    const bb = Busboy({ headers: req.headers, limits: { fileSize: MAX_BYTES, files: 1 } });
    const fields = {};
    let saved = null, tooBig = false;

    bb.on('field', (k, v) => { fields[k] = v; });
    bb.on('file', (_name, stream, info) => {
      const safe = crypto.randomBytes(8).toString('hex') + path.extname(info.filename || '').slice(0, 10);
      const dest = path.join(FILES_DIR, safe);
      const out = fs.createWriteStream(dest);
      let bytes = 0;
      stream.on('data', d => { bytes += d.length; });
      stream.on('limit', () => { tooBig = true; out.destroy(); fs.unlink(dest, () => {}); });
      stream.pipe(out);
      out.on('close', () => { if (!tooBig) saved = { path: safe, name: info.filename, mime: info.mimeType, bytes }; });
    });

    bb.on('close', async () => {
      try {
        if (tooBig) return res.status(413).json({
          error: `That file is over ${MAX_BYTES / 1024 / 1024} MB. Upload it to Drive and paste the link instead — video belongs on a link, not in the database.`,
          suggest_external_url: true,
        });
        if (!saved && !fields.external_url) return res.status(400).json({ error: 'No file' });
        const rows = await req.sql(
          `INSERT INTO files(task_id,project_id,name,storage_path,external_url,mime,size_bytes,kind,visibility,uploaded_by)
           VALUES($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'attachment'),COALESCE($9,'internal'),$10) RETURNING *`,
          [fields.task_id ? Number(fields.task_id) : null,
           fields.project_id ? Number(fields.project_id) : null,
           saved ? saved.name : (fields.name || 'Link'),
           saved ? saved.path : '', fields.external_url || '',
           saved ? saved.mime : '', saved ? saved.bytes : 0,
           fields.kind, req.user.role === 'teammate' ? 'internal' : fields.visibility, req.user.id]);
        res.json(rows[0]);
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    req.pipe(bb);
  });

  r.delete('/:id', only('owner'), wrap(async (req, res) => {
    const rows = await req.sql('DELETE FROM files WHERE id=$1 RETURNING storage_path', [Number(req.params.id)]);
    if (rows.length && rows[0].storage_path)
      fs.unlink(path.join(FILES_DIR, path.basename(rows[0].storage_path)), () => {});
    res.json({ ok: true });
  }));

  return r;
};
module.exports.FILES_DIR = FILES_DIR;
