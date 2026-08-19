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
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
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
