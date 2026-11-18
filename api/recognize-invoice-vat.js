module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) { res.status(500).json({ error: 'GEMINI_API_KEY manquante sur le serveur.' }); return; }
  const { image, mimeType } = req.body || {};
  if (!image || !mimeType) { res.status(400).json({ error: 'Requête invalide.' }); return; }
  if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(mimeType)) {
    res.status(400).json({ error: 'Type de fichier non supporté : ' + mimeType }); return;
  }

  const prompt = [
    "Tu lis une facture fournisseur (photo ou PDF). Je veux UNIQUEMENT la TVA, telle qu'elle est imprimée sur le document.",
    "1) vat : un tableau avec UNE entrée par taux de TVA : rate = taux en pourcentage (ex. 5.5, 10, 20, 0), base = total HT soumis à ce taux (après remises), tva = montant de TVA pour ce taux.",
    "Utilise de préférence le tableau récapitulatif de TVA en bas du document. S'il n'existe pas, additionne les lignes par taux (colonnes Taux TVA / MT TVA).",
    "2) totalHT, totalTVA, totalTTC : les totaux imprimés (nombres, point décimal). null si illisible.",
    "3) date : la date de la facture au format AAAA-MM-JJ, ou null.",
    "Si le document est un avoir, les montants sont négatifs. Si la facture n'a pas de TVA, mets vat = [] et totalTVA = 0.",
    "N'invente rien : si un chiffre est illisible, mets null.",
    'Réponds UNIQUEMENT avec un objet JSON strict : {"vat":[{"rate":5.5,"base":100,"tva":5.5}],"totalHT":100,"totalTVA":5.5,"totalTTC":105.5,"date":"2026-11-12"}'
  ].join('\n');

  try {
    const r = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=' + apiKey,
      {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: image } }] }],
          generationConfig: { responseMimeType: 'application/json' }
        })
      }
    );
    if (!r.ok) { console.error('Gemini error', r.status, await r.text()); res.status(502).json({ error: "Erreur de l'IA." }); return; }
    const data = await r.json();
    const text = data && data.candidates && data.candidates[0] && data.candidates[0].content
      && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
    let p = null;
    try { p = JSON.parse(text); } catch (e) { p = null; }
    if (!p) { res.status(502).json({ error: 'Réponse de l’IA illisible.' }); return; }
    const n = function (v) { if (v === null || v === undefined || v === '') return null; v = Number(v); return isFinite(v) ? v : null; };
    const vat = (Array.isArray(p.vat) ? p.vat : []).map(function (x) {
      return { rate: n(x && x.rate), base: n(x && x.base), tva: n(x && x.tva) };
    }).filter(function (x) { return x.rate !== null && x.tva !== null; });
    const date = (typeof p.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.date)) ? p.date : null;
    res.status(200).json({ vat: vat, totalHT: n(p.totalHT), totalTVA: n(p.totalTVA), totalTTC: n(p.totalTTC), date: date });
  } catch (e) {
    console.error('recognize-invoice-vat failed', e);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};
