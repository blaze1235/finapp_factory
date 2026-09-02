/* The agency surface: account manager, editor, member and accountant.
   The client portal is a separate page that ships none of this. */

const State = { me: null, view: 'today', data: {}, settings: {} };
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
    f.querySelector('button').disabled = true;
    try {
      const r = await POST('/api/login', { phone: f.phone.value, pin: f.pin.value });
      Store.token = r.token;
      // A client who lands on the staff login belongs in the portal, not here.
      location.href = r.role === 'client' ? '/portal/' : '/';
    } catch (err) { renderLogin(err.message); }
  }
}

// ---------------------------------------------------------------------------
// Shell — the nav each role gets is spelled out in §1
// ---------------------------------------------------------------------------
const NAV = [
  { id: 'today',    ico: '◈', roles: ['owner', 'teammate', 'editor'] },
  { id: 'projects', ico: '▤', roles: ['owner', 'teammate', 'editor', 'accountant'] },
  { id: 'mytasks',  ico: '☑', roles: ['owner', 'teammate', 'editor'] },
  { id: 'calendar', ico: '▦', roles: ['owner', 'teammate', 'editor'] },
  { id: 'team_perf',ico: '★', roles: ['owner', 'teammate', 'editor'] },
  { id: 'clients',  ico: '◍', roles: ['owner', 'accountant'] },
  { id: 'team',     ico: '◎', roles: ['owner'] },
  { id: 'finance',  ico: '₴', roles: ['owner', 'accountant'] },
  { id: 'report',   ico: '◔', roles: ['owner', 'accountant', 'teammate', 'editor'] },
  { id: 'settings', ico: '⚙', roles: ['owner'] },
];

const VIEWS = {
  today: viewToday, projects: viewProjects, mytasks: viewMyTasks, calendar: viewCalendar,
  team_perf: viewPerformance, clients: viewClients, team: viewTeam, finance: viewFinance,
  report: viewReport, settings: viewSettings,
};

function go(view) { State.view = view; renderShell(); }

function renderShell() {
  const nav = NAV.filter(n => n.roles.includes(State.me.role));
  if (!nav.some(n => n.id === State.view)) State.view = nav[0].id;

  const side = h('div', { class: 'side' },
    h('div', { class: 'brand' }, h('div', { class: 'mark' }, 'A'),
      h('div', {}, h('b', State.settings.agency_name || State.me.agency), h('small', State.me.role_name))),
    ...nav.map(n => h('button', {
      class: `nav ${State.view === n.id ? 'on' : ''}`, onclick: () => go(n.id),
    }, h('span', { class: 'ico' }, n.ico),
       // One page, two names: the owner gets a stats table, everyone else a
       // leaderboard, so the nav should not call both of them the same thing.
       t(n.id === 'team_perf' && State.me.role === 'owner' ? 'nav_team_stats' : 'nav_' + n.id),
       n.id === 'today' && State.data.scopeCount ? h('span', { class: 'count' }, State.data.scopeCount) : null)),
    h('div', { class: 'side-foot' },
      h('div', { class: 'row tiny dim', style: { padding: '0 10px 8px' } },
        ...['uz', 'ru', 'en'].map(l => h('a', {
          href: '#', style: { marginRight: '9px' },
          onclick: e => { e.preventDefault(); Store.lang = l; renderShell(); },
        }, l === Store.lang ? h('b', l.toUpperCase()) : l.toUpperCase()))),
      h('button', { class: 'nav', onclick: () => { Store.token = null; location.reload(); } },
        avatar(State.me.name, State.me.avatar_color || State.me.id, 20), State.me.name)));

  const main = h('div', { class: 'main' });
  clear(root()).append(h('div', { class: 'app' }, side, main));
  VIEWS[State.view](main);
}

function loading(el) { clear(el).append(h('div', { class: 'empty' }, h('div', { class: 'spin', style: { margin: '0 auto' } }))); }
function pageHead(title, sub, ...actions) {
  return h('div', { class: 'head' }, h('div', {}, h('h1', title), sub && h('p', sub)),
    actions.filter(Boolean).length ? h('div', { class: 'sp' }, ...actions) : null);
}
const visBadge = v => h('span', { class: `vis ${v === 'client_visible' ? 'client' : 'internal'}` },
  h('span', { class: 'dot' }), v === 'client_visible' ? t('clientVisible') : t('internal'));
function emptyBox(icon, text) { return h('div', { class: 'empty' }, h('div', { class: 'big' }, icon), text); }
const canAssign = () => ['owner', 'editor'].includes(State.me.role);

// ---------------------------------------------------------------------------
// Today — the command centre (§2)
// ---------------------------------------------------------------------------
async function viewToday(el) {
  loading(el);
  const d = await GET('/api/dashboard');
  State.data.scopeCount = d.scope.length;
  clear(el);

  el.append(pageHead(`${greeting()}, ${State.me.name.split(' ')[0]}`,
    new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }),
    h('button', { class: 'btn', onclick: () => quickAddTask(() => go('today')) }, '+ Ish'),
    State.me.role === 'owner' ? h('button', { class: 'btn pri', onclick: () => newProject() }, '+ Loyiha') : null));

  // The scope decision comes first on the page, every time, until it is made.
  for (const s of d.scope) el.append(scopeAlertCard(s));

  // "Needs your attention" — every count is a link to the thing it counts.
  const A = d.attention;
  const items = [
    ['client_requests',   A.client_requests,   'mijoz soʻrovlari',        () => go('projects')],
    ['overdue_tasks',     A.overdue_tasks,     'muddati oʻtgan ish',      () => go('mytasks')],
    ['awaiting_approval', A.awaiting_approval, 'ichki tekshiruvda',       () => go('projects')],
    ['waiting_on_client', A.waiting_on_client, 'mijozda turibdi',         () => go('projects')],
    ['due_tomorrow',      A.due_tomorrow,      'ertaga muddati',          () => go('mytasks')],
    ['overdue_invoices',  A.overdue_invoices,  'toʻlanmagan hisob',       () => go('finance')],
  ].filter(([k, n]) => n > 0 || k === 'overdue_tasks');

  el.append(h('div', { class: 'card' },
    h('h2', 'Eʼtiboringiz kerak'),
    items.length ? h('div', { class: 'attn' }, ...items.map(([k, n, label, onclick]) =>
      h('button', { class: n > 0 && ['overdue_tasks', 'overdue_invoices'].includes(k) ? 'hot' : '', onclick },
        h('span', { class: 'n' }, n), h('span', { class: 'l' }, label))))
      : emptyBox('✓', 'Hammasi joyida — hech narsa kutmayapti')));

  // Personal stats + the shipped/slipped strip.
  const strip = h('div', { class: 'card' },
    h('div', { class: 'row', style: { alignItems: 'flex-start' } },
      h('div', { class: 'grid g4', style: { flex: 1 } },
        miniStat('Ochiq ishim', d.stats.open),
        miniStat('Shu hafta', d.stats.due_this_week),
        miniStat('7 kunda yakunlandi', d.stats.done_7d),
        miniStat('Loyihalarim', d.stats.projects)),
      h('div', { style: { marginLeft: '20px', textAlign: 'right' } },
        h('div', { class: 'tiny dim', style: { marginBottom: '5px' } }, 'Topshirildi / kechikdi'),
        sparkline(d.strip, 'shipped', 'slipped'),
        h('a', { href: '#', class: 'tiny', style: { display: 'block', marginTop: '6px' },
                 onclick: e => { e.preventDefault(); go('report'); } }, 'Hisobotga →'))));
  el.append(strip);

  const cols = h('div', { class: 'grid g2' });

  // Client activity, split the way the spec asks.
  const act = h('div', { class: 'card' }, h('h2', 'Mijozlardan'));
  const CA = d.client_activity;
  act.append(h('div', { class: 'sec-t' }, `Sizda · ${CA.waiting_on_you.length}`));
  act.append(CA.waiting_on_you.length
    ? h('div', { class: 'list' }, ...CA.waiting_on_you.slice(0, 5).map(a =>
        h('div', { class: 'item', onclick: () => openTask(a.task_id) },
          h('div', {}, h('div', { class: 't' }, a.task),
            h('div', { class: 's' }, `${a.company} · ${a.note ? '"' + a.note.slice(0, 48) + '"' : ''}`)),
          h('div', { class: 'r' }, h('span', { class: 'pill acc' }, fmtWhen(a.decided_at))))))
    : h('div', { class: 'dim tiny', style: { paddingBottom: '8px' } }, 'Javob kutayotgan soʻrov yoʻq'));
  if (CA.handled.length) {
    act.append(h('div', { class: 'sec-t', style: { marginTop: '14px' } }, 'Hal qilingan'));
    act.append(h('div', { class: 'list' }, ...CA.handled.slice(0, 4).map(a =>
      h('div', { class: 'item', onclick: () => openTask(a.task_id) },
        h('div', {}, h('div', { class: 't' }, a.task), h('div', { class: 's' }, a.company)),
        h('div', { class: 'r' }, h('span', { class: `pill ${a.decision === 'approved' ? 'ok' : ''}` },
          a.decision === 'approved' ? '✓' : '✏'))))));
  }
  cols.append(act);

  // Today, tomorrow, and anything already late.
  const tt = h('div', { class: 'card' }, h('h2', `Bugun va ertaga · ${d.today_tomorrow.length}`));
  tt.append(d.today_tomorrow.length
    ? h('div', { class: 'list' }, ...d.today_tomorrow.map(tk => h('div', { class: 'item', onclick: () => openTask(tk.id) },
        h('div', {}, h('div', { class: 't' }, tk.title), h('div', { class: 's' }, `${tk.company} · ${tk.project}`)),
        h('div', { class: 'r' },
          tk.assignee ? avatar(tk.assignee, tk.assignee, 22) : null,
          h('span', { class: `pill ${tk.bucket === 'overdue' ? 'warn' : tk.bucket === 'today' ? 'acc' : ''}` },
            tk.bucket === 'overdue' ? dueLabel(tk.due_date).text : tk.bucket === 'today' ? t('today') : t('tomorrow'))))))
    : emptyBox('✓', 'Bugun va ertaga muddati yoʻq'));
  cols.append(tt);
  el.append(cols);

  if (d.waiting.length) {
    const rows = d.waiting.map(waitingRow);
    el.append(h('div', { class: 'card' },
      h('h2', `${t('waitingOnClients')} · ${d.waiting.length}`),
      h('div', { class: 'list' }, ...rows)));
  }

  // Project cards grid.
  if (d.projects.length) {
    el.append(h('div', { class: 'sec-t', style: { marginTop: '20px' } }, 'Loyihalar'));
    el.append(h('div', { class: 'grid g3' }, ...d.projects.map(projectCard)));
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
}

function waitingRow(w) {
  const days = w.sent_at ? Math.round((Date.now() - Date.parse(w.sent_at)) / 86400000) : null;
  const tone = days >= 5 ? 'warn' : days >= 3 ? 'acc' : '';
  const age = days === null ? '—' : days === 0 ? t('today') : t('daysAgo', { n: days });
  return h('div', { class: 'item', onclick: () => openTask(w.id) },
    h('div', {},
      h('div', { class: 't' }, w.title),
      h('div', { class: 's' }, `${w.company} · ${w.project}`)),
    h('div', { class: 'r' },
      w.version ? h('span', { class: 'pill' }, 'v' + w.version) : null,
      h('span', { class: 'pill ' + tone }, age)));
}

function miniStat(label, n) {
  return h('div', {}, h('div', { class: 'num' }, n), h('div', { class: 'tiny dim' }, label));
}

function greeting() {
  const hr = new Date().getHours();
  return hr < 12 ? 'Xayrli tong' : hr < 18 ? 'Xayrli kun' : 'Xayrli kech';
}

