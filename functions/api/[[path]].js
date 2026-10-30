import {
  now, nowSec, randToken, sha256, hashPw, checkPw, json, fail, HttpError, readCookie, cookieName, sessionCookie,
  clean, isEmail, isDate, esc, blocked, bump, clearKey, sendMail, mailShell, EXT, MAX_FILE,
} from '../../src/lib.js';

const SESSION_DAYS = 7;
const CATS = ['sales', 'presales', 'technical', 'spiff'];
const DEAL_STATUS = ['submitted', 'approved', 'rejected', 'info'];
const USER_STATUS = ['pending', 'approved', 'rejected', 'suspended'];

export async function onRequest(ctx) {
  const { request, env } = ctx;
  const url = new URL(request.url);
  const seg = (ctx.params.path || []).map(String);
  try {
    if (!env.DB) fail(500, 'The database is not connected yet (binding DB missing).');
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const origin = request.headers.get('Origin');
      if (origin && origin !== url.origin) fail(403, 'Cross-site request refused.');
      if (request.headers.get('X-Requested-With') !== 'portal') fail(403, 'Missing request header.');
    }
    return await route(ctx, request, env, url, seg);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: 'Something went wrong on our side. Please try again.' }, 500);
  }
}

async function body(request) {
  try { return await request.json(); } catch { return fail(400, 'Invalid request.'); }
}
const ip = (r) => r.headers.get('CF-Connecting-IP') || 'local';
const pub = (u) => ({ id: u.id, email: u.email, name: u.name, company: u.company, phone: u.phone, country: u.country, role: u.role, status: u.status, created_at: u.created_at, approved_at: u.approved_at, last_login: u.last_login });

