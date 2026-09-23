(() => {
  // Use a CORS proxy so GitHub Pages doesn't get blocked by the backend
  const AQUA_API = '';
  const $ = selector => document.querySelector(selector);
  const state = { loading: false };
  const refreshButton = $('#refreshMarket');

  const numberValue = value => {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };

  const dollars = value => {
    const number = numberValue(value);
    if (number === null) return 'Unavailable';
    if (number > 0 && number < 0.01) return `$${number.toLocaleString('en-US', { maximumSignificantDigits: 4 })}`;
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(number);
  };

  function setStatus(message, kind = '') {
    const element = $('#marketState');
    element.className = `market-state ${kind}`;
    element.querySelector('p').textContent = message;
  }

  function valueFrom(market, launch, key) {
    return market?.[key] ?? launch?.[key] ?? null;
  }

  async function loadAllMarkets() {
    if (state.loading) return;
    state.loading = true;
    setStatus('Fetching all live markets...', 'loading');
    
    try {
      // Fetch all launches
      const res = await fetch(`${AQUA_API}/api/launches?limit=50`);
      if (!res.ok) throw new Error('Failed to fetch launches');
      const data = await res.json();
      const launches = data.launches || [];

      // Fetch live prices
      const priceRes = await fetch(`${AQUA_API}/api/market-prices`);
      const priceData = priceRes.ok ? await priceRes.json() : { prices: [] };
      const pricesMap = new Map((priceData.prices || []).map(p => [p.launchId, p]));

      renderGrid(launches, pricesMap);
      setStatus('');
      $('#marketState').hidden = true; // hide the loading text when done
    } catch (error) {
      console.error(error);
      setStatus('Market data is unavailable right now. Try refreshing.', 'error');
    } finally {
      state.loading = false;
    }
  }

  function renderGrid(launches, pricesMap) {
    const template = $('#marketCard');
    const container = template.parentElement;
    
    // Clear previous clones if refreshing
    container.querySelectorAll('.cloned-market').forEach(el => el.remove());

    if (launches.length === 0) {
       setStatus('No launches found on the platform yet.', 'error');
       return;
    }

    template.hidden = true; // hide the original template

    for (const launch of launches) {
      const market = pricesMap.get(launch.id) || null;
      
      const symbol = String(launch.symbol || 'TOKEN').toUpperCase();
      const price = valueFrom(market, launch, 'priceUsd');
      const change = numberValue(valueFrom(market, launch, 'change24h'));
      const marketCap = valueFrom(market, launch, 'marketCapUsd');
      const pairType = String(launch.pairType || market?.pairType || '').toLowerCase();

      // Clone the template for each token
      const card = template.cloneNode(true);
      card.id = ''; // remove ID so we don't have duplicates
      card.classList.add('cloned-market');
      card.hidden = false;

      // Populate data
      card.querySelector('#tokenInitials').textContent = symbol.slice(0, 4);
      card.querySelector('#tokenName').firstChild.textContent = `${launch.name || 'Token'} `;
      card.querySelector('#tokenSymbol').textContent = symbol;
      card.querySelector('#marketType').textContent = pairType === 'orca' ? 'AQUA Launchpad · Orca market' : 'AQUA Launchpad · SOL market';
      card.querySelector('#tokenPrice').textContent = dollars(price);
      
      const changeEl = card.querySelector('#priceChange');
      changeEl.textContent = change === null ? '24h change unavailable' : `${change >= 0 ? '+' : ''}${change.toFixed(2)}% 24h`;
      changeEl.className = `change ${change === null ? '' : change >= 0 ? 'up' : 'down'}`;
      
      card.querySelector('#marketCap').textContent = dollars(marketCap);

      // Append to page
      container.appendChild(card);
    }
  }

  refreshButton?.addEventListener('click', loadAllMarkets);
  loadAllMarkets();
})();
