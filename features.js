/* =============================================================================
   features.js — ORCAGENT Premium Features
   ─────────────────────────────────────────────────────────────────────────────
   1. Heat Score Leaderboard  — momentum-based trending strip above market grid
   2. Live Activity Feed      — real-time event timeline (5th tab)
   3. Watchlist + Alerts      — star tokens, set price targets, browser notifs
   ─────────────────────────────────────────────────────────────────────────────
   Self-contained IIFE. Fetches its own data. Zero modifications to any
   existing file except the additive HTML hooks inserted in index.html.
============================================================================= */
(function () {
  'use strict';

  /* ── Config ─────────────────────────────────────────────────────────────── */
  const FEAT_API   = '';           // same origin — Vercel/local proxy handles /api/*
  const REFRESH_MS = 90_000;       // 90-second refresh cycle
  const MAX_EVENTS = 80;           // cap event log length
  const MILESTONES = [10, 25, 50, 100, 250, 500, 1000];

  /* ── Module State ───────────────────────────────────────────────────────── */
  let launches    = [];
  let pricesMap   = new Map();     // launchId → price object from API
  let snapshot    = new Map();     // mint → { price, vol, holders, change }
  let sessionHigh = new Map();     // mint → highest price seen this session
  let eventLog    = [];
  let watchlist   = {};
  let feedFilter  = 'all';
  let lastRefresh = null;
  let isFirstRun  = true;

  /* ── Tiny Helpers ───────────────────────────────────────────────────────── */
  const $   = id  => document.getElementById(id);
  const $$  = sel => document.querySelectorAll(sel);

  function fmtUsd(n) {
    if (n === null || n === undefined) return 'n/a';
    const x = Number(n);
    if (!Number.isFinite(x)) return 'n/a';
    if (x > 0 && x < 0.01) return '$' + x.toLocaleString('en-US', { maximumSignificantDigits: 4 });
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD', maximumFractionDigits: 4
    }).format(x);
  }

  function timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60)    return 'just now';
    if (s < 3600)  return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  function loadWatchlist() {
    try { watchlist = JSON.parse(localStorage.getItem('orca_watchlist') || '{}'); }
    catch (_) { watchlist = {}; }
  }

  function saveWatchlist() {
    localStorage.setItem('orca_watchlist', JSON.stringify(watchlist));
  }

  /* ── Data Fetch ─────────────────────────────────────────────────────────── */
  async function fetchData() {
    try {
      let all = [], offset = 0, hasMore = true;
      while (hasMore) {
        const r = await fetch(`${FEAT_API}/api/launches?limit=100&offset=${offset}`);
        if (!r.ok) throw new Error('API ' + r.status);
        const d = await r.json();
        const batch = Array.isArray(d.launches) ? d.launches : [];
        all      = all.concat(batch);
        hasMore  = !!d.hasMore;
        offset   = d.nextOffset ?? (offset + batch.length);
        if (!batch.length) break;
      }
      launches = all;

      const pr = await fetch(`${FEAT_API}/api/market-prices`);
      if (pr.ok) {
        const pd = await pr.json();
        pricesMap = new Map((pd.prices || []).map(p => [p.launchId, p]));
      }
      return true;
    } catch (e) {
      console.warn('[ORCAGENT Features] fetch failed:', e.message);
      return false;
    }
  }

  /* ── Live data for one launch ───────────────────────────────────────────── */
  function live(launch) {
    const m = pricesMap.get(launch.id) || null;
    const v = f => {
      const src = m
        ? (m[f] !== undefined ? m[f] : launch[f])
        : launch[f];
      const n = Number(src);
      return Number.isFinite(n) ? n : null;
    };
    return {
      price:   v('priceUsd'),
      mcap:    v('marketCapUsd'),
      vol:     v('volume24hUsd'),
      change:  v('change24h'),
      holders: v('holderCount'),
    };
  }

  /* ── Tab switcher (mirrors app.js pattern without touching it) ──────────── */
  function switchTab(tabId) {
    $$('.nav-link').forEach(b => {
      b.classList.toggle('is-active', b.dataset.tab === tabId);
      b.setAttribute('aria-selected', String(b.dataset.tab === tabId));
    });
    $$('.tab-panel').forEach(p => p.classList.toggle('is-active', p.id === tabId));
    localStorage.setItem('orca_tab', tabId);
  }

  /* =========================================================================
     FEATURE 1 — HEAT SCORE LEADERBOARD
  ========================================================================= */
  function heatTier(score) {
    if (score >= 75) return { icon: '🔥', label: 'On Fire',    cls: 'ht-fire' };
    if (score >= 50) return { icon: '⚡', label: 'Heating Up', cls: 'ht-hot'  };
    if (score >= 25) return { icon: '📈', label: 'Warming',    cls: 'ht-warm' };
    return              { icon: '❄️', label: 'Cold',        cls: 'ht-cold' };
  }

  function computeScores() {
    let maxC = 0, maxV = 0, maxH = 0;
    const now = Date.now();

    launches.forEach(l => {
      const d = live(l);
      if (d.change   !== null) maxC = Math.max(maxC, Math.abs(d.change));
      if (d.vol      !== null) maxV = Math.max(maxV, d.vol);
      if (d.holders  !== null) maxH = Math.max(maxH, d.holders);
    });

    if (!maxC) maxC = 1;
    if (!maxV) maxV = 1;
    if (!maxH) maxH = 1;

    return launches.map(l => {
      const d  = live(l);
      const cN = d.change  !== null ? Math.max(0, d.change) / maxC : 0;
      const vN = d.vol     !== null ? d.vol / maxV : 0;
      const hN = d.holders !== null ? d.holders / maxH : 0;
      const ts = l.launchedAt || l.createdAt || 0;
      const ageMs = now - new Date(ts).getTime();
      const rec   = (ageMs > 0 && ageMs < 7 * 86_400_000)
        ? 1 - ageMs / (7 * 86_400_000)
        : 0;
      const score = Math.round((cN * 0.40 + vN * 0.30 + hN * 0.15 + rec * 0.15) * 100);
      return { launch: l, score, data: d };
    }).sort((a, b) => b.score - a.score);
  }

  function renderHeatStrip() {
    const strip = $('heatStrip');
    if (!strip || !launches.length) return;

    const top  = computeScores().slice(0, 7);
    const html = top.map((item, i) => {
      const tier = heatTier(item.score);
      const sym  = (item.launch.symbol || 'TKN').toUpperCase().slice(0, 4);
      const ch   = item.data.change;
      const chTxt = ch !== null ? (ch >= 0 ? '+' : '') + ch.toFixed(1) + '%' : '—';
      const chCls = ch === null ? '' : ch >= 0 ? 'hs-up' : 'hs-dn';
      return `
        <button class="hs-chip ${tier.cls}"
                data-mint="${item.launch.mint || ''}"
                title="${item.launch.name || sym} · Heat Score: ${item.score}">
          <span class="hs-rank">#${i + 1}</span>
          <span class="hs-avatar">${sym.slice(0, 3)}</span>
          <div class="hs-chip-meta">
            <span class="hs-sym">${sym}</span>
            <span class="hs-ch ${chCls}">${chTxt}</span>
          </div>
          <div class="hs-pill ${tier.cls}">
            <span class="hs-score-num">${item.score}</span>
            <span class="hs-tier-icon">${tier.icon}</span>
          </div>
        </button>`;
    }).join('');

    strip.innerHTML = `
      <div class="hs-header">
        <div class="hs-title-block">
          <span class="hs-title">🔥 Trending Now</span>
          <span class="hs-sub">ORCAGENT Heat Score™</span>
        </div>
        <button class="hs-see-all" id="hsSeeAll">See all →</button>
      </div>
      <div class="hs-chips" role="list">${html}</div>`;

    strip.querySelectorAll('.hs-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const mint  = btn.dataset.mint;
        const found = launches.find(l => l.mint === mint);
        if (!found) return;
        switchTab('agent');
        const input = $('askInput');
        if (input) {
          input.value = 'price of ' + (found.symbol || '');
          input.focus();
        }
      });
    });

    const seeAll = $('hsSeeAll');
    if (seeAll) seeAll.addEventListener('click', () => switchTab('feed'));
  }

  /* =========================================================================
     FEATURE 2 — LIVE ACTIVITY FEED
  ========================================================================= */
  function buildEvents() {
    const events = [];

    launches.forEach(l => {
      const d    = live(l);
      const mint = l.mint || l.id;
      const sym  = (l.symbol || 'TOKEN').toUpperCase();
      const prev = snapshot.get(mint);

      if (!prev) {
        events.push({
          type: 'launch', icon: '🆕', label: 'New Launch',
          mint, sym, name: l.name,
          desc: `${l.name || sym} just launched on AQUA Launchpad`,
          ts: Date.now(),
        });
      } else {
        if (d.change !== null && d.change >= 30
            && (prev.change === null || prev.change < 30)) {
          events.push({
            type: 'spike', icon: '🚀', label: 'Price Spike',
            mint, sym, name: l.name,
            desc:  `${sym} surged ${d.change.toFixed(1)}% in the last 24h`,
            value: fmtUsd(d.price), ts: Date.now(),
          });
        }
        if (d.change !== null && d.change <= -30
            && (prev.change === null || prev.change > -30)) {
          events.push({
            type: 'crash', icon: '🩸', label: 'Price Drop',
            mint, sym, name: l.name,
            desc:  `${sym} fell ${Math.abs(d.change).toFixed(1)}% in the last 24h`,
            value: fmtUsd(d.price), ts: Date.now(),
          });
        }
        if (d.vol !== null && prev.vol !== null && prev.vol > 0
            && d.vol >= prev.vol * 2 && d.vol > 500) {
          events.push({
            type: 'volume', icon: '🐳', label: 'Volume Surge',
            mint, sym, name: l.name,
            desc:  `${sym} volume spiked to ${fmtUsd(d.vol)} — ${(d.vol / prev.vol).toFixed(1)}× jump`,
            value: fmtUsd(d.vol), ts: Date.now(),
          });
        }
        if (d.holders !== null && prev.holders !== null) {
          MILESTONES.forEach(m => {
            if (prev.holders < m && d.holders >= m) {
              events.push({
                type: 'holders', icon: '👥', label: 'Holder Milestone',
                mint, sym, name: l.name,
                desc:  `${sym} crossed ${m.toLocaleString()} holders`,
                value: d.holders.toLocaleString() + ' holders', ts: Date.now(),
              });
            }
          });
        }
        const prevHigh = sessionHigh.get(mint) || 0;
        if (d.price !== null && d.price > prevHigh && prevHigh > 0) {
          events.push({
            type: 'ath', icon: '📈', label: 'Session High',
            mint, sym, name: l.name,
            desc:  `${sym} hit a new session high`,
            value: fmtUsd(d.price), ts: Date.now(),
          });
        }
      }

      snapshot.set(mint, {
        price:   d.price,
        vol:     d.vol,
        holders: d.holders,
        change:  d.change,
      });
      if (d.price !== null) {
        const hi = sessionHigh.get(mint) || 0;
        if (d.price > hi) sessionHigh.set(mint, d.price);
      }
    });

    return events;
  }

  function pushEvents(newEvents) {
    if (!newEvents.length) return;
    eventLog = [...newEvents, ...eventLog].slice(0, MAX_EVENTS);
    renderFeed();

    if (Notification.permission === 'granted') {
      newEvents.forEach(ev => {
        if (watchlist[ev.mint]) {
          try {
            new Notification('ORCAGENT · ' + ev.label, {
              body: ev.desc,
              icon: './favicon.jpg',
              tag:  ev.mint + ev.type,
            });
          } catch (_) {}
        }
      });
    }
  }

  function renderFeed() {
    const list = $('feedList');
    if (!list) return;

    const filtered = feedFilter === 'all'
      ? eventLog
      : eventLog.filter(e => e.type === feedFilter);

    if (!filtered.length) {
      list.innerHTML = `
        <div class="feed-empty">
          <div class="feed-empty-glow"></div>
          <span class="feed-empty-icon">👁</span>
          <p class="feed-empty-title">Watching the market…</p>
          <span class="feed-empty-sub">Events will appear here as they happen. Market refreshes every 90 seconds.</span>
        </div>`;
      return;
    }

    list.innerHTML = filtered.map(ev => `
      <div class="feed-event fe-${ev.type}" role="listitem">
        <div class="fe-icon-wrap"><span class="fe-icon">${ev.icon}</span></div>
        <div class="fe-body">
          <div class="fe-header">
            <span class="fe-label fe-label-${ev.type}">${ev.label}</span>
            <span class="fe-sym">${ev.sym}</span>
            <span class="fe-time">${timeAgo(ev.ts)}</span>
          </div>
          <p class="fe-desc">${ev.desc}</p>
          ${ev.value ? `<span class="fe-val">${ev.value}</span>` : ''}
        </div>
        <button class="fe-ask-btn"
                data-sym="${ev.sym}"
                data-name="${ev.name || ev.sym}"
                title="Ask ORCAGENT about ${ev.sym}">Ask →</button>
      </div>`).join('');

    list.querySelectorAll('.fe-ask-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const sym = btn.dataset.sym;
        switchTab('agent');
        const input = $('askInput');
        if (input) { input.value = 'price of ' + sym; input.focus(); }
      });
    });
  }

  function wireFeedFilters() {
    $$('.feed-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        feedFilter = btn.dataset.filter || 'all';
        $$('.feed-filter').forEach(b => b.classList.toggle('is-active', b === btn));
        renderFeed();
      });
    });
  }

  function updateRefreshLabel() {
    const el = $('feedRefreshLabel');
    if (!el) return;
    el.textContent = lastRefresh ? 'Updated ' + timeAgo(lastRefresh) : 'Waiting for data…';
  }

  /* =========================================================================
     FEATURE 3 — WATCHLIST + PRICE ALERTS
  ========================================================================= */
  const isWatched = mint => !!watchlist[mint];

  function toggleWatch(launch) {
    const mint = launch && launch.mint;
    if (!mint) return;
    if (isWatched(mint)) {
      delete watchlist[mint];
    } else {
      watchlist[mint] = {
        name:    launch.name    || '',
        symbol:  launch.symbol  || '',
        addedAt: Date.now(),
        alert:   null,
      };
    }
    saveWatchlist();
    renderWatchlist();
    updateAllStars();
  }

  function checkAlerts() {
    let dirty = false;
    Object.entries(watchlist).forEach(([mint, entry]) => {
      if (!entry.alert || entry.alert.fired) return;
      const l = launches.find(x => x.mint === mint);
      if (!l) return;
      const d = live(l);
      if (d.price === null) return;
      const hit = entry.alert.dir === 'above'
        ? d.price >= entry.alert.price
        : d.price <= entry.alert.price;
      if (!hit) return;

      watchlist[mint].alert.fired = true;
      dirty = true;

      const sym = (entry.symbol || '').toUpperCase();
      const msg = `${sym} is ${entry.alert.dir === 'above' ? 'above' : 'below'} ${fmtUsd(entry.alert.price)} — now ${fmtUsd(d.price)}`;

      if (Notification.permission === 'granted') {
        try { new Notification('🔔 ORCAGENT Price Alert', { body: msg, icon: './favicon.jpg', tag: mint + 'alert' }); }
        catch (_) {}
      }
      showBanner('🔔 ' + msg);
    });
    if (dirty) saveWatchlist();
  }

  function showBanner(msg) {
    let el = $('featBanner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'featBanner';
      el.className = 'feat-banner';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('is-on');
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => el.classList.remove('is-on'), 5500);
  }

  function renderWatchlist() {
    const sec = $('watchlistSection');
    if (!sec) return;

    const keys = Object.keys(watchlist);
    if (!keys.length) { sec.innerHTML = ''; return; }

    const rows = keys.map(mint => {
      const w    = watchlist[mint];
      const l    = launches.find(x => x.mint === mint);
      const d    = l ? live(l) : null;
      const sym  = (w.symbol || '').toUpperCase();
      const px   = d ? d.price  : null;
      const ch   = d ? d.change : null;
      const chTxt = ch !== null ? (ch >= 0 ? '+' : '') + ch.toFixed(2) + '%' : '—';
      const chCls = ch === null ? '' : ch >= 0 ? 'wl-up' : 'wl-dn';
      const al   = w.alert;
      return `
        <div class="wl-row" data-mint="${mint}">
          <div class="wl-tok">
            <div class="wl-av">${sym.slice(0, 3) || '?'}</div>
            <div class="wl-tok-info">
              <span class="wl-sym">${sym || '—'}</span>
              <span class="wl-nm">${w.name || ''}</span>
            </div>
          </div>
          <div class="wl-prices">
            <span class="wl-px">${fmtUsd(px)}</span>
            <span class="wl-ch ${chCls}">${chTxt}</span>
          </div>
          <div class="wl-al-cell">
            ${al && !al.fired
              ? `<span class="wl-al-active" title="Alert set">${al.dir === 'above' ? '↑' : '↓'} ${fmtUsd(al.price)}</span>`
              : al && al.fired
                ? `<span class="wl-al-fired" title="Alert triggered">✓ Fired</span>`
                : `<button class="wl-add-al" data-mint="${mint}">+ Alert</button>`
            }
          </div>
          <button class="wl-rm" data-mint="${mint}" aria-label="Remove ${sym} from watchlist">✕</button>
        </div>`;
    }).join('');

    sec.innerHTML = `
      <div class="wl-wrap">
        <div class="wl-head">
          <span class="wl-title">⭐ Watchlist</span>
          <span class="wl-badge">${keys.length}</span>
        </div>
        <div class="wl-table" role="list">${rows}</div>
      </div>`;

    sec.querySelectorAll('.wl-rm').forEach(b => {
      b.addEventListener('click', () => {
        const mint = b.dataset.mint;
        delete watchlist[mint];
        saveWatchlist();
        renderWatchlist();
        updateAllStars();
      });
    });

    sec.querySelectorAll('.wl-add-al').forEach(b => {
      b.addEventListener('click', () => openAlertModal(b.dataset.mint));
    });
  }

  function openAlertModal(mint) {
    const w = watchlist[mint];
    if (!w) return;
    const sym  = (w.symbol || '').toUpperCase();
    const l    = launches.find(x => x.mint === mint);
    const d    = l ? live(l) : null;
    const px   = d ? d.price : null;

    const existing = $('featAlertModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'featAlertModal';
    modal.className = 'feat-alert-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', `Set price alert for ${sym}`);

    modal.innerHTML = `
      <div class="fam-backdrop"></div>
      <div class="fam-box">
        <div class="fam-head">
          <span class="fam-title">🔔 Set Alert · <strong>${sym}</strong></span>
          <button class="fam-close" aria-label="Close alert modal">×</button>
        </div>
        ${px !== null ? `<p class="fam-current">Current price: <strong>${fmtUsd(px)}</strong></p>` : ''}
        <div class="fam-dirs">
          <label class="fam-opt">
            <input type="radio" name="famDir" value="above" checked>
            <span>Alert when price goes <strong>above</strong></span>
          </label>
          <label class="fam-opt">
            <input type="radio" name="famDir" value="below">
            <span>Alert when price goes <strong>below</strong></span>
          </label>
        </div>
        <input class="fam-input" id="famPriceInput"
               type="number" placeholder="Target price (e.g. 0.05)"
               step="any" min="0" autocomplete="off">
        <button class="fam-confirm" id="famConfirm">Set Alert</button>
      </div>`;

    document.body.appendChild(modal);

    const close = () => modal.remove();
    modal.querySelector('.fam-backdrop').addEventListener('click', close);
    modal.querySelector('.fam-close').addEventListener('click', close);

    const escHandler = e => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); } };
    document.addEventListener('keydown', escHandler);

    modal.querySelector('#famConfirm').addEventListener('click', () => {
      const raw   = modal.querySelector('#famPriceInput').value;
      const price = parseFloat(raw);
      const inp   = modal.querySelector('#famPriceInput');
      if (isNaN(price) || price <= 0) {
        inp.classList.add('fam-input-err');
        inp.focus();
        return;
      }
      inp.classList.remove('fam-input-err');
      const dir = modal.querySelector('input[name="famDir"]:checked')?.value || 'above';

      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        Notification.requestPermission();
      }

      watchlist[mint].alert = { dir, price, fired: false };
      saveWatchlist();
      renderWatchlist();
      document.removeEventListener('keydown', escHandler);
      close();
    });

    setTimeout(() => modal.querySelector('#famPriceInput')?.focus(), 50);
  }

  /* ── Star buttons on market cards (injected via MutationObserver) ────────── */
  function injectStars() {
    $$('.token-card:not([data-feat-init])').forEach(card => {
      card.setAttribute('data-feat-init', '1');

      const nameEl = card.querySelector('.token-name');
      const symEl  = card.querySelector('.token-symbol');
      if (!nameEl || !symEl) return;

      const cardName = nameEl.textContent.trim();
      const cardSym  = symEl.textContent.trim();

      const launch = launches.find(x =>
        (x.name   || '').trim()              === cardName ||
        (x.symbol || '').toUpperCase().trim() === cardSym
      );
      if (!launch || !launch.mint) return;

      const btn = document.createElement('button');
      btn.className   = 'feat-star' + (isWatched(launch.mint) ? ' on' : '');
      btn.dataset.mint = launch.mint;
      btn.setAttribute('aria-label', isWatched(launch.mint) ? 'Remove from watchlist' : 'Add to watchlist');
      btn.title       = isWatched(launch.mint) ? 'Remove from watchlist' : 'Add to watchlist';
      btn.innerHTML   = isWatched(launch.mint) ? '★' : '☆';
      btn.addEventListener('click', e => {
        e.stopPropagation();
        toggleWatch(launch);
      });

      const head = card.querySelector('.token-head');
      if (head) head.appendChild(btn);
    });
  }

  function updateAllStars() {
    $$('.feat-star').forEach(btn => {
      const w = isWatched(btn.dataset.mint);
      btn.innerHTML = w ? '★' : '☆';
      btn.classList.toggle('on', w);
      btn.setAttribute('aria-label', w ? 'Remove from watchlist' : 'Add to watchlist');
      btn.title = w ? 'Remove from watchlist' : 'Add to watchlist';
    });
  }

  /* ── Main Refresh Loop ──────────────────────────────────────────────────── */
  async function refresh() {
    const ok = await fetchData();
    if (!ok) return;

    if (isFirstRun) {
      const historicalEvents = [];
      const now = Date.now();

      launches.forEach(l => {
        const d    = live(l);
        const mint = l.mint || l.id;
        const sym  = (l.symbol || 'TOKEN').toUpperCase();

        snapshot.set(mint, { price: d.price, vol: d.vol, holders: d.holders, change: d.change });
        if (d.price !== null) sessionHigh.set(mint, d.price);

        const ts = l.launchedAt || l.createdAt || 0;
        const ageMs = now - new Date(ts).getTime();
        
        if (ageMs > 0 && ageMs < 72 * 3600000) {
          historicalEvents.push({
            type: 'launch', icon: '🆕', label: 'Recent Launch',
            mint, sym, name: l.name,
            desc: `${l.name || sym} launched on AQUA Launchpad`,
            ts: new Date(ts).getTime(),
          });
        }
        if (d.change !== null && d.change >= 30) {
          historicalEvents.push({
            type: 'spike', icon: '🚀', label: '24h Top Gainer',
            mint, sym, name: l.name,
            desc: `${sym} is up ${d.change.toFixed(1)}% today`,
            value: fmtUsd(d.price), ts: now - Math.floor(Math.random() * 3600000),
          });
        }
        if (d.change !== null && d.change <= -30) {
          historicalEvents.push({
            type: 'crash', icon: '🩸', label: '24h Big Drop',
            mint, sym, name: l.name,
            desc: `${sym} fell ${Math.abs(d.change).toFixed(1)}% today`,
            value: fmtUsd(d.price), ts: now - Math.floor(Math.random() * 3600000),
          });
        }
        if (d.vol !== null && d.vol >= 5000) {
          historicalEvents.push({
            type: 'volume', icon: '🐳', label: 'High Volume',
            mint, sym, name: l.name,
            desc: `${sym} is seeing heavy trading activity`,
            value: fmtUsd(d.vol), ts: now - Math.floor(Math.random() * 7200000),
          });
        }
      });

      historicalEvents.sort((a, b) => b.ts - a.ts);
      eventLog = historicalEvents.slice(0, 30);
      renderFeed();

      isFirstRun = false;
    } else {
      const events = buildEvents();
      pushEvents(events);
    }

    checkAlerts();
    renderHeatStrip();
    renderWatchlist();
    injectStars();
    lastRefresh = Date.now();
    updateRefreshLabel();
  }

  /* ── Boot ───────────────────────────────────────────────────────────────── */
  function boot() {
    loadWatchlist();
    wireFeedFilters();
    renderFeed();       
    renderWatchlist();  

    setTimeout(() => {
      refresh().then(() => {
        const grid = $('marketGrid');
        if (grid) {
          new MutationObserver(() => injectStars()).observe(grid, { childList: true });
        }
      });
    }, 1800);

    setInterval(refresh, REFRESH_MS);
    setInterval(updateRefreshLabel, 60_000);
  }

  /* ── Entry point ─────────────────────────────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
