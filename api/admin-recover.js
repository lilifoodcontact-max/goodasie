/* TEMPORARY admin recovery endpoint -- lets the owner look up a forgotten
   username and reset a password by visiting a special URL with a secret key.
   IMPORTANT: delete this file from GitHub once you've recovered access.
   Anyone who knows ADMIN_SECRET could reset any account's password while
   this file exists, so it should not stay live long-term. */

const crypto = require('crypto');

const ADMIN_SECRET = 'JIkORdJe-d2NooBpayRIBMVHEyHaT5HE';

function hashPassword(password){
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return salt + ':' + hash;
}

async function redisCmd(args){
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if(!url || !token){ throw new Error('KV_REST_API_URL manquant.'); }
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
  const secret = req.query.secret;
  if(secret !== ADMIN_SECRET){
    res.status(403).json({ error: 'Non autorisé.' });
    return;
  }

  const action = req.query.action;

  if(action === 'list'){
    try{
      const keys = await redisCmd(['KEYS', 'user:*']);
      const out = [];
      for(let i = 0; i < keys.length; i++){
        const raw = await redisCmd(['GET', keys[i]]);
        if(!raw) continue;
        const u = JSON.parse(raw);
        out.push({ username: u.username, email: u.email, companyName: u.companyName, createdAt: u.createdAt });
      }
      res.status(200).json({ ok: true, users: out });
    }catch(e){
      res.status(500).json({ error: e.message });
    }
    return;
  }

  if(action === 'reset'){
    const username = String(req.query.username || '').trim().toLowerCase();
    const newPassword = String(req.query.newPassword || '');
    if(!username || newPassword.length < 6){
      res.status(400).json({ error: 'username et newPassword (6+ caracteres) requis.' });
      return;
    }
    try{
      const raw = await redisCmd(['GET', 'user:' + username]);
      if(!raw){ res.status(404).json({ error: 'Utilisateur introuvable.' }); return; }
      const user = JSON.parse(raw);
      user.passwordHash = hashPassword(newPassword);
      await redisCmd(['SET', 'user:' + username, JSON.stringify(user)]);
      res.status(200).json({ ok: true, message: 'Mot de passe change pour ' + username });
    }catch(e){
      res.status(500).json({ error: e.message });
    }
    return;
  }

  res.status(400).json({ error: 'Action inconnue. Utilise ?action=list ou ?action=reset' });
};
