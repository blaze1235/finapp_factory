/* The agency surface: account manager, teammate and accountant.
   The client portal is a separate page that ships none of this. */

const State = { me: null, view: 'today', data: {}, notifications: [] };
const root = () => document.getElementById('root');

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------
function renderLogin(err) {
  const box = h('div', { class: 'box' },
    h('div', { class: 'mark' }, 'A'),
    h('h1', 'Account Manager'),
    h('p', { class: 'sub' }, 'Studio operations'),
    err && h('div', { class: 'err' }, err),
    h('form', { onsubmit: submit },
      h('label', { class: 'f' }, h('span', t('phone')),
        h('input', { class: 'in', name: 'phone', type: 'tel', placeholder: '+998 90 111 22 33', required: true, autofocus: true })),
      h('label', { class: 'f' }, h('span', t('pin')),
        h('input', { class: 'in', name: 'pin', type: 'password', inputmode: 'numeric', placeholder: '••••', required: true })),
      h('button', { class: 'btn pri wide', type: 'submit', style: { marginTop: '6px' } }, t('signIn'))),
    h('div', { class: 'row tiny dim', style: { justifyContent: 'center', marginTop: '18px', gap: '14px' } },
      ...['uz', 'ru', 'en'].map(l => h('a', { href: '#', onclick: e => { e.preventDefault(); Store.lang = l; renderLogin(); } },
        l === Store.lang ? h('b', l.toUpperCase()) : l.toUpperCase()))));
  clear(root()).append(h('div', { class: 'login' }, box));

  async function submit(e) {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('button');
    btn.disabled = true;
    try {
      const r = await POST('/api/login', { phone: f.phone.value, pin: f.pin.value });
      Store.token = r.token;
      // A client who lands on the staff login belongs in the portal, not here.
      location.href = r.role === 'client' ? '/portal/' : '/';
    } catch (err) { btn.disabled = false; renderLogin(err.message); }
  }
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------
const NAV = [
  { id: 'today',    ico: '◈', roles: ['owner', 'teammate'] },
  { id: 'projects', ico: '▤', roles: ['owner', 'teammate'] },
  { id: 'clients',  ico: '◍', roles: ['owner', 'accountant'] },
  { id: 'finance',  ico: '₴', roles: ['owner', 'accountant'] },
  { id: 'report',   ico: '◔', roles: ['owner', 'accountant'] },
  { id: 'team',     ico: '◎', roles: ['owner'] },
  { id: 'settings', ico: '⚙', roles: ['owner', 'teammate', 'accountant'] },
];

function renderShell() {
  const nav = NAV.filter(n => n.roles.includes(State.me.role));
  if (!nav.some(n => n.id === State.view)) State.view = nav[0].id;

  const side = h('div', { class: 'side' },
    h('div', { class: 'brand' }, h('div', { class: 'mark' }, 'A'),
      h('div', {}, h('b', State.me.agency), h('small', State.me.role_name))),
    ...nav.map(n => h('button', {
      class: `nav ${State.view === n.id ? 'on' : ''}`,
      onclick: () => { State.view = n.id; renderShell(); },
    }, h('span', { class: 'ico' }, n.ico), t('nav_' + n.id),
       n.id === 'today' && State.data.scopeCount ? h('span', { class: 'count' }, State.data.scopeCount) : null)),
    h('div', { class: 'side-foot' },
      h('div', { class: 'row tiny dim', style: { padding: '0 10px 8px' } },
        ...['uz', 'ru', 'en'].map(l => h('a', {
          href: '#', style: { marginRight: '9px' },
          onclick: e => { e.preventDefault(); Store.lang = l; renderShell(); },
        }, l === Store.lang ? h('b', l.toUpperCase()) : l.toUpperCase()))),
      h('button', { class: 'nav', onclick: () => { Store.token = null; location.reload(); } },
        h('span', { class: 'ico' }, '⏻'), State.me.name)));

  const main = h('div', { class: 'main' });
  clear(root()).append(h('div', { class: 'app' }, side, main));
  ({ today: viewToday, projects: viewProjects, clients: viewClients, finance: viewFinance,
     report: viewReport, team: viewTeam, settings: viewSettings }[State.view])(main);
}

function loading(el) { clear(el).append(h('div', { class: 'empty' }, h('div', { class: 'spin', style: { margin: '0 auto' } }))); }
function pageHead(title, sub, ...actions) {
  return h('div', { class: 'head' }, h('div', {}, h('h1', title), sub && h('p', sub)),
    actions.length ? h('div', { class: 'sp' }, ...actions) : null);
}
const visBadge = v => h('span', { class: `vis ${v === 'client_visible' ? 'client' : 'internal'}` },
  h('span', { class: 'dot' }), v === 'client_visible' ? t('clientVisible') : t('internal'));

// ---------------------------------------------------------------------------
// Today — the command centre
// ---------------------------------------------------------------------------
async function viewToday(el) {
  loading(el);
  const d = await GET('/api/dashboard');
  State.data.scopeCount = d.scope.length;
  clear(el);
  el.append(pageHead(greeting() + ', ' + State.me.name.split(' ')[0],
    summaryLine(d),
    State.me.role === 'owner'
      ? h('button', { class: 'btn pri', onclick: () => newProject() }, '+ Loyiha')
      : null));

  // The scope decision comes first on the page, every time, until it is made.
  for (const s of d.scope) el.append(scopeAlertCard(s));

  const cols = h('div', { class: 'grid g2' });

  const waiting = h('div', { class: 'card' },
    h('h2', `${t('waitingOnClients')} · ${d.waiting.length}`),
    d.waiting.length ? h('div', { class: 'list' }, ...d.waiting.map(w => {
      const days = w.sent_at ? Math.round((Date.now() - Date.parse(w.sent_at)) / 86400000) : null;
      return h('div', { class: 'item', onclick: () => openTask(w.id) },
        h('div', {}, h('div', { class: 't' }, w.title),
          h('div', { class: 's' }, `${w.company} · ${w.project}`)),
        h('div', { class: 'r' },
          w.revision_round > 0 ? h('span', { class: 'pill' }, 'v' + (w.version || 1)) : null,
          h('span', { class: `pill ${days >= 5 ? 'warn' : days >= 3 ? 'acc' : ''}` },
            days === null ? '—' : days === 0 ? t('today') : t('daysAgo', { n: days }))));
    })) : emptyBox('✓', 'Hech narsa mijozlarda turmagan'));

  const mine = h('div', { class: 'card' },
    h('h2', `${t('myWork')} · ${d.mine.length}`),
    d.mine.length ? h('div', { class: 'list' }, ...d.mine.slice(0, 8).map(taskRow)) : emptyBox('✓', 'Ochiq ish yoʻq'));

  cols.append(waiting, mine);
  el.append(cols);

  if (d.atRisk.length) {
    el.append(h('div', { class: 'card' }, h('h2', `${t('atRisk')} · ${d.atRisk.length}`),
      h('div', { class: 'list' }, ...d.atRisk.map(taskRow))));
  }

  const unread = d.unread.filter(n => n.kind !== 'scope');
  if (unread.length) {
    el.append(h('div', { class: 'card' },
      h('div', { class: 'row' }, h('h2', { style: { marginBottom: 0 } }, 'Yangiliklar'),
        h('button', { class: 'btn sm ghost sp', onclick: async () => { await POST('/api/notifications/read', {}); viewToday(el); } }, '✓')),
      h('div', { class: 'list', style: { marginTop: '10px' } },
        ...unread.slice(0, 6).map(n => h('div', { class: 'item' },
          h('div', {}, h('div', { class: 't' }, renderNotification(n)),
            h('div', { class: 's' }, fmtWhen(n.created_at))))))));
  }

  if (d.recent.length) {
    el.append(h('div', { class: 'card' }, h('h2', t('recent')),
      h('div', { class: 'tl' }, ...d.recent.map(a => h('div', {
        class: `tl-i ${a.verb === 'approved' ? 'ok' : a.verb === 'requested changes' ? 'warn' : ''}`,
      }, h('div', {}, h('b', a.actor_name || '—'), ' ', a.verb, ' ', h('span', { class: 'dim' }, a.detail || '')),
         h('div', { class: 'tiny dim' }, `${a.project || ''} · ${fmtWhen(a.created_at)}`))))));
  }
}

function greeting() {
  const hr = new Date().getHours();
  return hr < 12 ? 'Xayrli tong' : hr < 18 ? 'Xayrli kun' : 'Xayrli kech';
}
function summaryLine(d) {
  const bits = [];
  if (d.scope.length) bits.push(`${d.scope.length} ta qoʻshimcha ish qarori kutmoqda`);
  if (d.waiting.length) bits.push(`${d.waiting.length} ta mijozlarda`);
  if (d.atRisk.length) bits.push(`${d.atRisk.length} ta muddati yaqin`);
  return bits.length ? bits.join(' · ') : 'Hammasi joyida.';
}
function emptyBox(icon, text) { return h('div', { class: 'empty' }, h('div', { class: 'big' }, icon), text); }

function taskRow(tk) {
  const due = dueLabel(tk.due_date);
  return h('div', { class: 'item', onclick: () => openTask(tk.id) },
    h('div', {}, h('div', { class: 't' }, tk.title),
      h('div', { class: 's' }, [tk.company || '', tk.project || tk.project_name || ''].filter(Boolean).join(' · '))),
    h('div', { class: 'r' },
      tk.revision_round > 0 ? h('span', { class: 'pill acc' }, 'R' + tk.revision_round) : null,
      tk.assignee ? h('span', { class: 'pill' }, tk.assignee) : null,
      due.text ? h('span', { class: `pill ${due.cls}` }, due.text) : null));
}

// The two buttons the brief asks for, on the screen the owner opens first.
function scopeAlertCard(s) {
  const box = h('div', { class: 'scope-alert' },
    h('h3', `⚠ ${t('scopeTitle')}`),
    h('div', { class: 'why' },
      `"${s.task}" — ${s.company} · ${s.project}. `,
      h('b', t('revisionRound', { n: s.revision_round })),
      `, kelishuvda ${s.revisions_included} ta edi. Hozir qaror qiling: keyin emas.`),
    h('div', { class: 'acts' },
      h('button', { class: 'btn', onclick: absorb }, '🤝 ' + t('absorb')),
      h('button', { class: 'btn pri', onclick: bill }, '💵 ' + t('bill')),
      h('button', { class: 'btn ghost', onclick: () => openTask(s.task_id || s.id) }, 'Koʻrish')));

  function absorb() {
    confirmDialog(t('absorb'), 'Bu qoʻshimcha ish ichki hisobdan qoplanadi va mijozga hisob qilinmaydi.', async () => {
      await POST(`/api/scope-alerts/${s.id}/resolve`, { resolution: 'absorbed' });
      toast('Ichki hisobdan qoplandi'); renderShell();
    });
  }
  function bill() {
    modal(t('bill'), close => {
      const inp = h('input', { class: 'in mono', type: 'number', min: '1', step: '1000', placeholder: '3 000 000' });
      return h('div', {},
        h('p', { class: 'muted', style: { marginBottom: '14px' } },
          `${s.company} uchun qoʻshimcha qator yaratiladi va hisob-fakturaga qoʻshiladi.`),
        h('label', { class: 'f' }, h('span', 'Summa'), inp),
        h('div', { class: 'row', style: { justifyContent: 'flex-end' } },
          h('button', { class: 'btn', onclick: close }, t('cancel')),
          h('button', {
            class: 'btn pri', onclick: async () => {
              if (!(Number(inp.value) > 0)) return toast('Summani kiriting', 'bad');
              await POST(`/api/scope-alerts/${s.id}/resolve`, { resolution: 'billed', amount: Number(inp.value) });
              close(); toast('Qoʻshimcha ish hisobga qoʻshildi'); renderShell();
            },
          }, t('bill'))));
    });
  }
  return box;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------
async function viewProjects(el) {
  loading(el);
  const list = await GET('/api/projects');
  clear(el);
  el.append(pageHead(t('nav_projects'), `${list.length} ta faol loyiha`,
    State.me.role === 'owner' ? h('button', { class: 'btn pri', onclick: () => newProject() }, '+ Loyiha') : null));
  if (!list.length) return el.append(h('div', { class: 'card' }, emptyBox('▤', 'Hali loyiha yoʻq')));

  el.append(h('div', { class: 'grid g2' }, ...list.map(p => {
    const due = dueLabel(p.due_date);
    return h('div', { class: 'card', style: { cursor: 'pointer' }, onclick: () => openProject(p.id) },
      h('div', { class: 'row', style: { marginBottom: '3px' } },
        h('b', p.name),
        h('span', { class: 'sp' }),
        Number(p.scope_pending) ? h('span', { class: 'pill acc' }, '⚠ ' + p.scope_pending) : null,
        Number(p.awaiting) ? h('span', { class: 'pill info' }, p.awaiting + ' kutmoqda') : null),
      h('div', { class: 'tiny dim', style: { marginBottom: '12px' } }, `${p.company_name} · ${p.stage}`),
      h('div', { class: 'bar' }, h('i', { style: { width: (p.pct || 0) + '%' } })),
      h('div', { class: 'row tiny dim', style: { marginTop: '6px' } },
        h('span', t('delivered', { done: p.done, total: p.total })),
        h('span', { class: 'sp' }),
        due.text ? h('span', { class: due.cls === 'warn' ? 'pill warn' : '' }, due.text) : null));
  })));
}

function newProject() {
  modal('Yangi loyiha', close => {
    const f = h('form', { onsubmit: submit });
    let companies = [];
    const sel = h('select', { class: 'in', name: 'company_id', required: true });
    GET('/api/companies').then(cs => {
      companies = cs;
      sel.append(...cs.map(c => h('option', { value: c.id }, c.name)));
    });
    f.append(
      h('label', { class: 'f' }, h('span', 'Mijoz'), sel),
      h('label', { class: 'f' }, h('span', 'Loyiha nomi'), h('input', { class: 'in', name: 'name', required: true })),
      // The one field that cannot be skipped: without it the scope warning
      // never fires and the feature that pays for this product is decorative.
      h('label', { class: 'f' },
        h('span', 'Kelishilgan qayta ishlashlar soni ',
          h('span', { class: 'hint' }, '— shartnomadagi raqam')),
        h('input', { class: 'in mono', name: 'revisions_included', type: 'number', min: '0', value: '2', required: true }),
        h('div', { class: 'tiny dim', style: { marginTop: '4px' } },
          'Shu sondan oshsa, oʻsha zahoti ogohlantirish keladi.')),
      h('div', { class: 'grid g2' },
        h('label', { class: 'f' }, h('span', 'Ichki muddat'), h('input', { class: 'in', name: 'due_date', type: 'date' })),
        h('label', { class: 'f' }, h('span', 'Mijozga aytilgan muddat'), h('input', { class: 'in', name: 'client_due_date', type: 'date' }))),
      h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '6px' } },
        h('button', { class: 'btn', type: 'button', onclick: close }, t('cancel')),
        h('button', { class: 'btn pri', type: 'submit' }, 'Yaratish')));

    async function submit(e) {
      e.preventDefault();
      const b = Object.fromEntries(new FormData(f));
      try {
        const p = await POST('/api/projects', {
          ...b, company_id: Number(b.company_id), revisions_included: Number(b.revisions_included),
          due_date: b.due_date || null, client_due_date: b.client_due_date || null,
        });
        close(); toast('Loyiha yaratildi'); openProject(p.id);
      } catch (err) { toast(err.message, 'bad'); }
    }
    return f;
  });
}