function projectCard(p) {
  const due = dueLabel(p.client_due_date || p.due_date);
  // The accountant has no task visibility at all, so project_progress honestly
  // returns zero for them. Drawing an empty bar would read as "nothing is
  // done" rather than "this is not yours to see" — so it is not drawn.
  const seesTasks = State.me.role !== 'accountant';
  return h('div', { class: 'card', style: { cursor: 'pointer' }, onclick: () => openProject(p.id) },
    h('div', { class: 'row', style: { marginBottom: '2px' } },
      h('b', p.name),
      h('span', { class: 'pill sp' }, STAGE_LABEL[p.stage] || p.stage)),
    h('div', { class: 'tiny dim', style: { marginBottom: '11px' } }, p.company_name),
    seesTasks ? h('div', { class: 'bar' }, h('i', { style: { width: (p.pct || 0) + '%' } })) : null,
    h('div', { class: 'row tiny dim', style: { marginTop: '7px' } },
      h('span', seesTasks ? t('delivered', { done: p.done, total: p.total }) : 'Ishlar sizga koʻrinmaydi'),
      h('span', { class: 'sp' }, due.text ? h('span', { class: due.cls === 'warn' ? 'pill warn' : '' }, due.text) : null)),
    p.members && p.members.length
      ? h('div', { style: { marginTop: '9px' } }, avatars(p.members)) : null);
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
      h('button', { class: 'btn ghost', onclick: () => openTask(s.task_id) }, 'Koʻrish')));

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
          `${s.company} uchun daftarga "toʻlanmagan" qatori yoziladi — oyning foydasini koʻtaradi, ` +
          'lekin pul kelgunicha kassaga tegmaydi.'),
        h('label', { class: 'f' }, h('span', 'Summa'), inp),
        h('div', { class: 'row', style: { justifyContent: 'flex-end' } },
          h('button', { class: 'btn', onclick: close }, t('cancel')),
          h('button', {
            class: 'btn pri', onclick: async () => {
              if (!(Number(inp.value) > 0)) return toast('Summani kiriting', 'bad');
              await POST(`/api/scope-alerts/${s.id}/resolve`, { resolution: 'billed', amount: Number(inp.value) });
              close(); toast('Qoʻshimcha ish daftarga yozildi'); renderShell();
            },
          }, t('bill'))));
    });
  }
  return box;
}

// Quick-add from the dashboard: an inline form, not a separate page (§2).
function quickAddTask(done, presetProject) {
  modal('Yangi ish', close => {
    const f = h('form');
    const project = h('select', { class: 'in', required: true });
    const assignee = h('select', { class: 'in' }, h('option', { value: '' }, '—'));
    const difficulty = h('select', { class: 'in' },
      ...Object.entries(DIFFICULTY).map(([k, v]) =>
        h('option', { value: k, selected: k === 'medium' }, `${v} · ${{ easy: 5, medium: 10, hard: 20 }[k]} ball`)));
    const requiresFile = h('input', { type: 'checkbox' });

    GET('/api/projects').then(ps => {
      project.append(...ps.map(p => h('option', { value: p.id, selected: p.id === presetProject },
        `${p.company_name} — ${p.name}`)));
      if (presetProject) project.value = String(presetProject);
    });
    if (canAssign()) GET('/api/team').then(team => assignee.append(...team
      .filter(u => ['teammate', 'editor'].includes(u.role))
      .map(u => h('option', { value: u.id }, `${u.name} · ${u.craft || u.role_name}`))));

    f.append(
      h('label', { class: 'f' }, h('span', 'Ish nomi'), h('input', { class: 'in', name: 'title', required: true, autofocus: true })),
      h('label', { class: 'f' }, h('span', 'Loyiha'), project),
      canAssign()
        ? h('label', { class: 'f' }, h('span', 'Kim bajaradi'), assignee)
        : h('div', { class: 'tiny dim', style: { marginBottom: '11px' } },
            'Bu ish sizga biriktiriladi — boshqaga topshirishni muharrir yoki akkaunt menejer qiladi.'),
      h('div', { class: 'grid g2' },
        h('label', { class: 'f' }, h('span', 'Muddat'), h('input', { class: 'in', name: 'due_date', type: 'date' })),
        h('label', { class: 'f' }, h('span', 'Murakkabligi ', h('span', { class: 'hint' }, '— ballni belgilaydi')), difficulty)),
      h('label', { class: 'toggle', style: { cursor: 'pointer' } },
        h('span', { class: 'lbl' }, h('b', 'Fayl talab qilinadimi?'),
          h('span', 'Yoqilsa, fayl biriktirilmaguncha ish yopilmaydi')),
        h('span', { class: 'sw' }, requiresFile, h('i'))),
      h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '14px' } },
        h('button', { class: 'btn', type: 'button', onclick: close }, t('cancel')),
        h('button', { class: 'btn pri', type: 'button', onclick: save }, 'Qoʻshish')));

    async function save() {
      const b = Object.fromEntries(new FormData(f));
      if (!b.title) return toast('Ish nomini yozing', 'bad');
      try {
        await POST('/api/tasks', {
          project_id: Number(project.value), title: b.title,
          assignee_id: assignee.value ? Number(assignee.value) : null,
          due_date: b.due_date || null, difficulty: difficulty.value,
          requires_file: requiresFile.checked,
        });
        close(); toast('Qoʻshildi'); done && done();
      } catch (e) { toast(e.message, 'bad'); }
    }
    return f;
  });
}

// ---------------------------------------------------------------------------
// Projects (§3)
// ---------------------------------------------------------------------------
const STAGES = ['brief', 'concept', 'production', 'review', 'approval', 'delivery'];
const STAGE_LABEL = {
  brief: 'Brif', concept: 'Konsept', production: 'Ishlab chiqarish',
  review: 'Koʻrib chiqish', approval: 'Tasdiqlash', delivery: 'Topshirish',
};
const STATUS_ORDER = ['todo', 'in_progress', 'in_review', 'awaiting_client', 'approved', 'completed'];
const STATUS_LABEL = {
  todo: 'Navbatda', in_progress: 'Ishlanmoqda', in_review: 'Ichki tekshiruv',
  awaiting_client: 'Mijozda', approved: 'Tasdiqlandi', completed: 'Yakunlandi',
};

function stagePipeline(current, onPick) {
  return h('div', { class: 'row', style: { gap: '4px', flexWrap: 'wrap' } },
    ...STAGES.map(st => h('button', {
      class: `pill ${st === current ? 'acc' : ''}`,
      style: { border: 'none', cursor: onPick ? 'pointer' : 'default',
               fontWeight: st === current ? 700 : 500, opacity: st === current ? 1 : .65 },
      onclick: onPick ? () => onPick(st) : null,
    }, STAGE_LABEL[st])));
}

async function viewProjects(el) {
  loading(el);
  const list = await GET('/api/projects');
  clear(el);
  el.append(pageHead(t('nav_projects'), `${list.length} ta faol loyiha`,
    State.me.role === 'owner' ? h('button', { class: 'btn pri', onclick: () => newProject() }, '+ Loyiha') : null));
  if (!list.length) return el.append(h('div', { class: 'card' }, emptyBox('▤', 'Hali loyiha yoʻq')));
  el.append(h('div', { class: 'grid g3' }, ...list.map(p => {
    const card = projectCard({ ...p, members: p.members || [] });
    if (Number(p.scope_pending)) card.querySelector('.row').append(h('span', { class: 'pill acc' }, '⚠'));
    return card;
  })));
}

function newProject() {
  modal('Yangi loyiha', close => {
    const f = h('form');
    const company = h('select', { class: 'in', name: 'company_id', required: true });
    const members = h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '6px' } });
    const chosen = new Set();
    GET('/api/companies').then(cs => company.append(...cs.map(c => h('option', { value: c.id }, c.name))));
    GET('/api/team').then(team => members.append(...team.filter(u => ['teammate', 'editor'].includes(u.role))
      .map(u => {
        const chip = h('button', { class: 'pill', type: 'button', style: { cursor: 'pointer', border: '1px solid var(--line)' } },
          u.name);
        chip.onclick = () => {
          chosen.has(u.id) ? chosen.delete(u.id) : chosen.add(u.id);
          chip.className = chosen.has(u.id) ? 'pill acc' : 'pill';
        };
        return chip;
      })));
    f.append(
      h('label', { class: 'f' }, h('span', 'Mijoz'), company),
      h('label', { class: 'f' }, h('span', 'Loyiha nomi'), h('input', { class: 'in', name: 'name', required: true })),
      h('label', { class: 'f' }, h('span', 'Jamoa'), members),
      // The one field that cannot be skipped: without it the scope warning
      // never fires and the feature that pays for this product is decorative.
      h('label', { class: 'f' },
        h('span', 'Kelishilgan qayta ishlashlar ', h('span', { class: 'hint' }, '— shartnomadagi raqam')),
        h('input', { class: 'in mono', name: 'revisions_included', type: 'number', min: '0', value: '2', required: true })),
      h('div', { class: 'grid g2' },
        h('label', { class: 'f' }, h('span', 'Boshlanish'), h('input', { class: 'in', name: 'starts_on', type: 'date' })),
        h('label', { class: 'f' }, h('span', 'Rejadagi tugash'), h('input', { class: 'in', name: 'due_date', type: 'date' }))),
      h('label', { class: 'f' }, h('span', 'Mijozga aytiladigan sana ', h('span', { class: 'hint' }, '— zaxira bilan')),
        h('input', { class: 'in', name: 'client_due_date', type: 'date' })),
      h('div', { class: 'row', style: { justifyContent: 'flex-end' } },
        h('button', { class: 'btn', type: 'button', onclick: close }, t('cancel')),
        h('button', { class: 'btn pri', type: 'button', onclick: save }, 'Yaratish')));

    async function save() {
      const b = Object.fromEntries(new FormData(f));
      try {
        const p = await POST('/api/projects', {
          company_id: Number(company.value), name: b.name,
          revisions_included: Number(b.revisions_included),
          starts_on: b.starts_on || null, due_date: b.due_date || null,
          client_due_date: b.client_due_date || null,
        });
        for (const uid of chosen)
          await POST(`/api/projects/${p.id}/members`, { user_id: uid, craft: 'designer' });
        close(); toast('Loyiha yaratildi'); openProject(p.id);
      } catch (err) { toast(err.message, 'bad'); }
    }
    return f;
  });
}

