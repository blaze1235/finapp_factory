/* The timeline grid, modelled on the client's own planning sheet.
 *
 * Rows are processes grouped by stage; columns are working days grouped under
 * week headers. Weekends are absent rather than greyed, which is what keeps
 * two months readable without scrolling.
 *
 * Shared by the agency view and the client portal on purpose: two renderers
 * drawing the same dates would eventually disagree about them, and the whole
 * point of this product is that the client and the team see one story.
 *
 * What it deliberately does better than the spreadsheet:
 *   - runs of days render as one rounded bar, not a row of hard cells
 *   - the stage rail and the process/status columns stay put while you scroll
 *   - today is a line you can find without counting columns
 *   - each bar is a button: click it and the task opens
 *   - status is derived, so it cannot say "done" while the work sits open
 */

const GANTT_STATE = {
  planned:   { key: 'planned',   fill: 'var(--g-planned)',   label: { uz: 'rejalashtirilgan', ru: 'запланировано', en: 'planned' } },
  in_action: { key: 'in_action', fill: 'var(--g-action)',    label: { uz: 'jarayonda',       ru: 'в процессе',    en: 'in progress' } },
  done:      { key: 'done',      fill: 'var(--g-done)',      label: { uz: 'yakunlandi',      ru: 'завершено',     en: 'completed' } },
  meeting:   { key: 'meeting',   fill: 'var(--g-meeting)',   label: { uz: 'taqdimot kuni',   ru: 'дата встречи',  en: 'presentation' } },
  missed:    { key: 'missed',    fill: 'var(--g-missed)',    label: { uz: 'bajarilmadi',     ru: 'не выполнено',  en: 'missed' } },
};
const gLabel = k => (GANTT_STATE[k]?.label[Store.lang]) || GANTT_STATE[k]?.label.en || k;

// The same three words the client's sheet uses in its status column.
function ganttState(row) {
  if (row.state) return row.state;                  // portal rows arrive pre-derived
  if (row.missed) return 'missed';
  if (row.is_meeting) return 'meeting';
  if (['approved', 'completed'].includes(row.status)) return 'done';
  if (['in_progress', 'in_review', 'awaiting_client'].includes(row.status)) return 'in_action';
  return 'planned';
}

const MONTH_SHORT = {
  uz: ['yan', 'fev', 'mar', 'apr', 'may', 'iyun', 'iyul', 'avg', 'sen', 'okt', 'noy', 'dek'],
  ru: ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};
const DOW_SHORT = {
  uz: { mon: 'Du', tue: 'Se', wed: 'Ch', thu: 'Pa', fri: 'Ju', sat: 'Sh', sun: 'Ya' },
  ru: { mon: 'Пн', tue: 'Вт', wed: 'Ср', thu: 'Чт', fri: 'Пт', sat: 'Сб', sun: 'Вс' },
  en: { mon: 'Mo', tue: 'Tu', wed: 'We', thu: 'Th', fri: 'Fr', sat: 'Sa', sun: 'Su' },
};
const mshort = m => (MONTH_SHORT[Store.lang] || MONTH_SHORT.en)[m];
const dshort = d => (DOW_SHORT[Store.lang] || DOW_SHORT.en)[d] || d;

const WEEK_WORD = { uz: 'hafta', ru: 'неделя', en: 'week' };

/**
 * @param data  { columns, rows, phases, project, today }
 * @param opts  { onRow, statusColumn, title, footnote, compact }
 */
