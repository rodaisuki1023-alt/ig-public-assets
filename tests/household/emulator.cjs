// Local stand-in for the parts of Supabase the trial uses, for browser tests only:
//   POST /auth/v1/otp, /auth/v1/verify, /auth/v1/token?grant_type=refresh_token, /auth/v1/logout
//   POST /rest/v1/rpc/<function>   (runs the real migration SQL in PGlite as the signed-in user)
// Test helpers: GET /__test/otp?email=…, POST /__test/reset, POST /__test/sql (read-only checks).
// Wire format follows Supabase Auth (GoTrue) and PostgREST closely enough for the client; real
// Supabase behaviour (email delivery, token format, rate limits) is NOT verified by this emulator.
const http = require('node:http');
const crypto = require('node:crypto');
const { createDb, call } = require('./pg.cjs');

const port = Number(process.env.E2E_HH_PORT || 4720);
let db, codes, tokens, refresh, oauth, dropPush, guests;
async function reset() { db = await createDb(); codes = new Map(); tokens = new Map(); refresh = new Map(); oauth = new Map(); dropPush = new Map(); guests = new Set(); }
const uidFor = email => { const h = crypto.createHash('sha256').update(String(email).toLowerCase()).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`; };
function session(uid, email) {
  const access = 'emu.' + crypto.randomBytes(16).toString('hex'), r = 'emr.' + crypto.randomBytes(16).toString('hex');
  tokens.set(access, uid); refresh.set(r, { uid, email });
  return { access_token: access, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: r, user: { id: uid, email, is_anonymous:guests.has(uid) } };
}
function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-client-info', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' });
  res.end(body === undefined ? '' : JSON.stringify(body));
}
const readBody = req => new Promise(resolve => { let s = ''; req.on('data', c => { s += c; }); req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { resolve(null); } }); });

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'OPTIONS') return send(res, 204);
  const body = req.method === 'POST' ? await readBody(req) : {};
  if (body === null) return send(res, 400, { code: 'PGRST102', message: 'invalid JSON' });
  try {
    if (url.pathname === '/__test/health') return send(res, db ? 200 : 503, { ok: !!db });
    if (url.pathname === '/__test/reset') { await reset(); return send(res, 200, { ok: true }); }
    if (url.pathname === '/__test/otp') return send(res, 200, { code: codes.get(String(url.searchParams.get('email')).toLowerCase()) || null });
    if (url.pathname === '/__test/sql') return send(res, 200, (await db.query(body.sql)).rows);
    if (url.pathname === '/__test/drop-push') {
      const uid=uidFor(body.email||url.searchParams.get('email'));
      const fault=dropPush.get(uid)||{enabled:false,attempts:0};
      if(req.method==='POST'){fault.enabled=body.enabled===true;dropPush.set(uid,fault)}
      return send(res,200,fault);
    }
    if (url.pathname === '/auth/v1/authorize') {
      const redirect = new URL(url.searchParams.get('redirect_to'));
      const challenge = url.searchParams.get('code_challenge');
      if (url.searchParams.get('provider') !== 'google' || url.searchParams.get('code_challenge_method') !== 's256' || !/^[A-Za-z0-9_-]{43}$/.test(challenge || '') ||
          !['127.0.0.1', 'localhost'].includes(redirect.hostname) || redirect.pathname !== '/ig-public-assets/preview-baby-v19/' || !redirect.searchParams.has('atokore_auth')) return send(res, 400, { message: 'invalid test authorize request' });
      const code = crypto.randomUUID();
      oauth.set(code, { challenge, email: 'google@example.test' });
      redirect.searchParams.set('code', code);
      // Real HTTP redirect: WebKit cannot simulate a 302 with Playwright route.fulfill().
      res.writeHead(302, { Location: redirect.href, 'Cache-Control': 'no-store' }); res.end(); return;
    }
    if (req.headers.apikey !== 'emu-anon-key') return send(res, 401, { message: 'Invalid API key' });
    if (url.pathname === '/auth/v1/signup') {
      if(body.email||body.password)return send(res,400,{message:'Only guest signup is simulated'});
      const uid=crypto.randomUUID();guests.add(uid);return send(res,200,session(uid,''));
    }
    if (url.pathname === '/auth/v1/otp') {
      const email = String(body.email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return send(res, 400, { code: 'validation_failed', msg: 'Unable to validate email address' });
      codes.set(email, String(crypto.randomInt(0, 1e6)).padStart(6, '0'));
      return send(res, 200, {});
    }
    if (url.pathname === '/auth/v1/verify') {
      const email = String(body.email || '').trim().toLowerCase();
      if (body.type !== 'email' || !codes.get(email) || codes.get(email) !== String(body.token)) return send(res, 403, { code: 'otp_expired', msg: 'Token has expired or is invalid' });
      codes.delete(email);
      return send(res, 200, session(uidFor(email), email));
    }
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      const r = refresh.get(body.refresh_token);
      if (!r) return send(res, 400, { code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
      refresh.delete(body.refresh_token);
      return send(res, 200, session(r.uid, r.email));
    }
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'pkce') {
      const attempt = oauth.get(body.auth_code); oauth.delete(body.auth_code);
      if (!attempt || crypto.createHash('sha256').update(String(body.code_verifier || '')).digest('base64url') !== attempt.challenge) return send(res, 400, { message: 'invalid PKCE exchange' });
      return send(res, 200, session(uidFor(attempt.email), attempt.email));
    }
    if (url.pathname === '/auth/v1/logout') { tokens.delete(String(req.headers.authorization || '').replace(/^Bearer /, '')); return send(res, 204); }
    const m = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
    if (m && req.method === 'POST') {
      const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
      const uid = tokens.get(token) || null;
      if (token && token !== 'emu-anon-key' && !uid) return send(res, 401, { code: 'PGRST301', message: 'JWT expired' });
      // Real connection failure, after CORS preflight succeeds, before SQL can apply the push.
      // This avoids browser-specific request-interception behaviour in offline/retry tests.
      const fault=dropPush.get(uid);
      if(m[1]==='hh_push'&&fault?.enabled){fault.attempts++;res.destroy();return}
      try { return send(res, 200, await call(db, uid, m[1], body, {is_anonymous:guests.has(uid)})); }
      catch (e) { return send(res, e.code === '42501' ? 403 : e.code === '42883' ? 404 : 400, { code: e.code, message: e.message }); }
    }
    return send(res, 404, { message: 'not found' });
  } catch (e) {
    return send(res, 500, { message: String(e.message || e) });
  }
}).listen(port, '127.0.0.1', async () => { await reset(); console.log(`household emulator on http://127.0.0.1:${port}`); });
