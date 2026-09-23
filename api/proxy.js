export default async function handler(req, res) {
  // req.url will be e.g. /api/proxy?path=launches&limit=50
  const url = new URL(req.url, `https://${req.headers.host}`);

  // Rebuild the target path from all query params except internal ones
  const rawPath = url.searchParams.get('path') || '';
  url.searchParams.delete('path');
  const qs = url.searchParams.toString();

  const targetUrl = `https://launchpad-backend-production-63dc.up.railway.app/api/${rawPath}${qs ? '?' + qs : ''}`;

  try {
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers: {
        'Origin':     'https://aquafamily.fun',
        'Referer':    'https://aquafamily.fun/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    const body = await upstream.text();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(upstream.status).send(body);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