async function openProject(id) {
  drawer(async (box, close) => {
    box.append(h('div', { class: 'drawer-head' }, h('div', { class: 'spin' })));
    const d = await GET(`/api/projects/${id}`);
    const p = d.project;
    const reload = () => { close(); openProject(id); };
    clear(box);
    box.append(h('div', { class: 'drawer-head' },
      h('div', { class: 'row' },
        h('div', {}, h('h1', { style: { fontSize: '18px', fontWeight: 650 } }, p.name),
          h('div', { class: 'tiny dim' }, p.company_name)),
        h('button', { class: 'btn sm ghost sp', onclick: close }, '✕')),
      h('div', { style: { marginTop: '10px' } },
        stagePipeline(p.stage, State.me.role === 'owner' ? async st => {
          await PATCH(`/api/projects/${id}`, { stage: st }); toast('Bosqich yangilandi'); reload();
        } : null))));

    const body = h('div', { class: 'drawer-body' });
    box.append(body);

    // Two progress numbers side by side: what is true, and what the client is
    // being told. If those diverge, the owner should see it here first.
    if (State.me.role !== 'accountant')
      body.append(h('div', { class: 'card' }, h('div', { class: 'grid g2' },
        progressBlock('Ichki holat', d.progress.internal),
        progressBlock('Mijoz koʻradigan', d.progress.client, true))));

    if (d.suggested_stage && State.me.role === 'owner') {
      body.append(h('div', { class: 'card', style: { borderColor: 'var(--accent)' } },
        h('div', { class: 'row' },
          h('div', {}, h('b', `Bosqichni "${STAGE_LABEL[d.suggested_stage]}" ga oʻtkazamizmi?`),
            h('div', { class: 'tiny dim' }, 'Bu bosqichdagi barcha ishlar tugadi.')),
          h('button', {
            class: 'btn pri sp', onclick: async () => {
              await PATCH(`/api/projects/${id}`, { stage: d.suggested_stage });
              toast('Bosqich yangilandi'); reload();
            },
          }, 'Ha'))));
    }

    for (const s of d.scope.filter(x => x.resolution === 'pending'))
      body.append(scopeAlertCard({ ...s, company: p.company_name, project: p.name,
        task: (d.tasks.find(t2 => t2.id === s.task_id) || {}).title }));

    // Deliverables grid — versions and the revision meter, per §3.
    const deliverables = d.tasks.filter(t2 => t2.is_deliverable && t2.visibility === 'client_visible');
    if (deliverables.length) {
      body.append(h('div', { class: 'card' }, h('h2', `Topshiriladigan ishlar · ${deliverables.length}`),
        h('div', { class: 'grid g2' }, ...deliverables.map(tk => deliverableCard(tk, p)))));
    }

    const byStatus = {};
    for (const tk of d.tasks) (byStatus[tk.status] ||= []).push(tk);
    const tasksCard = h('div', { class: 'card' },
      h('div', { class: 'row' }, h('h2', { style: { marginBottom: 0 } }, `Ishlar · ${d.tasks.length}`),
        h('button', { class: 'btn sm sp', onclick: () => quickAddTask(reload, id) }, '+ Ish')));
    for (const st of STATUS_ORDER) {
      const group = byStatus[st];
      if (!group?.length) continue;
      tasksCard.append(h('div', { class: 'sec-t', style: { marginTop: '14px' } }, `${STATUS_LABEL[st]} · ${group.length}`));
      tasksCard.append(h('div', { class: 'list' }, ...group.map(tk => taskListRow(tk))));
    }
    body.append(tasksCard);

    // Team table for this project, with each person's open-task count.
    body.append(h('div', { class: 'card' },
      h('div', { class: 'row' }, h('h2', { style: { marginBottom: 0 } }, 'Jamoa'),
        State.me.role === 'owner'
          ? h('button', { class: 'btn sm ghost sp', onclick: () => addMember(id, reload) }, '+ Qoʻshish') : null),
      h('div', { class: 'list', style: { marginTop: '8px' } }, ...d.members.map(m => {
        const openCount = d.tasks.filter(x => x.assignee_id === m.user_id
          && !['approved', 'completed'].includes(x.status)).length;
        return h('div', { class: 'item', style: { cursor: 'default' } },
          avatar(m.name, m.user_id),
          h('div', {}, h('div', { class: 't' }, m.name), h('div', { class: 's' }, m.craft)),
          h('div', { class: 'r' }, h('span', { class: 'pill' }, `${openCount} ochiq`)));
      }))));

    if (d.activity.length) {
      body.append(h('div', { class: 'card' }, h('h2', t('recent')),
        h('div', { class: 'tl' }, ...d.activity.slice(0, 15).map(a =>
          h('div', { class: `tl-i ${a.verb === 'approved' ? 'ok' : a.verb === 'requested changes' ? 'warn' : ''}` },
            h('div', {}, h('b', a.actor_name || '—'), ' ', a.verb, ' ', h('span', { class: 'dim' }, a.detail || '')),
            h('div', { class: 'tiny dim' }, fmtWhen(a.created_at)))))));
    }
  });
}

function taskListRow(tk) {
  const due = dueLabel(tk.due_date);
  return h('div', { class: 'item', onclick: () => openTask(tk.id) },
    h('div', {},
      h('div', { class: 't' }, tk.title, tk.requires_file ? h('span', { class: 'dim' }, ' 📎') : null),
      h('div', { class: 's row', style: { gap: '8px' } }, visBadge(tk.visibility),
        tk.assignee_name ? h('span', tk.assignee_name) : null)),
    h('div', { class: 'r' },
      tk.missed ? h('span', { class: 'pill warn' }, 'Bajarilmadi') : null,
      tk.revision_round > 0 ? h('span', { class: 'pill acc' }, 'R' + tk.revision_round) : null,
      due.text ? h('span', { class: `pill ${due.cls}` }, due.text) : null));
}

