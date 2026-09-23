(() => {
  const AQUA_API  = '';
  const JUP_PROXY = '/api/jupiter';
  const SOL_MINT  = 'So11111111111111111111111111111111111111112';
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
  let allLaunches = [];
  let pricesMap   = new Map();
  let walletAddr  = null;
  let loadingMkt  = false;
  let loadingPort = false;
  let chatHistory = JSON.parse(localStorage.getItem('orca_chat') || '[]');
  let pendingBuyTarget = null;

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
        <a class="card-buy-btn" href="https://aquafamily.fun/#/token/${launch.id}" target="_blank" rel="noopener" style="text-decoration:none;display:inline-block;text-align:center;box-sizing:border-box;">View Market ↗</a>
      `;
      grid.appendChild(card);
    }
  }

  // ── Swap Quote Flow ────────────────────────────────────────────────────────
  // Calls Jupiter via our Vercel proxy (avoids CORS), shows an inline quote card.
  async function triggerBuyFlow(launch, solAmount) {
    const symbol = (launch.symbol || 'TOKEN').toUpperCase();

    if (!launch.mint) {
      addMessage(`No mint address found for ${symbol}. Cannot get a quote.`, 'agent');
      return;
    }

    const lamports = Math.round(solAmount * 1e9);

    try {
      const quoteRes = await fetch(
        `${JUP_PROXY}?endpoint=quote` +
        `&inputMint=${encodeURIComponent(SOL_MINT)}` +
        `&outputMint=${encodeURIComponent(launch.mint)}` +
        `&amount=${lamports}` +
        `&slippageBps=50`
      );
      if (!quoteRes.ok) throw new Error(`Quote API returned ${quoteRes.status}`);
      const quote = await quoteRes.json();
      if (quote.error) throw new Error(quote.error);

      // Calculate display values
      const decimals   = launch.decimals ?? 9;
      const outDisplay = (Number(quote.outAmount) / Math.pow(10, decimals))
        .toLocaleString('en-US', { maximumSignificantDigits: 6 });
      const inSol     = (Number(quote.inAmount) / 1e9).toFixed(4);
      const impact    = parseFloat(quote.priceImpactPct || 0);
      const impactPct = (impact < 0.01 ? '<0.01' : impact.toFixed(2)) + '%';

      // Build the inline swap card (we do not save this in chatHistory)
      const card   = document.createElement('div');
      const btnId  = 'scb_' + Date.now();
      card.className = 'swap-quote-card';
      card.innerHTML = `
        <div class="swap-route">
          <span class="swap-in">${inSol} SOL</span>
          <span class="swap-arrow">→</span>
          <span class="swap-out">~${outDisplay} ${symbol}</span>
        </div>
        <div class="swap-meta">
          <span>Slippage: 0.5%</span>
          <span>Price impact: ${impactPct}</span>
        </div>
        <button class="swap-confirm-btn" id="${btnId}">⚡ Confirm Swap in Wallet</button>
      `;

      addMessage('', 'agent', card, false);

      document.getElementById(btnId).addEventListener('click', async function () {
        if (!walletAddr) {
          addMessage('Please connect your wallet first (top-right button).', 'agent');
          return;
        }
        await executeSwap(quote, launch, this);
      });

    } catch (err) {
      console.error(err);
      addMessage(`Couldn't get a quote: ${err.message}`, 'agent');
    }
  }

  async function executeSwap(quote, launch, confirmBtn) {
    const symbol = (launch.symbol || 'TOKEN').toUpperCase();
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Building transaction…';

    try {
      // 1. Build swap transaction via Vercel proxy → Jupiter
      const swapRes = await fetch(`${JUP_PROXY}?endpoint=swap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey: walletAddr,
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: 'auto',
        }),
      });
      if (!swapRes.ok) throw new Error(`Swap API returned ${swapRes.status}`);
      const { swapTransaction } = await swapRes.json();
      if (!swapTransaction) throw new Error('No transaction returned from swap API');

      // 2. Deserialize and send to wallet for signing
      confirmBtn.textContent = 'Waiting for wallet…';
      const txBytes = Uint8Array.from(atob(swapTransaction), c => c.charCodeAt(0));

      let signature;
      if (window.solanaWeb3) {
        const tx = window.solanaWeb3.VersionedTransaction.deserialize(txBytes);
        const result = await window.solana.signAndSendTransaction(tx);
        signature = result.signature;
      } else {
        // Fallback for wallets that accept raw bytes
        const result = await window.solana.signAndSendTransaction({ serialize: () => txBytes });
        signature = result.signature;
      }

      // 3. Show success
      confirmBtn.textContent = '✅ Submitted!';
      confirmBtn.style.background = 'var(--up)';
      confirmBtn.style.color = '#0a1a0d';
      addMessage(
        `✅ Swap submitted! ${symbol} purchase is on-chain.\nTx: ${signature.slice(0,8)}…${signature.slice(-6)}`,
        'agent'
      );

    } catch (err) {
      console.error(err);
      confirmBtn.disabled = false;
      confirmBtn.textContent = '⚡ Confirm Swap in Wallet';
      const rejected = err.message?.toLowerCase().includes('reject') ||
                       err.message?.toLowerCase().includes('cancel') ||
                       err.message?.toLowerCase().includes('user denied');
      addMessage(rejected ? 'Transaction cancelled.' : `Swap failed: ${err.message}`, 'agent');
    }
  }

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
    localStorage.removeItem('orca_wallet');
    onWalletDisconnected();
  }

  function onWalletConnected() {
    $$('.wallet-btn').forEach(btn => {
      btn.textContent = shortAddr(walletAddr);
      btn.classList.add('is-connected');
    });
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
        <p>Connect your wallet to see your AQUA Launchpad holdings.</p>
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
      const res = await fetch(`${AQUA_API}/api/wallets/${encodeURIComponent(walletAddr)}/holdings?_t=${Date.now()}`);
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
      const launchData = h.launch || h;
      const launchId   = launchData.id || h.launchId;
      const mint       = launchData.mint || h.mint;
      const symbol     = String(launchData.symbol || h.symbol || 'TOKEN').toUpperCase();
      const name       = launchData.name || h.name || 'Token';
      const decimals   = launchData.tokenDecimals ?? launchData.decimals ?? 6;
      
      let amount = num(h.amount || h.balance);
      if (h.balanceRaw) {
        amount = Number(h.balanceRaw) / Math.pow(10, decimals);
      }

      // Try to get live price from global map, fallback to snapshot price in holding
      const market = pricesMap.get(launchId) || null;
      const price  = val(market, launchData, 'priceUsd') || launchData.priceUsd || 0;
      const valueUsd = h.valueUsd !== undefined ? h.valueUsd : ((amount !== null && price) ? (amount * price) : null);

      const launchObj = { ...launchData, id: launchId, mint, symbol, name, decimals };

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
        <div class="holding-value">≈ ${valueUsd !== null ? dollars(valueUsd) : 'n/a'} · ${dollars(price)} each</div>
        <button class="card-buy-btn holding-buy-btn">Swap ${symbol} →</button>
      `;
      card.querySelector('.holding-buy-btn').addEventListener('click', () => {
        // Switch to agent tab
        $$('.nav-link').forEach(b => { b.classList.toggle('is-active', b.dataset.tab === 'agent'); b.setAttribute('aria-selected', b.dataset.tab === 'agent'); });
        $$('.tab-panel').forEach(p => p.classList.toggle('is-active', p.id === 'agent'));
        addMessage(`buy ${name}`, 'user');
        pendingBuyTarget = launchObj;
        setTimeout(() => {
          addMessage(`How much SOL worth of ${symbol} would you like to buy? (e.g., 0.1)\nType "cancel" to abort.`, 'agent');
        }, 220);
      });
      grid.appendChild(card);
    }
  }

  // ── Agent ─────────────────────────────────────────────────────────────────
  function addMessage(text, role, extra = null, save = true) {
    const feed = $('conversation');
    const div  = document.createElement('div');
    div.className = 'message ' + (role === 'user' ? 'user-message' : 'agent-message');
    div.innerHTML = text.replace(/\n/g, '<br>');
    if (extra) div.appendChild(extra);
    feed.appendChild(div);
    feed.scrollTop = feed.scrollHeight;
    
    if (save && text) {
      chatHistory.push({ text, role });
      localStorage.setItem('orca_chat', JSON.stringify(chatHistory));
    }
  }

  function makeBuyLink(launch) {
    const symbol = (launch.symbol || 'TOKEN').toUpperCase();
    const btn = document.createElement('button');
    btn.className = 'buy-inline-btn';
    btn.textContent = `⚡ Swap ${symbol} now`;
    btn.addEventListener('click', () => {
      addMessage(`buy ${symbol}`, 'user');
      pendingBuyTarget = launch;
      setTimeout(() => {
        addMessage(`How much SOL worth of ${symbol} would you like to buy? (e.g., 0.1)\nType "cancel" to abort.`, 'agent');
      }, 220);
    });
    return btn;
  }

  function agentReply(prompt) {
    const q = prompt.toLowerCase().trim();

    if (!allLaunches.length) {
      return { text: 'Market data is still loading. Please try again in a moment.', link: null };
    }

    if (pendingBuyTarget) {
      const solAmount = parseFloat(q);
      if (q === 'cancel' || q === 'stop') {
        pendingBuyTarget = null;
        return { text: 'Buy cancelled. What else can I help you with?', link: null };
      }
      if (!isNaN(solAmount) && solAmount > 0) {
        const launch = pendingBuyTarget;
        pendingBuyTarget = null;
        setTimeout(() => triggerBuyFlow(launch, solAmount), 300);
        return { text: `Getting a quote for ${solAmount} SOL → ${(launch.symbol || '').toUpperCase()}…`, link: null };
      } else {
        return { text: 'Please enter a valid amount in SOL (e.g., 0.1), or type "cancel".', link: null };
      }
    }

    // Buy intent — supports: "buy aqua", "buy $aqua", "buy 0.5 sol of aqua"
    const buyMatch = q.match(/^buy\s+(?:(\d+\.?\d*)\s+sol\s+(?:of\s+)?)?\$?(.+)/);
    if (buyMatch) {
      const amountStr = buyMatch[1];
      const target    = buyMatch[2].trim();
      const launch    = allLaunches.find(l =>
        (l.symbol || '').toLowerCase() === target ||
        (l.name   || '').toLowerCase().includes(target)
      );
      if (launch) {
        if (amountStr) {
          const solAmount = parseFloat(amountStr);
          setTimeout(() => triggerBuyFlow(launch, solAmount), 300);
          return {
            text: `Getting a quote for ${solAmount} SOL → ${(launch.symbol || '').toUpperCase()}…`,
            link: null,
          };
        } else {
          pendingBuyTarget = launch;
          return {
            text: `How much SOL worth of ${(launch.symbol || '').toUpperCase()} would you like to buy? (e.g., 0.1)\nType "cancel" to abort.`,
            link: null
          };
        }
      }
      return {
        text: `I couldn't find "${target}". Check the spelling or browse the Market tab.`,
        link: null,
      };
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
      return { text: top ? `Top gainer: ${top.name} (${top.symbol?.toUpperCase()}) +${chg?.toFixed(2)}% in 24h.` : 'No change data yet.', link: null };
    }
    if (q.includes('market status') || q.includes('status')) {
      return { text: `Market is live · ${allLaunches.length} launches · Data from AQUA Launchpad API.`, link: null };
    }
    if (q === 'help') {
      return { text: 'Commands:\n• buy [token]\n• buy 0.5 sol of [token]\n• price of [token]\n• largest market cap\n• highest volume\n• top gainers\n• how many launches\n• market status', link: null };
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

    return { text: `I couldn't find "${prompt}". Try a token name, or: buy ORCA · largest market cap · top gainers.`, link: null };
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
      localStorage.setItem('orca_tab', btn.dataset.tab);
    });
  });

  // ── Event wiring ──────────────────────────────────────────────────────────
  $('refreshMarket')?.addEventListener('click', loadMarkets);
  $('marketSearch')?.addEventListener('input', applySearch);
  $('refreshPortfolio')?.addEventListener('click', loadPortfolio);

  $('walletBtn')?.addEventListener('click', () => {
    walletAddr ? disconnectWallet() : connectWallet();
  });
  $('portfolioConnectBtn')?.addEventListener('click', connectWallet);

  // ── Boot ──────────────────────────────────────────────────────────────────
  if (!chatHistory.length) {
    chatHistory.push({ text: "I'm watching the AQUA Launchpad in real time. Ask me about any token, market stats — or say <strong>buy [symbol]</strong> to swap directly here with any Solana wallet.", role: 'agent' });
  }
  const feed = $('conversation');
  if (feed) {
    feed.innerHTML = '';
    chatHistory.forEach(msg => {
      const div = document.createElement('div');
      div.className = 'message ' + (msg.role === 'user' ? 'user-message' : 'agent-message');
      div.innerHTML = msg.text.replace(/\n/g, '<br>');
      feed.appendChild(div);
    });
    feed.scrollTop = feed.scrollHeight;
  }

  const savedWallet = localStorage.getItem('orca_wallet');
  if (savedWallet) {
    walletAddr = savedWallet;
    onWalletConnected();
  }

  // Auto-reconnect if wallet is already trusted
  if (window.solana?.isPhantom) {
    window.solana.connect({ onlyIfTrusted: true }).then(resp => {
      walletAddr = resp.publicKey.toString();
      localStorage.setItem('orca_wallet', walletAddr);
      onWalletConnected();
    }).catch(() => {});
  }

  // Restore active tab
  const activeTab = localStorage.getItem('orca_tab');
  if (activeTab) {
    const targetBtn = document.querySelector(`.nav-link[data-tab="${activeTab}"]`);
    if (targetBtn) targetBtn.click();
  }

  loadMarkets();
})();
