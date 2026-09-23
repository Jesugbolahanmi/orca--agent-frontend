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

  function agentReply(prompt) {
    const raw = prompt.trim();
    const q   = raw.toLowerCase();

    if (/\b(check again|again|do it again|retry|refresh)\b/.test(q)) {
      if (lastPrompt) {
        return agentReply(lastPrompt);
      }
      return { text: "I don't have a previous command to repeat.", link: null };
    }
    
    // Save valid prompts for 'check again' logic (excluding conversational/flow stops)
    if (!['cancel', 'stop', 'no', 'yes'].includes(q)) {
      lastPrompt = raw;
    }

    if (!allLaunches.length) {
      return { text: 'Market data is still loading. Please try again in a moment.', link: null };
    }

    // ── Pending buy amount ──────────────────────────────────────────────────
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

    // ── Pending sell amount ──────────────────────────────────────────────────
    if (pendingSellTarget) {
      const tokenAmount = parseFloat(q);
      if (q === 'cancel' || q === 'stop') {
        pendingSellTarget = null;
        return { text: 'Sell cancelled. What else can I help you with?', link: null };
      }
      if (!isNaN(tokenAmount) && tokenAmount > 0) {
        const launch = pendingSellTarget;
        pendingSellTarget = null;
        setTimeout(() => triggerSellFlow(launch, tokenAmount), 300);
        return { text: `Getting a quote for ${tokenAmount} ${(launch.symbol || '').toUpperCase()} → SOL…`, link: null };
      } else {
        return { text: 'Please enter a valid amount of tokens to sell, or type "cancel".', link: null };
      }
    }

    // ── Helper: get live data for a token ──────────────────────────────────
    function getLaunchData(l) {
      const m = pricesMap.get(l.id) || null;
      return {
        price:   num(val(m, l, 'priceUsd')),
        mcap:    num(val(m, l, 'marketCapUsd')),
        vol:     num(val(m, l, 'volume24hUsd')),
        change:  num(val(m, l, 'change24h')),
        holders: num(val(m, l, 'holderCount')),
        tvl:     num(val(m, l, 'tvlUsd')),
      };
    }

    // ── Helper: find a token by name/symbol/CA in query ───────────────────────
    function findToken(query) {
      const q = query.toLowerCase().trim();
      
      // 1. Exact match (Mint/CA, Symbol, or Name)
      let match = allLaunches.find(l =>
        (l.mint   || '').toLowerCase() === q ||
        (l.symbol || '').toLowerCase() === q ||
        (l.name   || '').toLowerCase() === q
      );
      if (match) return match;
      
      // 2. Partial match (Name or Symbol includes the query)
      return allLaunches.find(l =>
        (l.name   || '').toLowerCase().includes(q) ||
        (l.symbol || '').toLowerCase().includes(q)
      ) || null;
    }

    // ── Greetings & chitchat ───────────────────────────────────────────────
    if (/^(hi|hey|hello|sup|yo|gm|good morning|hiya|what'?s up|howdy)\b/.test(q)) {
      return { text: `Hey! 👋 I'm ORCAGENT — your AI market reader for the AQUA Launchpad. I'm watching ${allLaunches.length} tokens in real time. Ask me about any token, get prices, market analysis, or just say "buy [token]" to swap!`, link: null };
    }
    if (/\b(who are you|what are you|what is orcagent|tell me about yourself)\b/.test(q)) {
      return { text: `I'm ORCAGENT 🐋 — an on-chain AI agent built specifically for the AQUA Launchpad on Solana. I can give you live prices, market caps, volume, holder counts, and market sentiment for every token. You can also swap tokens directly through me using any Solana wallet.`, link: null };
    }
    if (/\b(thank|thanks|thx|ty|appreciate)\b/.test(q)) {
      return { text: `Anytime! 🐋 That's what I'm here for. Anything else you want to know about the market?`, link: null };
    }
    if (/\b(good|nice|great|awesome|cool|love it|love this|amazing)\b/.test(q) && q.length < 30) {
      return { text: `Glad to help! 🚀 The AQUA Launchpad is moving fast — stay sharp. Anything else?`, link: null };
    }

    // ── Balance intent — "how many aqua am i holding", "what is my sol balance" ──
    const balMatch = q.match(/^(?:how\s+many|how\s+much|what\s+(?:is|are)\s+my|show\s+my)\s+\$?(?:of\s+)?([a-z0-9]+)\s*(?:am\s+i\s+holding|do\s+i\s+have|do\s+i\s+hold|balance|tokens?)?\b/i) 
                  || q.match(/^([a-z0-9]+)\s+balance\b/i);
    if (balMatch) {
      const targetStr = (balMatch[1] || balMatch[2]).trim();
      const launch = findToken(targetStr);
      setTimeout(() => triggerBalanceFlow(launch, targetStr), 300);
      return { text: `Checking your wallet balance for ${launch ? (launch.symbol || '').toUpperCase() : targetStr.toUpperCase()}...`, link: null };
    }

    // ── Buy intent — supports: "buy aqua", "buy $aqua", "buy 0.5 sol of aqua" ──
    const buyMatch = q.match(/^buy\s+(?:(\d+\.?\d*)\s+sol\s+(?:of\s+)?)?\$?(.+)/);
    if (buyMatch) {
      const amountStr = buyMatch[1];
      const target    = buyMatch[2].trim();
      const launch    = findToken(target);
      if (launch) {
        if (amountStr) {
          const solAmount = parseFloat(amountStr);
          setTimeout(() => triggerBuyFlow(launch, solAmount), 300);
          return { text: `Getting a quote for ${solAmount} SOL → ${(launch.symbol || '').toUpperCase()}…`, link: null };
        } else {
          pendingBuyTarget = launch;
          return { text: `How much SOL worth of ${(launch.symbol || '').toUpperCase()} would you like to buy? (e.g., 0.1)\nType "cancel" to abort.`, link: null };
        }
      }
      return { text: `I couldn't find "${target}" on the AQUA Launchpad. Check the spelling or browse the Market tab.`, link: null };
    }

    // ── Sell intent — supports: "sell aqua", "sell 100 aqua" ──
    const sellMatch = q.match(/^sell\s+(?:(\d+\.?\d*)\s+)?\$?(.+)/);
    if (sellMatch) {
      const amountStr = sellMatch[1];
      const target    = sellMatch[2].trim();
      const launch    = findToken(target);
      if (launch) {
        if (amountStr) {
          const tokenAmount = parseFloat(amountStr);
          setTimeout(() => triggerSellFlow(launch, tokenAmount), 300);
          return { text: `Getting a quote for ${tokenAmount} ${(launch.symbol || '').toUpperCase()} → SOL…`, link: null };
        } else {
          pendingSellTarget = launch;
          return { text: `How many ${(launch.symbol || '').toUpperCase()} tokens would you like to sell? (e.g., 1000)\nType "cancel" to abort.`, link: null };
        }
      }
      return { text: `I couldn't find "${target}" on the AQUA Launchpad. Check the spelling or browse the Market tab.`, link: null };
    }

    // ── Price intent — "price of aqua", "what is aqua price", "aqua price" ──
    const priceMatch = q.match(/(?:price\s+of\s+|what(?:'?s|\s+is)\s+(?:the\s+)?(?:price\s+of\s+)?|how much is\s+)?\$?([a-z0-9]+)(?:'?s|\s+price|\s+worth|\s+cost|\s+trading)?$/);

    // ── Moon/Prediction intent ─────────────────────────────────────────────
    const predictionKeywords = /\b(moon|go up|pump|hit|reach|get to|make it|millions?|billion|prediction|predict|gonna|going to|will it|potential|x from|×|10x|100x|1000x|future|outlook|target|price target|when|ath|all[- ]time high)\b/;
    const sentimentKeywords  = /\b(good|bad|worth it|worth buying|undervalued|overvalued|bull|bear|bullish|bearish|gem|safe|risky|rug|legit|scam|hold|bag|accumulate|dip|buy the dip)\b/;

    // Check if question is about a specific token with prediction/sentiment
    // Sort launches by length descending to prevent greedy matching (e.g. "AQUA" overriding "AQUACAT")
    const searchLaunches = [...allLaunches].sort((a, b) => {
      const aLen = Math.max((a.name || '').length, (a.symbol || '').length);
      const bLen = Math.max((b.name || '').length, (b.symbol || '').length);
      return bLen - aLen;
    });

    for (const l of searchLaunches) {
      const sym  = (l.symbol || '').toLowerCase();
      const name = (l.name   || '').toLowerCase();
      const mint = (l.mint   || '').toLowerCase();
      
      const hasSymMatch  = sym.length > 1 && q.includes(sym);
      const hasNameMatch = name.length > 2 && q.includes(name);
      const hasMintMatch = mint.length > 10 && q.includes(mint);

      if (hasSymMatch || hasNameMatch || hasMintMatch) {
        const d = getLaunchData(l);
        const symbol = (l.symbol || '').toUpperCase();
        const isMoon  = predictionKeywords.test(q);
        const isSenti = sentimentKeywords.test(q);

        if (isMoon || isSenti) {
          // Build honest bullish analysis
          const mcapM   = d.mcap ? (d.mcap / 1e6).toFixed(2) : null;
          const volRatio = (d.vol && d.mcap) ? (d.vol / d.mcap) : null;
          const chgTxt   = d.change !== null ? ((d.change >= 0 ? '+' : '') + d.change.toFixed(2) + '% in 24h') : 'price change not available';
          const holders  = d.holders ? Number(d.holders).toLocaleString() : 'unknown number of';

          let outlook = '';
          if (d.mcap && d.mcap < 500_000) {
            outlook = `With a market cap of ${dollars(d.mcap)}, ${symbol} is in its very early stages — offering maximum upside potential as adoption grows.`;
          } else if (d.mcap && d.mcap < 2_000_000) {
            outlook = `At ${dollars(d.mcap)} market cap, ${symbol} is still in its early growth phase. There's real room to move if volume stays strong.`;
          } else if (d.mcap && d.mcap < 10_000_000) {
            outlook = `${symbol} is building momentum with a ${mcapM}M market cap. Solid footing — continued growth depends on community and launchpad activity.`;
          } else {
            outlook = `${symbol} has established itself with a sizeable market cap of ${dollars(d.mcap)}. For further big moves, it needs consistent volume and new buyers.`;
          }

          let volNote = '';
          if (volRatio && volRatio > 0.5) {
            volNote = ` Volume-to-cap ratio is strong (${(volRatio * 100).toFixed(0)}%) — that's a healthy sign of active trading.`;
          } else if (volRatio && volRatio > 0.1) {
            volNote = ` Volume is moderate relative to market cap.`;
          } else if (volRatio) {
            volNote = ` Volume is currently low relative to its market cap — watch for a volume spike.`;
          }

          const disclaimer = `\n\n💡 This is on-chain market data. Always do your own research.`;

          return {
            text: `📊 ${symbol} Analysis:\n\nPrice: ${dollars(d.price)} (${chgTxt})\nMkt Cap: ${dollars(d.mcap)}\n24h Volume: ${dollars(d.vol)}\nHolders: ${holders}\n\n${outlook}${volNote}${disclaimer}`,
            link: makeBuyLink(l)
          };
        }

        // Plain token lookup (no prediction keywords)
        const chg  = d.change;
        const text = `${l.name} (${symbol})\nPrice: ${dollars(d.price)}\n24h Change: ${chg !== null ? (chg>=0?'+':'') + chg.toFixed(2)+'%' : 'n/a'}\nMkt Cap: ${dollars(d.mcap)}\n24h Volume: ${dollars(d.vol)}\nHolders: ${d.holders ? Number(d.holders).toLocaleString() : 'n/a'}\nTVL: ${dollars(d.tvl)}`;
        return { text, link: makeBuyLink(l) };
      }
    }

    // ── Market-wide stats ──────────────────────────────────────────────────
    if (/\b(how many|launch count|total tokens?|total launches?)\b/.test(q)) {
      return { text: `There are ${allLaunches.length} tokens live on the AQUA Launchpad right now.`, link: null };
    }
    if (/\b(largest market cap|biggest|highest cap|top by cap)\b/.test(q)) {
      const top = [...allLaunches].sort((a,b) => (getLaunchData(b).mcap||0) - (getLaunchData(a).mcap||0))[0];
      return { text: top ? `Largest market cap: ${top.name} (${top.symbol?.toUpperCase()}) at ${dollars(getLaunchData(top).mcap)}.` : 'No data yet.', link: top ? makeBuyLink(top) : null };
    }
    if (/\b(highest volume|most volume|most traded|most active)\b/.test(q)) {
      const top = [...allLaunches].sort((a,b) => (getLaunchData(b).vol||0) - (getLaunchData(a).vol||0))[0];
      return { text: top ? `Highest 24h volume: ${top.name} (${top.symbol?.toUpperCase()}) at ${dollars(getLaunchData(top).vol)}.` : 'No data yet.', link: top ? makeBuyLink(top) : null };
    }
    if (/\b(top gainer|best performer|biggest winner|most gains?|most pumped?)\b/.test(q)) {
      const top = [...allLaunches].filter(l => getLaunchData(l).change !== null)
        .sort((a,b) => (getLaunchData(b).change||0) - (getLaunchData(a).change||0))[0];
      const chg = top ? getLaunchData(top).change : null;
      return { text: top ? `Top gainer: ${top.name} (${top.symbol?.toUpperCase()}) +${chg?.toFixed(2)}% in 24h.` : 'No change data yet.', link: top ? makeBuyLink(top) : null };
    }
    if (/\b(top loser|biggest loss|most down|worst performer|dumped)\b/.test(q)) {
      const bot = [...allLaunches].filter(l => getLaunchData(l).change !== null)
        .sort((a,b) => (getLaunchData(a).change||0) - (getLaunchData(b).change||0))[0];
      const chg = bot ? getLaunchData(bot).change : null;
      return { text: bot ? `Biggest drop: ${bot.name} (${bot.symbol?.toUpperCase()}) ${chg?.toFixed(2)}% in 24h.` : 'No change data yet.', link: null };
    }
    if (/\b(market status|market overview|how('?s| is) the market|overall|general)\b/.test(q)) {
      const gainers = allLaunches.filter(l => (getLaunchData(l).change || 0) > 0).length;
      const losers  = allLaunches.filter(l => (getLaunchData(l).change || 0) < 0).length;
      const totalVol = allLaunches.reduce((acc, l) => acc + (getLaunchData(l).vol || 0), 0);
      const sentiment = gainers > losers ? 'Bullish' : gainers < losers ? 'Bearish' : 'Mixed';
      return { text: `AQUA Launchpad Market Overview:\n${sentiment} — ${gainers} tokens up, ${losers} down\nTotal 24h Volume: ${dollars(totalVol)}\nTokens tracked: ${allLaunches.length}`, link: null };
    }
    if (/\b(most holders?|largest community|most popular by holders?)\b/.test(q)) {
      const top = [...allLaunches].sort((a,b) => (getLaunchData(b).holders||0) - (getLaunchData(a).holders||0))[0];
      return { text: top ? `Most holders: ${top.name} (${top.symbol?.toUpperCase()}) with ${Number(getLaunchData(top).holders).toLocaleString()} holders.` : 'No holder data yet.', link: top ? makeBuyLink(top) : null };
    }
    if (/\b(newest|latest|most recent|just launched|new token)\b/.test(q)) {
      const newest = [...allLaunches].sort((a,b) => (b.launchedAt||b.createdAt||0) - (a.launchedAt||a.createdAt||0))[0];
      return { text: newest ? `Most recent launch: ${newest.name} (${newest.symbol?.toUpperCase()}) at ${dollars(getLaunchData(newest).price)}.` : 'No data.', link: newest ? makeBuyLink(newest) : null };
    }

    if (/^help$|what can you do|what do you know|commands/.test(q)) {
      return { text: `I can help you with:\n• "price of [token]" — live price\n• "[token] analysis" — full breakdown\n• "is [token] going to moon?" — honest outlook\n• top gainers / top losers\n• highest volume / largest market cap\n• market overview / market status\n• "buy [token]" — swap via Jupiter\n• most holders / newest launch`, link: null };
    }

    // ── General AQUA Launchpad questions ──────────────────────────────────
    if (/\b(what is aqua|what is aquafamily|how does aqua work|aqua launchpad|about aqua)\b/.test(q)) {
      return { text: `AQUA Launchpad is a Solana-based token launchpad built on top of Orca's concentrated liquidity AMM (CLMM). It lets anyone create and launch tokens with deep on-chain liquidity from day one. Unlike typical bonding-curve launchpads, AQUA tokens graduate into real Orca liquidity pools.`, link: null };
    }
    if (/\b(solana|sol network|what chain|blockchain)\b/.test(q)) {
      return { text: `AQUA Launchpad runs on Solana — one of the fastest blockchains in the world with near-instant transactions and very low fees. All tokens here are Solana SPL tokens tradeable with any Solana wallet.`, link: null };
    }

    // ── Fallback ──────────────────────────────────────────────────────────
    return { text: `I'm not sure what you mean by "${raw}". Try asking:\n• price of [token]\n• is [token] going to moon?\n• top gainers\n• market overview\n• buy [token]`, link: null };
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

  function enterApp() {
    // Show the app shell and hide landing
    appShell.style.display = '';
    landing.style.display = 'none';
    landing.classList.add('is-hidden');
    localStorage.setItem('orca_visited', '1');
    // Restore last tab or default to market
    const lastTab = localStorage.getItem('orca_tab') || 'market';
    if (lastTab !== 'home') {
      const targetBtn = document.querySelector(`.nav-link[data-tab="${lastTab}"]`);
      if (targetBtn) {
        $$('.nav-link').forEach(b => { b.classList.toggle('is-active', b === targetBtn); b.setAttribute('aria-selected', b === targetBtn); });
        $$('.tab-panel').forEach(p => p.classList.toggle('is-active', p.id === lastTab));
      }
    }
  }

  if (hasVisited) {
    landing.style.display = 'none';
    appShell.style.display = '';
  }

  // Always wire the button — needed when returning via the Home tab
  enterBtn?.addEventListener('click', enterApp);

})();
