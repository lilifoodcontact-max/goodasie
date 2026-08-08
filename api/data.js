/* Vercel Serverless Function -- per-company data storage (get / set / delete / list).
   Every request must carry a valid session cookie (set by /api/auth). The server
   reads which company that session belongs to and only ever touches Redis keys
   under that company's own namespace ("company:<id>:..."), so one company can
   never read or write another company's data, no matter what key it asks for.
   NOTE: intentionally avoids "//" line comments in the middle of code, so this
   still works even if line breaks get flattened during copy/paste. */

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

async function requireSession(req){
  const cookies = parseCookies(req);
  if(!cookies.gsid) return null;
  const raw = await redisCmd(['GET', 'session:' + cookies.gsid]);
  if(!raw) return null;
  return JSON.parse(raw);
}

module.exports = async function handler(req, res){
  if(req.method !== 'POST'){
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  let session;
  try{ session = await requireSession(req); }
  catch(e){ res.status(500).json({ error: e.message || 'Erreur serveur.' }); return; }
  if(!session){
    res.status(401).json({ error: 'Non connecté.' });
    return;
  }

  const cid = session.companyId;
  const body = req.body || {};
  const action = body.action;

  try{
    if(action === 'get'){
      const key = String(body.key || '');
      if(!key){ res.status(400).json({ error: 'key manquant' }); return; }
      const raw = await redisCmd(['GET', 'company:' + cid + ':' + key]);
      if(raw === null || raw === undefined){ res.status(404).json({ error: 'not found' }); return; }
      res.status(200).json({ key: key, value: raw });
      return;
    }

    if(action === 'set'){
      const key = String(body.key || '');
      const value = (body.value !== undefined && body.value !== null) ? String(body.value) : '';
      if(!key){ res.status(400).json({ error: 'key manquant' }); return; }
      await redisCmd(['SET', 'company:' + cid + ':' + key, value]);
      res.status(200).json({ key: key, value: value });
      return;
    }

    if(action === 'delete'){
      const key = String(body.key || '');
      if(!key){ res.status(400).json({ error: 'key manquant' }); return; }
      await redisCmd(['DEL', 'company:' + cid + ':' + key]);
      res.status(200).json({ key: key, deleted: true });
      return;
    }

    if(action === 'list'){
      const prefix = String(body.prefix || '');
      const pattern = 'company:' + cid + ':' + prefix + '*';
      const allKeys = await redisCmd(['KEYS', pattern]) || [];
      const stripLen = ('company:' + cid + ':').length;
      const keys = allKeys.map(function(k){ return k.slice(stripLen); });
      res.status(200).json({ keys: keys, prefix: prefix });
      return;
    }

    res.status(400).json({ error: 'Action inconnue.' });
  }catch(e){
    res.status(500).json({ error: e.message || 'Erreur serveur.' });
  }
};