function deliverableCard(tk, project) {
  const over = tk.revision_round > project.revisions_included;
  return h('div', { class: 'card', style: { cursor: 'pointer', margin: 0 }, onclick: () => openTask(tk.id) },
    h('div', { class: 'row' }, h('b', tk.title),
      h('span', { class: `pill sp ${tk.status === 'awaiting_client' ? 'info' : tk.status === 'approved' ? 'ok' : ''}` },
        STATUS_LABEL[tk.status])),
    h('div', { class: 'row tiny dim', style: { marginTop: '7px' } },
      h('span', tk.latest_version ? `v${tk.latest_version}` : 'versiya yoʻq'),
      h('span', { class: 'sp' }, tk.assignee_name || '')),
    // The revision meter: used against included, flagged when over.
    h('div', { style: { marginTop: '9px' } },
      h('div', { class: 'row tiny' },
        h('span', { class: over ? 'pill warn' : 'dim' },
          `${tk.revision_round} / ${project.revisions_included} qayta ishlash`)),
      h('div', { class: `bar ${over ? '' : 'acc'}`, style: { marginTop: '4px' } },
        h('i', { style: { width: Math.min(100, (tk.revision_round / Math.max(1, project.revisions_included)) * 100) + '%',
                          background: over ? 'var(--warn)' : null } }))));
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

function addMember(projectId, done) {
  modal('Jamoaga qoʻshish', close => {
    const sel = h('select', { class: 'in' });
    GET('/api/team').then(team => sel.append(...team.filter(u => ['teammate', 'editor'].includes(u.role))
      .map(u => h('option', { value: u.id, 'data-craft': u.craft || 'designer' }, `${u.name} · ${u.craft}`))));
    return h('div', {},
      h('label', { class: 'f' }, h('span', 'Kim'), sel),
      h('div', { class: 'row', style: { justifyContent: 'flex-end' } },
        h('button', { class: 'btn', onclick: close }, t('cancel')),
        h('button', {
          class: 'btn pri', onclick: async () => {
            await POST(`/api/projects/${projectId}/members`,
              { user_id: Number(sel.value), craft: sel.selectedOptions[0].dataset.craft });
            close(); toast('Qoʻshildi'); done && done();
          },
        }, 'Qoʻshish')));
  });
}

// ---------------------------------------------------------------------------
// My tasks (§4)
// ---------------------------------------------------------------------------
async function viewMyTasks(el) {
  loading(el);
  const showAll = State.data.myTasksAll || false;
  const list = await GET('/api/my-tasks' + (showAll ? '?all=1' : ''));
  clear(el);
  el.append(pageHead(t('nav_mytasks'), `${list.length} ta ish`,
    h('div', { class: 'seg' },
      h('button', { class: showAll ? '' : 'on', onclick: () => { State.data.myTasksAll = false; viewMyTasks(el); } }, 'Ochiq'),
      h('button', { class: showAll ? 'on' : '', onclick: () => { State.data.myTasksAll = true; viewMyTasks(el); } }, 'Hammasi')),
    h('button', { class: 'btn pri', onclick: () => quickAddTask(() => viewMyTasks(el)) }, '+ Ish')));

  if (!list.length) return el.append(h('div', { class: 'card' }, emptyBox('✓', 'Sizda ochiq ish yoʻq')));

  el.append(h('div', { class: 'card' }, h('div', { class: 'list' }, ...list.map(tk => {
    const due = dueLabel(tk.due_date);
    return h('div', { class: 'item', onclick: () => openTask(tk.id) },
      h('div', {},
        h('div', { class: 't' }, tk.title,
          tk.requires_file ? h('span', { class: tk.file_count ? 'dim' : 'pill warn', style: { marginLeft: '6px' } },
            tk.file_count ? '📎' : '📎 fayl kerak') : null),
        h('div', { class: 's' }, `${tk.company_name} · ${tk.project_name}`)),
      h('div', { class: 'r' },
        h('span', { class: 'pill' }, DIFFICULTY[tk.difficulty] || tk.difficulty),
        h('span', { class: `pill ${tk.status === 'approved' ? 'ok' : tk.status === 'awaiting_client' ? 'info' : ''}` },
          STATUS_LABEL[tk.status]),
        due.text ? h('span', { class: `pill ${due.cls}` }, due.text) : null));
  }))));
}

// ---------------------------------------------------------------------------
// Calendar / Timeline (§6)
// ---------------------------------------------------------------------------
// Bars are positioned as percentages of a shared window, so every row lines up
// against the same months no matter what dates it holds.
function timelineWindow(items) {
  const dates = [];
  for (const i of items) for (const k of ['starts_on', 'ends_on', 'due_date', 'client_due_date', 'phase_start', 'phase_end'])
    if (i[k]) dates.push(Date.parse(String(i[k]).slice(0, 10)));
  const now = Date.now();
  let min = dates.length ? Math.min(...dates) : now - 30 * 86400000;
  let max = dates.length ? Math.max(...dates) : now + 60 * 86400000;
  min = Math.min(min, now); max = Math.max(max, now);
  const pad = Math.max((max - min) * 0.05, 3 * 86400000);
  return { min: min - pad, max: max + pad };
}
const pctIn = (w, d) => d ? ((Date.parse(String(d).slice(0, 10)) - w.min) / (w.max - w.min)) * 100 : null;

function monthAxis(w) {
  const cells = [];
  const cur = new Date(w.min); cur.setDate(1);
  while (cur.getTime() < w.max) {
    cells.push(cur.toLocaleDateString('en-GB', { month: 'short' }));
    cur.setMonth(cur.getMonth() + 1);
  }
  return h('div', { class: 'tl-months' }, h('span'), h('div', { class: 'cells' }, ...cells.map(c => h('span', c))));
}

function nowMarker(w) {
  const p = pctIn(w, new Date().toISOString().slice(0, 10));
  return p === null || p < 0 || p > 100 ? null
    : h('div', { class: 'tl-mark', style: { left: p + '%', background: 'var(--info)' }, title: 'Bugun' });
}

async function viewCalendar(el) {
  loading(el);
  if (State.data.calProject) return singleProjectTimeline(el, State.data.calProject);
  const list = await GET('/api/calendar');
  clear(el);
  el.append(pageHead(t('nav_calendar'), `${list.length} ta faol loyiha`));
  if (!list.length) return el.append(h('div', { class: 'card' }, emptyBox('▦', 'Hali loyiha yoʻq')));

  const w = timelineWindow(list);
  const rows = list.map(p => {
    const from = pctIn(w, p.starts_on || p.phase_start);
    const to = pctIn(w, p.due_date || p.phase_end || p.client_due_date);
    const marker = pctIn(w, p.client_due_date || p.due_date);
    const track = h('div', { class: 'tl-track' });
    if (from !== null && to !== null && to > from)
      track.append(h('div', { class: 'tl-bar', style: { left: from + '%', width: Math.max(1.5, to - from) + '%' } }));
    if (marker !== null) track.append(h('div', { class: 'tl-mark', style: { left: marker + '%' },
      title: 'Topshirish sanasi' }));
    const nm = nowMarker(w); if (nm) track.append(nm);
    return h('div', { class: 'tl-row', style: { cursor: 'pointer' },
                      onclick: () => { State.data.calProject = p.id; viewCalendar(el); } },
      h('div', {},
        h('div', { style: { fontWeight: 550 } }, p.name),
        h('div', { class: 'tiny dim' }, `${p.company_name} · ${STAGE_LABEL[p.stage] || p.stage}`)),
      track);
  });
  el.append(h('div', { class: 'card' },
    h('div', { class: 'tl-grid' }, h('div', { class: 'tl-rows' }, monthAxis(w), ...rows))));

  el.append(h('div', { class: 'sec-t' }, 'Loyihalar'));
  el.append(h('div', { class: 'grid g3' }, ...list.map(projectCard)));
}

async function singleProjectTimeline(el, id) {
  const d = await GET(`/api/calendar/projects/${id}/gantt`);
  clear(el);
  const back = () => { State.data.calProject = null; viewCalendar(el); };
  const reload = () => singleProjectTimeline(el, id);
  const showPadding = State.data.ganttPadding || false;

  el.append(pageHead(d.project.name,
    `${d.project.company_name} · ${STAGE_LABEL[d.project.stage] || d.project.stage}`,
    h('div', { class: 'seg' },
      h('button', {
        class: State.data.ganttCompact ? '' : 'on',
        onclick: () => { State.data.ganttCompact = false; reload(); },
      }, 'Keng'),
      h('button', {
        class: State.data.ganttCompact ? 'on' : '',
        onclick: () => { State.data.ganttCompact = true; reload(); },
      }, 'Ixcham')),
    State.me.role === 'owner'
      ? h('button', {
          class: showPadding ? 'btn pri' : 'btn',
          title: 'Ichki sana bilan mijozga aytilgan sana orasidagi zaxirani koʻrsatish',
          onclick: () => { State.data.ganttPadding = !showPadding; reload(); },
        }, '⇥ Zaxira')
      : null,
    State.me.role === 'owner'
      ? h('button', { class: 'btn', onclick: () => editPhase(id, null, reload) }, '+ Bosqich') : null,
    h('button', { class: 'btn ghost', onclick: back }, '‹ Barchasi')));

  el.append(h('div', { class: 'card' }, renderGantt(d, {
    compact: State.data.ganttCompact,
    showPadding,
    onRow: r => openTask(r.id),
    processLabel: 'Jarayonlar',
    statusLabel: 'Holat',
    unphasedLabel: 'Bosqichsiz',
    emptyStageText: 'Hali jarayon qoʻshilmagan',
    footnote: 'Koʻrsatilgan muddatlar mijozning qaror qabul qilish vaqtini oʻz ichiga olmaydi.',
  })));

  // Stages are edited here rather than on the chart itself: dragging a stage
  // and dragging a task would be the same gesture meaning two different things.
  if (State.me.role === 'owner' && d.phases.length) {
    el.append(h('div', { class: 'card' }, h('h2', 'Bosqichlar'),
      h('div', { class: 'list' }, ...d.phases.map(ph => h('div', {
        class: 'item', onclick: () => editPhase(id, ph, reload),
      },
        h('div', {}, h('div', { class: 't' }, ph.name),
          h('div', { class: 's' }, [ph.starts_on && fmtDate(ph.starts_on), ph.ends_on && fmtDate(ph.ends_on)]
            .filter(Boolean).join(' → ') || 'sanasiz')),
        h('div', { class: 'r' },
          h('span', { class: 'pill' }, `${d.rows.filter(r => r.phase_id === ph.id).length} jarayon`),
          h('span', { class: 'dim' }, '✎')))))));
  }

  if (!d.rows.length) el.append(h('div', { class: 'card' },
    emptyBox('▦', 'Bu loyihada hali sanasi belgilangan ish yoʻq')));
}

function editPhase(projectId, phase, done) {
  modal(phase ? 'Bosqichni tahrirlash' : 'Yangi bosqich', close => {
    const name = h('input', { class: 'in', value: phase?.name || '', placeholder: 'Masalan: Ishlab chiqarish' });
    const from = h('input', { class: 'in', type: 'date', value: (phase?.starts_on || '').slice(0, 10) });
    const to = h('input', { class: 'in', type: 'date', value: (phase?.ends_on || '').slice(0, 10) });
    return h('div', {},
      h('label', { class: 'f' }, h('span', 'Nomi'), name),
      h('div', { class: 'grid g2' },
        h('label', { class: 'f' }, h('span', 'Boshlanish'), from),
        h('label', { class: 'f' }, h('span', 'Tugash'), to)),
      h('div', { class: 'row', style: { justifyContent: 'flex-end', gap: '8px' } },
        phase ? h('button', {
          class: 'btn danger', onclick: () => confirmDialog('Bosqichni oʻchirish', `"${phase.name}" oʻchirilsinmi?`,
            async () => { await DEL(`/api/calendar/phases/${phase.id}`); close(); toast('Oʻchirildi'); done(); },
            { danger: true, yes: 'Oʻchirish' }),
        }, 'Oʻchirish') : null,
        h('button', { class: 'btn', onclick: close }, t('cancel')),
        h('button', {
          class: 'btn pri', onclick: async () => {
            if (!name.value.trim()) return toast('Nomini yozing', 'bad');
            const body = { name: name.value.trim(), starts_on: from.value || null, ends_on: to.value || null };
            try {
              phase ? await PATCH(`/api/calendar/phases/${phase.id}`, body)
                    : await POST(`/api/calendar/projects/${projectId}/phases`, body);
              close(); toast('Saqlandi'); done();
            } catch (e) { toast(e.message, 'bad'); }
          },
        }, t('save'))));
  });
}

// ---------------------------------------------------------------------------
// Team performance (§5) — one dataset, two framings
// ---------------------------------------------------------------------------
async function viewPerformance(el) {
  // The owner gets management reporting; everyone else gets the leaderboard.
  // Showing the owner a scoreboard would turn a judgement into a ranking.
  return State.me.role === 'owner' ? ownerStats(el) : leaderboard(el);
}

async function leaderboard(el) {
  loading(el);
  const scope = State.data.perfScope || 'month';
  const d = await GET('/api/performance/leaderboard?scope=' + scope);
  clear(el);
  el.append(pageHead('Reyting', scope === 'month' ? 'Shu oy · har oy yangilanadi' : 'Butun davr',
    h('div', { class: 'seg' },
      h('button', { class: scope === 'month' ? 'on' : '', onclick: () => { State.data.perfScope = 'month'; leaderboard(el); } }, 'Shu oy'),
      h('button', { class: scope === 'all' ? 'on' : '', onclick: () => { State.data.perfScope = 'all'; leaderboard(el); } }, 'Butun davr'))));

  if (d.month_empty) el.append(h('div', { class: 'card' },
    h('div', { class: 'tiny dim' },
      'Bu oy hali yakunlangan ish yoʻq — ballar har oy boshida noldan boshlanadi. ' +
      'Oldingi natijalarni koʻrish uchun "Butun davr" ni tanlang.')));
  if (d.me) {
    el.append(h('div', { class: 'card', style: { borderColor: 'var(--accent)' } },
      h('div', { class: 'row' },
        avatar(d.me.name, d.me.avatar_color || d.me.user_id, 42),
        h('div', { style: { marginLeft: '4px' } },
          h('div', { class: 'row', style: { gap: '8px' } }, h('b', d.me.name), badgeChip(d.me.badge)),
          h('div', { class: 'tiny dim' },
            `${d.me.completed} ta yakunlandi · ${d.me.on_time_pct === null ? '—' : d.me.on_time_pct + '% oʻz vaqtida'}`)),
        h('div', { class: 'sp', style: { textAlign: 'right' } },
          h('div', { class: 'lb-pts' }, d.me.points),
          h('div', { class: 'tiny dim' }, `${d.me.rank}-oʻrin`))),
      d.me.next_badge
        ? h('div', { class: 'tiny dim', style: { marginTop: '10px' } },
            `Keyingi nishon — ${(BADGE_LOOK[d.me.next_badge.key] || {}).label}: yana ${d.me.next_badge.points_needed} ball`)
        : h('div', { class: 'tiny dim', style: { marginTop: '10px' } }, 'Eng yuqori nishondasiz 🏆')));
  }

  if (d.top) el.append(h('div', { class: 'card' },
    h('div', { class: 'row' }, h('span', { style: { fontSize: '22px' } }, '🏆'),
      h('div', {}, h('b', d.top.name), h('div', { class: 'tiny dim' }, 'Shu davrning eng yaxshisi')),
      h('div', { class: 'lb-pts sp' }, d.top.points))));

  el.append(h('div', { class: 'card' }, h('h2', 'Reyting'),
    ...d.leaderboard.map(p => h('div', { class: `lb-row ${p.user_id === State.me.id ? 'me' : ''}` },
      h('span', { class: 'lb-rank' }, p.rank),
      avatar(p.name, p.avatar_color || p.user_id, 30),
      h('div', {}, h('div', { class: 'row', style: { gap: '7px' } }, h('b', p.name), badgeChip(p.badge)),
        h('div', { class: 'tiny dim' },
          `${p.completed} yakunlandi · ${p.on_time_pct === null ? '—' : p.on_time_pct + '% oʻz vaqtida'}`)),
      h('div', { class: 'sp lb-pts' }, p.points)))));

  el.append(h('div', { class: 'card' }, h('h2', 'Nishonlar'),
    h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
      ...Object.keys(BADGE_LOOK).map(k => h('div', { class: 'row', style: { gap: '6px' } },
        badgeChip(k), h('span', { class: 'tiny dim' }, badgeHint(k)))))));
}

