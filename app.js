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
    const raw = prompt.trim();
    const q   = raw.toLowerCase();

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

    // ── Helper: find a token by name/symbol in query ───────────────────────
    function findToken(query) {
      return allLaunches.find(l =>
        (l.symbol || '').toLowerCase() === query ||
        (l.name   || '').toLowerCase() === query ||
        (l.name   || '').toLowerCase().includes(query) ||
        query.includes((l.symbol || '').toLowerCase())
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

    // ── Price intent — "price of aqua", "what is aqua price", "aqua price" ──
    const priceMatch = q.match(/(?:price\s+of\s+|what(?:'?s|\s+is)\s+(?:the\s+)?(?:price\s+of\s+)?|how much is\s+)?\$?([a-z0-9]+)(?:'?s|\s+price|\s+worth|\s+cost|\s+trading)?$/);

    // ── Moon/Prediction intent ─────────────────────────────────────────────
    const predictionKeywords = /\b(moon|go up|pump|hit|reach|get to|make it|millions?|billion|prediction|predict|gonna|going to|will it|potential|x from|×|10x|100x|1000x|future|outlook|target|price target|when|ath|all[- ]time high)\b/;
    const sentimentKeywords  = /\b(good|bad|worth it|worth buying|undervalued|overvalued|bull|bear|bullish|bearish|gem|safe|risky|rug|legit|scam|hold|bag|accumulate|dip|buy the dip)\b/;

    // Check if question is about a specific token with prediction/sentiment
    for (const l of allLaunches) {
      const sym  = (l.symbol || '').toLowerCase();
      const name = (l.name   || '').toLowerCase();
      if ((q.includes(sym) || q.includes(name)) && sym.length > 1) {
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
            outlook = `With a market cap of only ${dollars(d.mcap)}, ${symbol} is very early stage — high risk, but also high reward potential if adoption grows.`;
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

          const disclaimer = `\n\n⚠️ This is market data, not financial advice. AQUA Launchpad tokens carry high risk — always do your own research.`;

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
      const sentiment = gainers > losers ? '📈 Bullish' : gainers < losers ? '📉 Bearish' : '⚖️ Mixed';
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
      return { text: `I can help you with:\n• 💰 "price of [token]" — live price\n• 📊 "[token] analysis" — full breakdown\n• 🚀 "is [token] going to moon?" — honest outlook\n• 📈 top gainers / top losers\n• 💧 highest volume / largest market cap\n• 🌐 market overview / market status\n• 🛒 "buy [token]" — swap via Jupiter\n• 📁 most holders / newest launch`, link: null };
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
