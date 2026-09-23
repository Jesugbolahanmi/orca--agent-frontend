(() => {
  // Empty = relative path, so Vercel serverless proxy at /api/[...path].js handles it
  const AQUA_API = '';
  const $ = id => document.getElementById(id);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const compact = v => {
    const n = num(v);
    if (n === null) return 'n/a';
    return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n);
  };
  const dollars = v => {
    const n = num(v);
    if (n === null) return 'n/a';
    if (n > 0 && n < 0.01) return '$' + n.toLocaleString('en-US', { maximumSignificantDigits: 4 });
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(n);
  };
  const val = (m, l, k) => m?.[k] ?? l?.[k] ?? null;

  // ── State ──────────────────────────────────────────────────────────────────
  let allLaunches = [];
  let pricesMap   = new Map();
  let loading     = false;

  // ── Status bar ─────────────────────────────────────────────────────────────
  function setStatus(text, kind = '') {
    const el = $('marketState');
    el.className = 'market-state' + (kind ? ' is-' + kind : '');
    el.querySelector('p').textContent = text;
  }

  function setSourceLabel(text) {
    $('sourceLabel').textContent = text;
  }

  // ── Render grid ────────────────────────────────────────────────────────────
  function renderGrid(launches) {
    const grid = $('marketGrid');
    grid.innerHTML = '';

    if (!launches.length) {
      grid.innerHTML = '<p class="empty-market">No launches found.</p>';
      return;
    }

    for (const launch of launches) {
      const market  = pricesMap.get(launch.id) || null;
      const symbol  = String(launch.symbol || 'TOKEN').toUpperCase();
      const price   = val(market, launch, 'priceUsd');
      const change  = num(val(market, launch, 'change24h'));
      const mcap    = val(market, launch, 'marketCapUsd');
      const vol     = val(market, launch, 'volume24hUsd');
      const holders = val(market, launch, 'holderCount');
      const pair    = String(launch.pairType || market?.pairType || '').toLowerCase();

      const changeClass = change === null ? '' : change >= 0 ? ' up' : ' down';
      const changeText  = change === null
        ? 'n/a'
        : (change >= 0 ? '+' : '') + change.toFixed(2) + '%';

      const card = document.createElement('article');
      card.className = 'token-card';
      card.innerHTML = `
        <div class="token-head">
          <div class="token-initials">${symbol.slice(0, 4)}</div>
          <div>
            <p class="token-name">${launch.name || 'Token'}</p>
            <p class="token-symbol">${symbol}</p>
          </div>
          <span class="token-pair">${pair === 'orca' ? 'ORCA' : 'SOL'}</span>
        </div>
        <div class="price-row">
          <p class="price">${dollars(price)}</p>
          <p class="change${changeClass}">${changeText} 24h</p>
        </div>
        <dl class="metrics">
          <div>
            <dt>Mkt Cap</dt>
            <dd>${dollars(mcap)}</dd>
          </div>
          <div>
            <dt>Vol 24h</dt>
            <dd>${dollars(vol)}</dd>
          </div>
          <div>
            <dt>Holders</dt>
            <dd>${holders !== null ? Number(holders).toLocaleString() : 'n/a'}</dd>
          </div>
        </dl>
      `;
      grid.appendChild(card);
    }
  }

  // ── Search filter ──────────────────────────────────────────────────────────
  function applySearch() {
    const q = ($('marketSearch')?.value || '').trim().toLowerCase();
    const filtered = q
      ? allLaunches.filter(l =>
          (l.name   || '').toLowerCase().includes(q) ||
          (l.symbol || '').toLowerCase().includes(q)
        )
      : allLaunches;
    renderGrid(filtered);
  }

  // ── Fetch data ─────────────────────────────────────────────────────────────
  async function loadMarkets() {
    if (loading) return;
    loading = true;
    $('refreshMarket').disabled = true;
    setStatus('Reading AQUA Launchpad launches…');
    setSourceLabel('Loading…');

    try {
      const [launchRes, priceRes] = await Promise.all([
        fetch(`${AQUA_API}/api/launches?limit=50`),
        fetch(`${AQUA_API}/api/market-prices`),
      ]);

      if (!launchRes.ok) throw new Error(`API ${launchRes.status}`);

      const launchData = await launchRes.json();
      allLaunches = launchData.launches || [];

      if (priceRes.ok) {
        const pd = await priceRes.json();
        pricesMap = new Map((pd.prices || []).map(p => [p.launchId, p]));
      }

      setStatus(`${allLaunches.length} launches loaded`, 'ready');
      setSourceLabel(`${allLaunches.length} launches · AQUA Launchpad`);
      applySearch();
    } catch (err) {
      console.error(err);
      setStatus('Failed to load markets: ' + err.message, 'error');
      setSourceLabel('Error');
    } finally {
      loading = false;
      $('refreshMarket').disabled = false;
    }
  }

  // ── Agent chat ─────────────────────────────────────────────────────────────
  function addMessage(text, role) {
    const feed = $('conversation');
    const div  = document.createElement('div');
    div.className = 'message ' + (role === 'user' ? 'user-message' : 'agent-message');
    div.textContent = text;
    feed.appendChild(div);
    feed.scrollTop = feed.scrollHeight;
  }

  function agentReply(prompt) {
    const q = prompt.toLowerCase();

    if (!allLaunches.length) {
      return 'Market data is still loading. Please wait a moment and try again.';
    }

    if (q.includes('how many') || q.includes('launch count') || q.includes('count')) {
      return `There are currently ${allLaunches.length} launches on the AQUA Launchpad.`;
    }

    if (q.includes('largest market cap') || q.includes('biggest market cap')) {
      const top = [...allLaunches].sort((a, b) =>
        (num(val(pricesMap.get(b.id), b, 'marketCapUsd')) || 0) -
        (num(val(pricesMap.get(a.id), a, 'marketCapUsd')) || 0)
      )[0];
      if (!top) return 'No market cap data available yet.';
      return `${top.name} (${top.symbol?.toUpperCase()}) has the largest market cap at ${dollars(val(pricesMap.get(top.id), top, 'marketCapUsd'))}.`;
    }

    if (q.includes('highest volume') || q.includes('most volume')) {
      const top = [...allLaunches].sort((a, b) =>
        (num(val(pricesMap.get(b.id), b, 'volume24hUsd')) || 0) -
        (num(val(pricesMap.get(a.id), a, 'volume24hUsd')) || 0)
      )[0];
      if (!top) return 'No volume data available yet.';
      return `${top.name} (${top.symbol?.toUpperCase()}) has the highest 24h volume at ${dollars(val(pricesMap.get(top.id), top, 'volume24hUsd'))}.`;
    }

    if (q.includes('market status') || q.includes('status')) {
      return `Market is live with ${allLaunches.length} launches. Data sourced directly from the AQUA Launchpad API.`;
    }

    // Token lookup
    const token = allLaunches.find(l =>
      (l.symbol || '').toLowerCase() === q ||
      (l.name   || '').toLowerCase().includes(q)
    );
    if (token) {
      const m     = pricesMap.get(token.id) || null;
      const price = val(m, token, 'priceUsd');
      const mcap  = val(m, token, 'marketCapUsd');
      const vol   = val(m, token, 'volume24hUsd');
      const chg   = num(val(m, token, 'change24h'));
      return `${token.name} (${token.symbol?.toUpperCase()})\n` +
             `Price: ${dollars(price)}\n` +
             `24h Change: ${chg !== null ? (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%' : 'n/a'}\n` +
             `Market Cap: ${dollars(mcap)}\n` +
             `24h Volume: ${dollars(vol)}`;
    }

    return `I couldn't find a token matching "${prompt}". Try a symbol like ORCA, or ask: launch count, largest market cap, highest volume, market status.`;
  }

  // ── Event listeners ────────────────────────────────────────────────────────
  $('refreshMarket')?.addEventListener('click', loadMarkets);
  $('marketSearch')?.addEventListener('input', applySearch);

  $('askForm')?.addEventListener('submit', e => {
    e.preventDefault();
    const input = $('askInput');
    const text  = input.value.trim();
    if (!text) return;
    addMessage(text, 'user');
    input.value = '';
    setTimeout(() => addMessage(agentReply(text), 'agent'), 280);
  });

  document.querySelectorAll('.quick-reads button').forEach(btn => {
    btn.addEventListener('click', () => {
      const prompt = btn.dataset.prompt || btn.textContent.trim();
      addMessage(prompt, 'user');
      setTimeout(() => addMessage(agentReply(prompt), 'agent'), 280);
    });
  });

  // Tab switching
  document.querySelectorAll('.nav-link').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-link').forEach(b => b.classList.toggle('is-active', b === btn));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('is-active', p.id === btn.dataset.tab));
    });
  });

  // ── Boot ───────────────────────────────────────────────────────────────────
  loadMarkets();
})();