async function ownerStats(el) {
  loading(el);
  const scope = State.data.perfScope || 'month';
  const d = await GET('/api/performance/stats?scope=' + scope);
  clear(el);
  el.append(pageHead('Jamoa koʻrsatkichlari', scope === 'month' ? 'Shu oy' : 'Butun davr',
    h('div', { class: 'seg' },
      h('button', { class: scope === 'month' ? 'on' : '', onclick: () => { State.data.perfScope = 'month'; ownerStats(el); } }, 'Shu oy'),
      h('button', { class: scope === 'all' ? 'on' : '', onclick: () => { State.data.perfScope = 'all'; ownerStats(el); } }, 'Butun davr'))));

  const cols = [
    ['name', 'Xodim', false], ['completed', 'Yakunlandi', true], ['early', 'Muddatdan oldin', true],
    ['late', 'Kechikib', true], ['missed', 'Bajarilmadi', true], ['on_time_pct', 'Oʻz vaqtida %', true],
  ];
  let sortKey = State.data.statSort || 'completed', desc = State.data.statDesc !== false;
  const rows = [...d.rows].sort((a, b) => {
    const av = a[sortKey] ?? -1, bv = b[sortKey] ?? -1;
    const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
    return desc ? -cmp : cmp;
  });

  const table = h('table', { class: 'tbl' },
    h('thead', h('tr', ...cols.map(([k, label, num]) => h('th', {
      class: num ? 'num' : '',
      onclick: () => {
        State.data.statDesc = State.data.statSort === k ? !desc : true;
        State.data.statSort = k; ownerStats(el);
      },
    }, label, sortKey === k ? (desc ? ' ↓' : ' ↑') : '')))),
    h('tbody', ...rows.map(p => h('tr',
      h('td', h('div', { class: 'row', style: { gap: '9px' } }, avatar(p.name, p.avatar_color || p.user_id, 24),
        h('div', {}, h('div', { style: { fontWeight: 550 } }, p.name), h('div', { class: 'tiny dim' }, p.craft || '')))),
      h('td', { class: 'num' }, p.completed),
      h('td', { class: 'num' }, p.early),
      h('td', { class: 'num', style: p.late ? { color: 'var(--warn)' } : {} }, p.late),
      h('td', { class: 'num', style: p.missed ? { color: 'var(--warn)' } : {} }, p.missed),
      h('td', { class: 'num' }, p.on_time_pct === null ? '—' : p.on_time_pct + '%')))));

  if (d.month_empty) el.append(h('div', { class: 'card' },
    h('div', { class: 'tiny dim' },
      'Bu oy hali yakunlangan ish yoʻq — ballar har oy boshida noldan boshlanadi. ' +
      'Oldingi natijalarni koʻrish uchun "Butun davr" ni tanlang.')));
  el.append(h('div', { class: 'card' }, table));
  el.append(h('div', { class: 'card' }, h('div', { class: 'tiny dim' },
    'Jamoa aʼzolari buni ball va nishonli reyting sifatida koʻradi. Bu yerda oʻsha maʼlumot ' +
    'boshqaruv uchun oddiy jadval koʻrinishida — ustun boʻyicha saralab, kim doim oldinda va ' +
    'kim ortda qolayotganini koʻrish uchun.')));
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
        h('span', { class: 'pill' }, DIFFICULTY[tk.difficulty] || tk.difficulty),
        tk.missed ? h('span', { class: 'pill warn' }, 'Bajarilmadi') : null,
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
    if (tk.requires_file) {
      const n = d.files.length;
      actions.append(h('div', { class: `tiny ${n ? 'dim' : ''}`, style: { marginTop: '10px' },
                                ...(n ? {} : { style: { marginTop: '10px', color: 'var(--warn)' } }) },
        n ? '📎 Fayl biriktirilgan — yopish mumkin' : '📎 Bu ishni yopish uchun fayl biriktirilishi kerak'));
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
      // Writing work off costs the assignee points, so it is deliberate and
      // the owner's alone.
      actions.append(h('button', {
        class: 'btn wide', style: { marginTop: '8px' },
        onclick: () => confirmDialog(
          tk.missed ? 'Belgini olib tashlash' : 'Bajarilmadi deb belgilash',
          tk.missed ? 'Ish yana odatdagidek hisoblanadi.'
                    : 'Bu ish bajarilmagan deb yoziladi va bajaruvchining ballidan ayiriladi.',
          async () => {
            await POST(`/api/performance/tasks/${id}/missed`, { missed: !tk.missed });
            toast('Yangilandi'); reload();
          }, { danger: !tk.missed, yes: tk.missed ? 'Olib tashlash' : 'Belgilash' }),
      }, tk.missed ? 'Belgini olib tashlash' : '✕ Bajarilmadi deb belgilash'));
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
// Clients (§7)
// ---------------------------------------------------------------------------
async function viewClients(el) {
  loading(el);
  const cs = await GET('/api/companies');
  const active = cs.filter(c => c.status === 'active');
  const past = cs.filter(c => c.status !== 'active');
  clear(el);
  el.append(pageHead(t('nav_clients'), `${active.length} faol · ${past.length} sobiq`,
    h('button', { class: 'btn pri', onclick: () => newCompany(() => viewClients(el)) }, '+ Mijoz')));

  const table = list => h('table', { class: 'tbl' },
    h('thead', h('tr', h('th', 'Mijoz'), h('th', 'Soha'), h('th', 'Asosiy kontakt'),
      h('th', 'Telefon'), h('th', { class: 'num' }, 'Loyiha'), h('th', { class: 'num' }, 'Kontakt'))),
    h('tbody', ...list.map(c => h('tr', { style: { cursor: 'pointer' }, onclick: () => openCompany(c.id) },
      h('td', h('div', { style: { fontWeight: 550 } }, c.name),
        c.since_date ? h('div', { class: 'tiny dim' }, fmtDate(c.since_date) + ' dan beri') : null),
      h('td', { class: 'tiny' }, c.industry || '—'),
      h('td', c.main_contact
        ? h('div', {}, h('div', c.main_contact.name),
            h('div', { class: 'tiny dim' }, c.main_contact.position || ''))
        : h('span', { class: 'dim' }, '—')),
      h('td', { class: 'tiny mono' }, c.main_contact?.phone || c.contact_phone || '—'),
      h('td', { class: 'num' }, c.active_projects),
      h('td', { class: 'num' }, c.contact_count)))));

  if (active.length) el.append(h('div', { class: 'card' }, h('h2', 'Faol'), table(active)));
  if (past.length) el.append(h('div', { class: 'card' }, h('h2', 'Sobiq'), table(past)));
  if (!cs.length) el.append(h('div', { class: 'card' }, emptyBox('◍', 'Hali mijoz yoʻq')));
}

async function openCompany(id) {
  drawer(async (box, close) => {
    box.append(h('div', { class: 'drawer-head' }, h('div', { class: 'spin' })));
    const d = await GET(`/api/companies/${id}`);
    const c = d.company;
    const reload = () => { close(); openCompany(id); };
    clear(box);
    box.append(h('div', { class: 'drawer-head' }, h('div', { class: 'row' },
      h('div', {}, h('h1', { style: { fontSize: '18px', fontWeight: 650 } }, c.name),
        h('div', { class: 'tiny dim' }, [c.industry, c.since_date && fmtDate(c.since_date) + ' dan beri']
          .filter(Boolean).join(' · '))),
      h('span', { class: `pill sp ${c.status === 'active' ? 'ok' : ''}` }, c.status === 'active' ? 'Faol' : 'Sobiq'),
      h('button', { class: 'btn sm ghost', onclick: close }, '✕'))));
    const body = h('div', { class: 'drawer-body' });
    box.append(body);

    // Contacts — a client is an organisation, not one person.
    const contacts = h('div', { class: 'card' },
      h('div', { class: 'row' }, h('h2', { style: { marginBottom: 0 } }, `Kontaktlar · ${d.contacts.length}`),
        h('button', { class: 'btn sm sp', onclick: () => editContact(id, null, reload) }, '+ Kontakt')));
    contacts.append(d.contacts.length
      ? h('div', { class: 'list', style: { marginTop: '8px' } }, ...d.contacts.map(ct =>
          h('div', { class: 'item', onclick: () => editContact(id, ct, reload) },
            avatar(ct.name, ct.id),
            h('div', {}, h('div', { class: 't' }, ct.name, ct.is_main ? h('span', { class: 'pill acc', style: { marginLeft: '6px' } }, 'asosiy') : null),
              h('div', { class: 's' }, [ct.position, ct.email, ct.phone].filter(Boolean).join(' · ')))))
        )
      : h('div', { class: 'dim tiny', style: { marginTop: '8px' } }, 'Kontakt qoʻshilmagan'));
    body.append(contacts);

    // Logins, and the join link that creates them.
    const logins = h('div', { class: 'card' },
      h('div', { class: 'row' }, h('h2', { style: { marginBottom: 0 } }, 'Platformaga kirish'),
        State.me.role === 'owner'
          ? h('button', { class: 'btn sm pri sp', onclick: () => makeInvite(id, c.name) }, '🔗 Havola yaratish') : null));
    logins.append(d.logins.length
      ? h('div', { class: 'list', style: { marginTop: '8px' } }, ...d.logins.map(u =>
          h('div', { class: 'item', style: { cursor: 'default' } },
            h('div', {}, h('div', { class: 't' }, u.name), h('div', { class: 's mono' }, u.phone)),
            h('div', { class: 'r' },
              u.telegram ? h('span', { class: 'pill ok' }, 'Telegram') : null,
              u.active ? null : h('span', { class: 'pill warn' }, 'Faol emas')))))
      : h('div', { class: 'dim tiny', style: { marginTop: '8px' } },
          'Bu mijozda hali kirish huquqi yoʻq. Havola yarating — oʻzi PIN belgilaydi.'));
    body.append(logins);

    if (d.projects.length) body.append(h('div', { class: 'card' }, h('h2', 'Loyihalar'),
      h('div', { class: 'list' }, ...d.projects.map(p => h('div', { class: 'item', onclick: () => { close(); openProject(p.id); } },
        h('div', {}, h('div', { class: 't' }, p.name),
          h('div', { class: 's' }, STAGE_LABEL[p.stage] || p.stage)),
        h('div', { class: 'r' }, h('span', { class: 'pill' }, p.pct + '%')))))));

    // Internal notes are on the client's own record and must never be part of
    // anything the portal reads. Labelled loudly so nobody forgets that.
    const notes = h('textarea', { class: 'in', style: { minHeight: '90px' } });
    notes.value = c.internal_notes || '';
    body.append(h('div', { class: 'card', style: { borderColor: 'var(--accent)' } },
      h('h2', { style: { color: 'var(--accent)' } }, '🔒 Ichki eslatmalar — mijoz hech qachon koʻrmaydi'),
      notes,
      h('button', {
        class: 'btn sm pri', style: { marginTop: '8px' },
        onclick: async () => { await PATCH(`/api/companies/${id}`, { internal_notes: notes.value }); toast('Saqlandi'); },
      }, t('save'))));

    if (['owner', 'accountant'].includes(State.me.role)) {
      const st = await GET(`/api/finance/companies/${id}/statement`);
      const billed = st.filter(x => x.direction === 'in').reduce((s2, x) => s2 + Number(x.amount), 0);
      const paid = st.filter(x => x.direction === 'in' && x.settled).reduce((s2, x) => s2 + Number(x.amount), 0);
      body.append(h('div', { class: 'card' }, h('h2', 'Hisob'),
        h('div', { class: 'grid g3' },
          h('div', {}, h('div', { class: 'tiny dim' }, 'Hisob qilingan'), h('div', { class: 'num' }, short(billed))),
          h('div', {}, h('div', { class: 'tiny dim' }, 'Toʻlangan'), h('div', { class: 'num' }, short(paid))),
          h('div', {}, h('div', { class: 'tiny dim' }, 'Qoldiq'),
            h('div', { class: 'num', style: { color: billed - paid > 0 ? 'var(--warn)' : 'inherit' } }, short(billed - paid))))));
    }

    if (State.me.role === 'owner') body.append(h('button', {
      class: 'btn wide', style: { marginTop: '10px' },
      onclick: async () => {
        await PATCH(`/api/companies/${id}`, { status: c.status === 'active' ? 'past' : 'active' });
        toast('Yangilandi'); close(); renderShell();
      },
    }, c.status === 'active' ? 'Sobiq mijozlarga oʻtkazish' : 'Faolga qaytarish'));
  });
}

function editContact(companyId, contact, done) {
  modal(contact ? 'Kontaktni tahrirlash' : 'Yangi kontakt', close => {
    const f = h('form');
    const isMain = h('input', { type: 'checkbox', checked: contact?.is_main || false });
    const fields = {};
    for (const [k, label] of [['name', 'Ism'], ['position', 'Lavozim'], ['email', 'Email'], ['phone', 'Telefon']]) {
      fields[k] = h('input', { class: 'in', value: contact?.[k] || '' });
      f.append(h('label', { class: 'f' }, h('span', label), fields[k]));
    }
    f.append(
      h('label', { class: 'toggle', style: { cursor: 'pointer' } },
        h('span', { class: 'lbl' }, h('b', 'Asosiy kontakt')),
        h('span', { class: 'sw' }, isMain, h('i'))),
      h('div', { class: 'row', style: { justifyContent: 'flex-end', gap: '8px', marginTop: '12px' } },
        contact ? h('button', {
          class: 'btn danger', type: 'button',
          onclick: async () => { await DEL(`/api/contacts/${contact.id}`); close(); toast('Oʻchirildi'); done(); },
        }, 'Oʻchirish') : null,
        h('button', { class: 'btn', type: 'button', onclick: close }, t('cancel')),
        h('button', { class: 'btn pri', type: 'button', onclick: save }, t('save'))));

    async function save() {
      const body = { name: fields.name.value, position: fields.position.value,
                     email: fields.email.value, phone: fields.phone.value, is_main: isMain.checked };
      if (!body.name) return toast('Ismni yozing', 'bad');
      try {
        contact ? await PATCH(`/api/contacts/${contact.id}`, body)
                : await POST(`/api/companies/${companyId}/contacts`, body);
        close(); toast('Saqlandi'); done();
      } catch (e) { toast(e.message, 'bad'); }
    }
    return f;
  });
}

// Adding a client mints a link; the invitee sets their own PIN, so the agency
// never knows or transmits it.
function makeInvite(companyId, companyName) {
  modal('Kirish havolasi', close => {
    const box = h('div', {}, h('div', { class: 'spin' }));
    POST('/api/invites', { role: 'client', company_id: companyId }).then(inv => {
      const url = inv.url || (location.origin + '/join/' + inv.token);
      clear(box).append(
        h('p', { class: 'muted' }, `${companyName} uchun havola. Yuboring — ular ismini va oʻz PIN kodini oʻzlari kiritadi.`),
        h('div', { class: 'card mono', style: { wordBreak: 'break-all', fontSize: '12.5px', margin: '12px 0' } }, url),
        h('div', { class: 'row', style: { gap: '8px' } },
          h('button', {
            class: 'btn pri', onclick: () => { navigator.clipboard?.writeText(url); toast('Nusxalandi'); },
          }, 'Nusxalash'),
          h('a', { class: 'btn', href: `https://t.me/share/url?url=${encodeURIComponent(url)}`, target: '_blank' },
            'Telegramda yuborish')),
        h('div', { class: 'tiny dim', style: { marginTop: '10px' } }, `${inv.expires_in_days} kun amal qiladi. Bir marta ishlatiladi.`));
    }).catch(e => clear(box).append(h('div', { class: 'err' }, e.message)));
    return box;
  });
}

function newCompany(done) {
  modal('Yangi mijoz', close => {
    const f = h('form');
    f.append(
      h('label', { class: 'f' }, h('span', 'Kompaniya'), h('input', { class: 'in', name: 'name', required: true })),
      h('div', { class: 'grid g2' },
        h('label', { class: 'f' }, h('span', 'Soha'), h('input', { class: 'in', name: 'industry', placeholder: 'Masalan: Bank' })),
        h('label', { class: 'f' }, h('span', 'Hamkorlik boshlangan'), h('input', { class: 'in', name: 'since_date', type: 'date', value: today() }))),
      h('div', { class: 'sec-t' }, 'Asosiy kontakt'),
      h('div', { class: 'grid g2' },
        h('label', { class: 'f' }, h('span', 'Ism'), h('input', { class: 'in', name: 'contact_name' })),
        h('label', { class: 'f' }, h('span', 'Lavozim'), h('input', { class: 'in', name: 'contact_position' }))),
      h('div', { class: 'grid g2' },
        h('label', { class: 'f' }, h('span', 'Telefon'), h('input', { class: 'in', name: 'contact_phone', type: 'tel' })),
        h('label', { class: 'f' }, h('span', 'Email'), h('input', { class: 'in', name: 'contact_email', type: 'email' }))),
      h('label', { class: 'f' }, h('span', 'Telegram'), h('input', { class: 'in', name: 'telegram_username', placeholder: 'username' })),
      h('label', { class: 'f' }, h('span', 'Ichki eslatma ', h('span', { class: 'hint' }, '— mijoz koʻrmaydi')),
        h('textarea', { class: 'in', name: 'internal_notes' })),
      h('div', { class: 'row', style: { justifyContent: 'flex-end' } },
        h('button', { class: 'btn', type: 'button', onclick: close }, t('cancel')),
        h('button', {
          class: 'btn pri', type: 'button', onclick: async () => {
            const b = Object.fromEntries(new FormData(f));
            if (!b.name) return toast('Nomini yozing', 'bad');
            try {
              const co = await POST('/api/companies', b);
              close(); toast('Qoʻshildi');
              if (State.me.role === 'owner') makeInvite(co.id, co.name);
              done && done();
            } catch (err) { toast(err.message, 'bad'); }
          },
        }, 'Qoʻshish')));
    return f;
  });
}

// ---------------------------------------------------------------------------
// Team (§8) — owner only
// ---------------------------------------------------------------------------
const WORK_MODE = { office: 'Ofis', remote: 'Masofadan', hybrid: 'Aralash' };
const LEVELS = [
  ['owner', 'Akkaunt menejer', 'Hamma narsa — moliya, ruxsatlar, koʻrinish sozlamalari'],
  ['accountant', 'Buxgalter', 'Faqat moliya va mijoz yozuvlari. Ishlarni koʻrmaydi'],
  ['editor', 'Muharrir', 'Oʻz loyihalarida ish yaratadi va biriktiradi. Moliya yoʻq'],
  ['teammate', 'Aʼzo', 'Biriktirilgan loyihalarni koʻradi, oʻz ishini yangilaydi, fayl yuklaydi'],
];

async function viewTeam(el) {
  loading(el);
  const [team, companies] = [await GET('/api/team'), await GET('/api/companies')];
  clear(el);
  el.append(pageHead(t('nav_team'), `${team.length} kishi`,
    h('button', { class: 'btn', onclick: () => editPerson(null, companies, () => viewTeam(el)) }, '+ Xodim')));

  const teamRow = u => h('tr', {
    style: { cursor: u.role === 'owner' ? 'default' : 'pointer', opacity: u.active ? 1 : .5 },
    onclick: () => u.role !== 'owner' && editPerson(u, companies, () => viewTeam(el)),
  },
    h('td', h('div', { class: 'row', style: { gap: '9px' } },
      avatar(u.name, u.avatar_color || u.id, 28),
      h('div', {},
        h('div', { style: { fontWeight: 550 } }, u.name),
        u.active ? null : h('div', { class: 'tiny dim' }, 'Faol emas')))),
    h('td', { class: 'tiny' }, u.title || u.craft || '—'),
    h('td', { class: 'tiny dim' }, u.responsibility || '—'),
    h('td', { class: 'tiny' },
      h('div', { class: 'mono' }, u.phone || ''),
      h('div', { class: 'dim' }, u.email || '')),
    h('td', { class: 'tiny' }, WORK_MODE[u.work_mode] || u.work_mode || '—'),
    h('td', h('span', { class: 'pill' }, u.role_name)),
    h('td', { class: 'tiny' }, u.birthdate ? fmtDate(u.birthdate) : '—'));

  const head = h('thead', h('tr',
    h('th', 'Xodim'), h('th', 'Lavozim'), h('th', 'Masʼuliyat'),
    h('th', 'Aloqa'), h('th', 'Ish rejimi'), h('th', 'Daraja'), h('th', 'Tugʻilgan kun')));
  const table = h('table', { class: 'tbl' }, head, h('tbody', ...team.map(teamRow)));
  el.append(h('div', { class: 'card' }, table));

  const counts = {};
  for (const u of team) counts[u.role] = (counts[u.role] || 0) + 1;
  el.append(h('div', { class: 'card' }, h('h2', 'Ruxsat darajalari'),
    ...LEVELS.map(([key, name, desc]) => h('div', { class: 'toggle' },
      h('div', { class: 'lbl' }, h('b', name), h('span', desc)),
      h('span', { class: 'pill' }, `${counts[key] || 0} kishi`)))));

  el.append(h('div', { class: 'card' }, h('div', { class: 'tiny dim' },
    'Akkaunt menejer hisobi qoʻlda yaratiladi va bu yerdan taklif qilinmaydi.')));
}

function editPerson(user, companies, done) {
  modal(user ? user.name : 'Yangi xodim', close => {
    const f = h('form');
    const role = h('select', { class: 'in' }, ...LEVELS.filter(l => l[0] !== 'owner')
      .map(([k, n]) => h('option', { value: k, selected: user?.role === k }, n)));
    const company = h('select', { class: 'in' }, ...companies.map(c => h('option', { value: c.id }, c.name)));
    const companyWrap = h('label', { class: 'f', style: { display: 'none' } }, h('span', 'Qaysi mijoz'), company);
    const workMode = h('select', { class: 'in' }, ...Object.entries(WORK_MODE)
      .map(([k, n]) => h('option', { value: k, selected: (user?.work_mode || 'office') === k }, n)));
    const fields = {};
    const field = (k, label, opts = {}) => {
      fields[k] = h('input', { class: 'in', value: user?.[k] || '', ...opts });
      return h('label', { class: 'f' }, h('span', label), fields[k]);
    };
    role.onchange = () => { companyWrap.style.display = role.value === 'client' ? 'block' : 'none'; };

    f.append(
      field('name', 'Ism'),
      h('div', { class: 'grid g2' }, field('title', 'Lavozim'), field('craft', 'Yoʻnalish')),
      field('responsibility', 'Masʼuliyat', { placeholder: 'Nima uchun javob beradi' }),
      h('div', { class: 'grid g2' },
        field('phone', 'Telefon', { type: 'tel', disabled: !!user }),
        field('email', 'Email', { type: 'email' })),
      h('div', { class: 'grid g2' },
        h('label', { class: 'f' }, h('span', 'Ish rejimi'), workMode),
        field('birthdate', 'Tugʻilgan kun', { type: 'date' })),
      h('label', { class: 'f' }, h('span', 'Ruxsat darajasi'), role),
      companyWrap,
      h('label', { class: 'f' }, h('span', user ? 'Yangi PIN ' : 'PIN ',
        h('span', { class: 'hint' }, user ? '— boʻsh qoldirsangiz oʻzgarmaydi' : '— 4 raqam')),
        (fields.pin = h('input', { class: 'in mono', inputmode: 'numeric', placeholder: '••••' }))),
      h('div', { class: 'row', style: { justifyContent: 'flex-end', gap: '8px', marginTop: '10px' } },
        user ? h('button', {
          class: 'btn', type: 'button',
          onclick: async () => {
            await PATCH(`/api/team/${user.id}`, { active: !user.active });
            close(); toast('Yangilandi'); done();
          },
        }, user.active ? 'Faolsizlantirish' : 'Faollashtirish') : null,
        h('button', { class: 'btn', type: 'button', onclick: close }, t('cancel')),
        h('button', { class: 'btn pri', type: 'button', onclick: save }, t('save'))));

    async function save() {
      const body = {
        name: fields.name.value, title: fields.title.value, craft: fields.craft.value,
        responsibility: fields.responsibility.value, email: fields.email.value,
        work_mode: workMode.value, birthdate: fields.birthdate.value || null,
      };
      if (fields.pin.value) body.pin = fields.pin.value;
      try {
        if (user) { await PATCH(`/api/team/${user.id}`, { ...body, role: role.value }); }
        else {
          if (!fields.phone.value) return toast('Telefon raqamini kiriting', 'bad');
          if (!fields.pin.value) return toast('PIN kiriting', 'bad');
          await POST('/api/team', { ...body, phone: fields.phone.value, pin: fields.pin.value,
            role: role.value, company_id: role.value === 'client' ? Number(company.value) : null });
        }
        close(); toast('Saqlandi'); done();
      } catch (e) { toast(e.message, 'bad'); }
    }
    return f;
  });
}

// ---------------------------------------------------------------------------
// Finance (§9) — one ledger, profit and cash shown as different numbers
// ---------------------------------------------------------------------------
const CATEGORY_LABEL = {
  project_fee: 'Loyiha toʻlovi', retainer: 'Doimiy shartnoma', licensing: 'Litsenziya', other_income: 'Boshqa daromad',
  payroll: 'Ish haqi', production: 'Ishlab chiqarish', outsourcing: 'Autsorsing', software: 'Dasturlar',
  rent: 'Ijara', transport: 'Transport', tax: 'Soliq', other_cost: 'Boshqa xarajat',
};
const TX_STATUS = { received: ['Qabul qilindi', 'ok'], paid: ['Toʻlandi', ''], not_settled: ['Kutilmoqda', 'acc'], overdue: ['Muddati oʻtdi', 'warn'] };

async function viewFinance(el) {
  loading(el);
  const [sum, accounts, txs, monthly, byCat] = [
    await GET('/api/finance/summary'), await GET('/api/finance/accounts'),
    await GET('/api/finance/transactions'), await GET('/api/finance/monthly'),
    await GET('/api/finance/by-category?months=1')];
  const cur = State.me.currency;
  const reload = () => viewFinance(el);
  clear(el);
  el.append(pageHead(t('nav_finance'), 'Shu oy',
    h('button', { class: 'btn ok', onclick: () => addTx('in', reload) }, '+ Kirim'),
    h('button', { class: 'btn danger', onclick: () => addTx('out', reload) }, '− Chiqim')));

  el.append(h('div', { class: 'grid g4' },
    stat('Sof foyda', short(sum.net_profit), 'shu oyga yozilgan', sum.net_profit < 0 ? 'var(--warn)' : null),
    stat('Pul harakati', short(sum.cash_movement), 'aslida koʻchgan pul'),
    stat('Bizga qarz', short(sum.unpaid_to_us),
      sum.overdue_to_us > 0 ? `${short(sum.overdue_to_us)} muddati oʻtgan` : 'muddati oʻtmagan',
      sum.overdue_to_us > 0 ? 'var(--warn)' : null),
    stat('Kassada', short(sum.cash_on_hand), `${accounts.length} ta hisob`)));

  // The two numbers above are deliberately different; say why, once, here.
  el.append(h('div', { class: 'card' }, h('div', { class: 'tiny dim' },
    'Sof foyda — shu oyga tegishli daromad va xarajat, puli koʻchgan-koʻchmaganidan qatʼi nazar. ' +
    'Pul harakati — faqat haqiqatan koʻchgan pul. Masalan avgust ish haqi avgust xarajati, ' +
    'lekin 30-sanada toʻlanadi: foydada bor, kassada hali yoʻq.')));

  if (sum.scope_pending)
    el.append(h('div', { class: 'card', style: { borderColor: 'var(--accent)' } },
      h('b', `${sum.scope_pending} ta qoʻshimcha ish qarori kutmoqda`),
      h('div', { class: 'tiny dim' }, 'Akkaunt menejer qaror qilmaguncha daftarga tushmaydi.')));

  el.append(h('div', { class: 'grid g2' },
    h('div', { class: 'card' }, h('h2', 'Hisoblar'),
      h('table', { class: 'tbl' }, h('tbody',
        ...accounts.map(a => h('tr', { style: { cursor: 'pointer' }, onclick: () => editAccount(a, reload) },
          h('td', h('div', { style: { fontWeight: 550 } }, a.name), h('div', { class: 'tiny dim' }, a.purpose || '')),
          h('td', { class: 'num mono' }, money(a.balance, a.currency)))),
        h('tr', h('td', h('b', 'Jami')), h('td', { class: 'num mono' },
          h('b', money(accounts.reduce((s2, a) => s2 + Number(a.balance), 0), cur)))))),
      h('button', { class: 'btn sm ghost', style: { marginTop: '8px' }, onclick: () => editAccount(null, reload) },
        '+ Hisob qoʻshish')),
    h('div', { class: 'card' }, h('h2', 'Kirim va chiqim · 6 oy'),
      h('div', { style: { paddingTop: '6px' } }, sparkline(monthly, 'income', 'costs', { height: 74 })),
      h('div', { class: 'row tiny dim', style: { marginTop: '10px', gap: '14px' } },
        h('span', h('span', { style: { color: 'var(--ok)' } }, '■'), ' kirim'),
        h('span', h('span', { style: { color: 'var(--warn)' } }, '■'), ' chiqim')))));

  // Two side-by-side panels, each category as a bar, sorted by amount.
  const income = byCat.filter(c => c.direction === 'in');
  const costs = byCat.filter(c => c.direction === 'out');
  const panel = (title, list) => {
    const max = Math.max(1, ...list.map(c => Number(c.amount)));
    return h('div', { class: 'card' },
      h('h2', `${title} · ${short(list.reduce((s2, c) => s2 + Number(c.amount), 0))}`),
      list.length ? h('div', {}, ...list.map(c =>
        hbar(CATEGORY_LABEL[c.category] || c.category, Number(c.amount), max))) : h('div', { class: 'dim tiny' }, 'Yozuv yoʻq'));
  };
  el.append(h('div', { class: 'grid g2' }, panel('Kirim', income), panel('Chiqim', costs)));

  el.append(h('div', { class: 'card' }, h('h2', `Daftar · ${txs.length}`),
    h('div', { style: { overflowX: 'auto' } }, h('table', { class: 'tbl' },
      h('thead', h('tr', h('th', 'Sana'), h('th', 'Davr'), h('th', 'Kim / nima'),
        h('th', 'Turkum'), h('th', 'Hisob'), h('th', { class: 'num' }, 'Kirim'),
        h('th', { class: 'num' }, 'Chiqim'), h('th', 'Holat'), h('th', ''))),
      h('tbody', ...txs.map(x => {
        const [label, tone] = TX_STATUS[x.status] || [x.status, ''];
        return h('tr',
          h('td', { class: 'tiny mono' }, x.paid_on ? fmtDate(x.paid_on) : '—'),
          h('td', { class: 'tiny dim mono' }, String(x.period).slice(0, 7)),
          h('td', h('div', { style: { fontWeight: 550 } }, x.counterparty || '—'),
            h('div', { class: 'tiny dim' }, x.description || '')),
          h('td', { class: 'tiny' }, CATEGORY_LABEL[x.category] || x.category),
          h('td', { class: 'tiny dim' }, x.account_name || '—'),
          h('td', { class: 'num mono money-in' }, x.direction === 'in' ? short(x.amount) : ''),
          h('td', { class: 'num mono money-out' }, x.direction === 'out' ? short(x.amount) : ''),
          h('td', h('span', { class: 'pill ' + tone }, label)),
          h('td', h('div', { class: 'row', style: { gap: '4px' } },
            !x.settled ? h('button', {
              class: 'btn sm', onclick: async () => {
                await POST(`/api/finance/transactions/${x.id}/settle`, {}); toast('Belgilandi'); reload();
              },
            }, '✓') : null,
            h('button', {
              class: 'btn sm ghost', title: 'Oʻchirish',
              onclick: () => confirmDialog('Yozuvni oʻchirish', `${x.counterparty} — ${money(x.amount, cur)}`,
                async () => {
                  try { await DEL(`/api/finance/transactions/${x.id}`); toast('Oʻchirildi'); reload(); }
                  catch (e) { toast(e.message, 'bad'); }
                }, { danger: true, yes: 'Oʻchirish' }),
            }, '×'))));
      }))))));
}

function stat(label, value, note, color) {
  return h('div', { class: 'card' },
    h('div', { class: 'tiny dim' }, label),
    h('div', { class: 'num', style: color ? { color } : {} }, value),
    h('div', { class: 'tiny dim' }, note || State.me.currency));
}

function addTx(direction, done) {
  modal(direction === 'in' ? '+ Kirim' : '− Chiqim', close => {
    const f = h('form');
    const category = h('select', { class: 'in' });
    const account = h('select', { class: 'in' });
    const company = h('select', { class: 'in' }, h('option', { value: '' }, '—'));
    const settled = h('input', { type: 'checkbox', checked: true });
    const fields = {};
    const field = (k, label, opts = {}) => {
      fields[k] = h('input', { class: 'in', ...opts });
      return h('label', { class: 'f' }, h('span', label), fields[k]);
    };
    GET('/api/finance/categories').then(cs => category.append(...cs[direction]
      .map(c => h('option', { value: c }, CATEGORY_LABEL[c] || c))));
    GET('/api/finance/accounts').then(as => account.append(...as.map(a => h('option', { value: a.id }, a.name))));
    GET('/api/companies').then(cs => company.append(...cs.map(c => h('option', { value: c.id }, c.name))));

    const dueWrap = h('label', { class: 'f', style: { display: 'none' } }, h('span', 'Qachongacha kutiladi'),
      (fields.due_on = h('input', { class: 'in', type: 'date' })));
    settled.onchange = () => { dueWrap.style.display = settled.checked ? 'none' : 'block'; };

    f.append(
      field('counterparty', direction === 'in' ? 'Kimdan' : 'Kimga', { required: true }),
      field('description', 'Izoh'),
      h('div', { class: 'grid g2' },
        h('label', { class: 'f' }, h('span', 'Turkum'), category),
        h('label', { class: 'f' }, h('span', 'Hisob'), account)),
      h('div', { class: 'grid g2' },
        field('amount', 'Summa', { type: 'number', min: '1', class: 'in mono', required: true }),
        field('paid_on', 'Sana', { type: 'date', value: today() })),
      h('div', { class: 'grid g2' },
        field('period', 'Qaysi oyga tegishli', { type: 'month', value: today().slice(0, 7) }),
        h('label', { class: 'f' }, h('span', 'Mijoz ', h('span', { class: 'hint' }, '— ixtiyoriy')), company)),
      // The checkbox that splits profit from cash.
      h('label', { class: 'toggle', style: { cursor: 'pointer' } },
        h('span', { class: 'lbl' }, h('b', 'Pul haqiqatan koʻchdimi?'),
          h('span', 'Oʻchirsangiz — hisoblangan, lekin hali kelmagan/toʻlanmagan deb yoziladi')),
        h('span', { class: 'sw' }, settled, h('i'))),
      dueWrap,
      h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '12px' } },
        h('button', { class: 'btn', type: 'button', onclick: close }, t('cancel')),
        h('button', { class: `btn ${direction === 'in' ? 'ok' : 'pri'}`, type: 'button', onclick: save }, 'Saqlash')));

    async function save() {
      if (!(Number(fields.amount.value) > 0)) return toast('Summani kiriting', 'bad');
      try {
        await POST('/api/finance/transactions', {
          direction, counterparty: fields.counterparty.value, description: fields.description.value,
          category: category.value, account_id: account.value ? Number(account.value) : null,
          amount: Number(fields.amount.value),
          period: fields.period.value ? fields.period.value + '-01' : null,
          paid_on: fields.paid_on.value || null, settled: settled.checked,
          due_on: settled.checked ? null : (fields.due_on.value || null),
          company_id: company.value ? Number(company.value) : null,
        });
        close(); toast('Yozildi'); done();
      } catch (e) { toast(e.message, 'bad'); }
    }
    return f;
  });
}

