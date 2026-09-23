(() => {
  const AQUA_API    = '';
  const AQUA_SITE   = 'https://aquafamily.fun';
  const $  = id => document.getElementById(id);
  const $$ = sel => document.querySelectorAll(sel);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const dollars = v => {
    const n = num(v);
    if (n === null) return 'n/a';
    if (n > 0 && n < 0.01) return '$' + n.toLocaleString('en-US', { maximumSignificantDigits: 4 });
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(n);
  };
  const val = (m, l, k) => m?.[k] ?? l?.[k] ?? null;
  const shortAddr = a => a ? a.slice(0, 4) + '…' + a.slice(-4) : '';

  // ── State ─────────────────────────────────────────────────────────────────
  let allLaunches  = [];
  let pricesMap    = new Map();
  let walletAddr   = null;
  let loadingMkt   = false;
  let loadingPort  = false;

  // ── Status ────────────────────────────────────────────────────────────────
  function setStatus(text, kind = '') {
    const el = $('marketState');
    el.className = 'market-state' + (kind ? ' is-' + kind : '');
    el.querySelector('p').textContent = text;
  }
  function setSourceLabel(text) { $('sourceLabel').textContent = text; }

  // ── Market ────────────────────────────────────────────────────────────────
  async function loadMarkets() {
    if (loadingMkt) return;
    loadingMkt = true;
    $('refreshMarket').disabled = true;
    setStatus('Reading AQUA Launchpad launches…');
    setSourceLabel('Loading…');

    try {
      const [launchRes, priceRes] = await Promise.all([
        fetch(`${AQUA_API}/api/launches?limit=50`),
        fetch(`${AQUA_API}/api/market-prices`),
      ]);
      if (!launchRes.ok) throw new Error(`API ${launchRes.status}`);

      const ld = await launchRes.json();
      allLaunches = ld.launches || [];

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
      loadingMkt = false;
      $('refreshMarket').disabled = false;
    }
  }

  function applySearch() {
    const q = ($('marketSearch')?.value || '').trim().toLowerCase();
    const list = q
      ? allLaunches.filter(l => (l.name || '').toLowerCase().includes(q) || (l.symbol || '').toLowerCase().includes(q))
      : allLaunches;
    renderGrid(list);
  }

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
      const changeText  = change === null ? 'n/a' : (change >= 0 ? '+' : '') + change.toFixed(2) + '%';

      const card = document.createElement('article');
      card.className = 'token-card';
      card.innerHTML = `
        <div class="token-head">
          <div class="token-initials">${symbol.slice(0,4)}</div>
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
          <div><dt>Mkt Cap</dt><dd>${dollars(mcap)}</dd></div>
          <div><dt>Vol 24h</dt><dd>${dollars(vol)}</dd></div>
          <div><dt>Holders</dt><dd>${holders !== null ? Number(holders).toLocaleString() : 'n/a'}</dd></div>
        </dl>
        <button class="card-buy-btn" data-mint="${launch.mint || ''}" data-symbol="${symbol}" data-name="${launch.name || 'Token'}" data-price="${dollars(price)}">Buy ${symbol} →</button>
      `;
      grid.appendChild(card);
    }

    // Buy button listeners on cards
    grid.querySelectorAll('.card-buy-btn').forEach(btn => {
      btn.addEventListener('click', () => openBuyModal({
        mint:   btn.dataset.mint,
        symbol: btn.dataset.symbol,
        name:   btn.dataset.name,
        price:  btn.dataset.price,
      }));
    });
  }

  // ── Buy Modal ─────────────────────────────────────────────────────────────
  function openBuyModal({ mint, symbol, name, price }) {
    $('buyModalInitials').textContent = symbol.slice(0, 4);
    $('buyModalName').textContent     = name;
    $('buyModalPrice').textContent    = price || '';
    const link = AQUA_SITE;
    $('buyModalLink').href = link;
    $('buyModal').hidden  = false;
    document.body.style.overflow = 'hidden';
  }
  function closeBuyModal() {
    $('buyModal').hidden = true;
    document.body.style.overflow = '';
  }
  $('buyModalClose')?.addEventListener('click', closeBuyModal);
  $('buyModal')?.addEventListener('click', e => { if (e.target === $('buyModal')) closeBuyModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeBuyModal(); });

  // ── Wallet ────────────────────────────────────────────────────────────────
  async function connectWallet() {
    const phantom = window.solana;
    if (!phantom?.isPhantom) {
      window.open('https://phantom.app/', '_blank');
      return;
    }
    try {
      const resp = await phantom.connect();
      walletAddr = resp.publicKey.toString();
      onWalletConnected();
    } catch (err) {
      console.error('Wallet connect failed:', err);
    }
  }

  function disconnectWallet() {
    window.solana?.disconnect?.();
    walletAddr = null;
    onWalletDisconnected();
  }

  function onWalletConnected() {
    // Update both wallet buttons
    $$('.wallet-btn').forEach(btn => {
      btn.textContent = shortAddr(walletAddr);
      btn.classList.add('is-connected');
    });
    // Show portfolio
    renderPortfolioShell();
    loadPortfolio();
  }

  function onWalletDisconnected() {
    $$('.wallet-btn').forEach(btn => {
      btn.textContent = 'Connect Wallet';
      btn.classList.remove('is-connected');
    });
    $('portfolioContent').innerHTML = `
      <div class="connect-prompt">
        <div class="connect-prompt-icon">◎</div>
        <p>Connect your Phantom wallet to see your AQUA Launchpad holdings.</p>
        <button class="wallet-btn" id="portfolioConnectBtn">Connect Wallet</button>
      </div>`;
    $('portfolioConnectBtn')?.addEventListener('click', connectWallet);
    $('refreshPortfolio').style.display = 'none';
  }

  // ── Portfolio ─────────────────────────────────────────────────────────────
  function renderPortfolioShell() {
    $('portfolioContent').innerHTML = `
      <div class="wallet-address-bar">
        <span>◎ ${walletAddr}</span>
        <button class="wallet-disconnect" id="disconnectBtn">Disconnect</button>
      </div>
      <div class="portfolio-grid" id="portfolioGrid"></div>
    `;
    $('disconnectBtn')?.addEventListener('click', disconnectWallet);
    $('refreshPortfolio').style.display = 'block';
  }

  async function loadPortfolio() {
    if (!walletAddr || loadingPort) return;
    loadingPort = true;
    const grid = $('portfolioGrid');
    if (grid) grid.innerHTML = '<p class="portfolio-empty">Loading holdings…</p>';

    try {
      const res = await fetch(`${AQUA_API}/api/wallets/${encodeURIComponent(walletAddr)}/holdings`);
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data = await res.json();
      const holdings = data.holdings || data || [];
      renderPortfolio(holdings);
    } catch (err) {
      console.error(err);
      if (grid) grid.innerHTML = `<p class="portfolio-empty">Could not load holdings: ${err.message}</p>`;
    } finally {
      loadingPort = false;
    }
  }

  function renderPortfolio(holdings) {
    const grid = $('portfolioGrid');
    if (!grid) return;
    grid.innerHTML = '';

    if (!holdings.length) {
      grid.innerHTML = '<p class="portfolio-empty">No AQUA Launchpad tokens found in this wallet.</p>';
      return;
    }

    for (const h of holdings) {
      const launch = allLaunches.find(l => l.id === h.launchId || l.mint === h.mint) || {};
      const market = pricesMap.get(h.launchId || launch.id) || null;
      const symbol = String(h.symbol || launch.symbol || 'TOKEN').toUpperCase();
      const name   = h.name || launch.name || 'Token';
      const amount = num(h.amount || h.balance);
      const price  = val(market, launch, 'priceUsd');
      const valueUsd = (amount !== null && num(price) !== null) ? dollars(amount * num(price)) : 'n/a';
      const mint   = h.mint || launch.mint || '';

      const card = document.createElement('article');
      card.className = 'holding-card';
      card.innerHTML = `
        <div class="holding-head">
          <div class="token-initials">${symbol.slice(0,4)}</div>
          <div>
            <p class="token-name">${name}</p>
            <p class="token-symbol">${symbol}</p>
          </div>
        </div>
        <div class="holding-amount">${amount !== null ? amount.toLocaleString('en-US', {maximumFractionDigits: 4}) : 'n/a'} <span style="font-size:13px;color:var(--quiet);font-weight:500">${symbol}</span></div>
        <div class="holding-value">≈ ${valueUsd} · ${dollars(price)} each</div>
        <button class="card-buy-btn holding-buy-btn" data-mint="${mint}" data-symbol="${symbol}" data-name="${name}" data-price="${dollars(price)}">Trade ${symbol} →</button>
      `;
      grid.appendChild(card);
    }

    grid.querySelectorAll('.card-buy-btn').forEach(btn => {
      btn.addEventListener('click', () => openBuyModal({
        mint:   btn.dataset.mint,
        symbol: btn.dataset.symbol,
        name:   btn.dataset.name,
        price:  btn.dataset.price,
      }));
    });
  }

  // ── Agent ─────────────────────────────────────────────────────────────────
  function addMessage(text, role, extra = null) {
    const feed = $('conversation');
    const div  = document.createElement('div');
    div.className = 'message ' + (role === 'user' ? 'user-message' : 'agent-message');
    div.textContent = text;
    if (extra) div.appendChild(extra);
    feed.appendChild(div);
    feed.scrollTop = feed.scrollHeight;
  }

  function makeBuyLink(launch) {
    const mint = launch.mint || '';
    const url  = AQUA_SITE;
    const a = document.createElement('a');
    a.className = 'buy-inline-btn';
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = `Buy ${(launch.symbol || '').toUpperCase()} on AQUA Family →`;
    return a;
  }

  function agentReply(prompt) {
    const q = prompt.toLowerCase().trim();

    if (!allLaunches.length) {
      return { text: 'Market data is still loading. Please try again in a moment.', link: null };
    }

    // Buy intent
    const buyMatch = q.match(/^buy\s+(.+)/);
    if (buyMatch) {
      const target = buyMatch[1].trim();
      const launch = allLaunches.find(l =>
        (l.symbol || '').toLowerCase() === target ||
        (l.name   || '').toLowerCase().includes(target)
      );
      if (launch) {
        return { text: `Opening ${launch.name} (${(launch.symbol || '').toUpperCase()}) on AQUA Family…`, link: makeBuyLink(launch) };
      }
      return { text: `I couldn't find a token matching "${buyMatch[1]}". Check the spelling or search in the Market tab.`, link: null };
    }

    // Stats
    if (q.includes('how many') || q.includes('launch count') || q.includes('count')) {
      return { text: `There are ${allLaunches.length} launches on the AQUA Launchpad right now.`, link: null };
    }
    if (q.includes('largest market cap') || q.includes('biggest')) {
      const top = [...allLaunches].sort((a,b) => (num(val(pricesMap.get(b.id),b,'marketCapUsd'))||0) - (num(val(pricesMap.get(a.id),a,'marketCapUsd'))||0))[0];
      return { text: top ? `${top.name} (${top.symbol?.toUpperCase()}) has the largest market cap at ${dollars(val(pricesMap.get(top.id),top,'marketCapUsd'))}.` : 'No data yet.', link: null };
    }
    if (q.includes('highest volume') || q.includes('most volume')) {
      const top = [...allLaunches].sort((a,b) => (num(val(pricesMap.get(b.id),b,'volume24hUsd'))||0) - (num(val(pricesMap.get(a.id),a,'volume24hUsd'))||0))[0];
      return { text: top ? `${top.name} (${top.symbol?.toUpperCase()}) has the highest 24h volume at ${dollars(val(pricesMap.get(top.id),top,'volume24hUsd'))}.` : 'No data yet.', link: null };
    }
    if (q.includes('top gainer') || q.includes('best performer')) {
      const top = [...allLaunches].filter(l => num(val(pricesMap.get(l.id),l,'change24h')) !== null)
        .sort((a,b) => (num(val(pricesMap.get(b.id),b,'change24h'))||0) - (num(val(pricesMap.get(a.id),a,'change24h'))||0))[0];
      const chg = top ? num(val(pricesMap.get(top.id),top,'change24h')) : null;
      return { text: top ? `Top gainer: ${top.name} (${top.symbol?.toUpperCase()}) +${chg?.toFixed(2)}% in the last 24h.` : 'No change data yet.', link: null };
    }
    if (q.includes('market status') || q.includes('status')) {
      return { text: `Market is live · ${allLaunches.length} launches · Data from AQUA Launchpad API.`, link: null };
    }
    if (q === 'help') {
      return { text: 'I can help you with:\n• price of [token]\n• buy [token]\n• largest market cap\n• highest volume\n• top gainers\n• how many launches\n• market status', link: null };
    }

    // Token lookup
    const token = allLaunches.find(l =>
      (l.symbol || '').toLowerCase() === q ||
      (l.name   || '').toLowerCase().includes(q)
    );
    if (token) {
      const m   = pricesMap.get(token.id) || null;
      const chg = num(val(m, token, 'change24h'));
      const text = `${token.name} (${token.symbol?.toUpperCase()})\nPrice: ${dollars(val(m,token,'priceUsd'))}\n24h Change: ${chg !== null ? (chg>=0?'+':'') + chg.toFixed(2)+'%' : 'n/a'}\nMarket Cap: ${dollars(val(m,token,'marketCapUsd'))}\n24h Volume: ${dollars(val(m,token,'volume24hUsd'))}`;
      return { text, link: makeBuyLink(token) };
    }

    return { text: `I couldn't find "${prompt}". Try a token symbol, or ask: buy ORCA, largest market cap, top gainers, market status.`, link: null };
  }

  $('askForm')?.addEventListener('submit', e => {
    e.preventDefault();
    const input = $('askInput');
    const text  = input.value.trim();
    if (!text) return;
    addMessage(text, 'user');
    input.value = '';
    setTimeout(() => {
      const { text: reply, link } = agentReply(text);
      addMessage(reply, 'agent', link);
    }, 220);
  });

  $$('.quick-reads button').forEach(btn => {
    btn.addEventListener('click', () => {
      const prompt = btn.dataset.prompt || btn.textContent.trim();
      addMessage(prompt, 'user');
      setTimeout(() => {
        const { text, link } = agentReply(prompt);
        addMessage(text, 'agent', link);
      }, 220);
    });
  });

  // ── Tabs ──────────────────────────────────────────────────────────────────
  $$('.nav-link').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.nav-link').forEach(b => { b.classList.toggle('is-active', b === btn); b.setAttribute('aria-selected', b === btn); });
      $$('.tab-panel').forEach(p => p.classList.toggle('is-active', p.id === btn.dataset.tab));
    });
  });

  // ── Event wiring ──────────────────────────────────────────────────────────
  $('refreshMarket')?.addEventListener('click', loadMarkets);
  $('marketSearch')?.addEventListener('input', applySearch);
  $('refreshPortfolio')?.addEventListener('click', loadPortfolio);

  // Wallet buttons
  $('walletBtn')?.addEventListener('click', () => {
    walletAddr ? disconnectWallet() : connectWallet();
  });
  $('portfolioConnectBtn')?.addEventListener('click', connectWallet);

  // Auto-reconnect if Phantom is already connected
  if (window.solana?.isPhantom && window.solana.isConnected) {
    window.solana.connect({ onlyIfTrusted: true }).then(resp => {
      walletAddr = resp.publicKey.toString();
      onWalletConnected();
    }).catch(() => {});
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  loadMarkets();
})();
