/* Vercel Serverless Function -- reads one photo that may contain several bank
   card payment slips (French "ticket de carte bancaire" laid side by side) and
   returns the MONTANT value printed on each one, so the app can sum them up
   into a single revenue entry while still keeping each individual amount.
   The Gemini API key NEVER reaches the browser: it only lives here, read from
   the GEMINI_API_KEY environment variable configured in the Vercel project.
   NOTE: intentionally avoids "//" line comments in the middle of code, so this
   still works even if line breaks get flattened during copy/paste. */

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
    "Tu regardes une photo qui contient un ou plusieurs tickets de paiement par carte bancaire (des reçus imprimés par un terminal de paiement bancaire, du type \"ticket commerçant\"), posés côte à côte ou l'un après l'autre.",
    "Sur chaque ticket, trouve la ligne \"MONTANT :\" (parfois écrite MONTANT, Montant, ou similaire) suivie d'un nombre et de EUR -- c'est ce nombre qui t'intéresse, rien d'autre sur le ticket (ignore les numéros de carte, heures, numéros d'autorisation, etc).",
    "Compte bien un montant par ticket visible sur la photo, même s'il y en a plusieurs.",
    'Réponds UNIQUEMENT avec un objet JSON strict, sans aucun texte autour, au format exact :',
    '{"amounts": [14.50, 29.00]}',
    "Utilise un point comme séparateur décimal, jamais de virgule. Si tu ne vois aucun montant lisible, réponds {\"amounts\": []}."
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
      res.status(502).json({ error: "Erreur de l'IA lors de la lecture des tickets." });
      return;
    }

    const data = await geminiRes.json();
    const text = data && data.candidates && data.candidates[0]
      && data.candidates[0].content && data.candidates[0].content.parts
      && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;

    let parsed = null;
    try { parsed = JSON.parse(text); } catch (e) { parsed = null; }

    let amounts = (parsed && Array.isArray(parsed.amounts)) ? parsed.amounts : [];
    amounts = amounts
      .map(function (n) { return Number(n); })
      .filter(function (n) { return isFinite(n) && n > 0; });

    res.status(200).json({ amounts: amounts });
  } catch (e) {
    console.error('recognize-receipts failed', e);
    res.status(500).json({ error: 'Erreur serveur lors de la reconnaissance.' });
  }
};