function editAccount(account, done) {
  modal(account ? account.name : 'Yangi hisob', close => {
    const f = h('form');
    const fields = {};
    const field = (k, label, opts = {}) => {
      fields[k] = h('input', { class: 'in', value: account?.[k] ?? '', ...opts });
      return h('label', { class: 'f' }, h('span', label), fields[k]);
    };
    f.append(
      field('name', 'Nomi', { placeholder: 'Masalan: Ipoteka Bank' }),
      field('purpose', 'Nima uchun ishlatiladi'),
      h('div', { class: 'grid g2' },
        field('currency', 'Valyuta', { value: account?.currency || 'UZS' }),
        field('opening_balance', 'Boshlangʻich qoldiq', { type: 'number', class: 'in mono' })),
      h('div', { class: 'row', style: { justifyContent: 'flex-end' } },
        h('button', { class: 'btn', type: 'button', onclick: close }, t('cancel')),
        h('button', {
          class: 'btn pri', type: 'button', onclick: async () => {
            const body = { name: fields.name.value, purpose: fields.purpose.value,
                           currency: fields.currency.value, opening_balance: Number(fields.opening_balance.value) || 0 };
            if (!body.name) return toast('Nomini yozing', 'bad');
            try {
              account ? await PATCH(`/api/finance/accounts/${account.id}`, body)
                      : await POST('/api/finance/accounts', body);
              close(); toast('Saqlandi'); done();
            } catch (e) { toast(e.message, 'bad'); }
          },
        }, t('save'))));
    return f;
  });
}

