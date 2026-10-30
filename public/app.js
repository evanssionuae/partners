(() => {
'use strict';
const VENDORS = ['Arambh Labs', 'Backflipt', 'Bright Security', 'DefectDojo', 'Illumio', 'Onyx Security', 'Operlity', 'ReversingLabs', 'Silent Push', 'WitnessAI'];
const CATS = { sales: 'Sales', presales: 'Presales', technical: 'Technical', spiff: 'SPIFF programmes' };
const CAT_BLURB = {
  sales: 'Customer-facing decks, one-pagers, battlecards and pricing guidance.',
  presales: 'Solution briefs, demo guides, architecture material and proof-of-concept kits.',
  technical: 'Datasheets, deployment guides, integration notes and technical FAQs.',
  spiff: 'Vendor incentive programmes: what to sell, what you earn, and until when.',
};
const DEAL_LABEL = { submitted: ['Under review', 'warn'], approved: ['Approved', 'ok'], rejected: ['Not approved', 'bad'], info: ['More information needed', 'warn'] };
const USER_LABEL = { pending: ['Awaiting approval', 'warn'], approved: ['Approved', 'ok'], rejected: ['Rejected', 'bad'], suspended: ['Suspended', 'bad'] };

let me = null; let status = null; let deals = []; let editing = null;
const main = document.getElementById('main'); const header = document.getElementById('header'); const toastEl = document.getElementById('toast');

/* ---------------------------------------------------------------- helpers */
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'value') e.value = v;
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
async function api(path, opts = {}) {
  const init = { credentials: 'same-origin', method: opts.method || 'GET', headers: { 'X-Requested-With': 'portal' } };
  if (opts.json) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.json); }
  if (opts.form) init.body = opts.form;
  const r = await fetch('/api/' + path, init);
  let data = {}; try { data = await r.json(); } catch {}
  if (!r.ok) { const err = new Error(data.error || 'Request failed.'); err.status = r.status; throw err; }
  return data;
}
function toast(msg) { toastEl.textContent = msg; toastEl.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => toastEl.classList.remove('show'), 3200); }
const fmtDate = (s) => { if (!s) return ''; const d = new Date(s.length === 10 ? s + 'T00:00:00' : s); return isNaN(d) ? s : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };
const fmtSize = (n) => !n ? '' : n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
const fmtUsd = (n) => n == null ? '—' : 'USD ' + Number(n).toLocaleString('en-US');
const extOf = (n) => (n || '').split('.').pop().toUpperCase().slice(0, 5);
const badge = (map, key) => { const [t, c] = map[key] || [key, '']; return h('span', { class: 'badge ' + c }, t); };
function field(label, name, o = {}) {
  let input;
  if (o.options) { input = h('select', { name, required: o.required }, o.blank !== false ? h('option', { value: '' }, o.blank || 'Select…') : null, o.options.map((x) => { const [v, t] = Array.isArray(x) ? x : [x, x]; return h('option', { value: v, selected: String(o.value ?? '') === String(v) }, t); })); }
  else if (o.type === 'textarea') input = h('textarea', { name, required: o.required, maxlength: o.max || 2000, placeholder: o.placeholder }, o.value || '');
  else input = h('input', { name, type: o.type || 'text', required: o.required, autocomplete: o.autocomplete, maxlength: o.max, minlength: o.min, placeholder: o.placeholder, list: o.list, accept: o.accept, step: o.step, value: o.value ?? '' });
  return h('label', { class: 'field ' + (o.cls || '') }, h('span', {}, label, o.required ? '' : ' (optional)'), input, o.hint ? h('small', {}, o.hint) : null);
}
const fd = (form) => Object.fromEntries(new FormData(form).entries());
function busy(btn, on, text) { btn.disabled = on; if (text) btn.dataset.t = btn.dataset.t || btn.textContent; btn.textContent = on ? text : (btn.dataset.t || btn.textContent); }
function show(...nodes) { main.replaceChildren(...nodes); window.scrollTo(0, 0); }
const wrap = (...c) => h('div', { class: 'wrap page' }, ...c);
function errBox(msg) { return h('div', { class: 'notice bad', role: 'alert' }, msg); }

