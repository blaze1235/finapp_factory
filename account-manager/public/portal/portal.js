/* The client portal.
   This page ships none of the agency application. Everything it renders comes
   from /api/portal, which reads only the v_client_* views — so there is no
   internal field on this page to accidentally reveal, and no internal endpoint
   for a curious browser console to call. */

const P = { me: null, data: null, tab: 'project' };
const TABS = {
  uz: { project: 'Loyiha', deliverables: 'Ishlar', timeline: 'Muddatlar', documents: 'Hujjatlar' },
  ru: { project: 'Проект', deliverables: 'Работы', timeline: 'Сроки', documents: 'Документы' },
  en: { project: 'Project', deliverables: 'Deliverables', timeline: 'Timeline', documents: 'Documents' },
};
const tl = k => (TABS[Store.lang] || TABS.en)[k];
// The six named stages the client is shown (§2).
const CLIENT_STAGES = ['brief', 'concept', 'production', 'review', 'approval', 'delivery'];
const STAGE_TEXT = {
  uz: { brief: 'Brif', concept: 'Konsept', production: 'Ishlab chiqarish', review: 'Koʻrib chiqish', approval: 'Tasdiqlash', delivery: 'Topshirish' },
  ru: { brief: 'Бриф', concept: 'Концепт', production: 'Производство', review: 'Ревью', approval: 'Утверждение', delivery: 'Сдача' },
  en: { brief: 'Brief', concept: 'Concept', production: 'Production', review: 'Review', approval: 'Approval', delivery: 'Delivery' },
};
const st = k => (STAGE_TEXT[Store.lang] || STAGE_TEXT.en)[k] || k;
const root = () => document.getElementById('root');

function renderLogin(err) {
  clear(root()).append(h('div', { class: 'login' }, h('div', { class: 'box' },
    h('div', { class: 'mark' }, '◍'),
    h('h1', 'Loyihalaringiz'),
    h('p', { class: 'sub' }, 'Ishlar qay holatda — bir sahifada'),
    err && h('div', { class: 'err' }, err),
    h('form', {
      onsubmit: async e => {
        e.preventDefault();
        const f = e.target; f.querySelector('button').disabled = true;
        try {
          const r = await POST('/api/login', { phone: f.phone.value, pin: f.pin.value });
          Store.token = r.token;
          if (r.role !== 'client') return void (location.href = '/');
          start();
        } catch (er) { renderLogin(er.message); }
      },
    },
      h('label', { class: 'f' }, h('span', t('phone')),
        h('input', { class: 'in', name: 'phone', type: 'tel', required: true, autofocus: true, placeholder: '+998 ...' })),
      h('label', { class: 'f' }, h('span', t('pin')),
        h('input', { class: 'in', name: 'pin', type: 'password', inputmode: 'numeric', required: true })),
      h('button', { class: 'btn pri wide', type: 'submit', style: { marginTop: '6px' } }, t('signIn'))),
    h('div', { class: 'row tiny dim', style: { justifyContent: 'center', marginTop: '18px', gap: '14px' } },
      ...['uz', 'ru', 'en'].map(l => h('a', {
        href: '#', onclick: e => { e.preventDefault(); Store.lang = l; renderLogin(); },
      }, l === Store.lang ? h('b', l.toUpperCase()) : l.toUpperCase()))))));
}

const BUCKET_LABEL = {
  uz: { needs_you: 'Sizning javobingiz kerak', in_progress: 'Ishlanmoqda', coming_up: 'Navbatda', done: 'Tayyor' },
  ru: { needs_you: 'Нужен ваш ответ', in_progress: 'В работе', coming_up: 'Впереди', done: 'Готово' },
  en: { needs_you: 'Needs you', in_progress: 'In progress', coming_up: 'Coming up', done: 'Done' },
};
const bl = k => (BUCKET_LABEL[Store.lang] || BUCKET_LABEL.en)[k];