const STATUS_ORDER = ['todo', 'in_progress', 'in_review', 'awaiting_client', 'approved', 'completed'];
const STATUS_LABEL = {
  todo: 'Navbatda', in_progress: 'Ishlanmoqda', in_review: 'Ichki tekshiruv',
  awaiting_client: 'Mijozda', approved: 'Tasdiqlandi', completed: 'Yakunlandi',
};

async function openProject(id) {
  drawer(async (box, close) => {
    box.append(h('div', { class: 'drawer-head' }, h('div', { class: 'spin' })));
    const d = await GET(`/api/projects/${id}`);
    const p = d.project;
    clear(box);
    box.append(h('div', { class: 'drawer-head' },
      h('div', { class: 'row' },
        h('div', {}, h('h1', { style: { fontSize: '18px', fontWeight: 650 } }, p.name),
          h('div', { class: 'tiny dim' }, `${p.company_name} · ${p.stage}`)),
        h('button', { class: 'btn sm ghost sp', onclick: close }, '✕'))));

    const body = h('div', { class: 'drawer-body' });
    box.append(body);

    // Two progress numbers side by side: what is true, and what the client is
    // being told. If those diverge, the owner should see it here first.
    body.append(h('div', { class: 'card' },
      h('div', { class: 'grid g2' },
        progressBlock('Ichki holat', d.progress.internal),
        progressBlock('Mijoz koʻradigan', d.progress.client, true))));

    if (d.suggested_stage && State.me.role === 'owner') {
      body.append(h('div', { class: 'card', style: { borderColor: 'var(--accent)' } },
        h('div', { class: 'row' },
          h('div', {}, h('b', `Bosqichni "${d.suggested_stage}" ga oʻtkazamizmi?`),
            h('div', { class: 'tiny dim' }, 'Bu bosqichdagi barcha ishlar tugadi.')),
          h('button', {
            class: 'btn pri sp', onclick: async () => {
              await PATCH(`/api/projects/${id}`, { stage: d.suggested_stage });
              close(); toast('Bosqich yangilandi'); renderShell();
            },
          }, 'Ha'))));
    }

    for (const s of d.scope.filter(x => x.resolution === 'pending'))
      body.append(scopeAlertCard({ ...s, company: p.company_name, project: p.name, task: (d.tasks.find(t2 => t2.id === s.task_id) || {}).title }));

    const byStatus = {};
    for (const tk of d.tasks) (byStatus[tk.status] ||= []).push(tk);
    const tasksCard = h('div', { class: 'card' },
      h('div', { class: 'row' }, h('h2', { style: { marginBottom: 0 } }, `Ishlar · ${d.tasks.length}`),
        h('button', { class: 'btn sm sp', onclick: () => newTask(id, close) }, '+ Ish')));
    for (const st of STATUS_ORDER) {
      const group = byStatus[st];
      if (!group?.length) continue;
      tasksCard.append(h('div', { class: 'sec-t', style: { marginTop: '14px' } }, `${STATUS_LABEL[st]} · ${group.length}`));
      tasksCard.append(h('div', { class: 'list' }, ...group.map(tk =>
        h('div', { class: 'item', onclick: () => openTask(tk.id) },
          h('div', {}, h('div', { class: 't' }, tk.title),
            h('div', { class: 's row', style: { gap: '8px' } }, visBadge(tk.visibility),
              tk.assignee_name ? h('span', tk.assignee_name) : null)),
          h('div', { class: 'r' },
            tk.revision_round > 0 ? h('span', { class: 'pill acc' }, 'R' + tk.revision_round) : null,
            tk.due_date ? h('span', { class: `pill ${dueLabel(tk.due_date).cls}` }, dueLabel(tk.due_date).text) : null)))));
    }
    body.append(tasksCard);

    body.append(h('div', { class: 'card' }, h('h2', 'Jamoa'),
      h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '6px' } },
        ...d.members.map(m => h('span', { class: 'pill' }, `${m.name} · ${m.craft}`)),
        State.me.role === 'owner'
          ? h('button', { class: 'btn sm ghost', onclick: () => addMember(id, close) }, '+ Qoʻshish') : null)));

    if (d.activity.length) {
      body.append(h('div', { class: 'card' }, h('h2', t('recent')),
        h('div', { class: 'tl' }, ...d.activity.slice(0, 15).map(a =>
          h('div', { class: `tl-i ${a.verb === 'approved' ? 'ok' : a.verb === 'requested changes' ? 'warn' : ''}` },
            h('div', {}, h('b', a.actor_name || '—'), ' ', a.verb, ' ', h('span', { class: 'dim' }, a.detail || '')),
            h('div', { class: 'tiny dim' }, fmtWhen(a.created_at)))))));
    }
  });
}