/* ---------------------------------------------------------------- chrome */
const NAV = [['#/', 'Dashboard'], ['#/sales', 'Sales'], ['#/presales', 'Presales'], ['#/technical', 'Technical'], ['#/spiff', 'SPIFF'], ['#/deals', 'Deals']];
function renderHeader() {
  const cur = location.hash || '#/';
  const link = ([href, t]) => h('li', {}, h('a', { class: 'nav-link', href, 'aria-current': (href === '#/' ? cur === '#/' : cur.startsWith(href)) ? 'page' : null }, t));
  const items = me ? [...NAV, ...(me.role === 'admin' ? [['#/admin', 'Admin']] : [])] : [];
  const nav = h('nav', { class: 'site-nav', id: 'site-nav', 'aria-label': 'Portal' }, h('ul', { class: 'nav-list' }, items.map(link), me ? h('li', {}, h('a', { class: 'nav-link', href: '#/account', 'aria-current': cur.startsWith('#/account') ? 'page' : null }, 'My account')) : null, me ? h('li', {}, h('button', { class: 'nav-link', type: 'button', onclick: logout }, 'Sign out')) : null));
  const theme = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Switch light or dark theme', title: 'Switch theme', onclick: toggleTheme }, themeIcon());
  const menu = h('button', { class: 'icon-btn menu-btn', type: 'button', 'aria-label': 'Menu', 'aria-expanded': 'false', 'aria-controls': 'site-nav', onclick: (e) => { const o = nav.classList.toggle('open'); e.currentTarget.setAttribute('aria-expanded', o); } }, '☰');
  header.replaceChildren(h('div', { class: 'wrap bar' },
    h('a', { class: 'logo', href: '#/', 'aria-label': 'Evanssion Partner Portal home' }, h('img', { class: 'logo-mark', src: '/mark.png', alt: '', width: 38, height: 38 }), h('span', { class: 'logo-word', role: 'img', 'aria-label': 'Evanssion' }), h('span', { class: 'logo-tag hide-sm' }, 'Partners')),
    nav, h('div', { class: 'bar-end' }, theme, menu)));
  nav.addEventListener('click', (e) => { if (e.target.closest('a')) nav.classList.remove('open'); });
}
function themeIcon() {
  const ns = 'http://www.w3.org/2000/svg'; const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '20'); s.setAttribute('height', '20'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2'); s.setAttribute('aria-hidden', 'true');
  const c = document.createElementNS(ns, 'circle'); c.setAttribute('cx', '12'); c.setAttribute('cy', '12'); c.setAttribute('r', '9');
  const pth = document.createElementNS(ns, 'path'); pth.setAttribute('d', 'M12 3a9 9 0 0 1 0 18z'); pth.setAttribute('fill', 'currentColor');
  s.append(c, pth); return s;
}
function toggleTheme() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark' || (!document.documentElement.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
  const n = dark ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', n);
  try { localStorage.setItem('evanssion-theme', n); } catch {}
}
async function logout() { try { await api('logout', { method: 'POST', json: {} }); } catch {} me = null; location.hash = '#/login'; }

/* ---------------------------------------------------------------- auth views */
function authShell(eyebrow, title, intro, ...body) {
  return h('div', { class: 'wrap' }, h('div', { class: 'auth' }, h('p', { class: 'eyebrow' }, eyebrow), h('h1', {}, title), intro ? h('p', { class: 'muted' }, intro) : null, h('div', { class: 'card stack' }, ...body)));
}
function submitter(fn, label, busyLabel) {
  const btn = h('button', { class: 'btn btn-primary', type: 'submit' }, label); const box = h('div', { 'aria-live': 'polite' });
  const form = (cls, ...kids) => { const f = h('form', { class: cls || 'form', novalidate: false }, ...kids, box, btn); f.addEventListener('submit', async (e) => { e.preventDefault(); box.replaceChildren(); busy(btn, true, busyLabel); try { await fn(f, box); } catch (x) { box.replaceChildren(errBox(x.message)); } busy(btn, false); }); return f; };
  return { form, box };
}
function loginView() {
  const { form } = submitter(async (f) => { const r = await api('login', { method: 'POST', json: fd(f) }); me = r.user; location.hash = '#/'; }, 'Sign in', 'Signing in…');
  show(authShell('Partner Portal', 'Sign in', 'Resources, SPIFF programmes and deal registration for approved Evanssion partners.',
    form('form', field('Work email', 'email', { type: 'email', required: true, autocomplete: 'username' }), field('Password', 'password', { type: 'password', required: true, autocomplete: 'current-password' })),
    h('div', { class: 'row between small' }, h('a', { href: '#/forgot' }, 'Forgot password?'), h('a', { href: '#/register' }, 'Request partner access'))));
}
function registerView() {
  const { form } = submitter(async (f, box) => { await api('register', { method: 'POST', json: fd(f) }); f.replaceWith(h('div', { class: 'notice ok', role: 'status' }, h('b', {}, 'Request received. '), 'The Evanssion team reviews every request. You will get an email when your access is approved, usually within one business day.')); }, 'Request access', 'Sending…');
  show(authShell('Partner Portal', 'Request partner access', 'Access is for Evanssion channel partners. We approve each request manually.',
    form('form two', field('Full name', 'name', { required: true, autocomplete: 'name', max: 100 }), field('Company', 'company', { required: true, autocomplete: 'organization', max: 140 }),
      field('Work email', 'email', { type: 'email', required: true, autocomplete: 'email', cls: 'full', hint: 'Please use your company address, not a personal one.' }),
      field('Country', 'country', { required: true, autocomplete: 'country-name', max: 80 }), field('Phone', 'phone', { type: 'tel', autocomplete: 'tel', max: 40 }),
      field('Password', 'password', { type: 'password', required: true, min: 10, autocomplete: 'new-password', cls: 'full', hint: 'At least 10 characters.' }),
      h('div', { class: 'hp', 'aria-hidden': 'true' }, h('input', { name: 'website_url', tabindex: '-1', autocomplete: 'off' }))),
    h('p', { class: 'small' }, 'Already approved? ', h('a', { href: '#/login' }, 'Sign in'))));
}
function forgotView() {
  const { form } = submitter(async (f) => { await api('forgot', { method: 'POST', json: fd(f) }); f.replaceWith(h('div', { class: 'notice ok', role: 'status' }, 'If that address has an approved account, a reset link is on its way. It works for one hour.')); }, 'Email me a reset link', 'Sending…');
  show(authShell('Partner Portal', 'Reset your password', null, form('form', field('Work email', 'email', { type: 'email', required: true, autocomplete: 'username' })), h('p', { class: 'small' }, h('a', { href: '#/login' }, 'Back to sign in'))));
}
function resetView(token) {
  const { form } = submitter(async (f) => { await api('reset', { method: 'POST', json: { token, password: fd(f).password } }); f.replaceWith(h('div', { class: 'notice ok', role: 'status' }, 'Password updated. ', h('a', { href: '#/login' }, 'Sign in'))); }, 'Save password', 'Saving…');
  show(authShell('Partner Portal', 'Choose a new password', null, form('form', field('New password', 'password', { type: 'password', required: true, min: 10, autocomplete: 'new-password', hint: 'At least 10 characters.' }))));
}
function setupView() {
  const { form } = submitter(async (f) => { await api('setup', { method: 'POST', json: fd(f) }); f.replaceWith(h('div', { class: 'notice ok', role: 'status' }, 'Administrator created. ', h('a', { href: '#/login' }, 'Sign in'), '. Now delete the SETUP_TOKEN variable in Cloudflare.')); }, 'Create administrator', 'Creating…');
  show(authShell('First-time setup', 'Create the administrator', 'Only works while no administrator exists.',
    form('form', field('Setup token', 'token', { type: 'password', required: true, autocomplete: 'off' }), field('Your name', 'name', { required: true }), field('Email', 'email', { type: 'email', required: true }), field('Password', 'password', { type: 'password', required: true, min: 10, autocomplete: 'new-password' }))));
}