function renderGantt(data, opts = {}) {
  const cols = data.columns || [];
  if (!cols.length) return h('div', { class: 'empty' }, opts.emptyText || 'Sanalar hali belgilanmagan');

  const index = new Map(cols.map((c, i) => [c.date, i]));
  const cw = opts.compact ? 26 : 34;              // column width in px
  const gridW = cols.length * cw;

  // ---- header: weeks, then days ------------------------------------------
  const weekGroups = [];
  for (const c of cols) {
    const last = weekGroups[weekGroups.length - 1];
    if (last && last.week === c.week && last.month === c.month) last.n++;
    else weekGroups.push({ week: c.week, month: c.month, n: 1, first: c.date });
  }
  const weekRow = h('div', { class: 'gz-weeks', style: { width: gridW + 'px' } },
    ...weekGroups.map((w, i) => h('div', {
      class: 'gz-week', style: { width: w.n * cw + 'px' },
    }, `${i + 1}-${WEEK_WORD[Store.lang] || WEEK_WORD.en}`)));

  const dayRow = h('div', { class: 'gz-days', style: { width: gridW + 'px' } },
    ...cols.map(c => {
      const d = new Date(c.date + 'T00:00:00Z');
      const isToday = c.date === data.today;
      const firstOfMonth = d.getUTCDate() <= 3;
      return h('div', {
        class: `gz-day${isToday ? ' today' : ''}${c.dow === 'mon' ? ' wk' : ''}`,
        style: { width: cw + 'px' }, title: c.date,
      },
        h('span', { class: 'dw' }, dshort(c.dow)),
        h('span', { class: 'dd' }, d.getUTCDate() + (firstOfMonth ? ' ' + mshort(d.getUTCMonth()) : '')));
    }));

  // ---- rows, grouped by stage --------------------------------------------
  const byPhase = new Map();
  for (const r of data.rows) {
    const k = r.phase_id == null ? 'none' : r.phase_id;
    if (!byPhase.has(k)) byPhase.set(k, []);
    byPhase.get(k).push(r);
  }
  const phases = [...(data.phases || [])];
  // Anything with no stage is still work: it gets its own group at the end
  // rather than vanishing off the chart.
  if (byPhase.has('none')) phases.push({ id: 'none', name: opts.unphasedLabel || '—', position: 999 });

  const labelCol = h('div', { class: 'gz-labels' });
  const gridCol = h('div', { class: 'gz-grid', style: { width: gridW + 'px' } });

  // Today's line, drawn once across the whole grid rather than per row.
  const todayIdx = index.get(data.today);
  if (todayIdx !== undefined)
    gridCol.append(h('div', { class: 'gz-today', style: { left: (todayIdx * cw + cw / 2) + 'px' } }));
  // Faint week separators, so counting days is never necessary.
  cols.forEach((c, i) => {
    if (c.dow === 'mon' && i) gridCol.append(h('div', { class: 'gz-wkline', style: { left: (i * cw) + 'px' } }));
  });

  let rowTop = 0;
  const ROW_H = opts.compact ? 26 : 30;
  const HEAD_H = 24;

  for (const ph of phases.sort((a, b) => a.position - b.position)) {
    const rows = byPhase.get(ph.id === 'none' ? 'none' : ph.id) || [];
    if (!rows.length && ph.id === 'none') continue;
    // A stage with nothing in it is worth showing the team — it is a gap in
    // the plan. It is only noise to a client, whose empty stages are empty
    // because the work in them is internal.
    if (!rows.length && opts.hideEmptyStages) continue;

    const doneN = rows.filter(r => ganttState(r) === 'done').length;
    labelCol.append(h('div', { class: 'gz-stage', style: { height: HEAD_H + 'px' } },
      h('span', { class: 'gz-stage-n' }, ph.name),
      rows.length ? h('span', { class: 'gz-stage-c' }, `${doneN}/${rows.length}`) : null));
    gridCol.append(h('div', { class: 'gz-stage-band', style: { top: rowTop + 'px', height: HEAD_H + 'px', width: gridW + 'px' } }));
    rowTop += HEAD_H;

    if (!rows.length) {
      labelCol.append(h('div', { class: 'gz-row gz-empty', style: { height: ROW_H + 'px' } },
        h('span', { class: 'gz-name dim' }, opts.emptyStageText || '—')));
      gridCol.append(h('div', { class: 'gz-lane', style: { top: rowTop + 'px', height: ROW_H + 'px', width: gridW + 'px' } }));
      rowTop += ROW_H;
      continue;
    }

    for (const r of rows) {
      const state = ganttState(r);
      labelCol.append(h('div', {
        class: 'gz-row', style: { height: ROW_H + 'px' },
        onclick: opts.onRow ? () => opts.onRow(r) : null,
      },
        h('span', { class: 'gz-name', title: r.title }, r.title),
        opts.statusColumn !== false
          ? h('span', { class: `gz-status s-${state}` }, gLabel(state)) : null));

      const lane = h('div', { class: 'gz-lane', style: { top: rowTop + 'px', height: ROW_H + 'px', width: gridW + 'px' } });
      const span = opts.clientDates && r.client_span ? r.client_span : r.span
        || (r.starts || r.due ? { from: r.starts || r.due, to: r.due || r.starts } : null);

      if (span) {
        // Snap to the nearest rendered column: a bar that starts on a Saturday
        // must still appear, on the Monday, rather than disappearing.
        const a = nearestIdx(cols, index, span.from, 1);
        const b = nearestIdx(cols, index, span.to, -1);
        if (a !== null && b !== null && b >= a) {
          const bar = h('button', {
            class: `gz-bar s-${state}`,
            style: { left: (a * cw + 2) + 'px', width: ((b - a + 1) * cw - 4) + 'px' },
            title: `${r.title}\n${span.from} → ${span.to}\n${gLabel(state)}${r.assignee ? '\n' + r.assignee : ''}`,
            onclick: opts.onRow ? e => { e.stopPropagation(); opts.onRow(r); } : null,
          }, state === 'meeting' ? '★' : (b - a >= 2 && r.assignee ? r.assignee.split(' ')[0] : ''));
          lane.append(bar);
        }
      }
      // The padded date the client was told, drawn as a faint outline behind
      // the real one — so the gap between them is visible instead of implied.
      if (opts.showPadding && r.client_span && r.span && r.client_span.to !== r.span.to) {
        const ca = nearestIdx(cols, index, r.span.to, 1);
        const cb = nearestIdx(cols, index, r.client_span.to, -1);
        if (ca !== null && cb !== null && cb > ca)
          lane.append(h('div', {
            class: 'gz-pad', style: { left: ((ca + 1) * cw + 2) + 'px', width: ((cb - ca) * cw - 4) + 'px' },
            title: 'Mijozga aytilgan sana',
          }));
      }
      gridCol.append(lane);
      rowTop += ROW_H;
    }
  }

  gridCol.style.height = rowTop + 'px';
  labelCol.style.width = (opts.compact ? 230 : 290) + 'px';

  // One scroll container, two sticky axes: the day header pins to the top and
  // the process column pins to the left, so neither is lost on a chart that is
  // wider than the screen and taller than the window. Two separate scrollers
  // would have to be kept in sync, and would drift on momentum scrolling.
  const labelW = opts.compact ? 230 : 290;
  labelCol.style.width = labelW + 'px';

  const inner = h('div', {
    class: 'gz-inner',
    style: { gridTemplateColumns: `${labelW}px ${gridW}px` },
  },
    h('div', { class: 'gz-corner', style: { width: labelW + 'px' } },
      h('span', opts.processLabel || 'Jarayonlar'),
      opts.statusColumn !== false ? h('span', { class: 'gz-status-head' }, opts.statusLabel || 'Holat') : null),
    h('div', { class: 'gz-head', style: { width: gridW + 'px' } }, weekRow, dayRow),
    labelCol,
    gridCol);

  const box = h('div', { class: `gz${opts.compact ? ' compact' : ''}` }, inner);

  // Reading across a wide chart is the whole difficulty; lighting up the row
  // under the pointer on both sides of the divide is most of the fix.
  const lanes = [...gridCol.querySelectorAll('.gz-lane')];
  const labels = [...labelCol.querySelectorAll('.gz-row')];
  labels.forEach((lab, i) => {
    const lane = lanes[i];
    if (!lane) return;
    const on = () => { lab.classList.add('hot'); lane.classList.add('hot'); };
    const off = () => { lab.classList.remove('hot'); lane.classList.remove('hot'); };
    lab.addEventListener('mouseenter', on); lab.addEventListener('mouseleave', off);
    lane.addEventListener('mouseenter', on); lane.addEventListener('mouseleave', off);
  });

  // Open on today rather than on the first week of the project, which is
  // usually history by the time anyone looks.
  if (todayIdx !== undefined) setTimeout(() => {
    box.scrollLeft = Math.max(0, todayIdx * cw - box.clientWidth / 2);
  }, 0);

  return h('div', {}, box, ganttLegend(opts));
}

// Bars whose ends fall on a non-working day still have to appear. Walk toward
// the middle of the span until a rendered column turns up.
function nearestIdx(cols, index, date, dir) {
  if (!date) return null;
  const iso = String(date).slice(0, 10);
  if (index.has(iso)) return index.get(iso);
  const d = new Date(iso + 'T00:00:00Z');
  for (let i = 0; i < 10; i++) {
    d.setUTCDate(d.getUTCDate() + dir);
    const k = d.toISOString().slice(0, 10);
    if (index.has(k)) return index.get(k);
  }
  // Off the end of the window entirely: clamp rather than drop the bar.
  const first = cols[0].date, last = cols[cols.length - 1].date;
  if (iso < first) return 0;
  if (iso > last) return cols.length - 1;
  return null;
}

function ganttLegend(opts = {}) {
  const keys = ['planned', 'in_action', 'done', 'meeting'];
  return h('div', { class: 'gz-legend' },
    ...keys.map(k => h('span', { class: 'gz-leg' },
      h('i', { class: 's-' + k }), gLabel(k))),
    opts.footnote ? h('span', { class: 'gz-note' }, opts.footnote) : null);
}