function progressBlock(label, pr, accent) {
  return h('div', {},
    h('div', { class: 'tiny dim' }, label),
    h('div', { class: 'num' }, (pr?.pct || 0) + '%'),
    h('div', { class: `bar ${accent ? 'acc' : ''}`, style: { marginTop: '6px' } },
      h('i', { style: { width: (pr?.pct || 0) + '%' } })),
    h('div', { class: 'tiny dim', style: { marginTop: '5px' } },
      t('delivered', { done: pr?.done || 0, total: pr?.total || 0 })));
}

function newTask(projectId, reopen) {
  modal('Yangi ish', close => {
    const f = h('form', { onsubmit: submit });
    const assignee = h('select', { class: 'in', name: 'assignee_id' }, h('option', { value: '' }, '—'));
    GET('/api/team').then(team => assignee.append(...team.filter(u => u.role === 'teammate')
      .map(u => h('option', { value: u.id }, `${u.name} · ${u.craft || u.role_name}`))));
    const visible = h('input', { type: 'checkbox', name: 'client_visible' });
    f.append(
      h('label', { class: 'f' }, h('span', 'Sarlavha'), h('input', { class: 'in', name: 'title', required: true })),
      h('label', { class: 'f' }, h('span', 'Tavsif'), h('textarea', { class: 'in', name: 'description' })),
      h('label', { class: 'f' }, h('span', 'Kim bajaradi'), assignee),
      h('div', { class: 'grid g2' },
        h('label', { class: 'f' }, h('span', 'Ichki muddat'), h('input', { class: 'in', name: 'due_date', type: 'date' })),
        h('label', { class: 'f' }, h('span', 'Mijozga aytiladigan'), h('input', { class: 'in', name: 'client_due_date', type: 'date' }))),
      State.me.role === 'owner'
        ? h('label', { class: 'row', style: { marginBottom: '14px', cursor: 'pointer' } }, visible,
            h('span', {}, ' Mijoz buni koʻrsin'))
        : h('div', { class: 'tiny dim', style: { marginBottom: '14px' } },
            'Yangi ish ichki boʻladi — mijozga koʻrsatishni akkаunt menejer hal qiladi.'),
      h('div', { class: 'row', style: { justifyContent: 'flex-end' } },
        h('button', { class: 'btn', type: 'button', onclick: close }, t('cancel')),
        h('button', { class: 'btn pri', type: 'submit' }, 'Qoʻshish')));

    async function submit(e) {
      e.preventDefault();
      const b = Object.fromEntries(new FormData(f));
      try {
        await POST('/api/tasks', {
          project_id: projectId, title: b.title, description: b.description,
          assignee_id: b.assignee_id ? Number(b.assignee_id) : null,
          due_date: b.due_date || null, client_due_date: b.client_due_date || null,
          visibility: visible.checked ? 'client_visible' : 'internal',
        });
        close(); toast('Qoʻshildi');
        if (reopen) { reopen(); openProject(projectId); }
      } catch (err) { toast(err.message, 'bad'); }
    }
    return f;
  });
}