/* ---------------------------------------------------------------- dashboard */
async function dashboardView() {
  const s = await api('summary');
  const tile = (href, title, n, note) => h('a', { class: 'card', href }, h('p', { class: 'eyebrow' }, title), h('p', { class: 'stat' }, String(n)), h('p', { class: 'muted small' }, note));
  const mine = s.myDeals || {}; const total = Object.values(mine).reduce((a, b) => a + b, 0);
  const admin = me.role === 'admin' ? h('div', { class: 'card plain stack' }, h('h2', {}, 'Needs your attention'), h('div', { class: 'row' },
    h('a', { class: 'btn btn-secondary', href: '#/admin/users' }, `Access requests: ${s.pendingUsers}`), h('a', { class: 'btn btn-secondary', href: '#/admin/deals' }, `Deals to review: ${s.pendingDeals}`), h('a', { class: 'btn btn-secondary', href: '#/admin/content' }, 'Manage content'))) : null;
  show(wrap(
    h('div', { class: 'page-head' }, h('div', {}, h('p', { class: 'eyebrow' }, me.company), h('h1', {}, `Welcome, ${me.name.split(' ')[0]}`), h('p', { class: 'muted' }, 'Everything you need to sell Evanssion vendors across the region.'))),
    admin,
    h('div', { class: 'grid cols-3' },
      tile('#/sales', 'Sales', s.counts.sales || 0, 'Decks, one-pagers, battlecards'), tile('#/presales', 'Presales', s.counts.presales || 0, 'Solution briefs, demo guides'),
      tile('#/technical', 'Technical', s.counts.technical || 0, 'Datasheets, deployment guides'), tile('#/spiff', 'Active SPIFFs', s.activeSpiffs, 'Incentives running now'),
      tile('#/deals', 'Your registrations', total, total ? `${mine.approved || 0} approved · ${(mine.submitted || 0) + (mine.info || 0)} open` : 'Register your first deal')),
    h('div', { class: 'stack' }, h('h2', {}, 'Recently added'),
      s.latest.length ? h('div', { class: 'grid cols-2' }, s.latest.map((x) => h('a', { class: 'card', href: '#/' + x.category }, h('div', { class: 'meta' }, h('span', { class: 'chip' }, CATS[x.category]), x.vendor ? h('span', { class: 'muted small' }, x.vendor) : null), h('h3', {}, x.title), h('p', { class: 'muted small' }, 'Added ' + fmtDate(x.created_at))))) : h('p', { class: 'muted' }, 'Content is being added. Check back soon.'))));
}

