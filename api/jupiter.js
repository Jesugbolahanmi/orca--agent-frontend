// Proxies Jupiter Quote & Swap API calls to avoid CORS restrictions in the browser.
// GET  /api/jupiter?endpoint=quote&inputMint=...&outputMint=...&amount=...&slippageBps=...
// POST /api/jupiter?endpoint=swap   (body: JSON quoteResponse + userPublicKey)

export default async function handler(req, res) {
  // CORS preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = new URL(req.url, `https://${req.headers.host}`);
  const endpoint = url.searchParams.get('endpoint') || '';
  url.searchParams.delete('endpoint');
  const qs = url.searchParams.toString();

  const JUPITER_BASE = 'https://api.jup.ag/swap/v1';

  let targetUrl;
  if (endpoint === 'quote') {
    targetUrl = `${JUPITER_BASE}/quote${qs ? '?' + qs : ''}`;
  } else if (endpoint === 'swap') {
    targetUrl = `${JUPITER_BASE}/swap`;
  } else {
    return res.status(400).json({ error: 'Unknown endpoint. Use endpoint=quote or endpoint=swap.' });
  }

  try {
    const options = {
      method: req.method,
      headers: { 'Content-Type': 'application/json' },
    };

    // Forward POST body for swap
    if (req.method === 'POST') {
      // Vercel streams the body; read it
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      options.body = Buffer.concat(chunks).toString();
    }

    const upstream = await fetch(targetUrl, options);
    const body = await upstream.text();

    res.setHeader('Content-Type', 'application/json');
    res.status(upstream.status).send(body);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