async function sessionUser(request, env, url) {
  const tok = readCookie(request, cookieName(url));
  if (!tok) return null;
  const s = await env.DB.prepare('SELECT user_id, expires FROM sessions WHERE id = ?').bind(await sha256(tok)).first();
  if (!s || s.expires < nowSec()) return null;
  const u = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(s.user_id).first();
  return u && u.status === 'approved' ? u : null;
}
async function startSession(env, url, user) {
  const tok = randToken();
  await env.DB.prepare('INSERT INTO sessions (id, user_id, expires) VALUES (?, ?, ?)').bind(await sha256(tok), user.id, nowSec() + SESSION_DAYS * 86400).run();
  await env.DB.prepare('UPDATE users SET last_login = ? WHERE id = ?').bind(now(), user.id).run();
  await env.DB.prepare('DELETE FROM sessions WHERE expires < ?').bind(nowSec()).run();
  return sessionCookie(url, tok, SESSION_DAYS * 86400);
}
function track(ctx, env, request, user, action, detail = '', email = '') {
  const p = env.DB.prepare('INSERT INTO activity (ts, user_id, email, action, detail, ip, country) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(now(), user ? user.id : null, user ? user.email : email, action, String(detail).slice(0, 300), ip(request), request.headers.get('CF-IPCountry') || '').run().catch(() => {});
  ctx.waitUntil(p);
}
const adminMail = (env) => env.PORTAL_ADMIN_EMAIL || env.LEAD_TO || 'sales@evanssion.com';
const checkPwPolicy = (pw) => { if (typeof pw !== 'string' || pw.length < 10) fail(400, 'Use a password of at least 10 characters.'); if (pw.length > 200) fail(400, 'Password is too long.'); };

async function route(ctx, request, env, url, seg) {
  const m = request.method;
  const [a, b, c] = seg;

  /* ---------------------------------------------------------------- public */
  if (a === 'status' && m === 'GET') {
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").first();
    return json({ ok: true, needsSetup: n.n === 0, setupEnabled: !!env.SETUP_TOKEN, email: !!env.RESEND_API_KEY, files: !!env.FILES });
  }

  if (a === 'setup' && m === 'POST') {
    const d = await body(request);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").first();
    if (n.n > 0) fail(403, 'Setup is already complete.');
    if (!env.SETUP_TOKEN || clean(d.token, 200) !== env.SETUP_TOKEN) {
      await bump(env, 'setup:' + ip(request), 900);
      if (await blocked(env, 'setup:' + ip(request), 5, 900)) fail(429, 'Too many attempts.');
      fail(403, 'Setup token is not correct.');
    }
    const email = clean(d.email, 160).toLowerCase(); const name = clean(d.name, 100);
    if (!isEmail(email) || !name) fail(400, 'Enter your name and a valid email.');
    checkPwPolicy(d.password);
    await env.DB.prepare("INSERT INTO users (email, name, company, role, status, pw, created_at, approved_at) VALUES (?, ?, 'Evanssion FZCO', 'admin', 'approved', ?, ?, ?)")
      .bind(email, name, await hashPw(d.password), now(), now()).run();
    return json({ ok: true });
  }

  if (a === 'register' && m === 'POST') {
    const key = 'reg:' + ip(request);
    if (await blocked(env, key, 5, 3600)) fail(429, 'Too many requests from this network. Please try again later.');
    const d = await body(request);
    if (clean(d.website_url)) return json({ ok: true }); // honeypot
    const email = clean(d.email, 160).toLowerCase(); const name = clean(d.name, 100); const company = clean(d.company, 140);
    const phone = clean(d.phone, 40); const country = clean(d.country, 80);
    if (!name || !company || !country || !isEmail(email)) fail(400, 'Please complete name, company, country and a valid work email.');
    checkPwPolicy(d.password);
    await bump(env, key, 3600);
    const exists = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
    if (!exists) {
      await env.DB.prepare("INSERT INTO users (email, name, company, phone, country, role, status, pw, created_at) VALUES (?, ?, ?, ?, ?, 'partner', 'pending', ?, ?)")
        .bind(email, name, company, phone, country, await hashPw(d.password), now()).run();
      ctx.waitUntil(sendMail(env, { to: adminMail(env), subject: `Partner access request: ${company}`, replyTo: email,
        html: mailShell('New partner access request', `<p><b>${esc(name)}</b> from <b>${esc(company)}</b> (${esc(country)}) has asked for access.</p><p>Email: ${esc(email)}<br>Phone: ${esc(phone) || '—'}</p><p><a href="${url.origin}/#/admin/users">Review in the portal</a></p>`) }));
    }
    return json({ ok: true }); // same answer whether or not the address was already registered
  }

  if (a === 'login' && m === 'POST') {
    const d = await body(request);
    const email = clean(d.email, 160).toLowerCase();
    const key = 'login:' + email + ':' + ip(request);
    if (await blocked(env, key, 6, 900)) fail(429, 'Too many failed sign-in attempts. Wait 15 minutes and try again.');
    const u = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
    const ok = u ? await checkPw(String(d.password || ''), u.pw) : (await hashPw('x'), false);
    if (!ok) { await bump(env, key, 900); track(ctx, env, request, null, 'login_failed', '', email); fail(401, 'Email or password is not correct.'); }
    if (u.status === 'pending') fail(403, 'Your request is waiting for approval by the Evanssion team. We will email you as soon as it is approved.');
    if (u.status !== 'approved') fail(403, 'This account is not active. Please contact the Evanssion team.');
    await clearKey(env, key);
    const cookie = await startSession(env, url, u);
    track(ctx, env, request, u, 'login');
    ctx.waitUntil(env.DB.prepare('DELETE FROM activity WHERE ts < ?').bind(new Date(Date.now() - 180 * 86400000).toISOString()).run());
    return json({ user: pub(u) }, 200, { 'Set-Cookie': cookie });
  }

  if (a === 'forgot' && m === 'POST') {
    const d = await body(request);
    const email = clean(d.email, 160).toLowerCase();
    const key = 'forgot:' + ip(request);
    if (await blocked(env, key, 5, 3600)) fail(429, 'Too many requests. Please try again later.');
    await bump(env, key, 3600);
    const u = isEmail(email) ? await env.DB.prepare("SELECT * FROM users WHERE email = ? AND status = 'approved'").bind(email).first() : null;
    if (u) {
      const tok = randToken();
      await env.DB.prepare('INSERT INTO resets (id, user_id, expires) VALUES (?, ?, ?)').bind(await sha256(tok), u.id, nowSec() + 3600).run();
      ctx.waitUntil(sendMail(env, { to: u.email, subject: 'Reset your Evanssion partner password',
        html: mailShell('Reset your password', `<p>Use this link within one hour:</p><p><a href="${url.origin}/#/reset/${tok}">Choose a new password</a></p><p>If you did not ask for this, ignore this email.</p>`) }));
    }
    return json({ ok: true });
  }

  if (a === 'reset' && m === 'POST') {
    const d = await body(request);
    checkPwPolicy(d.password);
    const id = await sha256(String(d.token || ''));
    const r = await env.DB.prepare('SELECT user_id, expires FROM resets WHERE id = ?').bind(id).first();
    if (!r || r.expires < nowSec()) fail(400, 'This reset link has expired. Please request a new one.');
    await env.DB.prepare('UPDATE users SET pw = ? WHERE id = ?').bind(await hashPw(d.password), r.user_id).run();
    await env.DB.prepare('DELETE FROM resets WHERE user_id = ?').bind(r.user_id).run();
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(r.user_id).run();
    return json({ ok: true });
  }

  if (a === 'logout' && m === 'POST') {
    const who = await sessionUser(request, env, url); if (who) track(ctx, env, request, who, 'logout');
    const tok = readCookie(request, cookieName(url));
    if (tok) await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256(tok)).run();
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(url, '', 0) });
  }

  /* ---------------------------------------------------------- signed-in area */
  const user = await sessionUser(request, env, url);
  if (!user) fail(401, 'Please sign in.');
  const isAdmin = user.role === 'admin';
  const needAdmin = () => { if (!isAdmin) fail(403, 'Administrators only.'); };

  if (a === 'me' && m === 'GET') return json({ user: pub(user) });

  if (a === 'password' && m === 'POST') {
    const d = await body(request);
    if (!(await checkPw(String(d.current || ''), user.pw))) fail(403, 'Your current password is not correct.');
    checkPwPolicy(d.password);
    await env.DB.prepare('UPDATE users SET pw = ? WHERE id = ?').bind(await hashPw(d.password), user.id).run();
    const tok = readCookie(request, cookieName(url));
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').bind(user.id, await sha256(tok)).run();
    return json({ ok: true });
  }

  if (a === 'account' && m === 'POST') {
    const d = await body(request);
    const name = clean(d.name, 100), phone = clean(d.phone, 40), country = clean(d.country, 80);
    if (!name || !country) fail(400, 'Name and country are required.');
    await env.DB.prepare('UPDATE users SET name = ?, phone = ?, country = ? WHERE id = ?').bind(name, phone, country, user.id).run(); // company is admin-controlled
    return json({ ok: true });
  }

  if (a === 'summary' && m === 'GET') {
    track(ctx, env, request, user, 'view', 'dashboard');
    const cat = await env.DB.prepare('SELECT category, COUNT(*) AS n FROM resources WHERE published = 1 GROUP BY category').all();
    const today = new Date().toISOString().slice(0, 10);
    const sp = await env.DB.prepare("SELECT COUNT(*) AS n FROM resources WHERE category = 'spiff' AND published = 1 AND (ends IS NULL OR ends = '' OR ends >= ?) AND (starts IS NULL OR starts = '' OR starts <= ?)").bind(today, today).first();
    const latest = await env.DB.prepare("SELECT id, category, vendor, title, created_at FROM resources WHERE published = 1 ORDER BY id DESC LIMIT 6").all();
    const mine = await env.DB.prepare('SELECT status, COUNT(*) AS n FROM deals WHERE user_id = ? GROUP BY status').bind(user.id).all();
    const out = { counts: Object.fromEntries(cat.results.map((r) => [r.category, r.n])), activeSpiffs: sp.n, latest: latest.results, myDeals: Object.fromEntries(mine.results.map((r) => [r.status, r.n])) };
    if (isAdmin) {
      out.pendingUsers = (await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE status = 'pending'").first()).n;
      out.pendingDeals = (await env.DB.prepare("SELECT COUNT(*) AS n FROM deals WHERE status = 'submitted'").first()).n;
    }
    return json(out);
  }

  if (a === 'vendors' && m === 'GET') {
    const r = await env.DB.prepare("SELECT DISTINCT vendor FROM resources WHERE vendor != '' AND published = 1 ORDER BY vendor").all();
    return json({ vendors: r.results.map((x) => x.vendor) });
  }

  /* ------------------------------------------------------------- resources */
  if (a === 'resources' && !b && m === 'GET') {
    const cat = clean(url.searchParams.get('category'), 20);
    if (!CATS.includes(cat)) fail(400, 'Unknown category.');
    track(ctx, env, request, user, 'view', cat);
    const order = cat === 'spiff' ? 'ORDER BY COALESCE(NULLIF(ends, \'\'), \'9999-12-31\') ASC, id DESC' : 'ORDER BY vendor ASC, id DESC';
    const r = await env.DB.prepare(`SELECT id, category, vendor, title, description, kind, url, file_id, file_name, file_size, file_type, reward, starts, ends, created_at FROM resources WHERE category = ? AND published = 1 ${order}`).bind(cat).all();
    return json({ items: r.results });
  }

  if (a === 'files' && b && m === 'GET') {
    const row = await env.DB.prepare(`SELECT * FROM resources WHERE file_id = ? ${isAdmin ? '' : 'AND published = 1'}`).bind(b).first();
    if (!row || !env.FILES) fail(404, 'File not found.');
    const obj = await env.FILES.get('f:' + row.file_id, 'stream');
    if (!obj) fail(404, 'File not found.');
    track(ctx, env, request, user, 'download', `${row.title} (${row.file_name})`);
    const inline = url.searchParams.get('inline') === '1' && row.file_type === 'application/pdf';
    const safe = (row.file_name || 'download').replace(/[^\w.\- ]+/g, '_');
    return new Response(obj, { headers: {
      'Content-Type': row.file_type || 'application/octet-stream',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${safe}"`,
      'Content-Length': String(row.file_size || ''),
      'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store', 'Content-Security-Policy': "sandbox; default-src 'none'",
    } });
  }

  /* ----------------------------------------------------------------- deals */
  if (a === 'deals' && !b && m === 'GET') {
    track(ctx, env, request, user, 'view', isAdmin ? 'deals (admin)' : 'deals');
    const st = clean(url.searchParams.get('status'), 20);
    const w = []; const args = [];
    if (!isAdmin) { w.push('d.user_id = ?'); args.push(user.id); }
    if (DEAL_STATUS.includes(st)) { w.push('d.status = ?'); args.push(st); }
    const conflicts = isAdmin ? ", (SELECT COUNT(*) FROM deals o WHERE o.id != d.id AND o.vendor = d.vendor COLLATE NOCASE AND lower(o.customer) = lower(d.customer) AND o.status IN ('submitted','approved')) AS conflicts" : '';
    const r = await env.DB.prepare(`SELECT d.*, COALESCE(u.name, 'Removed user') AS partner_name, COALESCE(u.company, '') AS partner_company, COALESCE(u.email, '') AS partner_email${conflicts} FROM deals d LEFT JOIN users u ON u.id = d.user_id ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY d.id DESC LIMIT 500`).bind(...args).all();
    return json({ items: r.results });
  }

  const dealFields = (d) => {
    const v = {
      customer: clean(d.customer, 160), customer_country: clean(d.customer_country, 80), customer_city: clean(d.customer_city, 80),
      contact_name: clean(d.contact_name, 100), contact_email: clean(d.contact_email, 160).toLowerCase(), contact_phone: clean(d.contact_phone, 40),
      industry: clean(d.industry, 80), vendor: clean(d.vendor, 80), product: clean(d.product, 120), notes: clean(d.notes, 2000),
      value_usd: d.value_usd === '' || d.value_usd == null ? null : Math.round(Number(d.value_usd)),
      expected_close: clean(d.expected_close, 10) || null,
    };
    if (!v.customer || !v.vendor || !v.customer_country || !v.contact_name) fail(400, 'Customer, country, contact name and vendor are required.');
    if (v.contact_email && !isEmail(v.contact_email)) fail(400, 'The customer contact email is not valid.');
    if (v.value_usd != null && (!Number.isFinite(v.value_usd) || v.value_usd < 0 || v.value_usd > 1e10)) fail(400, 'Estimated value must be a positive number.');
    if (v.expected_close && !isDate(v.expected_close)) fail(400, 'Expected close date is not valid.');
    return v;
  };

  if (a === 'deals' && !b && m === 'POST') {
    const v = dealFields(await body(request));
    const key = 'deal:' + user.id;
    if (await blocked(env, key, 20, 3600)) fail(429, 'Too many submissions. Please try again later.');
    await bump(env, key, 3600);
    const t = now();
    const res = await env.DB.prepare(`INSERT INTO deals (user_id, customer, customer_country, customer_city, contact_name, contact_email, contact_phone, industry, vendor, product, value_usd, expected_close, notes, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?)`)
      .bind(user.id, v.customer, v.customer_country, v.customer_city, v.contact_name, v.contact_email, v.contact_phone, v.industry, v.vendor, v.product, v.value_usd, v.expected_close, v.notes, t, t).run();
    const id = res.meta.last_row_id;
    const ref = `DR-${t.slice(0, 4)}-${String(id).padStart(4, '0')}`;
    await env.DB.prepare('UPDATE deals SET ref = ? WHERE id = ?').bind(ref, id).run();
    track(ctx, env, request, user, 'deal_submit', `${ref} ${v.customer} / ${v.vendor}`);
    ctx.waitUntil(sendMail(env, { to: adminMail(env), subject: `Deal registration ${ref}: ${v.customer} (${v.vendor})`, replyTo: user.email,
      html: mailShell('New deal registration', `<p><b>${esc(user.company)}</b> (${esc(user.name)}) registered <b>${esc(v.customer)}</b> for <b>${esc(v.vendor)}</b>${v.product ? ' — ' + esc(v.product) : ''}.</p><p>Value: ${v.value_usd != null ? 'USD ' + v.value_usd.toLocaleString('en-US') : 'not stated'}</p><p><a href="${url.origin}/#/admin/deals">Review in the portal</a></p>`) }));
    return json({ ok: true, ref });
  }

  if (a === 'deals' && b && m === 'PUT') { // partner re-submits after "more information needed"
    const row = await env.DB.prepare('SELECT * FROM deals WHERE id = ? AND user_id = ?').bind(+b, user.id).first();
    if (!row) fail(404, 'Deal not found.');
    if (row.status !== 'info') fail(409, 'This registration can no longer be edited.');
    const v = dealFields(await body(request));
    await env.DB.prepare(`UPDATE deals SET customer=?, customer_country=?, customer_city=?, contact_name=?, contact_email=?, contact_phone=?, industry=?, vendor=?, product=?, value_usd=?, expected_close=?, notes=?, status='submitted', updated_at=? WHERE id=?`)
      .bind(v.customer, v.customer_country, v.customer_city, v.contact_name, v.contact_email, v.contact_phone, v.industry, v.vendor, v.product, v.value_usd, v.expected_close, v.notes, now(), row.id).run();
    ctx.waitUntil(sendMail(env, { to: adminMail(env), subject: `Deal registration ${row.ref} updated`, replyTo: user.email, html: mailShell('Deal registration updated', `<p>${esc(user.company)} answered your question on ${esc(row.ref)}.</p><p><a href="${url.origin}/#/admin/deals">Review in the portal</a></p>`) }));
    return json({ ok: true });
  }

  /* ----------------------------------------------------------------- admin */
  if (a === 'admin') {
    needAdmin();

    if (b === 'users' && !c && m === 'GET') {
      const r = await env.DB.prepare('SELECT * FROM users ORDER BY (status = \'pending\') DESC, id DESC LIMIT 1000').all();
      return json({ items: r.results.map(pub) });
    }

    if (b === 'users' && c && m === 'POST') {
      const d = await body(request);
      const target = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(+c).first();
      if (!target) fail(404, 'User not found.');
      const act = clean(d.action, 20);
      if (target.id === user.id && ['reject', 'suspend', 'demote'].includes(act)) fail(400, 'You cannot do that to your own account.');
      const set = async (status) => env.DB.prepare('UPDATE users SET status = ?, approved_at = CASE WHEN ? = \'approved\' THEN ? ELSE approved_at END WHERE id = ?').bind(status, status, now(), target.id).run();
      if (act === 'approve') {
        if (d.company) await env.DB.prepare('UPDATE users SET company = ? WHERE id = ?').bind(clean(d.company, 140) || target.company, target.id).run();
        await set('approved');
        ctx.waitUntil(sendMail(env, { to: target.email, subject: 'Your Evanssion partner access is approved',
          html: mailShell('You are in', `<p>Hello ${esc(target.name)}, your access to the Evanssion Partner Portal is approved.</p><p><a href="${url.origin}/#/login">Sign in</a></p>`) }));
      } else if (act === 'reject') { await set('rejected'); await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(target.id).run(); }
      else if (act === 'suspend') { await set('suspended'); await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(target.id).run(); }
      else if (act === 'promote') { if (target.status !== 'approved') fail(400, 'Approve the user first.'); await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(target.id).run(); }
      else if (act === 'demote') await env.DB.prepare("UPDATE users SET role = 'partner' WHERE id = ?").bind(target.id).run();
      else if (act === 'company') { const co = clean(d.company, 140); if (!co) fail(400, 'Company is required.'); await env.DB.prepare('UPDATE users SET company = ? WHERE id = ?').bind(co, target.id).run(); }
      else if (act === 'delete') {
        if (target.id === user.id) fail(400, 'You cannot remove your own account.');
        await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(target.id).run();
        await env.DB.prepare('DELETE FROM resets WHERE user_id = ?').bind(target.id).run();
        await env.DB.prepare('DELETE FROM activity WHERE user_id = ?').bind(target.id).run();
        await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(target.id).run();
      } else if (act === 'reset_link') {
        const tok = randToken();
        await env.DB.prepare('INSERT INTO resets (id, user_id, expires) VALUES (?, ?, ?)').bind(await sha256(tok), target.id, nowSec() + 86400).run();
        const link = `${url.origin}/#/reset/${tok}`;
        ctx.waitUntil(sendMail(env, { to: target.email, subject: 'Reset your Evanssion partner password', html: mailShell('Reset your password', `<p>An administrator started a password reset for you. Use this link within 24 hours:</p><p><a href="${link}">Choose a new password</a></p>`) }));
        track(ctx, env, request, user, 'admin', `reset link for ${target.email}`);
        return json({ ok: true, link });
      } else fail(400, 'Unknown action.');
      track(ctx, env, request, user, 'admin', `${act} ${target.email}`);
      return json({ ok: true });
    }

    if (b === 'activity' && m === 'GET') {
      const w = []; const args = [];
      const uid = +url.searchParams.get('user'); if (uid) { w.push('a.user_id = ?'); args.push(uid); }
      const act = clean(url.searchParams.get('action'), 20); if (act) { w.push('a.action = ?'); args.push(act); }
      const r = await env.DB.prepare(`SELECT a.id, a.ts, a.user_id, a.email, a.action, a.detail, a.ip, a.country, u.name, u.company FROM activity a LEFT JOIN users u ON u.id = a.user_id ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY a.id DESC LIMIT 300`).bind(...args).all();
      return json({ items: r.results });
    }

    if (b === 'deals' && c && m === 'POST') {
      const d = await body(request);
      const row = await env.DB.prepare('SELECT d.*, u.email AS pe, u.name AS pn FROM deals d LEFT JOIN users u ON u.id = d.user_id WHERE d.id = ?').bind(+c).first();
      if (!row) fail(404, 'Deal not found.');
      const status = clean(d.status, 20); const note = clean(d.note, 1000);
      if (!['approved', 'rejected', 'info'].includes(status)) fail(400, 'Choose a decision.');
      if (status !== 'approved' && !note) fail(400, 'Add a short note for the partner.');
      const t = now();
      const until = status === 'approved' ? new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10) : null;
      await env.DB.prepare('UPDATE deals SET status = ?, admin_note = ?, decided_at = ?, protected_until = ?, updated_at = ? WHERE id = ?').bind(status, note, t, until, t, row.id).run();
      const label = { approved: 'approved', rejected: 'not approved', info: 'waiting for more information' }[status];
      track(ctx, env, request, user, 'admin', `deal ${row.ref} ${status}`);
      if (row.pe) ctx.waitUntil(sendMail(env, { to: row.pe, subject: `Deal registration ${row.ref} ${label}`,
        html: mailShell(`Deal registration ${label}`, `<p>Hello ${esc(row.pn)}, your registration <b>${esc(row.ref)}</b> for <b>${esc(row.customer)}</b> (${esc(row.vendor)}) is <b>${label}</b>.</p>${until ? `<p>Registration protection runs until <b>${until}</b>.</p>` : ''}${note ? `<p>Note from Evanssion: ${esc(note)}</p>` : ''}<p><a href="${url.origin}/#/deals">Open your deals</a></p>`) }));
      return json({ ok: true });
    }

    if (b === 'resources' && !c && m === 'GET') {
      const r = await env.DB.prepare('SELECT * FROM resources ORDER BY id DESC LIMIT 1000').all();
      return json({ items: r.results.map(({ file_id, ...x }) => ({ ...x, has_file: !!file_id, file_id })) });
    }

    if (b === 'resources' && m === 'POST' || b === 'resources' && c && m === 'PUT') {
      const fd = await request.formData();
      const cat = clean(fd.get('category'), 20); const title = clean(fd.get('title'), 160);
      if (!CATS.includes(cat) || !title) fail(400, 'Choose a category and enter a title.');
      const kind = fd.get('kind') === 'link' ? 'link' : 'file';
      let link = clean(fd.get('url'), 500);
      if (kind === 'link' && !/^https:\/\/[^\s]+$/i.test(link)) fail(400, 'Enter a full link starting with https://');
      if (kind === 'file') link = '';
      const starts = clean(fd.get('starts'), 10), ends = clean(fd.get('ends'), 10);
      if ((starts && !isDate(starts)) || (ends && !isDate(ends))) fail(400, 'Dates must be valid.');
      if (starts && ends && ends < starts) fail(400, 'The end date is before the start date.');
      const data = {
        category: cat, vendor: clean(fd.get('vendor'), 80), title, description: clean(fd.get('description'), 1500), kind, url: link,
        reward: cat === 'spiff' ? clean(fd.get('reward'), 200) : '', starts: cat === 'spiff' ? starts : '', ends: cat === 'spiff' ? ends : '',
        published: fd.get('published') === '0' ? 0 : 1,
      };
      const file = fd.get('file');
      let fileMeta = null;
      if (kind === 'file' && file && typeof file === 'object' && file.size > 0) {
        if (!env.FILES) fail(500, 'File storage is not connected yet (binding FILES missing).');
        const ext = String(file.name).split('.').pop().toLowerCase();
        if (!EXT[ext]) fail(400, `Files of type .${ext} are not allowed. Allowed: ${Object.keys(EXT).join(', ')}.`);
        if (file.size > MAX_FILE) fail(400, 'This file is larger than 25 MB. Compress it or share it as a link.');
        const id = randToken().slice(0, 32);
        await env.FILES.put('f:' + id, await file.arrayBuffer());
        fileMeta = { id, name: clean(file.name, 150), size: file.size, type: EXT[ext] };
      }
      const t = now();
      if (m === 'POST') {
        if (kind === 'file' && !fileMeta) fail(400, 'Choose a file to upload, or switch to a link.');
        await env.DB.prepare('INSERT INTO resources (category, vendor, title, description, kind, url, file_id, file_name, file_size, file_type, reward, starts, ends, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(data.category, data.vendor, data.title, data.description, kind, data.url, fileMeta?.id ?? null, fileMeta?.name ?? null, fileMeta?.size ?? null, fileMeta?.type ?? null, data.reward, data.starts, data.ends, data.published, t, t).run();
      } else {
        const old = await env.DB.prepare('SELECT * FROM resources WHERE id = ?').bind(+c).first();
        if (!old) fail(404, 'Item not found.');
        let fid = old.file_id, fname = old.file_name, fsize = old.file_size, ftype = old.file_type;
        if (kind === 'link') { if (fid && env.FILES) await env.FILES.delete('f:' + fid); fid = fname = fsize = ftype = null; }
        else if (fileMeta) { if (fid && env.FILES) await env.FILES.delete('f:' + fid); ({ id: fid, name: fname, size: fsize, type: ftype } = fileMeta); }
        else if (!fid) fail(400, 'Choose a file to upload, or switch to a link.');
        await env.DB.prepare('UPDATE resources SET category=?, vendor=?, title=?, description=?, kind=?, url=?, file_id=?, file_name=?, file_size=?, file_type=?, reward=?, starts=?, ends=?, published=?, updated_at=? WHERE id=?')
          .bind(data.category, data.vendor, data.title, data.description, kind, data.url, fid, fname, fsize, ftype, data.reward, data.starts, data.ends, data.published, t, old.id).run();
      }
      track(ctx, env, request, user, 'admin', `${m === 'POST' ? 'added' : 'edited'} ${cat}: ${title}`);
      return json({ ok: true });
    }

    if (b === 'resources' && c && m === 'DELETE') {
      const old = await env.DB.prepare('SELECT file_id FROM resources WHERE id = ?').bind(+c).first();
      if (old?.file_id && env.FILES) await env.FILES.delete('f:' + old.file_id);
      await env.DB.prepare('DELETE FROM resources WHERE id = ?').bind(+c).run();
      track(ctx, env, request, user, 'admin', `deleted resource ${c}`);
      return json({ ok: true });
    }
  }

  return fail(404, 'Not found.');
}
