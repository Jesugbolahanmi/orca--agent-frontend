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
  let pendingSellTarget = null;
  let lastPrompt = null;
  let currentMarketList = [];
  let marketPage = 1;

  // Conversation state tracked by OrcaBrain
  let agentState = {
    lastResolvedMint: null,
    pendingChoices:   null,
    pendingIntent:    null,
  };

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
      // Paginate through all launches (API max = 100 per page)
      let allFetched = [];
      let offset = 0;
      let hasMore = true;
      while (hasMore) {
        const res = await fetch(`${AQUA_API}/api/launches?limit=100&offset=${offset}`);
        if (!res.ok) throw new Error(`API ${res.status}`);
        const data = await res.json();
        const batch = data.launches || [];
        allFetched = allFetched.concat(batch);
        hasMore  = !!data.hasMore;
        offset   = data.nextOffset ?? (offset + batch.length);
        if (!batch.length) break; // safety guard
      }
      allLaunches = allFetched;

      // Load prices in parallel
      const priceRes = await fetch(`${AQUA_API}/api/market-prices`);
      if (priceRes.ok) {
        const pd = await priceRes.json();
        pricesMap = new Map((pd.prices || []).map(p => [p.launchId, p]));
      }

      setStatus(`${allLaunches.length} launches loaded`, 'ready');
      setSourceLabel(`${allLaunches.length} tokens · AQUA Launchpad`);
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
    currentMarketList = q
      ? allLaunches.filter(l => (l.name || '').toLowerCase().includes(q) || (l.symbol || '').toLowerCase().includes(q))
      : allLaunches;
    marketPage = 1;
    renderGrid();
  }

  function renderGrid() {
    const grid = $('marketGrid');
    const pagination = $('marketPagination');
    grid.innerHTML = '';
    if (pagination) {
      pagination.innerHTML = '';
      pagination.style.display = 'none';
    }

    if (!currentMarketList.length) {
      grid.innerHTML = '<p class="empty-market">No launches found.</p>';
      return;
    }

    const pageSize = 20;
    const totalPages = Math.ceil(currentMarketList.length / pageSize);
    const start = (marketPage - 1) * pageSize;
    const end = start + pageSize;
    const pageData = currentMarketList.slice(start, end);

    for (const launch of pageData) {
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

    if (totalPages > 1 && pagination) {
      pagination.style.display = 'flex';
      
      const prevBtn = document.createElement('button');
      prevBtn.className = 'page-btn';
      prevBtn.textContent = 'Prev';
      prevBtn.disabled = marketPage === 1;
      prevBtn.onclick = () => { if (marketPage > 1) { marketPage--; renderGrid(); window.scrollTo({top: 0, behavior: 'smooth'}); } };
      pagination.appendChild(prevBtn);

      const info = document.createElement('span');
      info.style.color = 'var(--quiet)';
      info.style.fontSize = '12px';
      info.style.fontWeight = '600';
      info.textContent = `Page ${marketPage} of ${totalPages}`;
      pagination.appendChild(info);

      const nextBtn = document.createElement('button');
      nextBtn.className = 'page-btn';
      nextBtn.textContent = 'Next';
      nextBtn.disabled = marketPage === totalPages;
      nextBtn.onclick = () => { if (marketPage < totalPages) { marketPage++; renderGrid(); window.scrollTo({top: 0, behavior: 'smooth'}); } };
      pagination.appendChild(nextBtn);
    }
  }

  // ── Swap Quote Flow (Sell) ──────────────────────────────────────────────────
  async function triggerSellFlow(launch, tokenAmount) {
    const symbol    = (launch.symbol || 'TOKEN').toUpperCase();
    const aquaUrl   = `https://aquafamily.fun/#/token/${launch.id || launch.mint}`;
    const orcaUrl   = launch.whirlpoolAddress ? `https://www.orca.so/pools/${launch.whirlpoolAddress}` : null;

    if (!launch.mint) {
      addMessage(`No mint address found for ${symbol}. Cannot get a quote.`, 'agent');
      return;
    }

    const decimals = launch.tokenDecimals ?? launch.decimals ?? 6;
    const rawAmount = Math.round(tokenAmount * Math.pow(10, decimals));

    try {
      const quoteRes = await fetch(
        `${JUP_PROXY}?endpoint=quote` +
        `&inputMint=${encodeURIComponent(launch.mint)}` +
        `&outputMint=${encodeURIComponent(SOL_MINT)}` +
        `&amount=${rawAmount}` +
        `&slippageBps=50`
      );

      if (!quoteRes.ok) {
        let errDetail = '';
        try {
          const errBody = await quoteRes.json();
          errDetail = errBody.error || errBody.message || '';
        } catch (_) {}

        if (quoteRes.status === 400) {
          const card = document.createElement('div');
          card.className = 'swap-quote-card swap-quote-no-route';
          card.innerHTML = `
            <div class="swap-no-route-icon">⚠️</div>
            <p class="swap-no-route-msg">
              <strong>No Jupiter route found for ${symbol}.</strong><br>
              ${symbol} trades in an Orca CLMM pool that Jupiter doesn't currently index.
              You can swap it directly on AQUA or Orca:
            </p>
            <div class="swap-fallback-links">
              <a class="swap-fallback-btn" href="${aquaUrl}" target="_blank" rel="noopener">Trade on AQUA ↗</a>
              ${orcaUrl ? `<a class="swap-fallback-btn orca" href="${orcaUrl}" target="_blank" rel="noopener">Orca Pool ↗</a>` : ''}
            </div>
          `;
          addMessage('', 'agent', card, false);
          return;
        }
        throw new Error(`Quote API returned ${quoteRes.status}${errDetail ? ': ' + errDetail : ''}`);
      }

      const quote = await quoteRes.json();
      if (quote.error) throw new Error(quote.error);

      const inDisplay = tokenAmount.toLocaleString('en-US', { maximumSignificantDigits: 6 });
      const outSol    = (Number(quote.outAmount) / 1e9).toFixed(4);
      const impact    = parseFloat(quote.priceImpactPct || 0);
      const impactPct = (impact < 0.01 ? '<0.01' : impact.toFixed(2)) + '%';

      const card   = document.createElement('div');
      const btnId  = 'scb_' + Date.now();
      card.className = 'swap-quote-card';
      card.innerHTML = `
        <div class="swap-route">
          <span class="swap-in">${inDisplay} ${symbol}</span>
          <span class="swap-arrow">→</span>
          <span class="swap-out">~${outSol} SOL</span>
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
      const card = document.createElement('div');
      card.className = 'swap-quote-card swap-quote-no-route';
      card.innerHTML = `
        <div class="swap-no-route-icon">❌</div>
        <p class="swap-no-route-msg"><strong>Couldn't get a quote for ${symbol}.</strong><br>${err.message}</p>
        <div class="swap-fallback-links">
          <a class="swap-fallback-btn" href="${aquaUrl}" target="_blank" rel="noopener">🌊 Trade on AQUA ↗</a>
          ${orcaUrl ? `<a class="swap-fallback-btn orca" href="${orcaUrl}" target="_blank" rel="noopener">🐳 Orca Pool ↗</a>` : ''}
        </div>
      `;
      addMessage('', 'agent', card, false);
    }
  }

  // ── Balance Check Flow ─────────────────────────────────────────────────────
  async function triggerBalanceFlow(launch, tokenNameStr) {
    if (!walletAddr) {
      addMessage("You need to connect your wallet first (top-right) to check your balances.", "agent");
      return;
    }
    
    // Check if the user is asking about SOL
    if (tokenNameStr.toLowerCase() === 'sol' || tokenNameStr.toLowerCase() === 'solana') {
      try {
        const res = await fetch(`${AQUA_API}/api/wallets/${encodeURIComponent(walletAddr)}/holdings?_t=${Date.now()}`);
        if (res.ok) {
          const data = await res.json();
          const solHolding = data.solBalance; // the API might return solBalance, or we just fallback
          if (solHolding !== undefined) {
             addMessage(`You currently have **${Number(solHolding).toFixed(4)} SOL** in your wallet.`, "agent");
             return;
          }
        }
      } catch (err) { console.error(err); }
      addMessage("I can check AQUA Launchpad token balances. Check your wallet extension for your SOL balance.", "agent");
      return;
    }

    if (!launch) {
      addMessage(`I couldn't find "${tokenNameStr}" on the AQUA Launchpad to check your balance.`, "agent");
      return;
    }

    try {
      const res = await fetch(`${AQUA_API}/api/wallets/${encodeURIComponent(walletAddr)}/holdings?_t=${Date.now()}`);
      if (!res.ok) throw new Error('API error');
      const data = await res.json();
      const holdings = data.holdings || data || [];
      
      const holding = holdings.find(h => {
        const hMint = (h.launch?.mint || h.mint || '').toLowerCase();
        return hMint === (launch.mint || '').toLowerCase();
      });
      
      const symbol = (launch.symbol || 'TOKEN').toUpperCase();
      
      if (!holding) {
        addMessage(`You don't currently hold any **${symbol}** in this wallet.`, "agent");
        return;
      }

      const launchData = holding.launch || holding;
      const decimals   = launchData.tokenDecimals ?? launchData.decimals ?? 6;
      let amount = num(holding.amount || holding.balance);
      if (holding.balanceRaw) {
        amount = Number(holding.balanceRaw) / Math.pow(10, decimals);
      }
      
      if (!amount || amount <= 0) {
        addMessage(`You don't currently hold any **${symbol}** in this wallet.`, "agent");
        return;
      }
      
      const amtDisplay = amount.toLocaleString('en-US', { maximumFractionDigits: 4 });
      const valDisplay = holding.valueUsd ? ` (worth ${dollars(holding.valueUsd)})` : '';
      
      addMessage(`You are currently holding **${amtDisplay} ${symbol}**${valDisplay}.`, "agent");
    } catch (err) {
      console.error(err);
      addMessage(`Sorry, I couldn't fetch your wallet balance right now.`, "agent");
    }
  }

  // ── Swap Quote Flow (Buy) ──────────────────────────────────────────────────
  // Calls Jupiter via our Vercel proxy (avoids CORS), shows an inline quote card.
  async function triggerBuyFlow(launch, solAmount) {
    const symbol    = (launch.symbol || 'TOKEN').toUpperCase();
    const aquaUrl   = `https://aquafamily.fun/#/token/${launch.id || launch.mint}`;
    const orcaUrl   = launch.whirlpoolAddress
      ? `https://www.orca.so/pools/${launch.whirlpoolAddress}`
      : null;

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

      // If Jupiter can't route this token (common for AQUA Launchpad CLMM tokens),
      // give the user a helpful fallback instead of a raw error.
      if (!quoteRes.ok) {
        let errDetail = '';
        try {
          const errBody = await quoteRes.json();
          errDetail = errBody.error || errBody.message || '';
        } catch (_) { /* body not JSON */ }

        if (quoteRes.status === 400) {
          // Build a fallback card pointing to AQUA / Orca directly
          const card = document.createElement('div');
          card.className = 'swap-quote-card swap-quote-no-route';
          card.innerHTML = `
            <div class="swap-no-route-icon">⚠️</div>
            <p class="swap-no-route-msg">
              <strong>No Jupiter route found for ${symbol}.</strong><br>
              ${symbol} trades in an Orca CLMM pool that Jupiter doesn't currently index.
              You can swap it directly on AQUA or Orca:
            </p>
            <div class="swap-fallback-links">
              <a class="swap-fallback-btn" href="${aquaUrl}" target="_blank" rel="noopener">🌊 Trade on AQUA ↗</a>
              ${orcaUrl ? `<a class="swap-fallback-btn orca" href="${orcaUrl}" target="_blank" rel="noopener">🐳 Orca Pool ↗</a>` : ''}
            </div>
          `;
          addMessage('', 'agent', card, false);
          return;
        }

        throw new Error(`Quote API returned ${quoteRes.status}${errDetail ? ': ' + errDetail : ''}`);
      }

      const quote = await quoteRes.json();
      if (quote.error) throw new Error(quote.error);

      // Calculate display values — AQUA tokens use tokenDecimals (usually 6)
      const decimals   = launch.tokenDecimals ?? launch.decimals ?? 6;
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
      // Generic fallback with AQUA link so the user isn't left stranded
      const card = document.createElement('div');
      card.className = 'swap-quote-card swap-quote-no-route';
      card.innerHTML = `
        <div class="swap-no-route-icon">❌</div>
        <p class="swap-no-route-msg"><strong>Couldn't get a quote for ${symbol}.</strong><br>${err.message}</p>
        <div class="swap-fallback-links">
          <a class="swap-fallback-btn" href="${aquaUrl}" target="_blank" rel="noopener">🌊 Trade on AQUA ↗</a>
          ${orcaUrl ? `<a class="swap-fallback-btn orca" href="${orcaUrl}" target="_blank" rel="noopener">🐳 Orca Pool ↗</a>` : ''}
        </div>
      `;
      addMessage('', 'agent', card, false);
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
        `✅ Swap submitted! Transaction is on-chain.\nTx: ${signature.slice(0,8)}…${signature.slice(-6)}`,
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

  // ── Agent reply — uses OrcaBrain ──────────────────────────────────────────
  function dispatchMessage(text) {
    if (!window.OrcaBrain) {
      addMessage('Agent brain is still loading. Please try again.', 'agent');
      return;
    }

    const q = text.trim().toLowerCase();

    // ── Handle pending buy amount ────────────────────────────────────────
    if (pendingBuyTarget) {
      if (q === 'cancel' || q === 'stop') {
        pendingBuyTarget = null;
        addMessage('Buy cancelled. What else can I help you with?', 'agent');
        return;
      }
      const solAmt = parseFloat(q);
      if (!isNaN(solAmt) && solAmt > 0) {
        const launch = pendingBuyTarget;
        pendingBuyTarget = null;
        addMessage('Getting a quote for ' + solAmt + ' SOL → ' + (launch.symbol || '').toUpperCase() + '…', 'agent');
        setTimeout(() => triggerBuyFlow(launch, solAmt), 300);
        return;
      }
      addMessage('Please enter a valid SOL amount (e.g. 0.1), or type "cancel".', 'agent');
      return;
    }

    // ── Handle pending sell amount ───────────────────────────────────────
    if (pendingSellTarget) {
      if (q === 'cancel' || q === 'stop') {
        pendingSellTarget = null;
        addMessage('Sell cancelled. What else can I help you with?', 'agent');
        return;
      }
      const tokAmt = parseFloat(q);
      if (!isNaN(tokAmt) && tokAmt > 0) {
        const launch = pendingSellTarget;
        pendingSellTarget = null;
        addMessage('Getting a quote for ' + tokAmt + ' ' + (launch.symbol || '').toUpperCase() + ' → SOL…', 'agent');
        setTimeout(() => triggerSellFlow(launch, tokAmt), 300);
        return;
      }
      addMessage('Please enter a valid token amount (e.g. 1000), or type "cancel".', 'agent');
      return;
    }

    if (!allLaunches.length) {
      addMessage('Market data is still loading. Please try again in a moment.', 'agent');
      return;
    }

    const classified = OrcaBrain.classifyIntent(text, agentState);
    const newState   = OrcaBrain.handleIntent(classified, agentState, allLaunches, pricesMap, {
      addMessage,
      makeBuyButton: makeBuyLink,
      triggerBuyFlow,
      triggerSellFlow,
      triggerBalanceFlow,
      setPendingBuy:  (l) => { pendingBuyTarget = l; },
      setPendingSell: (l) => { pendingSellTarget = l; },
    });
    agentState = newState;
  }

  $('askForm')?.addEventListener('submit', e => {
    e.preventDefault();
    const input = $('askInput');
    const text  = input.value.trim();
    if (!text) return;
    addMessage(text, 'user');
    input.value = '';
    setTimeout(() => {
      dispatchMessage(text);
    }, 220);
  });

  $$('.quick-reads button').forEach(btn => {
    btn.addEventListener('click', () => {
      const prompt = btn.dataset.prompt || btn.textContent.trim();
      addMessage(prompt, 'user');
      setTimeout(() => {
        dispatchMessage(prompt);
      }, 220);
    });
  });

  // ── Tabs ──────────────────────────────────────────────────────────────────
  $$('.nav-link').forEach(btn =>
    btn.addEventListener('click', () => {
      if (btn.dataset.tab === 'home') {
        // Show landing overlay
        const landing  = $('landing');
        const appShell = $('appShell');
        if (landing && appShell) {
          landing.style.display = '';
          landing.classList.remove('is-hidden');
          appShell.style.display = 'none';
        }
        localStorage.setItem('orca_tab', 'home');
        return;
      }
      $$('.nav-link').forEach(b => { b.classList.toggle('is-active', b === btn); b.setAttribute('aria-selected', b === btn); });
      $$('.tab-panel').forEach(p => p.classList.toggle('is-active', p.id === btn.dataset.tab));
      localStorage.setItem('orca_tab', btn.dataset.tab);
    })
  );

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

  // Restore active tab (skip 'home' — that's the landing overlay, not a real panel)
  const activeTab = localStorage.getItem('orca_tab');
  if (activeTab && activeTab !== 'home') {
    const targetBtn = document.querySelector(`.nav-link[data-tab="${activeTab}"]`);
    if (targetBtn) {
      $$('.nav-link').forEach(b => { b.classList.toggle('is-active', b === targetBtn); b.setAttribute('aria-selected', b === targetBtn); });
      $$('.tab-panel').forEach(p => p.classList.toggle('is-active', p.id === activeTab));
    }
  }

  loadMarkets();

  // ── Landing Screen ────────────────────────────────────────────────────────
  const landing    = $('landing');
  const appShell   = $('appShell');
  const enterBtn   = $('landingEnter');
  const hasVisited = localStorage.getItem('orca_visited');

  function enterApp(tabName = 'market') {
    // Show the app shell and hide landing
    appShell.style.display = '';
    landing.style.display = 'none';
    landing.classList.add('is-hidden');
    localStorage.setItem('orca_visited', '1');
    localStorage.setItem('orca_tab', tabName);
    
    // Activate the requested tab
    const targetBtn = document.querySelector(`.nav-link[data-tab="${tabName}"]`);
    if (targetBtn) {
      $$('.nav-link').forEach(b => { b.classList.toggle('is-active', b === targetBtn); b.setAttribute('aria-selected', b === targetBtn); });
      $$('.tab-panel').forEach(p => p.classList.toggle('is-active', p.id === tabName));
    }
  }

  if (hasVisited && localStorage.getItem('orca_tab') !== 'home') {
    landing.style.display = 'none';
    appShell.style.display = '';
  }

  // Always wire the buttons — needed when returning via the Home tab
  $$('.landing-enter').forEach(btn => {
    btn.addEventListener('click', () => {
      enterApp(btn.dataset.target || 'market');
    });
  });

})();
