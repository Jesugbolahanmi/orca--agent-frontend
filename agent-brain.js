/* global document */
(function () {
  'use strict';

  var STOP = new Set([
    'a','an','the','is','it','its','be','been','was','are','were','have','has','had',
    'will','would','could','should','can','may','might','shall','do','does','did',
    'go','going','gone','get','got','make','makes','made','hit','hits','reach',
    'to','of','in','on','at','by','for','with','from','into','about','like','than',
    'and','or','but','so','if','when','where','why','how','what','which','who','that',
    'this','these','those','my','your','our','their','we','you','they','i','he','she',
    'not','no','up','down','out','all','any','some','much','many','more','most','less',
    'just','only','also','even','still','yet','already','ever','never',
    'million','millions','billion','billions','thousand','hundreds',
    'price','prices','market','mcap','volume','holders','holder','tvl','cap',
    'token','tokens','coin','coins','crypto','defi','launchpad','solana','sol',
    'swap','buy','sell','trade','invest','investing','portfolio',
  ]);

  function cleanRef(str) {
    if (!str) return null;
    var s = str.trim().replace(/^\$/, '').toLowerCase();
    return STOP.has(s) ? null : s;
  }

  function extractRef(q) {
    var dm = q.match(/\$([a-z0-9]+)/i);
    if (dm) return dm[1].toLowerCase();
    var words = q.split(/\s+/)
      .map(function(w){ return w.replace(/[^a-z0-9]/gi,'').toLowerCase(); })
      .filter(function(w){ return w.length >= 2 && !STOP.has(w); });
    if (!words.length) return null;
    words.sort(function(a,b){ return b.length - a.length; });
    return words[0];
  }

  function extractMetric(q) {
    if (/\bvolume\b/.test(q))               return 'volume';
    if (/\bmarket.?cap|mcap\b/.test(q))     return 'mcap';
    if (/\bholder/.test(q))                 return 'holders';
    if (/\bprice\b/.test(q))                return 'price';
    if (/\btvl\b/.test(q))                  return 'tvl';
    if (/\bchange|24h\b/.test(q))           return 'change';
    return null;
  }

  function tryResolveChoice(q, choices) {
    var ords = ['first','second','third','fourth','fifth'];
    for (var i = 0; i < ords.length; i++) {
      if (q.indexOf(ords[i]) !== -1 || q.trim() === String(i+1)) return i;
    }
    for (var j = 0; j < choices.length; j++) {
      var sym  = (choices[j].symbol||'').toLowerCase();
      var name = (choices[j].name||'').toLowerCase();
      if (q.indexOf(sym) !== -1 || q.indexOf(name) !== -1) return j;
    }
    return null;
  }

  function classifyIntent(raw, state) {
    var msg = raw.trim();
    var q   = msg.toLowerCase().replace(/[?.!,]+$/, '').trim();

    if (state.pendingChoices && state.pendingChoices.length) {
      var idx = tryResolveChoice(q, state.pendingChoices);
      if (idx !== null) return { intent:'followup', entities:{ choiceIndex:idx }, confidence:'high' };
    }

    if (state.lastResolvedMint) {
      if (/\b(it|its|this|that|same|this one)\b/.test(q) && !/\b(buy|sell)\b/.test(q)) {
        return { intent:'followup', entities:{ useLastMint:true }, confidence:'high' };
      }
      var met = extractMetric(q);
      if (/\bwhat about\b|\band\b/.test(q) && q.split(/\s+/).length <= 6 && met) {
        return { intent:'followup', entities:{ useLastMint:true, metric:met }, confidence:'high' };
      }
    }

    if (/^(hi|hey|hello|sup|yo|gm|gn|good morning|good night|hiya|howdy|what.s up|wassup)\b/.test(q) ||
        /^(thanks|thank you|thx|ty|appreciate|nice|great|awesome|cool|love it|perfect|ok|okay|sounds good)\b/.test(q)) {
      return { intent:'smalltalk', entities:{ _raw:q }, confidence:'high' };
    }
    if (/\b(who are you|what are you|what is orcagent|tell me about yourself|what can you do)\b/.test(q) || /^help$/.test(q)) {
      return { intent:'help', entities:{}, confidence:'high' };
    }

    if (/\b(market overview|market status|how.?s the market|overall market|general market)\b/.test(q))
      return { intent:'market_overview', entities:{}, confidence:'high' };
    if (/\b(top gainer|best performer|biggest winner|most gains|most pumped|highest gain)\b/.test(q))
      return { intent:'top_gainers', entities:{}, confidence:'high' };
    if (/\b(top loser|biggest loss|most down|worst performer|dumped)\b/.test(q))
      return { intent:'top_losers', entities:{}, confidence:'high' };
    if (/\b(highest volume|most volume|most traded|most active|top volume)\b/.test(q))
      return { intent:'highest_volume', entities:{}, confidence:'high' };
    if (/\b(largest market cap|biggest cap|highest cap|top by cap|biggest mcap)\b/.test(q))
      return { intent:'largest_mcap', entities:{}, confidence:'high' };
    if (/\b(most holders|largest community|most popular by holders)\b/.test(q))
      return { intent:'most_holders', entities:{}, confidence:'high' };
    if (/\b(newest|latest launch|most recent launch|just launched|new token)\b/.test(q))
      return { intent:'newest_launch', entities:{}, confidence:'high' };
    if (/\b(how many tokens|launch count|total tokens|total launches|number of tokens)\b/.test(q))
      return { intent:'launch_count', entities:{}, confidence:'high' };
    if (/\b(what is aqua|how does aqua work|aqua launchpad|about aqua|how does this work)\b/.test(q))
      return { intent:'how_it_works', entities:{}, confidence:'high' };

    var buyM = msg.match(/^buy\s+(?:([\d.]+)\s+sol\s+(?:of\s+)?)?\$?(.+)/i);
    if (buyM) {
      var bref = cleanRef(buyM[2]);
      if (bref) return { intent:'buy', entities:{ tokenRef:bref, amount: buyM[1] ? parseFloat(buyM[1]) : null }, confidence:'high' };
    }
    var sellM = msg.match(/^sell\s+(?:([\d.]+)\s+)?\$?(.+)/i);
    if (sellM) {
      var sref = cleanRef(sellM[2]);
      if (sref) return { intent:'sell', entities:{ tokenRef:sref, amount: sellM[1] ? parseFloat(sellM[1]) : null }, confidence:'high' };
    }

    var balM = q.match(/(?:how\s+(?:many|much)|what(?:.s|\s+is|\s+are)\s+my|show\s+my|check\s+my)\s+\$?([a-z0-9]+)\s*(?:balance|holdings|tokens)?/i)
             || q.match(/^([a-z0-9]+)\s+balance$/i);
    if (balM) {
      var balRef = cleanRef(balM[1] || balM[2]);
      if (balRef) return { intent:'balance', entities:{ tokenRef:balRef }, confidence:'high' };
    }

    var predRx = /\b(moon|go up|pump|hit|reach|get to|make it|millions|billion|predict|gonna|going to|potential|10x|100x|future|outlook|target|ath|worth it|undervalued|overvalued|bullish|bearish|good investment|safe|risky|rug|legit|scam|accumulate)\b/;
    if (predRx.test(q)) {
      var pref = extractRef(q);
      return { intent:'prediction_or_opinion', entities:{ tokenRef: pref || null }, confidence: pref ? 'high' : 'medium' };
    }

    var priceM = q.match(/\bprice\s+of\s+\$?([a-z0-9]+)\b/i)
              || q.match(/\bwhat(?:.s|\s+is)\s+(?:the\s+)?price\s+(?:of\s+)?\$?([a-z0-9]+)\b/i)
              || q.match(/\bhow\s+much\s+(?:is|does)\s+\$?([a-z0-9]+)\s+(?:cost|worth|trading)\b/i)
              || q.match(/^\$?([a-z0-9]+)\s+price$/i);
    if (priceM) {
      var pr = cleanRef(priceM[1]);
      if (pr) return { intent:'price_lookup', entities:{ tokenRef:pr }, confidence:'high' };
    }

    var analyM = q.match(/\b([a-z0-9]+)\s+analysis\b/i)
              || q.match(/\btell\s+me\s+about\s+\$?([a-z0-9]+)\b/i)
              || q.match(/\binfo\s+(?:on|about)\s+\$?([a-z0-9]+)\b/i);
    if (analyM) {
      var ar = cleanRef(analyM[1]);
      if (ar) return { intent:'price_lookup', entities:{ tokenRef:ar }, confidence:'high' };
    }

    var bwords = q.split(/\s+/);
    if (bwords.length <= 2) {
      var bare = cleanRef(bwords[0]);
      if (bare && /^[a-z0-9]+$/i.test(bare)) {
        return { intent:'price_lookup', entities:{ tokenRef:bare }, confidence:'medium' };
      }
    }

    return { intent:'unknown', entities:{}, confidence:'low' };
  }

  function resolveToken(ref, allLaunches) {
    if (!ref) return { matches:[], tier:'none' };
    var r = ref.toLowerCase().trim();
    var byMint = allLaunches.filter(function(l){ return (l.mint||'').toLowerCase() === r; });
    if (byMint.length) return { matches:byMint, tier:'mint' };
    var bySym  = allLaunches.filter(function(l){ return (l.symbol||'').toLowerCase() === r; });
    if (bySym.length)  return { matches:bySym, tier:'symbol' };
    var byName = allLaunches.filter(function(l){ return (l.name||'').toLowerCase() === r; });
    if (byName.length) return { matches:byName, tier:'name' };
    var fuzzy  = allLaunches.filter(function(l){
      return (l.symbol||'').toLowerCase().indexOf(r) === 0 || (l.name||'').toLowerCase().indexOf(r) === 0
          || (l.symbol||'').toLowerCase().indexOf(r) !== -1 || (l.name||'').toLowerCase().indexOf(r) !== -1;
    });
    if (fuzzy.length) return { matches:fuzzy, tier:'fuzzy' };
    return { matches:[], tier:'none' };
  }

  function getLiveData(launch, pricesMap) {
    var m = pricesMap.get(launch.id) || null;
    function v(f){ var src = m ? (m[f] !== undefined ? m[f] : (launch[f] !== undefined ? launch[f] : null)) : (launch[f] !== undefined ? launch[f] : null); var n = Number(src); return Number.isFinite(n) ? n : null; }
    return { price:v('priceUsd'), mcap:v('marketCapUsd'), vol:v('volume24hUsd'), change:v('change24h'), holders:v('holderCount'), tvl:v('tvlUsd') };
  }

  function fmtUsd(n) {
    if (n === null || !Number.isFinite(n)) return 'unavailable';
    if (n > 0 && n < 0.01) return '$' + n.toLocaleString('en-US', { maximumSignificantDigits:4 });
    return new Intl.NumberFormat('en-US', { style:'currency', currency:'USD', maximumFractionDigits:4 }).format(n);
  }
  function fmtPct(n) {
    if (n === null || !Number.isFinite(n)) return 'unavailable';
    return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtNum(n) {
    if (n === null || !Number.isFinite(n)) return 'unavailable';
    return Number(n).toLocaleString();
  }
  function shortMint(m) { return m ? m.slice(0,4) + '...' + m.slice(-4) : ''; }

  function buildPriceText(launch, d) {
    var sym = (launch.symbol||'').toUpperCase();
    return [
      launch.name + ' (' + sym + ')',
      'Price: ' + fmtUsd(d.price),
      '24h Change: ' + fmtPct(d.change),
      'Market Cap: ' + fmtUsd(d.mcap),
      '24h Volume: ' + fmtUsd(d.vol),
      'Holders: ' + fmtNum(d.holders),
      'TVL: ' + fmtUsd(d.tvl),
    ].join('\n');
  }

  function buildMetricText(launch, d, metric) {
    var sym = (launch.symbol||'').toUpperCase();
    var map = {
      price:  'Price of ' + sym + ': ' + fmtUsd(d.price),
      mcap:   'Market cap of ' + sym + ': ' + fmtUsd(d.mcap),
      volume: '24h volume of ' + sym + ': ' + fmtUsd(d.vol),
      holders:'Holders of ' + sym + ': ' + fmtNum(d.holders),
      tvl:    'TVL of ' + sym + ': ' + fmtUsd(d.tvl),
      change: '24h price change of ' + sym + ': ' + fmtPct(d.change),
    };
    return map[metric] || buildPriceText(launch, d);
  }

  function buildPredictionText(launch, d) {
    var sym = (launch.symbol||'').toUpperCase();
    var lines = [
      'Here is what the on-chain data shows for ' + launch.name + ' (' + sym + '):',
      '',
      'Price: ' + fmtUsd(d.price),
      'Market Cap: ' + fmtUsd(d.mcap),
      '24h Volume: ' + fmtUsd(d.vol),
      'Holders: ' + fmtNum(d.holders),
      'TVL: ' + fmtUsd(d.tvl),
      '',
    ];
    if (d.mcap !== null) {
      lines.push(d.mcap < 1000000
        ? 'To reach a $1M market cap, the mcap would need to grow ~' + (1000000/d.mcap).toFixed(1) + 'x from the current ' + fmtUsd(d.mcap) + '.'
        : d.mcap < 10000000
          ? 'Reaching $10M would require ~' + (10000000/d.mcap).toFixed(1) + 'x growth from the current ' + fmtUsd(d.mcap) + ' mcap.'
          : 'Current market cap is ' + fmtUsd(d.mcap) + '.');
    }
    var risks = [];
    if (d.holders !== null && d.holders <= 5) risks.push('very few holders (' + d.holders + ')');
    if (d.vol !== null && d.vol < 100) risks.push('near-zero 24h volume');
    if (d.tvl !== null && d.tvl < 500) risks.push('very low TVL');
    if (risks.length) lines.push('Data risk note: ' + risks.join(', ') + '. Low activity means low liquidity and higher volatility.');
    lines.push('', 'I do not predict price moves. This is on-chain data only - not financial advice.');
    return lines.join('\n');
  }

  function buildChoiceCard(matches, ref, pricesMap, onPick, onNone) {
    var MAX = 5, shown = matches.slice(0, MAX), extra = matches.length - MAX;
    var wrap = document.createElement('div');
    wrap.className = 'choice-card-wrap';
    wrap.setAttribute('role', 'group');

    var hdr = document.createElement('p');
    hdr.className = 'choice-card-header';
    hdr.textContent = 'I found ' + matches.length + ' token' + (matches.length > 1 ? 's' : '') + ' matching "' + ref + '". Which one do you mean?';
    wrap.appendChild(hdr);

    var list = document.createElement('div');
    list.className = 'choice-card-list';

    shown.forEach(function(launch, idx) {
      var d = getLiveData(launch, pricesMap);
      var sym = (launch.symbol||'').toUpperCase();
      var rawD = launch.launchedAt || launch.createdAt;
      var dateTxt = rawD ? new Date(rawD).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : 'unknown';
      var btn = document.createElement('button');
      btn.className = 'choice-card-option';
      btn.setAttribute('type', 'button');
      btn.setAttribute('aria-label', 'Select ' + (launch.name||sym));
      btn.innerHTML =
        '<div class="choice-option-main">' +
          '<span class="choice-option-badge">' + (idx+1) + '</span>' +
          '<div class="choice-option-info">' +
            '<span class="choice-option-name">' + (launch.name||sym) + '</span>' +
            '<span class="choice-option-sym">' + sym + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="choice-option-meta">' +
          '<span class="choice-meta-item">Price <strong>' + fmtUsd(d.price) + '</strong></span>' +
          '<span class="choice-meta-item">MCap <strong>' + fmtUsd(d.mcap) + '</strong></span>' +
          '<span class="choice-meta-item">Holders <strong>' + fmtNum(d.holders) + '</strong></span>' +
          '<span class="choice-meta-item">Launched <strong>' + dateTxt + '</strong></span>' +
          '<span class="choice-meta-item choice-mint">Mint <strong>' + shortMint(launch.mint) + '</strong></span>' +
        '</div>';
      btn.addEventListener('click', function() {
        wrap.querySelectorAll('button').forEach(function(b){ b.disabled = true; });
        btn.classList.add('is-selected');
        wrap.classList.add('is-locked');
        onPick(launch);
      });
      list.appendChild(btn);
    });

    if (extra > 0) {
      var note = document.createElement('p');
      note.className = 'choice-card-more';
      note.textContent = extra + ' more match' + (extra > 1 ? 'es' : '') + ' - type the exact symbol or paste the mint address.';
      list.appendChild(note);
    }

    var noneBtn = document.createElement('button');
    noneBtn.className = 'choice-card-none';
    noneBtn.setAttribute('type', 'button');
    noneBtn.textContent = 'None of these';
    noneBtn.addEventListener('click', function() {
      wrap.querySelectorAll('button').forEach(function(b){ b.disabled = true; });
      wrap.classList.add('is-locked');
      onNone();
    });
    wrap.appendChild(list);
    wrap.appendChild(noneBtn);
    return wrap;
  }

  function handleIntent(classified, state, allLaunches, pricesMap, cbs) {
    var intent = classified.intent, entities = classified.entities || {};
    var ns = Object.assign({}, state);
    var addMsg = cbs.addMessage, mkBtn = cbs.makeBuyButton;
    var trigBuy = cbs.triggerBuyFlow, trigSell = cbs.triggerSellFlow;
    var trigBal = cbs.triggerBalanceFlow, setPB = cbs.setPendingBuy, setPS = cbs.setPendingSell;

    function withToken(ref, cb) {
      if (!ref) { addMsg('Which token are you asking about? Type its name, symbol, or mint address.', 'agent'); return; }
      var res = resolveToken(ref, allLaunches);
      if (!res.matches.length) { addMsg('I could not find "' + ref + '" on the AQUA Launchpad. Check spelling or browse the Market tab.', 'agent'); return; }
      if (res.matches.length === 1) { ns.lastResolvedMint = res.matches[0].mint; ns.pendingChoices = null; ns.pendingIntent = null; cb(res.matches[0]); return; }
      var sorted = res.matches.slice().sort(function(a,b){ return (getLiveData(b,pricesMap).mcap||0)-(getLiveData(a,pricesMap).mcap||0); });
      ns.pendingChoices = sorted;
      ns.pendingIntent  = { intent:intent, entities:entities };
      var card = buildChoiceCard(sorted, ref, pricesMap,
        function(p){ ns.lastResolvedMint = p.mint; ns.pendingChoices = null; ns.pendingIntent = null; cb(p); },
        function(){ ns.pendingChoices = null; ns.pendingIntent = null; addMsg('No problem. Paste the full mint address to specify a token.', 'agent'); }
      );
      addMsg('', 'agent', card, false);
    }

    if (intent === 'followup') {
      if (entities.choiceIndex !== null && entities.choiceIndex !== undefined && ns.pendingChoices) {
        var pk = ns.pendingChoices[entities.choiceIndex];
        if (pk) {
          ns.lastResolvedMint = pk.mint; ns.pendingChoices = null;
          var pi = ns.pendingIntent; ns.pendingIntent = null;
          if (pi) { handleIntent({ intent:pi.intent, entities:Object.assign({}, pi.entities, { forcedMint:pk.mint }) }, ns, allLaunches, pricesMap, cbs); }
          else { var d0 = getLiveData(pk,pricesMap); addMsg(buildPriceText(pk,d0),'agent',mkBtn(pk)); }
          return ns;
        }
      }
      if (entities.useLastMint && ns.lastResolvedMint) {
        var ll = allLaunches.filter(function(l){ return l.mint === ns.lastResolvedMint; })[0];
        if (ll) { var dll = getLiveData(ll,pricesMap); addMsg(entities.metric ? buildMetricText(ll,dll,entities.metric) : buildPriceText(ll,dll), 'agent', entities.metric ? null : mkBtn(ll)); return ns; }
      }
      addMsg('I lost track of which token you mean. Could you name it again?', 'agent');
      return ns;
    }

    if (intent === 'smalltalk') {
      var sq = entities._raw || '';
      if (/^(gm|good morning)/.test(sq)) addMsg('GM! Markets are live. Ask me about any token or say "buy [symbol]" to swap.', 'agent');
      else if (/^(gn|good night)/.test(sq)) addMsg('GN! Crypto never sleeps. I will be here when you are back.', 'agent');
      else if (/^(hi|hey|hello|sup|yo|howdy|hiya|wassup)/.test(sq))
        addMsg('Hey! I am ORCAGENT, watching ' + allLaunches.length + ' tokens on the AQUA Launchpad. Ask me about any token, or say "buy [symbol]" to swap.', 'agent');
      else if (/\b(thanks|thank you|thx|ty|appreciate)\b/.test(sq)) addMsg('Anytime! Anything else?', 'agent');
      else addMsg('Got it! What would you like to know about the AQUA Launchpad?', 'agent');
      return ns;
    }

    if (intent === 'help') {
      addMsg('I am ORCAGENT - a market reader for the AQUA Launchpad on Solana.\n\nThings I can do:\n- "price of [token]" - live price, mcap, volume, holders\n- "will [token] go to $1M?" - honest data-based context\n- "buy [token]" / "sell [token]" - in-app swap\n- top gainers / top losers\n- highest volume / largest market cap\n- market overview / newest launch\n- "[token] balance" - check your wallet holdings\n\nIf multiple tokens share a name, I will show a choice card so you pick the right one.', 'agent');
      return ns;
    }

    if (intent === 'how_it_works') {
      addMsg('AQUA Launchpad is a Solana-based token launchpad built on Orca\'s concentrated liquidity AMM (CLMM).\n\nUnlike bonding-curve launchpads, AQUA tokens launch directly into real Orca liquidity pools - on-chain liquidity from day one.\n\nI read live data from AQUA Family\'s public directory. I can also execute in-app swaps via Jupiter.', 'agent');
      return ns;
    }

    if (intent === 'launch_count') { addMsg('There are ' + allLaunches.length + ' tokens live on the AQUA Launchpad right now.', 'agent'); return ns; }

    if (intent === 'market_overview') {
      var gains = allLaunches.filter(function(l){ return (getLiveData(l,pricesMap).change||0) > 0; }).length;
      var losses = allLaunches.filter(function(l){ return (getLiveData(l,pricesMap).change||0) < 0; }).length;
      var tv2 = allLaunches.reduce(function(a,l){ return a + (getLiveData(l,pricesMap).vol||0); }, 0);
      var sent = gains > losses ? 'Bullish' : gains < losses ? 'Bearish' : 'Mixed';
      addMsg('AQUA Launchpad Market Overview:\n' + sent + ' - ' + gains + ' tokens up, ' + losses + ' down\nTotal 24h Volume: ' + fmtUsd(tv2) + '\nTokens tracked: ' + allLaunches.length, 'agent');
      return ns;
    }

    function topBy(f){ return allLaunches.slice().filter(function(l){ return getLiveData(l,pricesMap)[f] !== null; }).sort(function(a,b){ return (getLiveData(b,pricesMap)[f]||0)-(getLiveData(a,pricesMap)[f]||0); })[0]; }
    function botBy(f){ return allLaunches.slice().filter(function(l){ return getLiveData(l,pricesMap)[f] !== null; }).sort(function(a,b){ return (getLiveData(a,pricesMap)[f]||0)-(getLiveData(b,pricesMap)[f]||0); })[0]; }

    if (intent === 'top_gainers')  { var t1=topBy('change'); if(!t1){addMsg('No change data yet.','agent');return ns;} var d1=getLiveData(t1,pricesMap); addMsg('Top gainer: '+t1.name+' ('+t1.symbol.toUpperCase()+') at '+fmtPct(d1.change)+' in 24h. Price: '+fmtUsd(d1.price)+'.','agent',mkBtn(t1)); return ns; }
    if (intent === 'top_losers')   { var t2=botBy('change'); if(!t2){addMsg('No change data yet.','agent');return ns;} var d2=getLiveData(t2,pricesMap); addMsg('Biggest drop: '+t2.name+' ('+t2.symbol.toUpperCase()+') at '+fmtPct(d2.change)+' in 24h. Price: '+fmtUsd(d2.price)+'.','agent'); return ns; }
    if (intent === 'highest_volume'){ var t3=topBy('vol'); if(!t3){addMsg('No volume data yet.','agent');return ns;} var d3=getLiveData(t3,pricesMap); addMsg('Highest 24h volume: '+t3.name+' ('+t3.symbol.toUpperCase()+') with '+fmtUsd(d3.vol)+'.','agent',mkBtn(t3)); return ns; }
    if (intent === 'largest_mcap') { var t4=topBy('mcap'); if(!t4){addMsg('No mcap data yet.','agent');return ns;} var d4=getLiveData(t4,pricesMap); addMsg('Largest market cap: '+t4.name+' ('+t4.symbol.toUpperCase()+') at '+fmtUsd(d4.mcap)+'.','agent',mkBtn(t4)); return ns; }
    if (intent === 'most_holders') { var t5=topBy('holders'); if(!t5){addMsg('No holder data yet.','agent');return ns;} var d5=getLiveData(t5,pricesMap); addMsg('Most holders: '+t5.name+' ('+t5.symbol.toUpperCase()+') with '+fmtNum(d5.holders)+' holders.','agent',mkBtn(t5)); return ns; }
    if (intent === 'newest_launch'){ var t6=allLaunches.slice().sort(function(a,b){return (b.launchedAt||b.createdAt||0)-(a.launchedAt||a.createdAt||0);})[0]; if(!t6){addMsg('No launch data yet.','agent');return ns;} var d6=getLiveData(t6,pricesMap); addMsg('Most recent launch: '+t6.name+' ('+t6.symbol.toUpperCase()+') at '+fmtUsd(d6.price)+'.','agent',mkBtn(t6)); return ns; }

    if (intent === 'price_lookup') {
      if (entities.forcedMint) { var f1=allLaunches.filter(function(l){return l.mint===entities.forcedMint;})[0]; if(f1){ns.lastResolvedMint=f1.mint;addMsg(buildPriceText(f1,getLiveData(f1,pricesMap)),'agent',mkBtn(f1));} return ns; }
      withToken(entities.tokenRef, function(l){ addMsg(buildPriceText(l,getLiveData(l,pricesMap)),'agent',mkBtn(l)); });
      return ns;
    }

    if (intent === 'prediction_or_opinion') {
      function sendPred(l) {
        var d = getLiveData(l, pricesMap);
        if ((l.symbol || '').toUpperCase() === 'AQUA') {
          var txt = 'For sure, $AQUA will fully send! 🚀\n\n' + buildPredictionText(l, d);
          addMsg(txt, 'agent', mkBtn(l));
        } else {
          addMsg(buildPredictionText(l, d), 'agent');
        }
      }
      if (entities.forcedMint) { var f2=allLaunches.filter(function(l){return l.mint===entities.forcedMint;})[0]; if(f2){ns.lastResolvedMint=f2.mint;sendPred(f2);} return ns; }
      if (!entities.tokenRef) { addMsg('Which token are you asking about? I can give you honest on-chain context.','agent'); return ns; }
      withToken(entities.tokenRef, function(l){ sendPred(l); });
      return ns;
    }

    if (intent === 'buy') {
      function doBuy(l){ if(entities.amount){setTimeout(function(){trigBuy(l,entities.amount);},300);addMsg('Getting a quote for '+entities.amount+' SOL -> '+(l.symbol||'').toUpperCase()+'...','agent');}else{setPB(l);addMsg('How much SOL worth of '+(l.symbol||'').toUpperCase()+' would you like to buy? (e.g. 0.1)\nType "cancel" to abort.','agent');} }
      if (entities.forcedMint) { var f3=allLaunches.filter(function(l){return l.mint===entities.forcedMint;})[0]; if(f3){ns.lastResolvedMint=f3.mint;doBuy(f3);} return ns; }
      withToken(entities.tokenRef, doBuy); return ns;
    }

    if (intent === 'sell') {
      function doSell(l){ if(entities.amount){setTimeout(function(){trigSell(l,entities.amount);},300);addMsg('Getting a quote for '+entities.amount+' '+(l.symbol||'').toUpperCase()+' -> SOL...','agent');}else{setPS(l);addMsg('How many '+(l.symbol||'').toUpperCase()+' tokens would you like to sell? (e.g. 1000)\nType "cancel" to abort.','agent');} }
      if (entities.forcedMint) { var f4=allLaunches.filter(function(l){return l.mint===entities.forcedMint;})[0]; if(f4){ns.lastResolvedMint=f4.mint;doSell(f4);} return ns; }
      withToken(entities.tokenRef, doSell); return ns;
    }

    if (intent === 'balance') {
      var bres=resolveToken(entities.tokenRef,allLaunches); var bl=bres.matches.length===1?bres.matches[0]:null;
      setTimeout(function(){trigBal(bl,entities.tokenRef);},300);
      addMsg('Checking your wallet balance for '+(bl?(bl.symbol||'').toUpperCase():(entities.tokenRef||'').toUpperCase())+'...','agent');
      return ns;
    }

    addMsg('I am not sure what you mean. Things you can ask:\n- "price of AQUA"\n- "will AQUA go to $1M?"\n- "top gainers" / "market overview"\n- "buy AQUA" / "sell AQUA"\n\nType "help" for the full list.', 'agent');
    return ns;
  }

  window.OrcaBrain = { classifyIntent:classifyIntent, resolveToken:resolveToken, handleIntent:handleIntent, getLiveData:getLiveData, buildPriceText:buildPriceText, buildPredictionText:buildPredictionText, fmtUsd:fmtUsd, fmtPct:fmtPct, fmtNum:fmtNum };
})();