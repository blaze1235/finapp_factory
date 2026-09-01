// Team performance (§5).
//
// One dataset, two framings — and that is the whole design. The team see a
// leaderboard with points and festival badges; the owner sees the same numbers
// as a plain sortable management table with no game layer at all. Showing the
// owner a leaderboard would turn a management judgement into a scoreboard
// position, and showing the team a "missed tasks" column would do the reverse.
//
// This reverses the first brief, which deliberately carried no per-person
// counts. The client asked for it in writing.
const express = require('express');

const BADGES = {
  taf:     { name: 'TAF',         full: 'Tashkent Ad Fest', tier: 1 },
  jolbors: { name: 'Jolbors',     full: 'Jolbors',          tier: 2 },
  baku:    { name: 'Baku Flames', full: 'Baku Flames',      tier: 3 },
  cannes:  { name: 'Cannes',      full: 'Cannes Lions',     tier: 4 },
};

// Scores reset every month, so "this month" is the default everywhere and
// all-time is an explicit choice.
const monthFilter = scope => scope === 'all' ? '' : `WHERE month = date_trunc('month', CURRENT_DATE)::date`;

module.exports = ({ auth, only, wrap, getTeam }) => {
  const r = express.Router();
  r.use(auth, only('owner', 'teammate', 'editor'));

  async function tally(req, scope) {
    const rows = await req.sql(`
      SELECT user_id,
             COALESCE(SUM(points),0)::int                              AS points,
             count(*) FILTER (WHERE kind <> 'missed')::int             AS completed,
             count(*) FILTER (WHERE kind = 'early')::int               AS early,
             count(*) FILTER (WHERE kind = 'late')::int                AS late,
             count(*) FILTER (WHERE kind = 'missed')::int              AS missed,
             CASE WHEN count(*) FILTER (WHERE kind <> 'missed') = 0 THEN NULL
                  ELSE ROUND(100.0 * count(*) FILTER (WHERE kind IN ('early','on_time'))
                                   / count(*) FILTER (WHERE kind <> 'missed')) END AS on_time_pct
        FROM points_events ${monthFilter(scope)}
       GROUP BY user_id`);
    const team = (await getTeam(req.user.tenant_id))
      .filter(u => ['teammate', 'editor'].includes(u.role) && u.active);
    // Everyone on the team appears, including people with nothing yet —
    // a leaderboard that hides the bottom is not a leaderboard.
    return team.map(u => {
      const t = rows.find(x => x.user_id === u.id) || {};
      return {
        user_id: u.id, name: u.name, craft: u.craft, avatar_color: u.avatar_color,
        points: Number(t.points || 0), completed: Number(t.completed || 0),
        early: Number(t.early || 0), late: Number(t.late || 0), missed: Number(t.missed || 0),
        on_time_pct: t.on_time_pct === null || t.on_time_pct === undefined ? null : Number(t.on_time_pct),
      };
    }).sort((a, b) => b.points - a.points || b.completed - a.completed);
  }

  async function badges(req, list) {
    const thresholds = Object.fromEntries((await req.sql(
      `SELECT key, value FROM settings WHERE key LIKE 'badge_%'`)).map(s => [s.key, Number(s.value)]));
    const cannes = thresholds.badge_cannes_points ?? 200;
    const baku = thresholds.badge_baku_points ?? 120;
    const jolbors = thresholds.badge_jolbors_points ?? 60;
    for (const p of list) {
      p.badge = p.points >= cannes && (p.on_time_pct ?? 0) >= 90 ? 'cannes'
              : p.points >= baku ? 'baku'
              : p.points >= jolbors && p.late === 0 ? 'jolbors'
              : p.points > 0 ? 'taf' : null;
      const next = p.points < jolbors ? ['jolbors', jolbors] : p.points < baku ? ['baku', baku]
                 : p.points < cannes ? ['cannes', cannes] : null;
      p.next_badge = next ? { key: next[0], points_needed: next[1] - p.points } : null;
    }
    return list;
  }

  // The gamified view. Teammates and editors get this.
  r.get('/leaderboard', wrap(async (req, res) => {
    const scope = req.query.scope === 'all' ? 'all' : 'month';
    const list = await badges(req, await tally(req, scope));
    list.forEach((p, i) => { p.rank = i + 1; });
    const me = list.find(p => p.user_id === req.user.id) || null;
    res.json({
      scope,
      // Scores reset every month, so on the 1st the monthly board is genuinely
      // empty. Say so, and let the surface offer the all-time view rather than
      // showing a wall of zeroes with no explanation.
      month_empty: scope === 'month' && !list.some(p => p.completed > 0 || p.missed > 0),
      month: new Date().toISOString().slice(0, 7),
      leaderboard: list,
      top: list.length && list[0].points > 0 ? list[0] : null,
      me,
      badge_catalogue: BADGES,
    });
  }));

  // The same numbers, as management reporting. Sorting happens client-side so
  // the owner can hunt for a pattern without a round trip per column.
  r.get('/stats', only('owner'), wrap(async (req, res) => {
    const scope = req.query.scope === 'all' ? 'all' : 'month';
    const rows = await tally(req, scope);
    res.json({ scope, rows,
      month_empty: scope === 'month' && !rows.some(p => p.completed > 0 || p.missed > 0) });
  }));

  // Writing a task off as missed is a deliberate act, and it costs points, so
  // it is the owner's alone.
  r.post('/tasks/:id/missed', only('owner'), wrap(async (req, res) => {
    const rows = await req.sql(
      `UPDATE tasks SET missed=$1 WHERE id=$2 RETURNING id, title, missed`,
      [req.body.missed !== false, Number(req.params.id)]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  }));

  return r;
};
module.exports.BADGES = BADGES;