// ---------------------------------------------------------------------------
// Weekly report (§10) — the agency, and separately your own week
// ---------------------------------------------------------------------------
async function viewReport(el) {
  // A member's report is their own week only, and says so.
  if (!['owner', 'accountant'].includes(State.me.role)) return myWeek(el);
  loading(el);
  const r = await GET('/api/reports/weekly');
  clear(el);
  el.append(pageHead(t('nav_report'), 'Soʻnggi 7 kun'));

  const S = r.summary;
  el.append(h('div', { class: 'card' }, h('p', { style: { fontSize: '15px' } },
    `${S.shipped} ta ish topshirildi, ${S.slipped} tasi muddatidan kechikdi, ` +
    `${S.waiting} tasi mijozda javob kutmoqda, ${S.revision_rounds} ta qayta ishlash sarflandi.`)));

  el.append(h('div', { class: 'grid g4' },
    stat('Topshirildi', r.shipped.length, 'shu hafta'),
    stat('Kechikdi', r.slipped.length, 'muddati oʻtgan', r.slipped.length ? 'var(--warn)' : null),
    stat('Mijozlarda', r.waiting.length, 'javob kutmoqda'),
    stat('Hisob qilindi', short(r.money.invoiced), `${short(r.money.received)} keldi`)));

  el.append(h('div', { class: 'card' }, h('h2', 'Topshirildi / kechikdi · 6 hafta'),
    h('div', { style: { paddingTop: '8px' } }, sparkline(r.trend, 'shipped', 'slipped', { height: 66 }))));

  // "Progress moved": where each project was on Monday against where it is now.
  if (r.progress_moved.length) {
    el.append(h('div', { class: 'card' }, h('h2', 'Qanchalik siljidi'),
      ...r.progress_moved.map(p => h('div', { class: 'hbar' },
        h('div', { class: 'row tiny' }, h('span', `${p.name} · ${p.company}`),
          h('span', { class: 'sp mono' },
            `${p.was}% → ${p.now}%`,
            p.now > p.was ? h('span', { style: { color: 'var(--ok)' } }, ` +${p.now - p.was}`) : null)),
        h('div', { class: 'bar', style: { marginTop: '3px', position: 'relative' } },
          h('i', { style: { width: p.now + '%' } }),
          h('span', { style: { position: 'absolute', left: p.was + '%', top: '-2px', width: '2px',
                               height: '9px', background: 'var(--ink-3)' } }))))));
  }

  // Revision rounds used against what the scope allowed.
  el.append(h('div', { class: 'card' }, h('h2', 'Qayta ishlashlar'),
    h('table', { class: 'tbl' }, h('tbody', ...r.revision_usage.map(p => h('tr',
      h('td', h('div', { style: { fontWeight: 550 } }, p.name), h('div', { class: 'tiny dim' }, p.company)),
      h('td', { class: 'num mono' }, `${p.used} / ${p.revisions_included}`),
      h('td', { class: 'num' }, p.over ? h('span', { class: 'pill warn' }, 'oshdi') : ''))))))); 

  if (r.waiting.length) el.append(h('div', { class: 'card' }, h('h2', 'Mijozda turgan ishlar'),
    h('div', { class: 'tiny dim', style: { marginBottom: '8px' } }, 'Bularning kechikishi agentlikda emas.'),
    h('div', { class: 'list' }, ...r.waiting.slice(0, 8).map(w => h('div', { class: 'item', onclick: () => openTask(w.id) },
      h('div', {}, h('div', { class: 't' }, w.title), h('div', { class: 's' }, w.company)),
      h('div', { class: 'r' }, h('span', { class: `pill ${w.days_waiting >= 7 ? 'warn' : ''}` }, `${w.days_waiting} kun`)))))));

  if (r.slipped.length) el.append(h('div', { class: 'card' }, h('h2', 'Yangi sana kerak'),
    h('div', { class: 'tiny dim', style: { marginBottom: '8px' } }, 'Bu ayblov roʻyxati emas — shunchaki qayta rejalashtirish kerak.'),
    h('div', { class: 'list' }, ...r.slipped.map(s2 => h('div', { class: 'item', onclick: () => openTask(s2.id) },
      h('div', {}, h('div', { class: 't' }, s2.title), h('div', { class: 's' }, `${s2.company} · ${s2.project}`)),
      h('div', { class: 'r' }, h('span', { class: 'pill warn' }, `${s2.days_late} kun`)))))));

  el.append(h('div', { class: 'card' }, h('h2', 'Mijozlar boʻyicha'),
    h('div', { class: 'list' }, ...r.by_client.map(c => h('div', { class: 'item', style: { cursor: 'default' } },
      h('div', { class: 't' }, c.company),
      h('div', { class: 'r' },
        h('span', { class: 'pill ok' }, `${c.shipped} topshirildi`),
        c.waiting ? h('span', { class: 'pill info' }, `${c.waiting} kutmoqda`) : null,
        c.late ? h('span', { class: 'pill warn' }, `${c.late} kechikdi`) : null))))));
}

