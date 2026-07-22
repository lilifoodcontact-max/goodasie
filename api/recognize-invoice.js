/* Vercel Serverless Function.
   Receives a photo or PDF of a supplier invoice from the front-end, asks Gemini
   to read the supplier's name off it, and returns just that name.
   The Gemini API key NEVER reaches the browser: it only lives here, read from
   the GEMINI_API_KEY environment variable configured in the Vercel project.
   NOTE: this file intentionally avoids "//" line comments in the middle of code,
   so that it still works even if line breaks get flattened during copy/paste. */

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'GEMINI_API_KEY manquante sur le serveur (Vercel > Settings > Environment Variables).' });
    return;
  }

  const { image, mimeType } = req.body || {};
  if (!image || !mimeType) {
    res.status(400).json({ error: 'Requête invalide : image ou mimeType manquant.' });
    return;
  }

  const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  if (!allowedMimeTypes.includes(mimeType)) {
    res.status(400).json({ error: 'Type de fichier non supporté : ' + mimeType });
    return;
  }

  const prompt = [
    "Tu regardes la photo ou le PDF d'une facture, d'un bon de livraison ou d'un ticket envoyé PAR un fournisseur À un restaurant.",
    "Deux choses à trouver :",
    "1) Le nom de l'entreprise FOURNISSEUR qui a émis ce document (celle qui vend / livre la marchandise), PAS le nom du restaurant destinataire.",
    "2) Le MONTANT TOTAL TTC à payer (le montant final, taxes comprises -- généralement le plus grand total, souvent en bas du document, parfois appelé \"Total TTC\", \"Net à payer\" ou \"Total\").",
    'Réponds UNIQUEMENT avec un objet JSON strict, sans aucun texte autour, au format exact :',
    '{"supplierName": "Nom du fournisseur ou null", "amount": 123.45}',
    "Si tu ne peux pas identifier le fournisseur avec une raisonnable certitude, mets supplierName à null.",
    "Si tu ne peux pas lire le montant total avec certitude, mets amount à null. Le montant doit être un nombre pur (pas de texte, pas de symbole €), avec un point comme séparateur décimal, jamais de virgule."
  ].join('\n');

  const geminiBody = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: mimeType, data: image } }
      ]
    }],
    generationConfig: {
      responseMimeType: 'application/json'
    }
  };

  try {
    const model = 'gemini-3.5-flash';
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiBody)
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error('Gemini error', geminiRes.status, errText);
      res.status(502).json({ error: "Erreur de l'IA lors de la lecture de la facture." });
      return;
    }

    const data = await geminiRes.json();
    const text = data && data.candidates && data.candidates[0]
      && data.candidates[0].content && data.candidates[0].content.parts
      && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;

    let parsed = null;
    try { parsed = JSON.parse(text); } catch (e) { parsed = null; }

    const supplierName = (parsed && typeof parsed.supplierName === 'string' && parsed.supplierName.trim())
      ? parsed.supplierName.trim()
      : null;
    const amount = (parsed && typeof parsed.amount === 'number' && isFinite(parsed.amount) && parsed.amount > 0)
      ? parsed.amount
      : null;

    res.status(200).json({ supplierName, amount });
  } catch (e) {
    console.error('recognize-invoice failed', e);
    res.status(500).json({ error: 'Erreur serveur lors de la reconnaissance.' });
  }
};