async function render() {
  const d = P.data = await GET('/api/portal');
  const el = clear(root());
  const page = h('div', { class: 'portal' });
  el.append(page);

  page.append(h('div', { class: 'phead' },
    h('div', { class: 'mark' }, '◍'),
    h('div', {}, h('b', { style: { fontSize: '16px' } }, d.company?.name || ''),
      h('div', { class: 'tiny dim' }, P.me.agency)),
    h('div', { class: 'sp row', style: { gap: '10px' } },
      h('div', { class: 'seg' }, ...['uz', 'ru', 'en'].map(l =>
        h('button', { class: Store.lang === l ? 'on' : '', onclick: () => { Store.lang = l; render(); } }, l.toUpperCase()))),
      h('button', { class: 'btn sm ghost', onclick: () => { Store.token = null; location.reload(); } }, '⏻'))));

  // Anything waiting on the client outranks the tabs — it is the one thing
  // they might have come here to do.
  if (d.awaiting.length) {
    const box = h('div', { class: 'needs' }, h('h2', bl('needs_you') + ' · ' + d.awaiting.length));
    for (const tk of d.awaiting) box.append(h('div', { class: 'deliv', onclick: () => openDeliverable(tk.id) },
      h('div', { class: 'row' },
        h('div', {}, h('div', { class: 't' }, tk.title),
          h('div', { class: 'tiny dim' }, projectName(tk) + (tk.version ? ` · v${tk.version}` : ''))),
        h('span', { class: 'btn sm pri sp' }, 'Koʻrish →'))));
    page.append(box);
  }

  page.append(h('div', { class: 'seg', style: { marginBottom: '18px' } },
    ...Object.keys(TABS.en).map(k => h('button', {
      class: P.tab === k ? 'on' : '', onclick: () => { P.tab = k; render(); },
    }, tl(k)))));

  ({ project: tabProject, deliverables: tabDeliverables,
     timeline: tabTimeline, documents: tabDocuments }[P.tab])(page, d);

  page.append(h('div', { class: 'tiny dim', style: { marginTop: '30px', textAlign: 'center' } },
    'Savol boʻlsa akkaunt menejeringizga Telegramda yozing.'));
}

// The hero: one project at a glance, with the stage pipeline and a big number.
function tabProject(page, d) {
  if (!d.projects.length) return page.append(h('div', { class: 'card' },
    h('div', { class: 'empty' }, h('div', { class: 'big' }, '◍'), 'Hozircha faol loyiha yoʻq')));

  for (const p of d.projects) {
    const mine = d.tasks.filter(tk => tk.project_id === p.id);
    page.append(h('div', { class: 'card', style: { marginBottom: '14px' } },
      h('div', { class: 'row', style: { alignItems: 'flex-start', marginBottom: '14px' } },
        h('div', {},
          h('div', { style: { fontSize: '18px', fontWeight: 650 } }, p.name),
          p.description ? h('div', { class: 'tiny dim' }, p.description) : null,
          p.due ? h('div', { class: 'tiny dim', style: { marginTop: '4px' } },
            'Topshirish: ' + fmtDate(p.due)) : null),
        h('div', { class: 'ring sp' },
          h('svg', { viewBox: '0 0 44 44', width: '78', height: '78' },
            h('circle', { cx: 22, cy: 22, r: 19, fill: 'none', stroke: 'var(--surface-2)', 'stroke-width': 5 }),
            h('circle', { cx: 22, cy: 22, r: 19, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 5,
              'stroke-linecap': 'round', transform: 'rotate(-90 22 22)',
              'stroke-dasharray': `${(p.progress_pct / 100) * 119.4} 119.4` })),
          h('div', { class: 'ring-n' }, p.progress_pct + '%'))),
      // Stage pipeline, current stage highlighted.
      h('div', { class: 'row', style: { gap: '4px', flexWrap: 'wrap', marginBottom: '10px' } },
        ...CLIENT_STAGES.map(sk => h('span', {
          class: 'pill' + (sk === p.stage ? ' acc' : ''),
          style: { opacity: sk === p.stage ? 1 : .5, fontWeight: sk === p.stage ? 700 : 500 },
        }, st(sk)))),
      h('div', { class: 'tiny dim' }, t('delivered', { done: p.delivered, total: p.deliverables }))));

    const ready = mine.filter(tk => tk.bucket === 'done');
    const rest = mine.filter(tk => tk.bucket !== 'done' && !tk.needs_you);
    if (rest.length) {
      page.append(h('div', { class: 'bucket-t' }, bl('in_progress')));
      for (const tk of rest) page.append(delivRow(tk));
    }
    if (ready.length) {
      page.append(h('div', { class: 'bucket-t' }, bl('done')));
      for (const tk of ready) page.append(delivRow(tk));
    }
  }
}

