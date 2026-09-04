/* Shared building blocks for all three surfaces. No framework and no build
   step — the whole app is three static files Railway serves as-is. */

// ---- tiny DOM helper --------------------------------------------------------
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props && (typeof props !== 'object' || props.nodeType || Array.isArray(props))) { kids.unshift(props); props = null; }
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') {
      // Object.assign silently drops CSS custom properties — `--c` set that
      // way never lands, and anything depending on var(--c) renders as
      // nothing at all, with no error. They need setProperty.
      for (const [prop, val] of Object.entries(v)) {
        if (val == null) continue;
        if (prop.startsWith('--')) el.style.setProperty(prop, String(val));
        else el.style[prop] = val;
      }
    }
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = k => {
    if (k == null || k === false) return;
    if (Array.isArray(k)) return k.forEach(add);
    el.appendChild(k.nodeType ? k : document.createTextNode(String(k)));
  };
  kids.forEach(add);
  return el;
}
const $ = s => document.querySelector(s);
const clear = el => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

// ---- api --------------------------------------------------------------------
const Store = {
  get token() { return localStorage.getItem('am_token'); },
  set token(v) { v ? localStorage.setItem('am_token', v) : localStorage.removeItem('am_token'); },
  get lang() { return localStorage.getItem('am_lang') || 'uz'; },
  set lang(v) { localStorage.setItem('am_lang', v); },
};

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', ...(Store.token ? { authorization: `Bearer ${Store.token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) { Store.token = null; location.reload(); return; }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Something went wrong (${res.status})`);
  return data;
}
const GET = p => api('GET', p);
const POST = (p, b) => api('POST', p, b);
const PATCH = (p, b) => api('PATCH', p, b);
const DEL = p => api('DELETE', p);

// ---- chrome -----------------------------------------------------------------
function toast(msg, kind) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = h('div', { class: 'toast' }, kind === 'bad' ? '⚠ ' : '', msg);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

