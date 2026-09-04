/* The roadmap view — the timeline as something you would put in front of a
 * client, rather than something you would operate out of.
 *
 * The one structural difference from the day grid in gantt.js: time here is
 * CONTINUOUS. A bar is positioned by where its dates fall in the window, not
 * snapped to a column of days. That single change is most of why the reference
 * designs read as designed rather than as a spreadsheet — bars start and end
 * where the work does, in the middle of a week if that is the truth.
 *
 * Colour carries the stage, so the eye groups the plan the way the plan is
 * actually organised. Status is carried by treatment — filled, filled with a
 * live dot, or tinted-and-outlined — so both readings are available at once
 * without one fighting the other. The owner can swap the two if they would
 * rather see status at a glance.
 */

const RM_STAGE_VARS = ['--st-1', '--st-2', '--st-3', '--st-4', '--st-5', '--st-6'];
const rmStageColor = i => `var(${RM_STAGE_VARS[i % RM_STAGE_VARS.length]})`;
const RM_STATUS_COLOR = {
  done:      'var(--st-3)',
  in_action: 'var(--st-2)',
  planned:   'var(--ink-3)',
  meeting:   'var(--st-6)',
  missed:    'var(--ink-3)',
};

const RM_WORDS = {
  uz: { week: 'hafta', today: 'Bugun', noDates: 'Sanalar hali belgilanmagan', scale: { week: 'Hafta', month: 'Oy' }, by: { stage: 'Bosqich', status: 'Holat' } },
  ru: { week: 'неделя', today: 'Сегодня', noDates: 'Сроки ещё не заданы', scale: { week: 'Неделя', month: 'Месяц' }, by: { stage: 'Этап', status: 'Статус' } },
  en: { week: 'week', today: 'Today', noDates: 'No dates set yet', scale: { week: 'Week', month: 'Month' }, by: { stage: 'Stage', status: 'Status' } },
};
const rw = () => RM_WORDS[Store.lang] || RM_WORDS.en;