function addMember(projectId, reopen) {
  modal('Jamoaga qoʻshish', close => {
    const sel = h('select', { class: 'in' });
    GET('/api/team').then(team => sel.append(...team.filter(u => u.role === 'teammate')
      .map(u => h('option', { value: u.id, 'data-craft': u.craft || 'designer' }, `${u.name} · ${u.craft}`))));
    return h('div', {},
      h('label', { class: 'f' }, h('span', 'Kim'), sel),
      h('div', { class: 'row', style: { justifyContent: 'flex-end' } },
        h('button', { class: 'btn', onclick: close }, t('cancel')),
        h('button', {
          class: 'btn pri', onclick: async () => {
            const opt = sel.selectedOptions[0];
            await POST(`/api/projects/${projectId}/members`, { user_id: Number(sel.value), craft: opt.dataset.craft });
            close(); toast('Qoʻshildi'); if (reopen) { reopen(); openProject(projectId); }
          },
        }, 'Qoʻshish')));
  });
}

// ---------------------------------------------------------------------------
// Task detail — where the approval chain is visible as a chain
// ---------------------------------------------------------------------------
async function openTask(id) {
  drawer(async (box, close) => {
    box.append(h('div', { class: 'drawer-head' }, h('div', { class: 'spin' })));
    let d;
    try { d = await GET(`/api/tasks/${id}`); }
    catch (e) { clear(box).append(h('div', { class: 'drawer-body' }, h('div', { class: 'err' }, e.message))); return; }
    const tk = d.task;
    const reload = () => { close(); openTask(id); };
    clear(box);

    box.append(h('div', { class: 'drawer-head' },
      h('div', { class: 'row' },
        h('div', {},
          h('h1', { style: { fontSize: '18px', fontWeight: 650 } }, tk.title),
          h('div', { class: 'tiny dim' }, `${tk.company_name} · ${tk.project_name}`)),
        h('button', { class: 'btn sm ghost sp', onclick: close }, '✕')),
      h('div', { class: 'row', style: { marginTop: '10px', gap: '8px', flexWrap: 'wrap' } },
        visBadge(tk.visibility),
        h('span', { class: 'pill' }, STATUS_LABEL[tk.status]),
        tk.revision_round > 0
          ? h('span', { class: `pill ${tk.revision_round > tk.revisions_included ? 'warn' : 'acc'}` },
              `${t('revisionRound', { n: tk.revision_round })} / ${tk.revisions_included}`)
          : null,
        tk.assignee_name ? h('span', { class: 'pill' }, tk.assignee_name) : null)));

    const body = h('div', { class: 'drawer-body' });
    box.append(body);

    if (tk.description) body.append(h('div', { class: 'card' }, h('p', tk.description)));

    // Both dates, labelled, so nobody ever quotes the internal one at a client.
    body.append(h('div', { class: 'card' }, h('div', { class: 'grid g2' },
      h('div', {}, h('div', { class: 'tiny dim' }, 'Ichki muddat'),
        h('b', tk.due_date ? fmtDate(tk.due_date) : '—')),
      h('div', {}, h('div', { class: 'tiny dim' }, 'Mijozga aytilgan'),
        h('b', tk.client_due_date ? fmtDate(tk.client_due_date) : '—')))));

    // ---- move it along --------------------------------------------------
    const actions = h('div', { class: 'card' }, h('h2', 'Holat'));
    const seg = h('div', { class: 'seg' }, ...STATUS_ORDER.filter(s => s !== 'awaiting_client' && s !== 'approved')
      .map(s => h('button', {
        class: tk.status === s ? 'on' : '',
        onclick: async () => { await PATCH(`/api/tasks/${id}`, { status: s }); toast('Yangilandi'); reload(); },
      }, STATUS_LABEL[s])));
    actions.append(seg);

    if (tk.status !== 'awaiting_client') {
      actions.append(h('button', {
        class: 'btn pri wide', style: { marginTop: '12px' },
        onclick: () => sendForApproval(tk, reload),
      }, '→ ' + t('sendForApproval')));
      actions.append(h('div', { class: 'tiny dim', style: { marginTop: '6px' } },
        'Bu ishni mijozga koʻrsatadi va uning qaroriga qoʻyadi.'));
    } else {
      actions.append(h('div', { class: 'row', style: { marginTop: '12px' } },
        h('span', { class: 'pill info' }, '⏳ Mijozning qarorini kutmoqda'),
        h('span', { class: 'dim tiny sp' }, `v${d.versions[0]?.version_no || 1}`)));
    }
    if (State.me.role === 'owner') {
      actions.append(h('button', {
        class: 'btn wide', style: { marginTop: '8px' },
        onclick: async () => {
          await PATCH(`/api/tasks/${id}`, { visibility: tk.visibility === 'internal' ? 'client_visible' : 'internal' });
          toast(tk.visibility === 'internal' ? 'Mijoz endi koʻradi' : 'Mijozdan yashirildi'); reload();
        },
      }, tk.visibility === 'internal' ? '👁 Mijozga ochish' : '🔒 Mijozdan yashirish'));
      if (tk.visibility === 'internal')
        actions.append(h('div', { class: 'tiny dim', style: { marginTop: '6px' } },
          'Ochilganda mijoz faqat shundan keyin yozilgan izohlarni koʻradi.'));
    }
    body.append(actions);

    // ---- the chain, as a chain -------------------------------------------
    if (d.approvals.length || d.versions.length) {
      const chain = h('div', { class: 'card' }, h('h2', 'Tasdiqlash tarixi'));
      const events = [
        ...d.versions.map(v => ({ kind: 'sent', at: v.sent_at, v: v.version_no, note: v.note })),
        ...d.approvals.map(a => ({ kind: a.decision, at: a.decided_at, v: a.version_no, note: a.note, who: a.decided_by_name, src: a.source })),
      ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
      chain.append(h('div', { class: 'tl' }, ...events.map(e => h('div', {
        class: `tl-i ${e.kind === 'approved' ? 'ok' : e.kind === 'changes_requested' ? 'warn' : ''}`,
      },
        h('div', {},
          h('b', e.kind === 'sent' ? `v${e.v} yuborildi`
             : e.kind === 'approved' ? `v${e.v} tasdiqlandi`
             : `v${e.v} — oʻzgartirish soʻraldi`),
          e.who ? h('span', { class: 'dim' }, ' · ' + e.who) : null,
          e.src === 'telegram' ? h('span', { class: 'pill', style: { marginLeft: '6px' } }, 'Telegram') : null),
        e.note ? h('div', { class: 'muted' }, e.note) : null,
        h('div', { class: 'tiny dim' }, fmtWhen(e.at))))));
      body.append(chain);
    }

    // ---- comments, with visibility on every single one --------------------
    const cbox = h('div', { class: 'card' }, h('h2', `Izohlar · ${d.comments.length}`));
    if (d.comments.length) {
      cbox.append(h('div', { class: 'list' }, ...d.comments.map(c => h('div', { style: { padding: '9px 0', borderBottom: '1px solid var(--line-soft)' } },
        h('div', { class: 'row tiny', style: { marginBottom: '3px' } },
          h('b', c.author_name), visBadge(c.visibility), h('span', { class: 'dim sp' }, fmtWhen(c.created_at))),
        h('div', {}, c.body)))));
    }
    const ta = h('textarea', { class: 'in', placeholder: 'Izoh yozing…', style: { marginTop: '10px' } });
    const asClient = h('input', { type: 'checkbox' });
    cbox.append(ta, h('div', { class: 'row', style: { marginTop: '8px' } },
      h('label', { class: 'row tiny', style: { cursor: 'pointer' } }, asClient, h('span', {}, ' Mijoz koʻrsin')),
      h('button', {
        class: 'btn pri sm sp', onclick: async () => {
          if (!ta.value.trim()) return;
          await POST(`/api/tasks/${id}/comments`, {
            body: ta.value, visibility: asClient.checked ? 'client_visible' : 'internal' });
          reload();
        },
      }, 'Yuborish')));
    body.append(cbox);

    // ---- files ------------------------------------------------------------
    const fbox = h('div', { class: 'card' }, h('h2', `Fayllar · ${d.files.length}`));
    if (d.files.length) fbox.append(h('div', { class: 'list' }, ...d.files.map(f =>
      h('a', { class: 'item', href: '#', onclick: e => openFile(e, f.id) },
        h('div', {}, h('div', { class: 't' }, (f.kind === 'voice_brief' ? '🎙 ' : '📎 ') + f.name),
          h('div', { class: 's row', style: { gap: '8px' } }, visBadge(f.visibility),
            f.size_bytes ? h('span', Math.round(f.size_bytes / 1024) + ' KB') : null))))));
    fbox.append(uploadRow(id, reload));
    body.append(fbox);
  });
}

function uploadRow(taskId, reload) {
  const input = h('input', { type: 'file', style: { display: 'none' } });
  const link = h('input', { class: 'in', placeholder: 'yoki Drive/Dropbox havolasini qoʻying' });
  input.addEventListener('change', async () => {
    if (!input.files[0]) return;
    const fd = new FormData();
    fd.append('task_id', taskId);
    fd.append('file', input.files[0]);
    const res = await fetch('/api/files', { method: 'POST', headers: { authorization: `Bearer ${Store.token}` }, body: fd });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) return toast(out.error || 'Yuklanmadi', 'bad');
    toast('Yuklandi'); reload();
  });
  return h('div', { style: { marginTop: '10px' } },
    h('div', { class: 'row', style: { gap: '8px' } },
      h('button', { class: 'btn sm', onclick: () => input.click() }, '📎 Fayl'), input,
      link,
      h('button', {
        class: 'btn sm pri', onclick: async () => {
          if (!link.value.trim()) return;
          const fd = new FormData();
          fd.append('task_id', taskId); fd.append('external_url', link.value.trim());
          fd.append('name', link.value.split('/').pop().slice(0, 60) || 'Havola');
          await fetch('/api/files', { method: 'POST', headers: { authorization: `Bearer ${Store.token}` }, body: fd });
          toast('Havola qoʻshildi'); reload();
        },
      }, '+')),
    h('div', { class: 'tiny dim', style: { marginTop: '6px' } },
      'Katta video fayllarni yuklamang — havola qoldiring. Bu arzonroq va tezroq.'));
}