/* ---------------------------------------------------------------- resources */
function openBtn(x) {
  if (x.kind === 'link') return h('a', { class: 'btn btn-primary btn-sm', href: x.url, target: '_blank', rel: 'noopener noreferrer' }, 'Open link');
  const dl = h('a', { class: 'btn btn-primary btn-sm', href: `/api/files/${x.file_id || ''}`, download: x.file_name || '' }, `Download ${extOf(x.file_name)} · ${fmtSize(x.file_size)}`);
  return dl;
}
function spiffState(x) {
  const today = new Date().toISOString().slice(0, 10);
  if (x.starts && x.starts > today) return 'upcoming'; if (x.ends && x.ends < today) return 'ended'; return 'active';
}
async function resourcesView(cat) {
  const r = await api('resources?category=' + cat);
  const items = r.items;
  const list = h('div', { class: 'stack' });
  const q = h('input', { type: 'search', placeholder: 'Search title or description', 'aria-label': 'Search' });
  const vend = h('select', { 'aria-label': 'Vendor' }, h('option', { value: '' }, 'All vendors'), [...new Set(items.map((x) => x.vendor).filter(Boolean))].sort().map((v) => h('option', { value: v }, v)));
  const draw = () => {
    const t = q.value.toLowerCase(); const v = vend.value;
    const rows = items.filter((x) => (!v || x.vendor === v) && (!t || (x.title + ' ' + x.description + ' ' + x.vendor).toLowerCase().includes(t)));
    if (!rows.length) { list.replaceChildren(h('div', { class: 'empty' }, items.length ? 'Nothing matches your search.' : 'Content for this section is being added. Check back soon.')); return; }
    if (cat === 'spiff') {
      const g = { active: [], upcoming: [], ended: [] }; rows.forEach((x) => g[spiffState(x)].push(x));
      list.replaceChildren(...[['active', 'Active now'], ['upcoming', 'Starting soon'], ['ended', 'Ended']].filter(([k]) => g[k].length).map(([k, t]) => h('section', { class: 'stack' }, h('h2', {}, t), h('div', { class: 'grid cols-2' }, g[k].map((x) => spiffCard(x, k))))));
    } else list.replaceChildren(h('div', { class: 'grid cols-2' }, rows.map(resCard)));
  };
  q.addEventListener('input', draw); vend.addEventListener('change', draw);
  show(wrap(h('div', { class: 'page-head' }, h('div', {}, h('p', { class: 'eyebrow' }, 'Resources'), h('h1', {}, CATS[cat]), h('p', { class: 'muted' }, CAT_BLURB[cat]))),
    h('div', { class: 'toolbar' }, h('div', { class: 'field' }, q), h('div', { class: 'field' }, vend)), list));
  draw();
}
const resCard = (x) => h('article', { class: 'card item' }, h('div', { class: 'meta' }, x.vendor ? h('span', { class: 'chip' }, x.vendor) : null, x.kind === 'file' ? h('span', { class: 'muted small' }, extOf(x.file_name)) : h('span', { class: 'muted small' }, 'Link')), h('h3', {}, x.title), x.description ? h('p', { class: 'muted' }, x.description) : null, h('div', { class: 'row' }, openBtn(x), x.file_type === 'application/pdf' ? h('a', { class: 'btn btn-secondary btn-sm', href: `/api/files/${x.file_id}?inline=1`, target: '_blank', rel: 'noopener' }, 'View') : null), h('p', { class: 'muted small' }, 'Added ' + fmtDate(x.created_at)));
function spiffCard(x, state) {
  const days = x.ends ? Math.ceil((new Date(x.ends + 'T23:59:59') - Date.now()) / 86400000) : null;
  return h('article', { class: 'card item' }, h('div', { class: 'meta' }, x.vendor ? h('span', { class: 'chip' }, x.vendor) : null, state === 'active' ? h('span', { class: 'badge ok' }, days != null && days <= 14 ? `Ends in ${days} day${days === 1 ? '' : 's'}` : 'Active') : state === 'upcoming' ? h('span', { class: 'badge warn' }, 'Starts ' + fmtDate(x.starts)) : h('span', { class: 'badge' }, 'Ended')),
    h('h3', {}, x.title), x.reward ? h('p', { class: 'reward' }, x.reward) : null, x.description ? h('p', { class: 'muted' }, x.description) : null,
    h('p', { class: 'small' }, [x.starts ? 'From ' + fmtDate(x.starts) : '', x.ends ? 'until ' + fmtDate(x.ends) : 'no end date'].filter(Boolean).join(' ')),
    (x.file_name || x.url) ? h('div', { class: 'row' }, openBtn(x)) : null);
}