async function myWeek(el) {
  loading(el);
  const w = await GET('/api/reports/my-week');
  clear(el);
  el.append(pageHead('Mening haftam', 'Faqat sizning ishlaringiz'));
  el.append(h('div', { class: 'grid g3' },
    stat('Yakunlandi', w.done.length, 'soʻnggi 7 kun'),
    stat('Ochiq', w.open.length, 'hozir'),
    stat('Yaqinlashmoqda', w.incoming.length, 'kelasi hafta')));

  const section = (title, list, note) => list.length ? h('div', { class: 'card' }, h('h2', title),
    note ? h('div', { class: 'tiny dim', style: { marginBottom: '8px' } }, note) : null,
    h('div', { class: 'list' }, ...list.map(tk => h('div', { class: 'item', onclick: () => openTask(tk.id) },
      h('div', {}, h('div', { class: 't' }, tk.title), h('div', { class: 's' }, tk.project)),
      h('div', { class: 'r' }, tk.due_date
        ? h('span', { class: `pill ${dueLabel(tk.due_date).cls}` }, dueLabel(tk.due_date).text)
        : null))))) : null;

  const done = section('Shu hafta yakunlandi', w.done);
  const open = section('Ochiq ishlar', w.open);
  const inc = section('Yaqinlashayotgan', w.incoming);
  for (const s2 of [done, open, inc]) if (s2) el.append(s2);
  el.append(h('div', { class: 'card' }, h('div', { class: 'tiny dim' },
    'Bu faqat sizning haftangiz — hech kim bilan taqqoslanmaydi.')));
}

// ---------------------------------------------------------------------------
// Settings (§12) — owner only
// ---------------------------------------------------------------------------
async function viewSettings(el) {
  loading(el);
  const { settings } = await GET('/api/settings');
  clear(el);
  el.append(pageHead(t('nav_settings'), State.settings.agency_name || State.me.agency));

  const pending = {};
  const save = async () => {
    if (!Object.keys(pending).length) return;
    try {
      await api('PUT', '/api/settings', pending);
      Object.assign(State.settings, pending);
      for (const k of Object.keys(pending)) delete pending[k];
      toast('Saqlandi');
    } catch (e) { toast(e.message, 'bad'); }
  };
  const toggle = (key, title, note) => h('label', { class: 'toggle', style: { cursor: 'pointer' } },
    h('span', { class: 'lbl' }, h('b', title), h('span', note)),
    h('span', { class: 'sw' },
      h('input', {
        type: 'checkbox', checked: settings[key] === 'true',
        onchange: e => { pending[key] = String(e.target.checked); save(); },
      }), h('i')));
  const textField = (key, label, opts = {}) => {
    const inp = h('input', { class: 'in', value: settings[key] || '', ...opts });
    inp.onchange = () => { pending[key] = inp.value; save(); };
    return h('label', { class: 'f' }, h('span', label), inp);
  };

  el.append(h('div', { class: 'card' }, h('h2', 'Ish maydoni'),
    textField('agency_name', 'Agentlik nomi (mijozlar koʻradi)', { placeholder: State.me.agency }),
    h('div', { class: 'grid g2' },
      textField('timezone', 'Vaqt mintaqasi'),
      (() => {
        const sel = h('select', { class: 'in' }, ...[['uz', "O'zbekcha"], ['ru', 'Русский'], ['en', 'English']]
          .map(([k, n]) => h('option', { value: k, selected: settings.language === k }, n)));
        sel.onchange = () => { pending.language = sel.value; save(); Store.lang = sel.value; renderShell(); };
        return h('label', { class: 'f' }, h('span', 'Interfeys tili'), sel);
      })())));

  el.append(h('div', { class: 'card' }, h('h2', 'Mijoz koʻrinishi — standart holat'),
    toggle('new_tasks_internal', 'Yangi ishlar ichki boʻlsin',
      'Har bir yangi ish, ochib berilmaguncha, mijozdan yopiq turadi'),
    toggle('hide_history_before_visible', 'Ochilgunga qadar yozilganlar yashirin qolsin',
      'Ish ochilganda mijoz faqat shundan keyingi izohlarni koʻradi'),
    toggle('show_client_deadline_only', 'Faqat mijozga aytilgan sana koʻrsatilsin',
      'Ichki muddat hech qachon mijoz tomonga chiqmaydi'),
    toggle('clients_can_reply', 'Mijoz izohlarga javob yoza olsin',
      'Yangi mavzu ocha olmaydi — qaror faqat tasdiqlash tugmasi orqali')));

  el.append(h('div', { class: 'card' }, h('h2', 'Telegram'),
    h('div', { class: 'row', style: { marginBottom: '10px' } },
      State.me.telegram_linked
        ? h('span', { class: 'pill ok' }, '✓ Ulangan')
        : h('span', { class: 'pill' }, 'Ulanmagan'),
      h('button', {
        class: 'btn sm sp', onclick: () => State.me.telegram_linked ? unlinkTelegram() : linkTelegram(),
      }, State.me.telegram_linked ? 'Uzish' : 'Ulash')),
    toggle('tg_daily_summary', 'Har kuni ertalabki xulosa', 'Kun boshida qisqa holat'),
    toggle('tg_deadline_reminder', 'Muddatdan bir kun oldin eslatma', ''),
    toggle('tg_overdue_alerts', 'Muddati oʻtganda ogohlantirish', 'Akkaunt menejer va bajaruvchiga')));

  el.append(h('div', { class: 'card' }, h('h2', 'Ballar va nishonlar'),
    h('div', { class: 'grid g3' },
      textField('points_easy', 'Oson', { type: 'number', class: 'in mono' }),
      textField('points_medium', 'Oʻrtacha', { type: 'number', class: 'in mono' }),
      textField('points_hard', 'Qiyin', { type: 'number', class: 'in mono' })),
    h('div', { class: 'grid g3' },
      textField('points_early_bonus', 'Erta bajarganga bonus', { type: 'number', class: 'in mono' }),
      textField('points_late_penalty', 'Kechikkanga jarima', { type: 'number', class: 'in mono' }),
      textField('points_missed_penalty', 'Bajarilmaganga jarima', { type: 'number', class: 'in mono' })),
    h('div', { class: 'sec-t' }, 'Nishon chegaralari'),
    h('div', { class: 'grid g3' },
      textField('badge_jolbors_points', 'Jolbors', { type: 'number', class: 'in mono' }),
      textField('badge_baku_points', 'Baku Flames', { type: 'number', class: 'in mono' }),
      textField('badge_cannes_points', 'Cannes', { type: 'number', class: 'in mono' }))));

  el.append(h('div', { class: 'card' }, h('h2', 'Maʼlumotlar'),
    h('p', { class: 'muted', style: { marginBottom: '10px' } },
      'Yakunlangan loyihalar oʻchirilmaydi — arxivga oʻtadi va qidiruvda qoladi.'),
    h('button', {
      class: 'btn', onclick: async () => {
        const res = await fetch('/api/settings/export', { headers: { authorization: `Bearer ${Store.token}` } });
        if (!res.ok) return toast('Eksport qilinmadi', 'bad');
        const url = URL.createObjectURL(await res.blob());
        const a = h('a', { href: url, download: `account-manager-${today()}.json` });
        document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      },
    }, '⬇ Hammasini yuklab olish')));
}

async function linkTelegram() {
  const r = await POST('/api/telegram/link-code', {});
  modal('Telegramni ulash', () => h('div', {},
    h('p', { class: 'muted' }, 'Botga shu kodni yuboring:'),
    h('div', { class: 'card mono', style: { textAlign: 'center', fontSize: '26px', letterSpacing: '.16em', margin: '14px 0' } }, r.code),
    r.bot ? h('a', { class: 'btn pri wide', href: `https://t.me/${r.bot}?start=${r.code}`, target: '_blank' }, 'Telegramda ochish') : null,
    h('div', { class: 'tiny dim', style: { marginTop: '10px' } }, `${r.expires_in_minutes} daqiqa amal qiladi.`)));
}
async function unlinkTelegram() {
  await POST('/api/telegram/unlink', {});
  State.me.telegram_linked = false; toast('Uzildi'); renderShell();
}

// ---------------------------------------------------------------------------
(async function start() {
  if (!Store.token) return renderLogin();
  try {
    State.me = await GET('/api/me');
    if (State.me.role === 'client') return void (location.href = '/portal/');
    State.settings = await GET('/api/settings/public').catch(() => ({}));
    if (State.settings.language && !localStorage.getItem('am_lang')) Store.lang = State.settings.language;
    renderShell();
  } catch (e) { Store.token = null; renderLogin(); }
})();
