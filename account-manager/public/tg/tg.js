/* The Telegram Mini App.
   Same API, same policies — the only thing that changes is how you get in:
   Telegram signs the session, so there is no login screen for anyone who has
   already linked their account to the bot. */

const TG = window.Telegram?.WebApp;
const M = { me: null, view: null };
const root = () => document.getElementById('root');

if (TG) {
  TG.ready();
  TG.expand();
  // Telegram's own colours win when it supplies them.
  if (TG.themeParams?.bg_color) document.body.style.background = TG.themeParams.bg_color;
}

const haptic = kind => { try { TG?.HapticFeedback?.notificationOccurred(kind); } catch {} };

function page(...kids) { return clear(root()).appendChild(h('div', { class: 'tg' }, ...kids)); }

// ---------------------------------------------------------------------------
function needsLink() {
  page(
    h('div', { class: 'tg-head' }, h('div', { class: 'mark' }, 'A'),
      h('div', {}, h('b', 'Account Manager'))),
    h('div', { class: 'tg-card' },
      h('p', { class: 'muted' },
        'Bu Telegram hisobingiz hali ulanmagan. Ilovada Sozlamalar → Telegram boʻlimidan kod oling va botga yuboring.')),
    h('div', { class: 'tg-sec' }, 'yoki telefon bilan kiring'),
    loginForm());
}

function loginForm() {
  const f = h('form', {
    onsubmit: async e => {
      e.preventDefault();
      try {
        const r = await POST('/api/login', { phone: f.phone.value, pin: f.pin.value });
        Store.token = r.token; haptic('success'); start();
      } catch (er) { haptic('error'); toast(er.message, 'bad'); }
    },
  },
    h('label', { class: 'f' }, h('span', t('phone')), h('input', { class: 'in', name: 'phone', type: 'tel', required: true })),
    h('label', { class: 'f' }, h('span', t('pin')), h('input', { class: 'in', name: 'pin', type: 'password', inputmode: 'numeric', required: true })),
    h('button', { class: 'btn pri wide', type: 'submit' }, t('signIn')));
  return f;
}

// ---------------------------------------------------------------------------
// Client view — the same three buckets and the same one decision.
// ---------------------------------------------------------------------------
async function clientHome() {
  const d = await GET('/api/portal');
  const kids = [
    h('div', { class: 'tg-head' }, h('div', { class: 'mark' }, '◍'),
      h('div', {}, h('b', d.company?.name || ''), h('div', { class: 'tg-s' }, M.me.agency))),
  ];
  if (d.awaiting.length) {
    kids.push(h('div', { class: 'tg-sec' }, `Sizning javobingiz kerak · ${d.awaiting.length}`));
    for (const tk of d.awaiting) kids.push(h('div', { class: 'tg-card act', onclick: () => clientTask(tk.id) },
      h('div', { class: 'tg-t' }, tk.title),
      h('div', { class: 'tg-s' }, (tk.version ? `v${tk.version} · ` : '') + (tk.assignee || ''))));
  }
  for (const p of d.projects) {
    kids.push(h('div', { class: 'tg-sec' }, p.name));
    kids.push(h('div', { class: 'tg-card' },
      h('div', { class: 'bar acc' }, h('i', { style: { width: (p.progress_pct || 0) + '%' } })),
      h('div', { class: 'row tg-s', style: { marginTop: '6px' } },
        h('span', `${p.progress_pct}%`),
        h('span', { class: 'sp' }, t('delivered', { done: p.delivered, total: p.deliverables })))));
    for (const tk of d.tasks.filter(x => x.project_id === p.id && !x.needs_you))
      kids.push(h('div', { class: 'tg-card', onclick: () => clientTask(tk.id) },
        h('div', { class: 'row' },
          h('div', {}, h('div', { class: 'tg-t' }, tk.title),
            h('div', { class: 'tg-s' }, [tk.assignee, tk.due ? fmtDate(tk.due) : null].filter(Boolean).join(' · '))),
          h('span', { class: `pill sp ${tk.bucket === 'done' ? 'ok' : ''}` },
            tk.bucket === 'done' ? '✓' : tk.bucket === 'in_progress' ? '•' : '·'))));
  }
  if (!d.projects.length) kids.push(h('div', { class: 'tg-card' }, h('div', { class: 'empty' }, 'Faol loyiha yoʻq')));
  page(...kids);
}