function delivRow(tk) {
  return h('div', { class: 'deliv', onclick: () => openDeliverable(tk.id) },
    h('div', { class: 'row' },
      h('div', {},
        h('div', { class: 't' }, tk.title),
        // Deliberately no assignee: the revised spec says the client is not
        // shown who is doing the work.
        h('div', { class: 'tiny dim' },
          [tk.due ? fmtDate(tk.due) : null, tk.version ? `v${tk.version}` : null].filter(Boolean).join(' · '))),
      tk.needs_you ? h('span', { class: 'pill acc sp' }, '⏳')
        : tk.bucket === 'done' ? h('span', { class: 'pill ok sp' }, '✓')
        : h('span', { class: 'pill sp' }, bl(tk.bucket))));
}

function tabDeliverables(page, d) {
  if (!d.tasks.length) return page.append(h('div', { class: 'card' },
    h('div', { class: 'empty' }, 'Hali ish yoʻq')));
  for (const bucket of ['needs_you', 'in_progress', 'coming_up', 'done']) {
    const group = d.tasks.filter(tk => tk.bucket === bucket);
    if (!group.length) continue;
    page.append(h('div', { class: 'bucket-t' }, bl(bucket)));
    for (const tk of group) page.append(h('div', { class: 'deliv', onclick: () => openDeliverable(tk.id) },
      h('div', { class: 'row' },
        h('div', {},
          h('div', { class: 't' }, tk.title),
          h('div', { class: 'tiny dim' },
            [projectName(tk), tk.version ? `v${tk.version} · ${tk.version_count} versiya` : null,
             tk.due ? fmtDate(tk.due) : null].filter(Boolean).join(' · '))),
        tk.needs_you
          ? h('span', { class: 'btn sm pri sp' }, 'Qaror kerak')
          : h('span', { class: `pill sp ${bucket === 'done' ? 'ok' : ''}` }, bl(bucket)))));
  }
}

// The client's timeline: their project's phases, scoped to them.
function tabTimeline(page, d) {
  if (!d.phases.length && !d.projects.length) return page.append(h('div', { class: 'card' },
    h('div', { class: 'empty' }, 'Muddatlar hali belgilanmagan')));
  for (const p of d.projects) {
    const phases = d.phases.filter(ph => ph.project_id === p.id);
    const dates = [...phases.flatMap(ph => [ph.starts_on, ph.ends_on]), p.starts_on, p.due]
      .filter(Boolean).map(x => Date.parse(String(x).slice(0, 10)));
    if (!dates.length) continue;
    const min = Math.min(...dates, Date.now()), max = Math.max(...dates, Date.now());
    const span = Math.max(1, max - min);
    const pct = x => ((Date.parse(String(x).slice(0, 10)) - min) / span) * 100;

    page.append(h('div', { class: 'card', style: { marginBottom: '12px' } },
      h('b', p.name),
      h('div', { style: { marginTop: '12px' } }, ...phases.map(ph => h('div', { style: { marginBottom: '11px' } },
        h('div', { class: 'row tiny' }, h('span', ph.name),
          h('span', { class: 'sp dim' },
            [ph.starts_on && fmtDate(ph.starts_on), ph.ends_on && fmtDate(ph.ends_on)].filter(Boolean).join(' → '))),
        h('div', { class: 'ptrack' },
          ph.starts_on && ph.ends_on
            ? h('i', { style: { left: pct(ph.starts_on) + '%',
                                width: Math.max(2, pct(ph.ends_on) - pct(ph.starts_on)) + '%' } })
            : null,
          h('span', { class: 'pnow', style: { left: pct(new Date().toISOString().slice(0, 10)) + '%' } }))))),
      p.due ? h('div', { class: 'row tiny', style: { marginTop: '6px', paddingTop: '9px',
                                                     borderTop: '1px solid var(--line-soft)' } },
        h('b', 'Topshirish'), h('span', { class: 'sp mono' }, fmtDate(p.due))) : null));
  }
}

function tabDocuments(page, d) {
  if (!d.documents.length) return page.append(h('div', { class: 'card' },
    h('div', { class: 'empty' }, h('div', { class: 'big' }, '📄'), 'Hujjat qoʻshilmagan')));
  for (const f of d.documents) page.append(h('a', {
    class: 'deliv', href: '#', style: { display: 'block' }, onclick: e => openFile(e, f.id),
  },
    h('div', { class: 'row' },
      h('div', {}, h('div', { class: 't' }, '📄 ' + f.name),
        h('div', { class: 'tiny dim' }, fmtWhen(f.created_at))),
      h('span', { class: 'btn sm sp' }, 'Ochish'))));
}