/* ---------------------------------------------------------------- deals */
async function dealsView() {
  const r = await api('deals'); deals = r.items;
  show(wrap(h('div', { class: 'page-head' }, h('div', {}, h('p', { class: 'eyebrow' }, 'Deal registration'), h('h1', {}, 'Your registrations'), h('p', { class: 'muted' }, 'Register an opportunity before you engage the customer. Approved registrations are protected for 90 days.')), h('a', { class: 'btn btn-primary', href: '#/deals/new' }, 'Register a deal')),
    deals.length ? h('div', { class: 'stack' }, deals.map((d) => dealCard(d, false))) : h('div', { class: 'empty' }, 'You have not registered any deals yet.')));
}
function dealCard(d, admin) {
  const dl = h('dl', { class: 'dl' }, ...[['Customer', `${d.customer}${d.customer_city ? ', ' + d.customer_city : ''}, ${d.customer_country}`], ['Contact', [d.contact_name, d.contact_email, d.contact_phone].filter(Boolean).join(' · ')], ['Industry', d.industry], ['Vendor / product', [d.vendor, d.product].filter(Boolean).join(' — ')], ['Estimated value', d.value_usd != null ? fmtUsd(d.value_usd) : ''], ['Expected close', fmtDate(d.expected_close)], ['Notes', d.notes], ...(admin ? [['Partner', `${d.partner_company} · ${d.partner_name} · ${d.partner_email}`]] : []), ['Submitted', fmtDate(d.created_at)], d.protected_until ? ['Protected until', fmtDate(d.protected_until)] : null].filter((x) => x && x[1]).flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
  return h('article', { class: 'card item' }, h('div', { class: 'meta between row' }, h('div', { class: 'meta' }, h('b', {}, d.ref), badge(DEAL_LABEL, d.status), admin && d.conflicts ? h('span', { class: 'badge bad' }, `${d.conflicts} possible conflict${d.conflicts > 1 ? 's' : ''}`) : null), h('span', { class: 'muted small' }, fmtDate(d.updated_at))),
    h('h3', {}, `${d.customer} · ${d.vendor}`), d.admin_note ? h('div', { class: 'notice ' + (d.status === 'approved' ? 'ok' : 'warn') }, h('b', {}, 'Evanssion: '), d.admin_note) : null,
    h('details', {}, h('summary', {}, 'Details'), dl),
    !admin && d.status === 'info' ? h('div', {}, h('a', { class: 'btn btn-primary btn-sm', href: '#/deals/edit/' + d.id }, 'Update and resubmit')) : null);
}
async function dealForm(id) {
  if (id && !deals.length) deals = (await api('deals')).items;
  const d = id ? deals.find((x) => x.id === +id) : null;
  if (id && (!d || d.status !== 'info')) { location.hash = '#/deals'; return; }
  const v = d || {};
  const vendorOpts = [...new Set([...VENDORS, v.vendor].filter(Boolean))].sort();
  const { form } = submitter(async (f) => { const body = fd(f); const r = await api(id ? 'deals/' + id : 'deals', { method: id ? 'PUT' : 'POST', json: body }); toast(id ? 'Registration updated' : `Submitted as ${r.ref}`); location.hash = '#/deals'; }, id ? 'Resubmit' : 'Submit registration', 'Submitting…');
  show(wrap(h('div', { class: 'page-head' }, h('div', {}, h('p', { class: 'eyebrow' }, 'Deal registration'), h('h1', {}, id ? 'Update registration' : 'Register a deal'), h('p', { class: 'muted' }, id && v.admin_note ? 'Evanssion asked: ' + v.admin_note : 'Evanssion reviews every registration. You will get an email with the decision.'))),
    h('div', { class: 'card plain' }, form('form',
      h('fieldset', { class: 'form two' }, h('legend', { class: 'full' }, 'Customer'), field('Customer company', 'customer', { required: true, max: 160, value: v.customer }), field('Industry', 'industry', { max: 80, value: v.industry }), field('Country', 'customer_country', { required: true, max: 80, value: v.customer_country }), field('City', 'customer_city', { max: 80, value: v.customer_city })),
      h('fieldset', { class: 'form two' }, h('legend', { class: 'full' }, 'Customer contact'), field('Contact name', 'contact_name', { required: true, max: 100, value: v.contact_name }), field('Contact email', 'contact_email', { type: 'email', max: 160, value: v.contact_email }), field('Contact phone', 'contact_phone', { type: 'tel', max: 40, value: v.contact_phone })),
      h('fieldset', { class: 'form two' }, h('legend', { class: 'full' }, 'Opportunity'), field('Vendor', 'vendor', { required: true, options: vendorOpts, value: v.vendor }), field('Product or solution', 'product', { max: 120, value: v.product }), field('Estimated value (USD)', 'value_usd', { type: 'number', step: '1', value: v.value_usd }), field('Expected close date', 'expected_close', { type: 'date', value: v.expected_close }), field('Notes', 'notes', { type: 'textarea', cls: 'full', value: v.notes, hint: 'Customer need, competition, timeline, anything that helps us support you.' }))))));
}

/* ---------------------------------------------------------------- account */
function accountView() {
  const a = submitter(async (f) => { await api('account', { method: 'POST', json: fd(f) }); me = (await api('me')).user; toast('Details saved'); }, 'Save details', 'Saving…');
  const p = submitter(async (f) => { await api('password', { method: 'POST', json: fd(f) }); f.reset(); toast('Password changed'); }, 'Change password', 'Saving…');
  show(wrap(h('div', { class: 'page-head' }, h('div', {}, h('p', { class: 'eyebrow' }, 'My account'), h('h1', {}, me.name))),
    h('div', { class: 'grid cols-2' },
      h('div', { class: 'card plain stack' }, h('h2', {}, 'Details'), h('p', { class: 'muted small' }, `${me.email} · ${me.company}. To change your company or email, contact the Evanssion team.`), a.form('form', field('Full name', 'name', { required: true, value: me.name, max: 100 }), field('Country', 'country', { required: true, value: me.country, max: 80 }), field('Phone', 'phone', { type: 'tel', value: me.phone, max: 40 }))),
      h('div', { class: 'card plain stack' }, h('h2', {}, 'Password'), p.form('form', field('Current password', 'current', { type: 'password', required: true, autocomplete: 'current-password' }), field('New password', 'password', { type: 'password', required: true, min: 10, autocomplete: 'new-password', hint: 'At least 10 characters.' }))))));
}

/* ---------------------------------------------------------------- admin */
function adminTabs(cur) { return h('div', { class: 'tabs' }, [['users', 'Access requests & users'], ['deals', 'Deal registrations'], ['content', 'Content'], ['activity', 'Activity']].map(([k, t]) => h('a', { class: 'tab', href: '#/admin/' + k, 'aria-current': k === cur ? 'page' : null }, t))); }
async function adminUsers() {
  const r = await api('admin/users'); let filter = 'pending';
  const sel = h('select', { 'aria-label': 'Filter' }, [['pending', 'Awaiting approval'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['suspended', 'Suspended'], ['all', 'Everyone']].map(([v, t]) => h('option', { value: v }, t)));
  const list = h('div', { class: 'stack' });
  const act = async (u, action, extra = {}) => { try { await api('admin/users/' + u.id, { method: 'POST', json: { action, ...extra } }); toast('Done'); adminUsers(); } catch (e) { toast(e.message); } };
  const draw = () => {
    const rows = r.items.filter((u) => filter === 'all' || u.status === filter);
    list.replaceChildren(...(rows.length ? rows.map((u) => {
      const co = h('input', { value: u.company, 'aria-label': 'Company', maxlength: 140 }); const box = h('div', { 'aria-live': 'polite' });
      return h('article', { class: 'card item' }, h('div', { class: 'meta' }, h('b', {}, u.name), badge(USER_LABEL, u.status), u.role === 'admin' ? h('span', { class: 'badge' }, 'Administrator') : null),
        h('dl', { class: 'dl' }, h('dt', {}, 'Email'), h('dd', {}, u.email), h('dt', {}, 'Country · phone'), h('dd', {}, [u.country, u.phone].filter(Boolean).join(' · ') || '—'), h('dt', {}, 'Requested'), h('dd', {}, fmtDate(u.created_at)), h('dt', {}, 'Last sign-in'), h('dd', {}, u.last_login ? fmtDate(u.last_login) : 'never')),
        h('label', { class: 'field' }, h('span', {}, 'Company (edit before approving if needed)'), co),
        h('div', { class: 'row' },
          u.status !== 'approved' ? h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => act(u, 'approve', { company: co.value }) }, 'Approve') : h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => act(u, 'company', { company: co.value }) }, 'Save company'),
          u.status === 'pending' ? h('button', { class: 'btn btn-danger btn-sm', type: 'button', onclick: () => act(u, 'reject') }, 'Reject') : null,
          u.status === 'approved' && u.id !== me.id ? h('button', { class: 'btn btn-danger btn-sm', type: 'button', onclick: () => confirm(`Suspend ${u.name}? They will be signed out.`) && act(u, 'suspend') }, 'Suspend') : null,
          u.status === 'approved' && u.role === 'partner' ? h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => confirm(`Make ${u.name} an administrator?`) && act(u, 'promote') }, 'Make administrator') : null,
          u.status === 'approved' && u.role === 'admin' && u.id !== me.id ? h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => act(u, 'demote') }, 'Remove administrator') : null,
          u.status === 'approved' ? h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: async () => { try { const r = await api('admin/users/' + u.id, { method: 'POST', json: { action: 'reset_link' } }); box.replaceChildren(h('div', { class: 'notice ok', role: 'status' }, h('b', {}, 'Reset link (valid 24 hours, also emailed): '), h('br'), h('input', { value: r.link, readonly: true, 'aria-label': 'Reset link', onfocus: (e) => e.target.select() }))); } catch (e) { toast(e.message); } } }, 'Reset password') : null,
          h('a', { class: 'btn btn-secondary btn-sm', href: '#/admin/activity/' + u.id }, 'Activity'),
          u.id !== me.id ? h('button', { class: 'btn btn-danger btn-sm', type: 'button', onclick: () => confirm(`Remove ${u.name} permanently? Their account, sign-in history and access are deleted. Their deal registrations stay on record. To block access but keep the record, use Suspend instead.`) && act(u, 'delete') }, 'Remove user') : null), box);
    }) : [h('div', { class: 'empty' }, 'Nobody in this list.')]));
  };
  sel.addEventListener('change', () => { filter = sel.value; draw(); });
  show(wrap(h('div', { class: 'page-head' }, h('div', {}, h('p', { class: 'eyebrow' }, 'Admin'), h('h1', {}, 'Users'))), adminTabs('users'), h('div', { class: 'toolbar' }, h('div', { class: 'field' }, sel)), list)); draw();
}
async function adminDeals() {
  let filter = 'submitted';
  const list = h('div', { class: 'stack' });
  const sel = h('select', { 'aria-label': 'Filter' }, [['submitted', 'Under review'], ['info', 'Waiting for partner'], ['approved', 'Approved'], ['rejected', 'Not approved'], ['', 'All']].map(([v, t]) => h('option', { value: v }, t)));
  const load = async () => {
    const r = await api('deals' + (filter ? '?status=' + filter : ''));
    list.replaceChildren(...(r.items.length ? r.items.map((d) => {
      const note = h('textarea', { 'aria-label': 'Note to partner', placeholder: 'Note to the partner (required unless approving)', maxlength: 1000 });
      const dec = async (status) => { try { await api('admin/deals/' + d.id, { method: 'POST', json: { status, note: note.value } }); toast('Decision sent'); load(); } catch (e) { toast(e.message); } };
      return h('div', { class: 'stack' }, dealCard(d, true), (d.status === 'submitted' || d.status === 'info') ? h('div', { class: 'card plain stack' }, note, h('div', { class: 'row' }, h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => dec('approved') }, 'Approve (90-day protection)'), h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => dec('info') }, 'Ask for information'), h('button', { class: 'btn btn-danger btn-sm', type: 'button', onclick: () => dec('rejected') }, 'Reject'))) : null);
    }) : [h('div', { class: 'empty' }, 'No deal registrations here.')]));
  };
  sel.addEventListener('change', () => { filter = sel.value; load(); });
  show(wrap(h('div', { class: 'page-head' }, h('div', {}, h('p', { class: 'eyebrow' }, 'Admin'), h('h1', {}, 'Deal registrations'))), adminTabs('deals'), h('div', { class: 'toolbar' }, h('div', { class: 'field' }, sel)), list)); await load();
}
async function adminContent() {
  const r = await api('admin/resources'); const items = r.items;
  const state = { id: null };
  const formHost = h('div', { class: 'card plain' });
  const list = h('div', { class: 'stack' });
  const drawForm = (x = {}) => {
    state.id = x.id || null; let kind = x.kind || 'file';
    const catSel = field('Section', 'category', { required: true, blank: false, options: Object.entries(CATS), value: x.category || 'sales' });
    const spiffBox = h('div', { class: 'form two full' }, field('Reward', 'reward', { max: 200, value: x.reward, placeholder: 'e.g. USD 500 per qualifying deal', cls: 'full' }), field('Starts', 'starts', { type: 'date', value: x.starts }), field('Ends', 'ends', { type: 'date', value: x.ends }));
    const fileBox = h('div', { class: 'full' }), linkBox = h('div', { class: 'full' });
    fileBox.append(field('File', 'file', { type: 'file', required: false, accept: '.pdf,.pptx,.ppt,.docx,.doc,.xlsx,.xls,.zip,.png,.jpg,.jpeg,.mp4,.csv,.txt', hint: x.file_name ? `Current: ${x.file_name}. Choose a file only to replace it. Max 25 MB.` : 'PDF, PowerPoint, Word, Excel, ZIP, images. Max 25 MB.' }));
    linkBox.append(field('Link', 'url', { type: 'url', value: x.url, placeholder: 'https://…' }));
    const kindSel = field('Delivered as', 'kind', { required: true, blank: false, options: [['file', 'Uploaded file'], ['link', 'External link']], value: kind });
    const sync = () => { const k = kindSel.querySelector('select').value; fileBox.hidden = k !== 'file'; linkBox.hidden = k !== 'link'; spiffBox.hidden = catSel.querySelector('select').value !== 'spiff'; };
    kindSel.addEventListener('change', sync); catSel.addEventListener('change', sync);
    const pub = h('label', { class: 'field check' }, h('input', { type: 'checkbox', name: 'published', checked: x.published !== 0 }), h('span', {}, 'Visible to partners'));
    const { form } = submitter(async (f) => {
      const data = new FormData(f); data.set('published', f.elements.published.checked ? '1' : '0');
      if (data.get('kind') === 'link') data.delete('file');
      await api(state.id ? 'admin/resources/' + state.id : 'admin/resources', { method: state.id ? 'PUT' : 'POST', form: data });
      toast(state.id ? 'Saved' : 'Added'); adminContent();
    }, x.id ? 'Save changes' : 'Add to portal', 'Uploading…');
    const f = form('form two', h('h2', { class: 'full' }, x.id ? 'Edit item' : 'Add content'), catSel,
      field('Vendor', 'vendor', { max: 80, list: 'vendors', value: x.vendor }), field('Title', 'title', { required: true, max: 160, cls: 'full', value: x.title }),
      field('Description', 'description', { type: 'textarea', max: 1500, cls: 'full', value: x.description }), spiffBox, kindSel, pub, fileBox, linkBox,
      h('datalist', { id: 'vendors' }, [...new Set([...VENDORS, ...items.map((i) => i.vendor).filter(Boolean)])].sort().map((v) => h('option', { value: v }))));
    if (x.id) f.append(h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => { drawForm(); } }, 'Cancel edit'));
    formHost.replaceChildren(f); sync();
  };
  const drawList = () => {
    list.replaceChildren(...(items.length ? items.map((x) => h('article', { class: 'card item' }, h('div', { class: 'meta' }, h('span', { class: 'chip' }, CATS[x.category]), x.vendor ? h('span', { class: 'muted small' }, x.vendor) : null, x.published ? null : h('span', { class: 'badge warn' }, 'Hidden')),
      h('h3', {}, x.title), h('p', { class: 'muted small' }, x.kind === 'file' ? `${x.file_name || 'no file'} · ${fmtSize(x.file_size)}` : x.url, x.category === 'spiff' && (x.starts || x.ends) ? ` · ${fmtDate(x.starts) || '…'} to ${fmtDate(x.ends) || '…'}` : ''),
      h('div', { class: 'row' }, h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => { drawForm(x); formHost.scrollIntoView({ behavior: 'smooth' }); } }, 'Edit'),
        h('button', { class: 'btn btn-danger btn-sm', type: 'button', onclick: async () => { if (!confirm(`Delete “${x.title}” permanently?`)) return; try { await api('admin/resources/' + x.id, { method: 'DELETE', json: {} }); toast('Deleted'); adminContent(); } catch (e) { toast(e.message); } } }, 'Delete')))) : [h('div', { class: 'empty' }, 'Nothing yet. Add your first item above.')]));
  };
  show(wrap(h('div', { class: 'page-head' }, h('div', {}, h('p', { class: 'eyebrow' }, 'Admin'), h('h1', {}, 'Content'))), adminTabs('content'), formHost, h('h2', {}, `All items (${items.length})`), list)); drawForm(); drawList();
}

