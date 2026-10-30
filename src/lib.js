// Shared helpers for the Evanssion partner portal API (runs on Cloudflare Workers / Pages Functions).
const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export const now = () => new Date().toISOString();
export const nowSec = () => Math.floor(Date.now() / 1000);
export const randToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));
export const sha256 = async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));

function same(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
// PBKDF2-SHA256 at 100,000 iterations (the maximum Workers allows), 16-byte random salt.
export async function hashPw(pw, salt = crypto.getRandomValues(new Uint8Array(16)), iter = 100000) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256);
  return `pbkdf2$${iter}$${b64(salt)}$${b64(bits)}`;
}
export async function checkPw(pw, stored) {
  const p = String(stored).split('$');
  if (p.length !== 4) return false;
  return same(await hashPw(pw, unb64(p[2]), +p[1]), stored);
}

export const SECURITY = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
};
export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY, ...headers } });
}
export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
export const fail = (status, message) => { throw new HttpError(status, message); };

export function cookieName(url) { return url.protocol === 'https:' ? '__Host-sid' : 'sid'; }
export function readCookie(request, name) {
  const m = (request.headers.get('Cookie') || '').split(/;\s*/).find((c) => c.startsWith(name + '='));
  return m ? m.slice(name.length + 1) : '';
}
export function sessionCookie(url, value, maxAge) {
  return `${cookieName(url)}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${url.protocol === 'https:' ? '; Secure' : ''}`;
}

export const clean = (v, max = 200) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
export const isEmail = (s) => /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(s) && s.length <= 160;
export const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Failed-attempt / abuse counters kept in D1.
export async function blocked(env, key, limit, windowSec) {
  const r = await env.DB.prepare('SELECT n, t FROM attempts WHERE k = ?').bind(key).first();
  return !!r && nowSec() - r.t <= windowSec && r.n >= limit;
}
export async function bump(env, key, windowSec) {
  const r = await env.DB.prepare('SELECT n, t FROM attempts WHERE k = ?').bind(key).first();
  if (!r || nowSec() - r.t > windowSec) await env.DB.prepare('INSERT OR REPLACE INTO attempts (k, n, t) VALUES (?, 1, ?)').bind(key, nowSec()).run();
  else await env.DB.prepare('UPDATE attempts SET n = n + 1 WHERE k = ?').bind(key).run();
}
export const clearKey = (env, key) => env.DB.prepare('DELETE FROM attempts WHERE k = ?').bind(key).run();

export async function sendMail(env, { to, subject, html, replyTo }) {
  if (!env.RESEND_API_KEY || !to) return false;
  const from = env.PORTAL_FROM || env.LEAD_FROM || 'noreply@evanssion.com';
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `Evanssion Partners <${from.replace(/^.*<|>$/g, '')}>`, to: [to], subject, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
    });
    return r.ok;
  } catch { return false; }
}
export const mailShell = (title, body) => `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:560px;margin:auto;color:#1D1D1F"><h2 style="margin:0 0 12px">${esc(title)}</h2>${body}<p style="color:#5F5F66;font-size:13px;margin-top:24px">Evanssion FZCO · Partner Portal</p></div>`;

export const EXT = {
  pdf: 'application/pdf', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ppt: 'application/vnd.ms-powerpoint',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel',
  zip: 'application/zip', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', mp4: 'video/mp4', csv: 'text/csv', txt: 'text/plain',
};
export const MAX_FILE = 25 * 1024 * 1024; // Workers KV value limit