const projectName = tk => (P.data.projects.find(p => p.id === tk.project_id) || {}).name || '';

async function openDeliverable(id) {
  drawer(async (box, close) => {
    box.append(h('div', { class: 'drawer-head' }, h('div', { class: 'spin' })));
    const d = await GET(`/api/portal/tasks/${id}`);
    const tk = d.task;
    clear(box);
    box.append(h('div', { class: 'drawer-head' }, h('div', { class: 'row' },
      h('div', {}, h('h1', { style: { fontSize: '18px', fontWeight: 650 } }, tk.title),
        h('div', { class: 'tiny dim' }, [projectName(tk), tk.version ? `v${tk.version}` : null]
          .filter(Boolean).join(' · '))),
      h('button', { class: 'btn sm ghost sp', onclick: close }, '✕'))));

    const body = h('div', { class: 'drawer-body' });
    box.append(body);
    if (tk.description) body.append(h('div', { class: 'card' }, h('p', tk.description)));
    if (tk.due) body.append(h('div', { class: 'card' },
      h('div', { class: 'tiny dim' }, 'Rejadagi sana'), h('b', fmtDate(tk.due))));

    if (d.files.length) body.append(h('div', { class: 'card' }, h('h2', 'Fayllar'),
      h('div', { class: 'list' }, ...d.files.map(f => h('a', {
        class: 'item', href: '#', onclick: e => openFile(e, f.id),
      }, h('div', { class: 't' }, '📎 ' + f.name))))));

    if (d.comments.length) body.append(h('div', { class: 'card' }, h('h2', 'Izohlar'),
      ...d.comments.map(c => h('div', { style: { padding: '8px 0', borderBottom: '1px solid var(--line-soft)' } },
        h('div', { class: 'tiny dim' }, fmtWhen(c.created_at)), h('div', {}, c.body)))));

    // The decision. Two buttons and nothing else — no free-text box that could
    // let feedback arrive without being counted as a round.
    if (tk.needs_you) {
      const note = h('textarea', { class: 'in', placeholder: 'Nimani oʻzgartirish kerak?' });
      const wrapEl = h('div', { class: 'card', style: { borderColor: 'var(--accent)' } },
        h('h2', { style: { color: 'var(--accent)' } }, 'Sizning qaroringiz'),
        h('div', { class: 'decide' },
          h('button', { class: 'btn ok', onclick: () => decide('approved') }, '✓ ' + t('approve')),
          h('button', { class: 'btn', onclick: () => noteBox.style.display = 'block' }, '✏ ' + t('requestChanges'))));
      const noteBox = h('div', { style: { display: 'none', marginTop: '12px' } },
        note, h('button', {
          class: 'btn pri wide', style: { marginTop: '8px' },
          onclick: () => {
            if (!note.value.trim()) return toast('Nimani oʻzgartirish kerakligini yozing', 'bad');
            decide('changes_requested', note.value.trim());
          },
        }, 'Yuborish'));
      wrapEl.append(noteBox);
      body.append(wrapEl);

      async function decide(decision, noteText) {
        try {
          await POST(`/api/portal/tasks/${id}/decision`, { decision, note: noteText });
          close();
          toast(decision === 'approved' ? 'Tasdiqlandi — rahmat!' : 'Yuborildi, jamoa ishlaydi');
          render();
        } catch (e) { toast(e.message, 'bad'); }
      }
    }

    if (d.approvals.length) body.append(h('div', { class: 'card' }, h('h2', 'Tarix'),
      h('div', { class: 'tl' }, ...d.approvals.map(a => h('div', {
        class: `tl-i ${a.decision === 'approved' ? 'ok' : 'warn'}`,
      },
        h('div', {}, h('b', a.decision === 'approved' ? `v${a.version_no} tasdiqlandi` : `v${a.version_no} — oʻzgartirish soʻraldi`),
          h('span', { class: 'dim' }, ' · ' + a.decided_by_name)),
        a.note ? h('div', { class: 'muted' }, a.note) : null,
        h('div', { class: 'tiny dim' }, fmtWhen(a.decided_at)))))));
  });
}

async function start() {
  if (!Store.token) return renderLogin();
  try {
    P.me = await GET('/api/me');
    if (P.me.role !== 'client') return void (location.href = '/');
    await render();
  } catch (e) { Store.token = null; renderLogin(); }
}
start();