async function adminActivity(uid) {
  const users = (await api('admin/users')).items; let user = uid || ''; let action = '';
  const usel = h('select', { 'aria-label': 'Person' }, h('option', { value: '' }, 'Everyone'), users.map((u) => h('option', { value: u.id, selected: String(u.id) === String(user) }, `${u.name} (${u.company})`)));
  const asel = h('select', { 'aria-label': 'Type' }, [['', 'All activity'], ['login', 'Sign-ins'], ['login_failed', 'Failed sign-ins'], ['view', 'Pages viewed'], ['download', 'Downloads'], ['deal_submit', 'Deals submitted'], ['admin', 'Admin actions'], ['logout', 'Sign-outs']].map(([v, t]) => h('option', { value: v }, t)));
  const host = h('div', {});
  const LBL = { login: 'Signed in', login_failed: 'Failed sign-in', logout: 'Signed out', view: 'Viewed', download: 'Downloaded', deal_submit: 'Submitted deal', admin: 'Admin action' };
  const load = async () => {
    const r = await api(`admin/activity?user=${user}&action=${action}`);
    host.replaceChildren(r.items.length ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['When', 'Who', 'What', 'Detail', 'From'].map((t) => h('th', { scope: 'col' }, t)))), h('tbody', {}, r.items.map((x) => h('tr', {}, h('td', {}, new Date(x.ts).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })), h('td', {}, x.name ? `${x.name} · ${x.company}` : (x.email || '—')), h('td', {}, LBL[x.action] || x.action), h('td', {}, x.detail), h('td', {}, [x.country, x.ip].filter(Boolean).join(' · ')))))))
      : h('div', { class: 'empty' }, 'No activity recorded yet.'));
  };
  usel.addEventListener('change', () => { user = usel.value; load(); }); asel.addEventListener('change', () => { action = asel.value; load(); });
  show(wrap(h('div', { class: 'page-head' }, h('div', {}, h('p', { class: 'eyebrow' }, 'Admin'), h('h1', {}, 'Activity'), h('p', { class: 'muted' }, 'The latest 300 events. Records are kept for 180 days. Sign-ins, pages viewed, downloads, deals and admin actions.'))), adminTabs('activity'), h('div', { class: 'toolbar' }, h('div', { class: 'field' }, usel), h('div', { class: 'field' }, asel)), host)); await load();
}