async function clientTask(id) {
  const d = await GET(`/api/portal/tasks/${id}`);
  const tk = d.task;
  const kids = [
    h('button', { class: 'tg-back', onclick: clientHome }, '‹ Orqaga'),
    h('h1', { style: { fontSize: '19px', fontWeight: 650, margin: '4px 0 2px' } }, tk.title),
    h('div', { class: 'tg-s', style: { marginBottom: '14px' } },
      [tk.assignee, tk.due ? fmtDate(tk.due) : null, tk.version ? `v${tk.version}` : null].filter(Boolean).join(' · ')),
  ];
  if (tk.description) kids.push(h('div', { class: 'tg-card' }, tk.description));
  for (const f of d.files) kids.push(h('a', {
    class: 'tg-card', style: { display: 'block' }, href: '#',
    onclick: e => openFile(e, f.id),
  }, '📎 ' + f.name));

  if (tk.needs_you) {
    const note = h('textarea', { class: 'in', placeholder: 'Nimani oʻzgartirish kerak?' });
    const noteWrap = h('div', { style: { display: 'none', marginTop: '10px' } }, note,
      h('button', {
        class: 'btn pri wide', style: { marginTop: '8px' },
        onclick: () => note.value.trim() ? decide('changes_requested', note.value.trim())
                                         : toast('Izoh yozing', 'bad'),
      }, 'Yuborish'));
    kids.push(h('div', { class: 'tg-card act' },
      h('b', 'Sizning qaroringiz'),
      h('div', { class: 'tg-btns' },
        h('button', { class: 'btn ok', onclick: () => decide('approved') }, '✓ ' + t('approve')),
        h('button', { class: 'btn', onclick: () => noteWrap.style.display = 'block' }, '✏ ' + t('requestChanges'))),
      noteWrap));

    async function decide(decision, noteText) {
      try {
        await POST(`/api/portal/tasks/${id}/decision`, { decision, note: noteText, source: 'telegram' });
        haptic('success');
        toast(decision === 'approved' ? 'Tasdiqlandi — rahmat!' : 'Yuborildi');
        clientHome();
      } catch (e) { haptic('error'); toast(e.message, 'bad'); }
    }
  }

  for (const a of d.approvals) kids.push(h('div', { class: 'tg-card' },
    h('div', { class: 'tg-t' }, a.decision === 'approved' ? `v${a.version_no} tasdiqlandi` : `v${a.version_no} — oʻzgartirish soʻraldi`),
    a.note ? h('div', { class: 'muted' }, a.note) : null,
    h('div', { class: 'tg-s' }, `${a.decided_by_name} · ${fmtWhen(a.decided_at)}`)));
  page(...kids);
}

// ---------------------------------------------------------------------------
// Staff view — my week, and the scope decision, because those are the two
// things worth doing from a phone.
// ---------------------------------------------------------------------------
async function staffHome() {
  const week = await GET('/api/reports/my-week');
  const kids = [
    h('div', { class: 'tg-head' }, h('div', { class: 'mark' }, 'A'),
      h('div', {}, h('b', M.me.name), h('div', { class: 'tg-s' }, M.me.agency))),
  ];

  if (M.me.role === 'owner') {
    const dash = await GET('/api/dashboard');
    for (const s of dash.scope) {
      const amtIn = h('input', { class: 'in mono', type: 'number', placeholder: 'Summa' });
      const amtWrap = h('div', { style: { display: 'none', marginTop: '10px' } }, amtIn,
        h('button', {
          class: 'btn pri wide', style: { marginTop: '8px' },
          onclick: async () => {
            if (!(Number(amtIn.value) > 0)) return toast('Summani kiriting', 'bad');
            await POST(`/api/scope-alerts/${s.id}/resolve`, { resolution: 'billed', amount: Number(amtIn.value) });
            haptic('success'); toast('Hisobga qoʻshildi'); staffHome();
          },
        }, 'Tasdiqlash'));
      kids.push(h('div', { class: 'tg-card act' },
      h('b', '⚠ ' + t('scopeTitle')),
      h('div', { class: 'tg-s' }, `${s.task} · ${s.company} — ${t('revisionRound', { n: s.revision_round })} / ${s.revisions_included}`),
      h('div', { class: 'tg-btns' },
        h('button', {
          class: 'btn', onclick: async () => {
            await POST(`/api/scope-alerts/${s.id}/resolve`, { resolution: 'absorbed' });
            haptic('success'); toast('Qoplandi'); staffHome();
          },
        }, '🤝 ' + t('absorb')),
        h('button', { class: 'btn pri', onclick: () => { amtWrap.style.display = 'block'; amtIn.focus(); } },
          '💵 ' + t('bill'))),
      amtWrap));
    }

    if (dash.waiting.length) {
      kids.push(h('div', { class: 'tg-sec' }, `${t('waitingOnClients')} · ${dash.waiting.length}`));
      for (const w of dash.waiting) kids.push(h('div', { class: 'tg-card' },
        h('div', { class: 'tg-t' }, w.title), h('div', { class: 'tg-s' }, `${w.company} · ${w.project}`)));
    }
  }

  kids.push(h('div', { class: 'tg-sec' }, `${t('myWork')} · ${week.open.length}`));
  if (!week.open.length) kids.push(h('div', { class: 'tg-card' }, h('div', { class: 'empty' }, 'Ochiq ish yoʻq 🎉')));
  for (const tk of week.open) {
    const due = dueLabel(tk.due_date);
    kids.push(h('div', { class: 'tg-card' },
      h('div', { class: 'row' },
        h('div', {}, h('div', { class: 'tg-t' }, tk.title), h('div', { class: 'tg-s' }, tk.project)),
        due.text ? h('span', { class: `pill sp ${due.cls}` }, due.text) : null)));
  }
  if (week.done.length) {
    kids.push(h('div', { class: 'tg-sec' }, `Shu hafta yakunlandi · ${week.done.length}`));
    for (const tk of week.done) kids.push(h('div', { class: 'tg-card' },
      h('div', { class: 'tg-t' }, '✓ ' + tk.title), h('div', { class: 'tg-s' }, tk.project)));
  }
  kids.push(h('div', { class: 'tg-card', style: { marginTop: '18px' } },
    h('div', { class: 'tg-s' }, '🎙 Botga ovozli xabar yuboring — u brief sifatida saqlanadi.')));
  page(...kids);
}

// ---------------------------------------------------------------------------
async function start() {
  // Telegram signs initData; if it checks out the person is already known and
  // never sees a login form.
  if (!Store.token && TG?.initData) {
    try {
      const r = await POST('/api/tg/auth', { initData: TG.initData });
      Store.token = r.token;
    } catch { return needsLink(); }
  }
  if (!Store.token) return needsLink();
  try {
    M.me = await GET('/api/me');
    return M.me.role === 'client' ? clientHome() : staffHome();
  } catch { Store.token = null; return needsLink(); }
}
start();