const rmDay = d => Date.parse(String(d).slice(0, 10) + 'T00:00:00Z');
const rmAddDays = (d, n) => { const x = new Date(rmDay(d)); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

// Text measurement, so a label only goes inside a bar when it genuinely fits.
// Guessing from character count puts Cyrillic labels half outside their pills.
let _rmCanvas;
function rmTextWidth(text, font) {
  _rmCanvas = _rmCanvas || document.createElement('canvas');
  const ctx = _rmCanvas.getContext('2d');
  ctx.font = font;
  return ctx.measureText(text).width;
}

/**
 * @param data { rows, phases, today, project }  — the gantt endpoint's shape
 * @param opts { scale, colorBy, onRow, showPadding, footnote, clientDates }
 */
function renderRoadmap(data, opts = {}) {
  const scale = opts.scale === 'month' ? 'month' : 'week';
  const colorBy = opts.colorBy === 'status' ? 'status' : 'stage';

  const spanOfRow = r => (opts.clientDates && r.client_span) ? r.client_span
    : r.span || (r.starts || r.due ? { from: r.starts || r.due, to: r.due || r.starts } : null);

  const dated = data.rows.filter(r => spanOfRow(r));
  if (!dated.length) return h('div', { class: 'rm-blank' }, rw().noDates);

  // ---- the window ---------------------------------------------------------
  let lo = Infinity, hi = -Infinity;
  for (const r of dated) {
    const s = spanOfRow(r);
    lo = Math.min(lo, rmDay(s.from));
    hi = Math.max(hi, rmDay(s.to));
    if (opts.showPadding && r.client_span) hi = Math.max(hi, rmDay(r.client_span.to));
  }
  const today = data.today || new Date().toISOString().slice(0, 10);
  lo = Math.min(lo, rmDay(today));
  hi = Math.max(hi, rmDay(today));

  // Snap outward to whole weeks or months so the axis labels are honest.
  const start = new Date(lo), end = new Date(hi);
  if (scale === 'month') { start.setUTCDate(1); end.setUTCMonth(end.getUTCMonth() + 1, 1); }
  else {
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
    end.setUTCDate(end.getUTCDate() + (7 - ((end.getUTCDay() + 6) % 7)));
  }
  const t0 = start.getTime(), t1 = Math.max(end.getTime(), t0 + 7 * 86400000);
  const days = (t1 - t0) / 86400000;

  const perDay = scale === 'month' ? 5.4 : 18;    // px
  const width = Math.max(560, Math.round(days * perDay));
  const x = d => ((rmDay(d) - t0) / (t1 - t0)) * width;

  // ---- axis ---------------------------------------------------------------
  const ticks = [];
  const cur = new Date(t0);
  if (scale === 'month') {
    while (cur.getTime() < t1) {
      ticks.push({ at: cur.toISOString().slice(0, 10), label: `${mshort(cur.getUTCMonth())} ${String(cur.getUTCFullYear()).slice(2)}` });
      cur.setUTCMonth(cur.getUTCMonth() + 1);
    }
  } else {
    let n = 1;
    while (cur.getTime() < t1) {
      ticks.push({ at: cur.toISOString().slice(0, 10), label: `${n}-${rw().week}`, sub: `${cur.getUTCDate()} ${mshort(cur.getUTCMonth())}` });
      cur.setUTCDate(cur.getUTCDate() + 7); n++;
    }
  }

  const axis = h('div', { class: 'rm-axis', style: { width: width + 'px', position: 'sticky' } },
    ...ticks.map(tk => h('div', {
      class: 'rm-tick', style: { left: x(tk.at) + 'px' },
    }, h('span', { class: 'rm-tick-l' }, tk.label),
       tk.sub ? h('span', { class: 'rm-tick-s' }, tk.sub) : null)));

  // ---- plot ---------------------------------------------------------------
  const body = h('div', { class: 'rm-body', style: { width: width + 'px' } });
  // Dashed rules run the full height behind everything, as in the references —
  // they are what lets the eye drop from a bar to its date.
  for (const tk of ticks)
    body.append(h('div', { class: 'rm-rule', style: { left: x(tk.at) + 'px' } }));
  if (scale === 'month')
    ticks.forEach((tk, i) => { if (i % 2) body.append(h('div', {
      class: 'rm-band',
      style: { left: x(tk.at) + 'px', width: (x(ticks[i + 1] ? ticks[i + 1].at : end.toISOString().slice(0, 10)) - x(tk.at)) + 'px' },
    })); });

  const todayX = x(today);
  if (todayX >= 0 && todayX <= width)
    body.append(h('div', { class: 'rm-today', style: { left: todayX + 'px' } },
      h('span', { class: 'rm-today-tag' }, rw().today)));

  const byPhase = new Map();
  for (const r of dated) {
    const k = r.phase_id == null ? 'none' : r.phase_id;
    if (!byPhase.has(k)) byPhase.set(k, []);
    byPhase.get(k).push(r);
  }
  const phases = [...(data.phases || [])].sort((a, b) => a.position - b.position);
  if (byPhase.has('none')) phases.push({ id: 'none', name: opts.unphasedLabel || '—', position: 999 });

  const BAR = 30, LANE = 42, HEAD = 40;
  // Only the stages that actually produced rows belong in the legend — a
  // client whose work touches two stages should not be shown five.
  const shown = [];
  const font = '600 11.5px "Golos Text", system-ui, sans-serif';
  let top = 0, order = 0;

  for (const ph of phases) {
    const rows = byPhase.get(ph.id === 'none' ? 'none' : ph.id) || [];
    if (!rows.length) continue;
    // Colour comes from the stage's position in the whole plan, not in the
    // filtered list, so a stage keeps its colour between views.
    const colorIndex = phases.indexOf(ph);
    const stageColor = rmStageColor(colorIndex);
    shown.push({ ph, color: stageColor });

    const group = h('div', {
      class: 'rm-group',
      style: { top: top + 'px', width: width + 'px', height: (HEAD + rows.length * LANE) + 'px' },
    });
    group.append(h('div', { class: 'rm-stage', style: { height: HEAD + 'px' } },
      h('span', { class: 'rm-chip', style: { background: stageColor } }),
      h('span', { class: 'rm-stage-name' }, ph.name),
      h('span', { class: 'rm-stage-meta' },
        `${rows.filter(r => (r.state || ganttState(r)) === 'done').length}/${rows.length}`)));
    body.append(group);
    let laneTop = HEAD;
    top += HEAD;

    for (const r of rows) {
      const s = spanOfRow(r);
      const state = r.state || ganttState(r);
      const color = colorBy === 'status' ? (RM_STATUS_COLOR[state] || stageColor) : stageColor;
      const left = Math.max(0, x(s.from));
      const right = Math.min(width, Math.max(x(s.to), left + (state === 'meeting' ? 0 : 14)));
      const w = Math.max(state === 'meeting' ? 0 : 22, right - left);

      const lane = h('div', { class: 'rm-lane', style: { top: laneTop + 'px', height: LANE + 'px', width: width + 'px' } });

      // The padded date the client was quoted, as a ghost tail behind the bar.
      if (opts.showPadding && r.client_span && r.span && rmDay(r.client_span.to) > rmDay(r.span.to)) {
        const pl = x(r.span.to), pr = x(r.client_span.to);
        lane.append(h('div', {
          class: 'rm-ghost',
          style: { left: pl + 'px', width: Math.max(6, pr - pl) + 'px', borderColor: color },
          title: 'Mijozga aytilgan sana',
        }));
      }

      if (state === 'meeting') {
        // A presentation is a moment, not a duration — a marker, not a bar.
        lane.append(h('button', {
          class: 'rm-mark', style: { left: (left - 9) + 'px', animationDelay: (order * 26) + 'ms' },
          title: `${r.title} · ${s.from}`,
          onclick: opts.onRow ? e => { e.stopPropagation(); opts.onRow(r); } : null,
        }, h('span', { class: 'rm-diamond' }), h('span', { class: 'rm-mark-l' }, r.title)));
      } else {
        const fits = rmTextWidth(r.title, font) + 26 <= w;
        const bar = h('button', {
          class: `rm-bar st-${state}${fits ? '' : ' bare'}`,
          style: {
            left: left + 'px', width: w + 'px', height: BAR + 'px',
            '--c': color, animationDelay: (order * 26) + 'ms',
          },
          title: `${r.title}\n${s.from} → ${s.to}${r.assignee ? '\n' + r.assignee : ''}`,
          onclick: opts.onRow ? e => { e.stopPropagation(); opts.onRow(r); } : null,
        },
          fits ? h('span', { class: 'rm-bar-l' }, r.title) : null,
          state === 'in_action' ? h('span', { class: 'rm-live' }) : null);
        lane.append(bar);
        // Too narrow to hold its own name: the label sits just outside, which
        // is how the reference charts handle short phases.
        if (!fits) lane.append(h('span', {
          class: 'rm-out', style: { left: (left + w + 9) + 'px', color },
        }, r.title));
      }
      group.append(lane);
      laneTop += LANE; top += LANE; order++;
    }
  }
  body.style.height = top + 'px';

  const scroller = h('div', { class: 'rm-scroll' }, axis, body);
  const wrap = h('div', { class: 'rm' }, scroller, roadmapLegend(colorBy, shown, opts));

  // Scrolling away from week one is only worth it when today would otherwise
  // be out of sight; on a plan that nearly fits it just hides the beginning.
  setTimeout(() => {
    const overflow = width - scroller.clientWidth;
    if (overflow > 80 && todayX > scroller.clientWidth * 0.8)
      scroller.scrollLeft = Math.min(overflow, Math.max(0, todayX - scroller.clientWidth * 0.55));
  }, 0);
  return wrap;
}

function roadmapLegend(colorBy, shown, opts) {
  const items = colorBy === 'status'
    ? ['planned', 'in_action', 'done', 'meeting'].map(k => ({ label: gLabel(k), color: RM_STATUS_COLOR[k] }))
    : shown.filter(x => x.ph.id !== 'none').map(x => ({ label: x.ph.name, color: x.color }));
  return h('div', { class: 'rm-legend' },
    ...items.map(it => h('span', { class: 'rm-leg' },
      h('i', { style: { background: it.color } }), it.label)),
    opts.footnote ? h('span', { class: 'rm-note' }, opts.footnote) : null);
}