/* ---------------------------------------------------------------- router */
async function route() {
  const hash = location.hash || '#/'; const [, p1, p2, p3] = hash.split('/');
  if (status === null) { try { status = await api('status'); } catch (e) { show(wrap(errBox(e.message))); return; } }
  if (me === null && !['login', 'register', 'forgot', 'reset', 'setup'].includes(p1)) { try { me = (await api('me')).user; } catch { me = false; } }
  renderHeader();
  const open = ['login', 'register', 'forgot', 'reset', 'setup'];
  if (!me && !open.includes(p1)) { location.hash = status.needsSetup && status.setupEnabled ? '#/setup' : '#/login'; return; }
  if (me && open.includes(p1) && p1 !== 'reset') { location.hash = '#/'; return; }
  renderHeader();
  try {
    if (!p1) return await dashboardView();
    if (p1 === 'login') return loginView(); if (p1 === 'register') return registerView(); if (p1 === 'forgot') return forgotView(); if (p1 === 'reset') return resetView(p2 || ''); if (p1 === 'setup') return setupView();
    if (['sales', 'presales', 'technical', 'spiff'].includes(p1)) return await resourcesView(p1);
    if (p1 === 'deals') return p2 === 'new' ? await dealForm() : p2 === 'edit' ? await dealForm(p3) : await dealsView();
    if (p1 === 'account') return accountView();
    if (p1 === 'admin') { if (me.role !== 'admin') { location.hash = '#/'; return; } return p2 === 'activity' ? await adminActivity(p3) : p2 === 'deals' ? await adminDeals() : p2 === 'content' ? await adminContent() : await adminUsers(); }
    show(wrap(h('h1', {}, 'Page not found'), h('p', { class: 'muted' }, h('a', { href: '#/' }, 'Back to the dashboard'))));
  } catch (e) {
    if (e.status === 401) { me = false; location.hash = '#/login'; return; }
    show(wrap(errBox(e.message)));
  }
  main.focus({ preventScroll: true });
}
window.addEventListener('hashchange', route);
route();
})();