function overlay(node, { onClose } = {}) {
  const scrim = h('div', { class: 'scrim', onclick: close });
  document.body.append(scrim, node);
  function close() { scrim.remove(); node.remove(); document.removeEventListener('keydown', esc); onClose && onClose(); }
  function esc(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', esc);
  return close;
}

function modal(title, bodyFn, { wide } = {}) {
  const box = h('div', { class: 'modal' });
  const close = overlay(box);
  box.append(h('h2', title));
  box.append(bodyFn(close, box));
  const first = box.querySelector('input, textarea, select');
  if (first) setTimeout(() => first.focus(), 30);
  return close;
}

function drawer(render) {
  const box = h('div', { class: 'drawer' });
  const close = overlay(box);
  render(box, close);
  return close;
}

function confirmDialog(title, message, onYes, { danger, yes } = {}) {
  modal(title, close => h('div', {},
    h('p', { class: 'muted', style: { marginBottom: '16px' } }, message),
    h('div', { class: 'row', style: { justifyContent: 'flex-end' } },
      h('button', { class: 'btn', onclick: close }, t('cancel')),
      h('button', { class: `btn ${danger ? 'danger' : 'pri'}`, onclick: () => { close(); onYes(); } }, yes || t('confirm')))));
}

// Files open through a short-lived, single-file token rather than by pasting
// the session token into a URL, where it would reach server logs, browser
// history and the Referer of any redirect out to Drive or Dropbox.
async function openFile(ev, id) {
  ev.preventDefault();
  try {
    const { url } = await GET(`/api/files/${id}/link`);
    window.open(url, '_blank', 'noopener');
  } catch (e) { toast(e.message, 'bad'); }
}

// ---- dates & money ----------------------------------------------------------
const pad = n => String(n).padStart(2, '0');
const today = () => new Date().toISOString().slice(0, 10);

// Dates arrive as plain 'YYYY-MM-DD' from the API on purpose; parsing them
// with `new Date()` would drag them back through a timezone and shift the day.
function fmtDate(d) {
  if (!d) return '';
  const s = String(d).slice(0, 10);
  const [y, m, dd] = s.split('-');
  if (!y || !m || !dd) return s;
  const months = t('months');
  return `${Number(dd)} ${months[Number(m) - 1]}`;
}
function daysFrom(d) {
  if (!d) return null;
  const s = String(d).slice(0, 10);
  return Math.round((Date.parse(s + 'T00:00:00Z') - Date.parse(today() + 'T00:00:00Z')) / 86400000);
}
function dueLabel(d) {
  const n = daysFrom(d);
  if (n === null) return { text: '', cls: '' };
  if (n < 0)  return { text: t('daysLate', { n: -n }), cls: 'warn' };
  if (n === 0) return { text: t('today'), cls: 'acc' };
  if (n === 1) return { text: t('tomorrow'), cls: 'acc' };
  if (n <= 4) return { text: t('inDays', { n }), cls: '' };
  return { text: fmtDate(d), cls: '' };
}
function fmtWhen(ts) {
  if (!ts) return '';
  const diff = (Date.now() - Date.parse(ts)) / 1000;
  if (diff < 90) return t('justNow');
  if (diff < 3600) return t('minsAgo', { n: Math.round(diff / 60) });
  if (diff < 86400) return t('hoursAgo', { n: Math.round(diff / 3600) });
  if (diff < 7 * 86400) return t('daysAgo', { n: Math.round(diff / 86400) });
  return fmtDate(ts);
}
const money = (n, cur) => `${Number(n || 0).toLocaleString('ru-RU')} ${cur || 'UZS'}`;
const short = (n) => {
  n = Number(n || 0);
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace('.0', '') + ' mlrd';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.0', '') + ' mln';
  if (n >= 1e3) return Math.round(n / 1e3) + 'k';
  return String(n);
};

// ---- shared visual pieces --------------------------------------------------
// Initials on a fixed per-person colour, so the same face is the same colour on
// every card, row and stack in the product.
const initials = name => String(name || '?').trim().split(/\s+/).slice(0, 2)
  .map(w => w[0]).join('').toUpperCase();

const AVATAR_COLORS = ['#b45309', '#1d4ed8', '#15803d', '#7c3aed', '#be123c', '#0f766e', '#a16207', '#4338ca'];
const colorFor = (seed) => {
  if (typeof seed === 'string' && seed.startsWith('#')) return seed;
  const n = typeof seed === 'number' ? seed
    : String(seed || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return AVATAR_COLORS[Math.abs(n) % AVATAR_COLORS.length];
};

function avatar(name, seed, size = 26) {
  return h('span', {
    class: 'av', title: name || '',
    style: { width: size + 'px', height: size + 'px', background: colorFor(seed ?? name),
             fontSize: Math.round(size * 0.4) + 'px' },
  }, initials(name));
}

// A stack of faces, with an overflow count rather than an unbounded row.
function avatars(names, max = 4) {
  const shown = (names || []).slice(0, max);
  return h('span', { class: 'av-stack' },
    ...shown.map(n => avatar(n, n, 24)),
    (names || []).length > max
      ? h('span', { class: 'av', style: { width: '24px', height: '24px', background: 'var(--surface-2)',
          color: 'var(--ink-2)', fontSize: '10px' } }, '+' + (names.length - max))
      : null);
}

// Two series, six buckets. Deliberately tiny and unlabelled inline — the full
// numbers live in the report; this is a glance, not a chart.
function sparkline(rows, aKey, bKey, { height = 34 } = {}) {
  const max = Math.max(1, ...rows.map(r => Math.max(Number(r[aKey]) || 0, Number(r[bKey]) || 0)));
  return h('div', { class: 'spark' }, ...rows.map(r => h('div', { class: 'spark-col', title: `${r.week || r.month}` },
    h('div', { class: 'spark-pair', style: { height: height + 'px' } },
      h('i', { class: 'a', style: { height: Math.round((Number(r[aKey]) || 0) / max * height) + 'px' },
               title: `${aKey}: ${r[aKey]}` }),
      h('i', { class: 'b', style: { height: Math.round((Number(r[bKey]) || 0) / max * height) + 'px' },
               title: `${bKey}: ${r[bKey]}` })),
    h('div', { class: 'spark-x' }, sparkLabel(r)))));
}

// '2026-04' reads better as 'apr'; a week bucket stays as its date.
function sparkLabel(r) {
  if (r.month && /^\d{4}-\d{2}$/.test(r.month)) return t('months')[Number(r.month.slice(5, 7)) - 1];
  return String(r.week || r.month || '').slice(-5);
}

// A labelled horizontal bar, used by the category breakdowns.
function hbar(label, value, max, note) {
  return h('div', { class: 'hbar' },
    h('div', { class: 'row tiny' }, h('span', label), h('span', { class: 'sp mono' }, note ?? short(value))),
    h('div', { class: 'bar', style: { marginTop: '3px' } },
      h('i', { style: { width: Math.round((Number(value) || 0) / Math.max(1, max) * 100) + '%' } })));
}

// Named after creative festivals, low to high. The names are proper nouns and
// stay as they are; only the reason you earned one is translated.
const BADGE_LOOK = {
  taf:     { label: 'TAF',         color: '#a16207' },
  jolbors: { label: 'Jolbors',     color: '#0f766e' },
  baku:    { label: 'Baku Flames', color: '#b45309' },
  cannes:  { label: 'Cannes',      color: '#7c3aed' },
};
const BADGE_HINT = {
  uz: { taf: 'Birinchi yakunlangan ishlar', jolbors: 'Bir oy — bironta ham kechikmagan',
        baku: 'Yuqori ball toʻplami', cannes: 'Alohida ajralib turgan oy' },
  ru: { taf: 'Первые выполненные задачи', jolbors: 'Месяц без опозданий',
        baku: 'Высокая сумма баллов', cannes: 'Выдающийся месяц' },
  en: { taf: 'First tasks completed', jolbors: 'A month with nothing late',
        baku: 'Strong point total', cannes: 'A standout month' },
};
const badgeHint = k => (BADGE_HINT[Store.lang] || BADGE_HINT.en)[k] || '';

function badgeChip(key) {
  const b = BADGE_LOOK[key];
  if (!b) return null;
  return h('span', { class: 'badge-chip', title: badgeHint(key),
                     style: { borderColor: b.color, color: b.color } }, b.label);
}

const DIFFICULTY = { easy: 'Oson', medium: 'Oʻrtacha', hard: 'Qiyin' };

// ---- i18n -------------------------------------------------------------------
// Open question 5: Latin Uzbek is the default — it is what the business writes
// in — with Russian and English alongside, because agency teams here switch
// language mid-sentence and the client may not share the team's preference.
const STRINGS = {
  uz: {
    months: ['yan','fev','mar','apr','may','iyun','iyul','avg','sen','okt','noy','dek'],
    today: 'Bugun', tomorrow: 'Ertaga', justNow: 'hozir',
    inDays: '{n} kundan keyin', daysLate: '{n} kun kechikdi',
    minsAgo: '{n} daq oldin', hoursAgo: '{n} soat oldin', daysAgo: '{n} kun oldin',
    cancel: 'Bekor qilish', confirm: 'Tasdiqlash', save: 'Saqlash', close: 'Yopish',
    nav_today: 'Bugun', nav_projects: 'Loyihalar', nav_clients: 'Mijozlar',
    nav_mytasks: 'Ishlarim', nav_calendar: 'Kalendar', nav_team_perf: 'Reyting', nav_team_stats: 'Koʻrsatkichlar',
    nav_finance: 'Moliya', nav_team: 'Jamoa', nav_report: 'Hisobot', nav_settings: 'Sozlamalar',
    signIn: 'Kirish', phone: 'Telefon', pin: 'PIN kod',
    waitingOnClients: 'Mijozlarda turibdi', myWork: 'Mening ishim', atRisk: 'Muddati yaqin',
    recent: 'Soʻnggi harakatlar', nothingHere: 'Hozircha hech narsa yoʻq',
    internal: 'Ichki', clientVisible: 'Mijozga koʻrinadi',
    approve: 'Tasdiqlash', requestChanges: 'Oʻzgartirish soʻrash',
    sendForApproval: 'Tasdiqlashga yuborish',
    scopeTitle: 'Kelishilgan qayta ishlashdan oshdi',
    absorb: 'Oʻzimiz qoplaymiz', bill: 'Qoʻshimcha hisob qilamiz',
    progress: 'Bajarildi', delivered: '{done} / {total} topshirildi',
    revisionRound: '{n}-qayta ishlash',
  },
  ru: {
    months: ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'],
    today: 'Сегодня', tomorrow: 'Завтра', justNow: 'только что',
    inDays: 'через {n} дн.', daysLate: 'просрочено на {n} дн.',
    minsAgo: '{n} мин назад', hoursAgo: '{n} ч назад', daysAgo: '{n} дн назад',
    cancel: 'Отмена', confirm: 'Подтвердить', save: 'Сохранить', close: 'Закрыть',
    nav_today: 'Сегодня', nav_projects: 'Проекты', nav_clients: 'Клиенты',
    nav_mytasks: 'Мои задачи', nav_calendar: 'Календарь', nav_team_perf: 'Рейтинг', nav_team_stats: 'Показатели',
    nav_finance: 'Финансы', nav_team: 'Команда', nav_report: 'Отчёт', nav_settings: 'Настройки',
    signIn: 'Войти', phone: 'Телефон', pin: 'PIN-код',
    waitingOnClients: 'У клиентов', myWork: 'Моя работа', atRisk: 'Горит срок',
    recent: 'Последние действия', nothingHere: 'Пока пусто',
    internal: 'Внутреннее', clientVisible: 'Видно клиенту',
    approve: 'Утвердить', requestChanges: 'Запросить правки',
    sendForApproval: 'Отправить на утверждение',
    scopeTitle: 'Превышены согласованные правки',
    absorb: 'Берём на себя', bill: 'Выставить счёт',
    progress: 'Готовность', delivered: 'сдано {done} из {total}',
    revisionRound: 'Правка {n}',
  },
  en: {
    months: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
    today: 'Today', tomorrow: 'Tomorrow', justNow: 'just now',
    inDays: 'in {n} days', daysLate: '{n} days late',
    minsAgo: '{n}m ago', hoursAgo: '{n}h ago', daysAgo: '{n}d ago',
    cancel: 'Cancel', confirm: 'Confirm', save: 'Save', close: 'Close',
    nav_today: 'Today', nav_projects: 'Projects', nav_clients: 'Clients',
    nav_mytasks: 'My tasks', nav_calendar: 'Calendar', nav_team_perf: 'Leaderboard', nav_team_stats: 'Performance',
    nav_finance: 'Finance', nav_team: 'Team', nav_report: 'Report', nav_settings: 'Settings',
    signIn: 'Sign in', phone: 'Phone', pin: 'PIN',
    waitingOnClients: 'With clients', myWork: 'My work', atRisk: 'Due soon',
    recent: 'Recent activity', nothingHere: 'Nothing here yet',
    internal: 'Internal', clientVisible: 'Client sees this',
    approve: 'Approve', requestChanges: 'Request changes',
    sendForApproval: 'Send for approval',
    scopeTitle: 'Beyond the agreed revisions',
    absorb: 'Absorb it', bill: 'Bill as extra scope',
    progress: 'Progress', delivered: '{done} of {total} delivered',
    revisionRound: 'Revision {n}',
  },
};

function t(key, vars) {
  const lang = STRINGS[Store.lang] ? Store.lang : 'uz';
  let s = STRINGS[lang][key];
  if (s === undefined) s = STRINGS.en[key];
  if (s === undefined) return key;
  if (Array.isArray(s) || !vars) return s;
  return String(s).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

// Notifications are written by database triggers, so they carry structured
// params and get rendered here rather than being stuck in whatever language
// the trigger happened to be written in.
function renderNotification(n) {
  const p = n.params || {};
  const L = {
    approved: {
      uz: `${p.who || 'Mijoz'} "${p.task}" (v${p.version}) ni tasdiqladi`,
      ru: `${p.who || 'Клиент'} утвердил «${p.task}» (v${p.version})`,
      en: `${p.who || 'The client'} approved "${p.task}" (v${p.version})`,
    },
    changes_requested: {
      uz: `${p.round}-qayta ishlash: "${p.task}" — ${p.note || ''}`,
      ru: `Правка ${p.round}: «${p.task}» — ${p.note || ''}`,
      en: `Round ${p.round} on "${p.task}" — ${p.note || ''}`,
    },
    scope_exceeded: {
      uz: `"${p.task}" ${p.round}-qayta ishlashda; kelishuv ${p.included} ta edi`,
      ru: `«${p.task}» на правке ${p.round}; в смете ${p.included}`,
      en: `"${p.task}" is on round ${p.round}; the scope allows ${p.included}`,
    },
    task_late: {
      uz: `"${p.task}" muddati oʻtdi (${p.due})`,
      ru: `«${p.task}» просрочено (${p.due})`,
      en: `"${p.task}" is past its internal date (${p.due})`,
    },
    awaiting_client: {
      uz: `"${p.task}" ${p.company}da ${p.days} kundan beri turibdi`,
      ru: `«${p.task}» у ${p.company} уже ${p.days} дн.`,
      en: `"${p.task}" has been with ${p.company} for ${p.days} days`,
    },
    scope_undecided: {
      uz: `"${p.task}" boʻyicha qaror ${p.days} kundan beri qabul qilinmagan`,
      ru: `Решение по «${p.task}» не принято ${p.days} дн.`,
      en: `"${p.task}" scope is still undecided after ${p.days} days`,
    },
  }[p.event];
  return (L && (L[Store.lang] || L.en)) || n.body || n.title;
}
