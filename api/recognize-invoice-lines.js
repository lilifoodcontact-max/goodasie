module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'GEMINI_API_KEY manquante sur le serveur.' });
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
    "Tu lis la photo ou le PDF d'une facture ou d'un bon de livraison envoyé PAR un fournisseur À un restaurant.",
    "Extrais :",
    "1) supplierName : le nom de l'entreprise FOURNISSEUR qui a émis le document (pas le destinataire), ou null si incertain.",
    "2) amount : le MONTANT TOTAL TTC à payer (nombre pur, point décimal), ou null si incertain.",
    "3) lines : la liste des lignes de PRODUITS. Pour chaque ligne : name = la désignation exactement comme écrite sur la facture, quantity = la quantité facturée (nombre), unitPrice = le prix unitaire HT (nombre, 0 si illisible).",
    "Ignore les lignes qui ne sont pas des produits (transport, consigne, remise globale, totaux).",
    'Réponds UNIQUEMENT avec un objet JSON strict, sans texte autour, au format exact : {"supplierName": "Nom ou null", "amount": 123.45, "lines": [{"name": "Désignation", "quantity": 2, "unitPrice": 10.5}]}'
  ].join('\n');

  const geminiBody = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: mimeType, data: image } }
      ]
    }],
    generationConfig: { responseMimeType: 'application/json' }
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
      ? parsed.supplierName.trim() : null;
    const amount = (parsed && typeof parsed.amount === 'number' && isFinite(parsed.amount) && parsed.amount > 0)
      ? parsed.amount : null;

    const rawLines = (parsed && Array.isArray(parsed.lines)) ? parsed.lines : [];
    const lines = rawLines
      .map(function (l) {
        return {
          name: String((l && l.name) || '').trim(),
          quantity: Number(l && l.quantity),
          unitPrice: Number(l && l.unitPrice)
        };
      })
      .filter(function (l) { return l.name && isFinite(l.quantity) && l.quantity > 0; })
      .map(function (l) {
        return { name: l.name, quantity: l.quantity, unitPrice: (isFinite(l.unitPrice) && l.unitPrice >= 0) ? l.unitPrice : 0 };
      });

    res.status(200).json({ supplierName, amount, lines });
  } catch (e) {
    console.error('recognize-invoice-lines failed', e);
    res.status(500).json({ error: 'Erreur serveur lors de la reconnaissance.' });
  }
};