function sendForApproval(tk, reload) {
  const next = (tk.revision_round || 0) + 1;
  const over = next > tk.revisions_included;
  modal(t('sendForApproval'), close => {
    const note = h('textarea', { class: 'in', placeholder: 'Mijozga qisqacha izoh (ixtiyoriy)' });
    return h('div', {},
      h('p', { class: 'muted', style: { marginBottom: '12px' } },
        'Bu ish mijozga koʻrinadi va uning qaroriga qoʻyiladi. Telegramda ham xabar boradi.'),
      over ? h('div', { class: 'err' },
        `Diqqat: bu ish allaqachon ${tk.revision_round}-qayta ishlashda, kelishuv ${tk.revisions_included} ta edi.`) : null,
      h('label', { class: 'f' }, h('span', 'Izoh'), note),
      h('div', { class: 'row', style: { justifyContent: 'flex-end' } },
        h('button', { class: 'btn', onclick: close }, t('cancel')),
        h('button', {
          class: 'btn pri', onclick: async () => {
            try {
              await POST(`/api/tasks/${tk.id}/send-for-approval`, { note: note.value });
              close(); toast('Mijozga yuborildi'); reload();
            } catch (e) { toast(e.message, 'bad'); }
          },
        }, 'Yuborish')));
  });
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------
async function viewClients(el) {
  loading(el);
  const cs = await GET('/api/companies');
  clear(el);
  el.append(pageHead(t('nav_clients'), `${cs.length} ta mijoz`,
    h('button', { class: 'btn pri', onclick: newCompany }, '+ Mijoz')));
  el.append(h('div', { class: 'card' }, h('div', { class: 'list' }, ...cs.map(c =>
    h('div', { class: 'item', onclick: () => openCompany(c) },
      h('div', {}, h('div', { class: 't' }, c.name),
        h('div', { class: 's' }, [c.contact_name, c.contact_phone].filter(Boolean).join(' · ') || '—')),
      h('div', { class: 'r' },
        c.internal_notes ? h('span', { class: 'pill acc' }, '📌') : null,
        h('span', { class: 'pill' }, `${c.active_projects} loyiha`)))))));
}

function openCompany(c) {
  drawer(async (box, close) => {
    clear(box).append(h('div', { class: 'drawer-head' },
      h('div', { class: 'row' }, h('div', {}, h('h1', { style: { fontSize: '18px', fontWeight: 650 } }, c.name),
        h('div', { class: 'tiny dim' }, c.contact_name || '—')),
        h('button', { class: 'btn sm ghost sp', onclick: close }, '✕'))));
    const body = h('div', { class: 'drawer-body' });
    box.append(body);
    body.append(h('div', { class: 'card' },
      h('h2', 'Aloqa'),
      h('div', {}, c.contact_phone || '—'),
      c.telegram_username ? h('div', { class: 'dim' }, '@' + c.telegram_username) : null));

    // Internal notes are on the client's own record and must never be part of
    // anything the portal reads. Labelled loudly so nobody forgets that.
    const notes = h('textarea', { class: 'in', style: { minHeight: '90px' } }, c.internal_notes || '');
    notes.value = c.internal_notes || '';
    body.append(h('div', { class: 'card', style: { borderColor: 'var(--accent)' } },
      h('h2', { style: { color: 'var(--accent)' } }, '🔒 Ichki eslatmalar — mijoz hech qachon koʻrmaydi'),
      notes,
      h('button', {
        class: 'btn sm pri', style: { marginTop: '8px' },
        onclick: async () => { await PATCH(`/api/companies/${c.id}`, { internal_notes: notes.value }); toast('Saqlandi'); },
      }, t('save'))));

    if (['owner', 'accountant'].includes(State.me.role)) {
      const st = await GET(`/api/finance/companies/${c.id}/statement`);
      const billed = st.invoices.reduce((s, i) => s + Number(i.total), 0);
      const paid = st.payments.reduce((s, p) => s + Number(p.amount), 0);
      body.append(h('div', { class: 'card' }, h('h2', 'Hisob'),
        h('div', { class: 'grid g3' },
          h('div', {}, h('div', { class: 'tiny dim' }, 'Hisob qilingan'), h('div', { class: 'num' }, short(billed))),
          h('div', {}, h('div', { class: 'tiny dim' }, 'Toʻlangan'), h('div', { class: 'num' }, short(paid))),
          h('div', {}, h('div', { class: 'tiny dim' }, 'Qoldiq'),
            h('div', { class: 'num', style: { color: billed - paid > 0 ? 'var(--warn)' : 'inherit' } }, short(billed - paid))))));
    }
  });
}

function newCompany() {
  modal('Yangi mijoz', close => {
    const f = h('form', { onsubmit: async e => {
      e.preventDefault();
      const b = Object.fromEntries(new FormData(f));
      try { await POST('/api/companies', b); close(); toast('Qoʻshildi'); renderShell(); }
      catch (err) { toast(err.message, 'bad'); }
    } });
    f.append(
      h('label', { class: 'f' }, h('span', 'Kompaniya'), h('input', { class: 'in', name: 'name', required: true })),
      h('label', { class: 'f' }, h('span', 'Kontakt shaxs'), h('input', { class: 'in', name: 'contact_name' })),
      h('label', { class: 'f' }, h('span', 'Telefon'), h('input', { class: 'in', name: 'contact_phone', type: 'tel' })),
      h('label', { class: 'f' }, h('span', 'Telegram'), h('input', { class: 'in', name: 'telegram_username', placeholder: 'username' })),
      h('label', { class: 'f' }, h('span', 'Ichki eslatma ', h('span', { class: 'hint' }, '— mijoz koʻrmaydi')),
        h('textarea', { class: 'in', name: 'internal_notes' })),
      h('div', { class: 'row', style: { justifyContent: 'flex-end' } },
        h('button', { class: 'btn', type: 'button', onclick: close }, t('cancel')),
        h('button', { class: 'btn pri', type: 'submit' }, 'Qoʻshish')));
    return f;
  });
}

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------
async function viewFinance(el) {
  loading(el);
  const [sum, invoices] = [await GET('/api/finance/summary'), await GET('/api/finance/invoices')];
  const cur = State.me.currency;
  clear(el);
  el.append(pageHead(t('nav_finance'), 'Hisob-fakturalar va toʻlovlar',
    h('button', { class: 'btn pri', onclick: () => newInvoice() }, '+ Hisob')));

  el.append(h('div', { class: 'grid g4' },
    stat('Hisob qilingan', short(sum.invoiced), cur),
    stat('Toʻlangan', short(sum.collected), cur),
    stat('Qoldiq', short(sum.outstanding), cur, sum.outstanding > 0 ? 'var(--warn)' : null),
    stat('Qoʻshimcha ish', short(sum.extra_scope_billed), cur, 'var(--accent)')));

  if (sum.scope_pending)
    el.append(h('div', { class: 'card', style: { borderColor: 'var(--accent)', marginTop: '12px' } },
      h('b', `${sum.scope_pending} ta qoʻshimcha ish qarori kutmoqda`),
      h('div', { class: 'tiny dim' }, 'Akkaunt menejer qaror qilmaguncha hisobga tushmaydi.')));

  el.append(h('div', { class: 'card' }, h('h2', 'Hisob-fakturalar'),
    invoices.length ? h('div', { class: 'list' }, ...invoices.map(i => {
      const owed = Number(i.total) - Number(i.paid);
      return h('div', { class: 'item', onclick: () => openInvoice(i.id) },
        h('div', {}, h('div', { class: 't' }, `${i.number} · ${i.company_name}`),
          h('div', { class: 's' }, [i.project_name, fmtDate(i.issued_on)].filter(Boolean).join(' · '))),
        h('div', { class: 'r' },
          h('span', { class: 'mono' }, money(i.total, cur)),
          h('span', { class: `pill ${i.status === 'paid' ? 'ok' : owed > 0 && i.due_on && daysFrom(i.due_on) < 0 ? 'warn' : ''}` },
            i.status === 'paid' ? 'Toʻlangan' : i.status === 'draft' ? 'Qoralama' : 'Yuborilgan')));
    })) : emptyBox('₴', 'Hisob-faktura yoʻq')));
}

function stat(label, value, cur, color) {
  return h('div', { class: 'card' },
    h('div', { class: 'tiny dim' }, label),
    h('div', { class: 'num', style: color ? { color } : {} }, value),
    h('div', { class: 'tiny dim' }, cur));
}

async function openInvoice(id) {
  const d = await GET(`/api/finance/invoices/${id}`);
  const cur = State.me.currency;
  const total = d.lines.reduce((s, l) => s + Number(l.qty) * Number(l.unit_amount), 0);
  const paid = d.payments.reduce((s, p) => s + Number(p.amount), 0);
  drawer((box, close) => {
    clear(box).append(h('div', { class: 'drawer-head' }, h('div', { class: 'row' },
      h('div', {}, h('h1', { style: { fontSize: '18px', fontWeight: 650 } }, d.invoice.number),
        h('div', { class: 'tiny dim' }, d.invoice.company_name)),
      h('button', { class: 'btn sm ghost sp', onclick: close }, '✕'))));
    const body = h('div', { class: 'drawer-body' });
    box.append(body);
    body.append(h('div', { class: 'card' }, h('h2', 'Qatorlar'),
      h('div', { class: 'list' }, ...d.lines.map(l => h('div', { class: 'item', style: { cursor: 'default' } },
        h('div', {}, h('div', { class: 't' }, l.description),
          l.scope_alert_id ? h('div', { class: 's' }, h('span', { class: 'pill acc' }, 'Qoʻshimcha ish')) : null),
        h('div', { class: 'r mono' }, money(Number(l.qty) * Number(l.unit_amount), cur))))),
      h('div', { class: 'row', style: { marginTop: '12px', paddingTop: '10px', borderTop: '1px solid var(--line)' } },
        h('b', 'Jami'), h('b', { class: 'mono sp' }, money(total, cur)))));

    body.append(h('div', { class: 'card' }, h('h2', 'Toʻlovlar'),
      d.payments.length ? h('div', { class: 'list' }, ...d.payments.map(p =>
        h('div', { class: 'item', style: { cursor: 'default' } },
          h('div', {}, h('div', { class: 't' }, fmtDate(p.paid_on)), h('div', { class: 's' }, p.method)),
          h('div', { class: 'r mono' }, money(p.amount, cur))))) : h('div', { class: 'dim tiny' }, 'Hali toʻlov yoʻq'),
      h('div', { class: 'row', style: { marginTop: '12px' } },
        h('span', { class: 'dim' }, 'Qoldiq'),
        h('b', { class: 'mono sp', style: { color: total - paid > 0 ? 'var(--warn)' : 'var(--ok)' } }, money(total - paid, cur))),
      total - paid > 0 ? h('button', {
        class: 'btn pri wide', style: { marginTop: '12px' },
        onclick: () => addPayment(d.invoice, total - paid, () => { close(); renderShell(); }),
      }, '+ Toʻlov qayd etish') : null));

    if (d.invoice.status === 'draft')
      body.append(h('button', {
        class: 'btn wide', onclick: async () => {
          await PATCH(`/api/finance/invoices/${id}`, { status: 'sent' });
          close(); toast('Yuborilgan deb belgilandi'); renderShell();
        },
      }, 'Yuborilgan deb belgilash'));
  });
}

function addPayment(invoice, suggested, done) {
  modal('Toʻlov', close => {
    const amt = h('input', { class: 'in mono', type: 'number', value: String(suggested) });
    const dt = h('input', { class: 'in', type: 'date', value: today() });
    return h('div', {},
      h('label', { class: 'f' }, h('span', 'Summa'), amt),
      h('label', { class: 'f' }, h('span', 'Sana'), dt),
      h('div', { class: 'row', style: { justifyContent: 'flex-end' } },
        h('button', { class: 'btn', onclick: close }, t('cancel')),
        h('button', {
          class: 'btn pri', onclick: async () => {
            await POST('/api/finance/payments', {
              invoice_id: invoice.id, company_id: invoice.company_id,
              amount: Number(amt.value), paid_on: dt.value });
            close(); toast('Qayd etildi'); done();
          },
        }, t('save'))));
  });
}

function newInvoice() {
  modal('Yangi hisob-faktura', close => {
    const f = h('form');
    const sel = h('select', { class: 'in', name: 'company_id', required: true });
    GET('/api/companies').then(cs => sel.append(...cs.map(c => h('option', { value: c.id }, c.name))));
    const desc = h('input', { class: 'in', placeholder: 'Xizmat tavsifi' });
    const amt = h('input', { class: 'in mono', type: 'number', placeholder: '0' });
    f.append(h('label', { class: 'f' }, h('span', 'Mijoz'), sel),
      h('label', { class: 'f' }, h('span', 'Tavsif'), desc),
      h('label', { class: 'f' }, h('span', 'Summa'), amt),
      h('div', { class: 'row', style: { justifyContent: 'flex-end' } },
        h('button', { class: 'btn', type: 'button', onclick: close }, t('cancel')),
        h('button', {
          class: 'btn pri', type: 'button', onclick: async () => {
            try {
              await POST('/api/finance/invoices', {
                company_id: Number(sel.value),
                lines: desc.value ? [{ description: desc.value, qty: 1, unit_amount: Number(amt.value) || 0 }] : [],
              });
              close(); toast('Yaratildi'); renderShell();
            } catch (e) { toast(e.message, 'bad'); }
          },
        }, 'Yaratish')));
    return f;
  });
}

// ---------------------------------------------------------------------------
// Weekly report — the agency, not the individuals
// ---------------------------------------------------------------------------
async function viewReport(el) {
  loading(el);
  const r = await GET('/api/reports/weekly');
  clear(el);
  el.append(pageHead(t('nav_report'), 'Soʻnggi 7 kun'));
  el.append(h('div', { class: 'grid g4' },
    stat('Topshirildi', r.shipped.length, ''),
    stat('Mijozlarda', r.waiting.length, ''),
    stat('Muddati oʻtdi', r.slipped.length, '', r.slipped.length ? 'var(--warn)' : null),
    stat('Qayta ishlash', r.revisions.rounds, `${r.revisions.on_tasks} ta ishda`, 'var(--accent)')));

  el.append(h('div', { class: 'card' },
    h('h2', 'Mijozlar boʻyicha'),
    h('div', { class: 'list' }, ...r.by_client.map(c => h('div', { class: 'item', style: { cursor: 'default' } },
      h('div', { class: 't' }, c.company),
      h('div', { class: 'r' },
        h('span', { class: 'pill ok' }, `${c.shipped} topshirildi`),
        c.waiting ? h('span', { class: 'pill info' }, `${c.waiting} kutmoqda`) : null,
        c.late ? h('span', { class: 'pill warn' }, `${c.late} kechikdi`) : null))))));

  if (r.waiting.length) el.append(h('div', { class: 'card' }, h('h2', 'Eng uzoq mijozlarda turgani'),
    h('div', { class: 'list' }, ...r.waiting.slice(0, 8).map(w => h('div', { class: 'item', onclick: () => openTask(w.id) },
      h('div', {}, h('div', { class: 't' }, w.title), h('div', { class: 's' }, w.company)),
      h('div', { class: 'r' }, h('span', { class: `pill ${w.days_waiting >= 7 ? 'warn' : ''}` }, `${w.days_waiting} kun`)))))));

  if (r.slipped.length) el.append(h('div', { class: 'card' }, h('h2', 'Muddati oʻtganlar'),
    h('div', { class: 'list' }, ...r.slipped.map(s => h('div', { class: 'item', onclick: () => openTask(s.id) },
      h('div', {}, h('div', { class: 't' }, s.title), h('div', { class: 's' }, `${s.company} · ${s.project}`)),
      h('div', { class: 'r' }, h('span', { class: 'pill warn' }, `${s.days_late} kun`)))))));

  el.append(h('div', { class: 'card' }, h('div', { class: 'tiny dim' },
    'Bu hisobot agentlikni oʻlchaydi, xodimlarni emas. Har kim oʻz haftasini "Bugun" sahifasida koʻradi.')));
}

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------
async function viewTeam(el) {
  loading(el);
  const [team, companies] = [await GET('/api/team'), await GET('/api/companies')];
  clear(el);
  el.append(pageHead(t('nav_team'), `${team.length} kishi`,
    h('button', { class: 'btn', onclick: () => invite('teammate', companies) }, '+ Xodim'),
    h('button', { class: 'btn pri', onclick: () => invite('client', companies) }, '+ Mijoz kirishi')));
  el.append(h('div', { class: 'card' }, h('div', { class: 'list' }, ...team.map(u =>
    h('div', { class: 'item', style: { cursor: 'default' } },
      h('div', {}, h('div', { class: 't' }, u.name), h('div', { class: 's' }, u.phone || '')),
      h('div', { class: 'r' },
        h('span', { class: 'pill' }, u.craft || u.role_name),
        u.active ? null : h('span', { class: 'pill warn' }, 'Faol emas')))))));
  el.append(h('div', { class: 'card' }, h('div', { class: 'tiny dim' },
    'Akkaunt menejer hisobi qoʻlda yaratiladi va bu yerdan taklif qilinmaydi.')));
}

function invite(role, companies) {
  modal(role === 'client' ? 'Mijozga kirish berish' : 'Xodim qoʻshish', close => {
    const f = h('form');
    const company = h('select', { class: 'in' }, ...companies.map(c => h('option', { value: c.id }, c.name)));
    const roleSel = h('select', { class: 'in' },
      h('option', { value: 'teammate' }, 'Jamoa aʼzosi'),
      h('option', { value: 'accountant' }, 'Buxgalter'));
    const craft = h('select', { class: 'in' }, ...['designer', 'smm', 'copywriter', 'motion', 'video']
      .map(c => h('option', { value: c }, c)));
    f.append(
      h('label', { class: 'f' }, h('span', 'Ism'), h('input', { class: 'in', name: 'name', required: true })),
      h('label', { class: 'f' }, h('span', 'Telefon'), h('input', { class: 'in', name: 'phone', type: 'tel', required: true, placeholder: '+998...' })),
      h('label', { class: 'f' }, h('span', 'PIN ', h('span', { class: 'hint' }, '— 4 raqam')),
        h('input', { class: 'in mono', name: 'pin', inputmode: 'numeric', required: true, placeholder: '1234' })),
      role === 'client'
        ? h('label', { class: 'f' }, h('span', 'Qaysi mijoz kompaniyasi'), company)
        : h('div', {}, h('label', { class: 'f' }, h('span', 'Rol'), roleSel),
                       h('label', { class: 'f' }, h('span', 'Yoʻnalish'), craft)),
      role === 'client' ? h('div', { class: 'tiny dim', style: { marginBottom: '12px' } },
        'Bu odam faqat shu kompaniyaning mijozga ochilgan ishlarini koʻradi. Boshqa hech narsani.') : null,
      h('div', { class: 'row', style: { justifyContent: 'flex-end' } },
        h('button', { class: 'btn', type: 'button', onclick: close }, t('cancel')),
        h('button', {
          class: 'btn pri', type: 'button', onclick: async () => {
            const b = Object.fromEntries(new FormData(f));
            try {
              await POST('/api/team', {
                name: b.name, phone: b.phone, pin: b.pin,
                role: role === 'client' ? 'client' : roleSel.value,
                company_id: role === 'client' ? Number(company.value) : null,
                craft: role === 'client' ? '' : craft.value,
              });
              close(); toast('Qoʻshildi'); renderShell();
            } catch (e) { toast(e.message, 'bad'); }
          },
        }, 'Qoʻshish')));
    return f;
  });
}

// ---------------------------------------------------------------------------
// Settings — mostly the Telegram link, because that is where they live
// ---------------------------------------------------------------------------
async function viewSettings(el) {
  clear(el);
  el.append(pageHead(t('nav_settings'), State.me.agency));
  const tg = h('div', { class: 'card' },
    h('h2', 'Telegram'),
    State.me.telegram_linked
      ? h('div', {}, h('div', { class: 'row' }, h('span', { class: 'pill ok' }, '✓ Ulangan'),
          h('button', {
            class: 'btn sm ghost sp', onclick: async () => {
              await POST('/api/telegram/unlink', {}); toast('Uzildi'); State.me.telegram_linked = false; viewSettings(el);
            },
          }, 'Uzish')),
          h('div', { class: 'tiny dim', style: { marginTop: '8px' } },
            State.me.role === 'client'
              ? 'Tasdiqlash kerak boʻlganda darhol xabar keladi va oʻsha yerda tasdiqlaysiz.'
              : 'Ovozli xabar yuborsangiz — bu brief sifatida saqlanadi. /week hisobotni beradi.'))
      : h('div', {},
          h('p', { class: 'muted', style: { marginBottom: '12px' } },
            'Telegramni ulang: tasdiqlashlar, ogohlantirishlar va ovozli brieflar oʻsha yerda ishlaydi.'),
          h('button', {
            class: 'btn pri', onclick: async () => {
              const r = await POST('/api/telegram/link-code', {});
              modal('Telegramni ulash', close => h('div', {},
                h('p', { class: 'muted' }, 'Botga shu kodni yuboring:'),
                h('div', { class: 'card mono', style: { textAlign: 'center', fontSize: '26px', letterSpacing: '.16em', margin: '14px 0' } }, r.code),
                r.bot ? h('a', { class: 'btn pri wide', href: `https://t.me/${r.bot}?start=${r.code}`, target: '_blank' }, 'Telegramda ochish') : null,
                h('div', { class: 'tiny dim', style: { marginTop: '10px' } }, `${r.expires_in_minutes} daqiqa amal qiladi.`)));
            },
          }, 'Kod olish')));
  el.append(tg);

  el.append(h('div', { class: 'card' }, h('h2', 'Til'),
    h('div', { class: 'seg' }, ...[['uz', "O'zbekcha"], ['ru', 'Русский'], ['en', 'English']].map(([k, label]) =>
      h('button', { class: Store.lang === k ? 'on' : '', onclick: () => { Store.lang = k; renderShell(); } }, label)))));

  el.append(h('div', { class: 'card' }, h('h2', 'Hisob'),
    h('div', {}, h('b', State.me.name)),
    h('div', { class: 'tiny dim' }, `${State.me.role_name} · ${State.me.agency}`)));
}

// ---------------------------------------------------------------------------
(async function start() {
  if (!Store.token) return renderLogin();
  try {
    State.me = await GET('/api/me');
    if (State.me.role === 'client') return void (location.href = '/portal/');
    renderShell();
  } catch (e) { Store.token = null; renderLogin(); }
})();
