export default async function handler(req, res) {
  const { path } = req.query;
  const targetPath = Array.isArray(path) ? path.join('/') : (path || '');
  
  // Reconstruct the query string
  const url = new URL(req.url, `http://${req.headers.host}`);
  const searchParams = url.searchParams;
  searchParams.delete('path'); 
  const queryString = searchParams.toString();
  
  const targetUrl = `https://launchpad-backend-production-63dc.up.railway.app/api/${targetPath}${queryString ? '?' + queryString : ''}`;

  try {
    const fetchRes = await fetch(targetUrl, {
      method: req.method,
      headers: {
        'Origin': 'https://aquafamily.fun',
        'Referer': 'https://aquafamily.fun/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    
    // We must manually forward the response headers and status
    const data = await fetchRes.text();
    
    // Attempt to parse JSON to ensure valid response, but send raw text to avoid double-stringifying
    try {
      JSON.parse(data);
      res.setHeader('Content-Type', 'application/json');
    } catch(e) {
      // If it's not JSON, let Vercel handle it
    }

    res.status(fetchRes.status).send(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to proxy request to Railway backend' });
  }
}
