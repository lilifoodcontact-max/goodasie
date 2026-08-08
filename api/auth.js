/* Vercel Serverless Function -- account signup / login / logout / session check.
   Multi-tenant: each company gets its own account (username + password + email).
   Passwords are hashed with scrypt (Node's built-in crypto, salted, never stored
   in plain text). Sessions are random tokens stored in Redis with a 30-day TTL,
   handed to the browser as an HttpOnly cookie so client-side JS never sees it.
   NOTE: intentionally avoids "//" line comments in the middle of code, so this
   still works even if line breaks get flattened during copy/paste. */

const crypto = require('crypto');

function parseCookies(req){
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach(function(part){
    const idx = part.indexOf('=');
    if(idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if(k) out[k] = decodeURIComponent(v);
  });
  return out;
}

function setSessionCookie(res, token){
  const maxAge = 60 * 60 * 24 * 30;
  res.setHeader('Set-Cookie', 'gsid=' + token + '; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=' + maxAge);
}

function clearSessionCookie(res){
  res.setHeader('Set-Cookie', 'gsid=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
}

function hashPassword(password){
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(password, stored){
  const parts = String(stored || '').split(':');
  if(parts.length !== 2) return false;
  const salt = parts[0], hash = parts[1];
  let check;
  try{ check = crypto.scryptSync(password, salt, 64).toString('hex'); }
  catch(e){ return false; }
  const a = Buffer.from(hash, 'hex'), b = Buffer.from(check, 'hex');
  if(a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function redisCmd(args){
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if(!url || !token){ throw new Error('Base de données non configurée (KV_REST_API_URL manquant sur Vercel).'); }
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(args)
  });
  const data = await r.json();
  if(data && data.error){ throw new Error(String(data.error)); }
  return data.result;
}

module.exports = async function handler(req, res){
  if(req.method !== 'POST'){
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body = req.body || {};
  const action = body.action;

  if(action === 'signup'){
    const username = String(body.username || '').trim().toLowerCase();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const companyName = String(body.companyName || '').trim();
    if(!username || !password || !email || !companyName){
      res.status(400).json({ error: 'Merci de remplir tous les champs.' });
      return;
    }
    if(!/^[a-z0-9_.-]{3,40}$/.test(username)){
      res.status(400).json({ error: "Le nom d'utilisateur doit faire 3 à 40 caractères (lettres, chiffres, . _ -)." });
      return;
    }
    if(password.length < 6){
      res.status(400).json({ error: 'Le mot de passe doit faire au moins 6 caractères.' });
      return;
    }
    try{
      const existing = await redisCmd(['GET', 'user:' + username]);
      if(existing){
        res.status(409).json({ error: "Ce nom d'utilisateur est déjà pris." });
        return;
      }
      const companyId = crypto.randomBytes(12).toString('hex');
      const userRecord = {
        username: username, email: email, passwordHash: hashPassword(password),
        companyId: companyId, companyName: companyName, createdAt: Date.now()
      };
      await redisCmd(['SET', 'user:' + username, JSON.stringify(userRecord)]);
      const token = crypto.randomBytes(32).toString('hex');
      await redisCmd(['SET', 'session:' + token, JSON.stringify({ username: username, companyId: companyId, companyName: companyName }), 'EX', String(60 * 60 * 24 * 30)]);
      setSessionCookie(res, token);
      res.status(200).json({ ok: true, companyName: companyName, username: username });
    }catch(e){
      res.status(500).json({ error: e.message || 'Erreur serveur.' });
    }
    return;
  }

  if(action === 'login'){
    const username = String(body.username || '').trim().toLowerCase();
    const password = String(body.password || '');
    try{
      const raw = await redisCmd(['GET', 'user:' + username]);
      if(!raw){
        res.status(401).json({ error: "Nom d'utilisateur ou mot de passe incorrect." });
        return;
      }
      const user = JSON.parse(raw);
      if(!verifyPassword(password, user.passwordHash)){
        res.status(401).json({ error: "Nom d'utilisateur ou mot de passe incorrect." });
        return;
      }
      const token = crypto.randomBytes(32).toString('hex');
      await redisCmd(['SET', 'session:' + token, JSON.stringify({ username: user.username, companyId: user.companyId, companyName: user.companyName }), 'EX', String(60 * 60 * 24 * 30)]);
      setSessionCookie(res, token);
      res.status(200).json({ ok: true, companyName: user.companyName, username: user.username });
    }catch(e){
      res.status(500).json({ error: e.message || 'Erreur serveur.' });
    }
    return;
  }

  if(action === 'logout'){
    try{
      const cookies = parseCookies(req);
      if(cookies.gsid){ await redisCmd(['DEL', 'session:' + cookies.gsid]); }
    }catch(e){ }
    clearSessionCookie(res);
    res.status(200).json({ ok: true });
    return;
  }

  if(action === 'me'){
    try{
      const cookies = parseCookies(req);
      if(!cookies.gsid){ res.status(200).json({ loggedIn: false }); return; }
      const raw = await redisCmd(['GET', 'session:' + cookies.gsid]);
      if(!raw){ res.status(200).json({ loggedIn: false }); return; }
      const session = JSON.parse(raw);
      res.status(200).json({ loggedIn: true, companyName: session.companyName, username: session.username });
    }catch(e){
      res.status(200).json({ loggedIn: false, error: e.message });
    }
    return;
  }

  res.status(400).json({ error: 'Action inconnue.' });
};
