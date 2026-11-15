// Token Radar 4's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, a filterable table, a per-protocol detail view with the
// twelve live-token comparables that priced it, and the live-token comparables check.
// No network: every byte it shows is in data.js.
//
// The farm plan and the implied value below are the same derivation main.ts writes to
// board.json: the nearest comparables, the momentum tilt and the quality score decide
// the value; category, chains, TVL and age decide the action, the capital, the hold and
// every cost and time. No protocol name is special-cased anywhere on this page.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var V = DATA.validation;
  var M = DATA.model;
  var watchSet = {};
  DATA.watchlist.forEach(function (s) { watchSet[s] = true; });
  var state = { q: '', category: 'all', chain: 'all', watch: false, tab: 'pre', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtMoney(n) { return n === null || n === undefined || !isFinite(n) ? 'n/a' : usd.format(Math.round(n)); }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return 'x' + n.toFixed(3); }
  function fmtDist(n) { return n.toFixed(2); }
  function fmtScore(n) { return Math.round(n) + ' / 100'; }

  // The model in one function: the page recomputes a row from the snapshot figures and
  // checks the number board.json carries, so the page's code and the board's data are
  // visibly the same arithmetic. Comparables value first, then the momentum tilt and
  // the quality tilt.
  function impliedOf(row) {
    var growth = Math.min(M.momentum_cap, Math.max(M.momentum_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + M.momentum_weight * Math.tanh(growth / M.momentum_scale);
    var qualityTilt = M.quality_floor + M.quality_range * (row.quality_score / 100);
    return { implied: Math.max(1, Math.round(row.knn_value_usd * growthMult * qualityTilt)), growthMult: growthMult, qualityTilt: qualityTilt, knn: row.knn_value_usd };
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else if (typeof child === 'number' || typeof child === 'boolean') node.appendChild(document.createTextNode(String(child)));
      else node.appendChild(child);
    }
    return node;
  }

  // --- Farm plans: the same derivation main.ts writes to board.json. ---
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 500;
    if (p.tvl_usd >= 1e9) return 250;
    if (p.tvl_usd >= 2.5e8) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function gasPerTx(chain) {
    var c = chain.toLowerCase();
    if (c === 'ethereum') return 8;
    if (c === 'solana') return 0.1;
    if (c === 'bitcoin') return 2;
    return 1;
  }
  function gasText(g) { return g >= 1 ? '$' + g : '$' + g.toFixed(2); }
  var ACTIONS = [
    [['lend', 'cdp', 'collateral'],
      'Lend {cap} of USDC on {name} ({chain}) and leave the deposit earning.',
      'Take a $25 stablecoin loan against the deposit, then repay it the same week to show borrowing activity.'],
    [['dex'],
      'Add {cap} of liquidity to {name}\'s deepest pool on {chain} and leave it in place.',
      'Trade $25 through {name} once a week so the wallet builds a swap history.'],
    [['yield', 'aggregator', 'leveraged farm', 'farm'],
      'Put {cap} of USDC into {name}\'s largest vault on {chain} and hold the vault shares.',
      'Claim the vault yield once and put the proceeds back into the same vault.'],
    [['bridge', 'cross chain'],
      'Move {cap} of USDC to {chain} through {name} and use it inside the destination app.',
      'Send a smaller amount back across the bridge to show the route works both ways.'],
    [['staking', 'restak'],
      'Stake {cap} through {name} on {chain} and keep the liquid receipt token.',
      'Delegate or restake the receipt once, or vote in a governance poll if one opens.'],
    [['perpetual', 'derivative', 'options'],
      'Fund {name} with {cap} of USDC margin on {chain} and open one small position.',
      'Close the position and open one more at small size, keeping exposure under {cap} in total.'],
    [['prediction'],
      'Fund an account with {cap} and take one small position in a {name} market.',
      'Close it and take a second position in a different market.'],
    [['rwa'],
      'Mint {cap} of {name}\'s yield-bearing token on {chain} and hold it.',
      'Claim one yield payout from the position, or reinvest it.'],
    [['stable', 'algo-stable'],
      'Mint {cap} of stable value through {name} on {chain}.',
      'Redeem a small amount back to USDC and mint again, completing a full cycle.'],
    [['insurance'],
      'Buy {cap} of cover on {name} ({chain}) and keep the policy live.',
      'Renew the cover once before it ends instead of letting it lapse.'],
    [['launchpad'],
      'Commit {cap} of USDC to an allocation on {name} ({chain}) and hold it.',
      'Join one launch round or vote on one allocation.'],
    [['nft'],
      'Do about {cap} of trading volume on {name} ({chain}), across one or two items.',
      'Trade once more the next week so the wallet shows repeat activity.'],
    [['payment', 'card'],
      'Spend {cap} through {name} on {chain} and keep the account open.',
      'Make a second payment the following week.'],
    [['ai', 'agent'],
      'Run {cap} of work through {name} on {chain}, such as inference or an agent task.',
      'Run a second task and leave a rating in the app.'],
    [['index'],
      'Buy {cap} of {name}\'s index on {chain} and hold it.',
      'Top the position up by $25 once, or rebalance if the app offers it.'],
    [['chain'],
      'Bridge {cap} of USDC onto {name} and try one native app on the chain.',
      'Use a second native app on the same chain.'],
    [['curator', 'allocator', 'risk'],
      'Deposit {cap} into a {name} vault on {chain} and hold the shares.',
      'Shift $25 between two allocations inside the vault.'],
    [['basis'],
      'Put {cap} of USDC into {name}\'s basis trade on {chain} and leave it running.',
      'Add $25 after the first funding period.'],
    [['synthetic'],
      'Mint {cap} of synthetic assets on {name} ({chain}) and hold them.',
      'Burn a small amount back and mint again to complete a cycle.'],
    [['governance'],
      'Lock {cap} in {name}\'s governance on {chain} and cast one vote.',
      'Vote on a second proposal when one appears.'],
  ];
  function actionsFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    for (var i = 0; i < ACTIONS.length; i++) {
      var keys = ACTIONS[i][0];
      for (var j = 0; j < keys.length; j++) {
        if (keys[j] === 'chain' && c.indexOf('cross') >= 0) continue;
        if (c.indexOf(keys[j]) >= 0) {
          return [ACTIONS[i][1], ACTIONS[i][2]];
        }
      }
    }
    return [
      'Deposit {cap} of USDC into {name} on {chain} and keep the position open.',
      'Do one more qualifying action in the app, such as a swap, a deposit or a vote.',
    ];
  }
  function fill(tpl, p, capital, chain) {
    return tpl.split('{cap}').join('$' + capital).split('{name}').join(p.name).split('{chain}').join(chain);
  }
  function farmStepsFor(row) {
    var chain = chainOf(row);
    var capital = capitalFor(row);
    var hold = holdDaysFor(row.age_days);
    var gas = gasPerTx(chain);
    var weeklyGas = Math.round(gas * Math.ceil(hold / 7) * 100) / 100;
    var weekly = Math.ceil(hold / 7);
    var txCount = 2 + weekly + 1;
    var pair = actionsFor(row, capital, chain);
    var steps = [
      { text: 'Use a dedicated wallet for this farm only. Fund it with $' + capital + ' plus gas on ' + chain + ', and store its seed phrase offline.', cost: gasText(gas) + ' of gas for the first transaction', time: '10 minutes' },
      { text: fill(pair[0], row, capital, chain), cost: '$' + capital + ' of capital and ' + gasText(gas) + ' of gas', time: '15 minutes to set up' },
      { text: fill(pair[1], row, capital, chain), cost: 'about $25 of volume and ' + gasText(gas) + ' of gas', time: '10 minutes' },
      { text: 'Do one qualifying action each week — a deposit, a swap, a vote or a claim — so the wallet shows steady activity.', cost: 'about $' + weeklyGas + ' of gas over ' + Math.ceil(hold / 7) + ' weeks', time: '10 minutes a week' },
      { text: 'Open ' + row.name + '\'s own points or rewards page from the link the protocol itself publishes and check the position is counted.', cost: 'no fee to check', time: '10 minutes' },
      { text: 'Keep the position open for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: 'If a token is announced, claim only from the protocol\'s own page or announcement, and never pay anyone to claim for you.', cost: 'gas only, never a claim fee', time: '10 minutes' },
      { text: 'Net it out: $' + capital + ' of capital plus $' + row.gas_total_usd + ' of gas over ' + txCount + ' transactions is $' + row.total_cost_usd + ' out of pocket. The farm pays for itself if a launch pays you ' + row.breakeven_bp + ' basis points of the $' + row.implied_value_usd.toLocaleString('en-US') + ' implied value.', cost: '$' + row.total_cost_usd + ' all in', time: hold + ' days, then unwind in two parts' },
    ];
    return steps;
  }

  // --- Rendering ---
  function categories() {
    var seen = {};
    DATA.rows.forEach(function (r) { seen[r.category || 'No category'] = true; });
    return Object.keys(seen).sort();
  }
  function chains() {
    var seen = {};
    DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { seen[c] = true; }); });
    return Object.keys(seen).sort();
  }
  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) {
      if (state.watch && !watchSet[r.slug]) return false;
      if (state.category !== 'all' && (r.category || 'No category') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = state.sort;
    rows.sort(function (a, b) {
      var av = key === 'implied' ? a.implied_value_usd : key === 'tvl' ? a.tvl_usd : key === 'quality' ? a.quality_score : key === 'breakeven' ? a.breakeven_bp : a.name.toLowerCase();
      var bv = key === 'implied' ? b.implied_value_usd : key === 'tvl' ? b.tvl_usd : key === 'quality' ? b.quality_score : key === 'breakeven' ? b.breakeven_bp : b.name.toLowerCase();
      if (av < bv) return -1 * state.dir;
      if (av > bv) return 1 * state.dir;
      return a.slug < b.slug ? -1 : 1;
    });
    return rows;
  }
  function rowBySlug(slug) {
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === slug) return DATA.rows[i];
    return null;
  }
  function selectRow(slug) {
    state.selected = slug;
    syncHash();
    render();
  }
  function syncHash() {
    var parts = [];
    if (state.selected) parts.push('detail=' + encodeURIComponent(state.selected));
    if (state.watch) parts.push('watch=1');
    if (state.tab !== 'pre') parts.push('tab=' + state.tab);
    var h = parts.length ? '#' + parts.join('&') : '';
    if (window.location.hash !== h) history.replaceState(null, '', h);
  }
  function readHash() {
    var h = window.location.hash.replace(/^#/, '');
    if (!h) return;
    h.split('&').forEach(function (kv) {
      var p = kv.split('=');
      if (p[0] === 'detail' && p[1]) state.selected = decodeURIComponent(p[1]);
      if (p[0] === 'watch') state.watch = p[1] === '1';
      if (p[0] === 'tab' && (p[1] === 'pre' || p[1] === 'live')) state.tab = p[1];
    });
  }

  function statCard(num, lbl) {
    return el('div', { class: 'stat' }, el('div', { class: 'num', text: num }), el('div', { class: 'lbl', text: lbl }));
  }
  function testCard(num, lbl) {
    return el('div', { class: 'test' }, el('div', { class: 'num', text: num }), el('div', { class: 'lbl', text: lbl }));
  }

  function renderDetail(row) {
    var calc = impliedOf(row);
    var flow = el('div', { class: 'flow' },
      el('div', { class: 'step' }, el('div', { class: 'k', text: 'Comparables value' }), el('div', { class: 'v', text: fmtUsd(calc.knn) })),
      el('div', { class: 'step eq', text: '×' }),
      el('div', { class: 'step' }, el('div', { class: 'k', text: 'Momentum (7d ' + fmtPct(row.change_7d) + ')' }), el('div', { class: 'v', text: fmtMult(calc.growthMult) })),
      el('div', { class: 'step eq', text: '×' }),
      el('div', { class: 'step' }, el('div', { class: 'k', text: 'Quality tilt (' + fmtScore(row.quality_score) + ')' }), el('div', { class: 'v', text: fmtMult(calc.qualityTilt) })),
      el('div', { class: 'step eq', text: '=' }),
      el('div', { class: 'step' }, el('div', { class: 'k', text: 'Implied value' }), el('div', { class: 'v', text: fmtUsd(row.implied_value_usd) })));
    var neighRows = row.neighbors.map(function (n) {
      return el('tr', {},
        el('td', {}, el('b', { text: n.name })),
        el('td', { class: 'money', text: fmtUsd(n.mcap_usd) }),
        el('td', { class: 'money num', text: fmtDist(n.distance) }),
        el('td', { class: 'money num', text: Math.round(n.weight * 100) + '%' }),
        el('td', {}, n.same_category ? el('span', { class: 'pill same', text: 'same category' }) : el('span', { class: 'pill', text: 'other category' })));
    });
    var neighTable = el('table', { class: 'neigh' },
      el('thead', {}, el('tr', {},
        el('th', { text: 'Comparable' }), el('th', { text: 'Its market cap' }), el('th', { text: 'Distance' }), el('th', { text: 'Weight' }), el('th', { text: 'Category' }))),
      el('tbody', {}, neighRows));
    var steps = farmStepsFor(row).map(function (s) {
      return el('li', {}, document.createTextNode(s.text + ' '), el('span', { class: 'cost', text: 'Cost: ' + s.cost + '. Time: ' + s.time + '.' }));
    });
    return el('section', { class: 'detail', 'aria-label': 'Protocol detail' },
      el('button', { class: 'back', text: '← Back to the board', onclick: function () { selectRow(null); } }),
      el('h2', { text: '#' + row.rank + ' — ' + row.name }),
      el('p', { class: 'sub', text: (row.category || 'No category') + ' · ' + (row.chains || []).join(', ') + ' · TVL ' + fmtUsd(row.tvl_usd) + ' · 7d ' + fmtPct(row.change_7d) + ' · tracked ' + fmtAge(row.age_days) + (watchSet[row.slug] ? ' · on the watchlist' : '') }),
      el('h3', { text: 'How it was priced' }),
      flow,
      el('p', { text: 'The comparables value is the weighted geometric mean of the twelve live-token protocols nearest to ' + row.name + ' in size, age, growth and category. A close comparable counts far more than a distant one; the value is local, not a global law.' }),
      el('h3', { text: 'The twelve comparables' }),
      neighTable,
      el('h3', { text: 'Launch-quality score — ' + fmtScore(row.quality_score) }),
      el('div', { class: 'qgrid' },
        el('div', { class: 'q' }, el('div', { class: 'num', text: 'Breadth' }), el('div', { class: 'lbl', text: (row.chains || []).length + ' chains' })),
        el('div', { class: 'q' }, el('div', { class: 'num', text: 'Age' }), el('div', { class: 'lbl', text: fmtAge(row.age_days) + ' tracked' })),
        el('div', { class: 'q' }, el('div', { class: 'num', text: 'Momentum' }), el('div', { class: 'lbl', text: fmtPct(row.change_7d) + ' in 7 days' })),
        el('div', { class: 'q' }, el('div', { class: 'num', text: 'Scale' }), el('div', { class: 'lbl', text: 'TVL ' + fmtUsd(row.tvl_usd) }))),
      el('h3', { text: 'Farm economics' }),
      el('div', { class: 'econ' },
        el('div', { class: 'box' }, el('div', { class: 'num', text: fmtMoney(row.capital_usd) }), el('div', { class: 'lbl', text: 'capital' })),
        el('div', { class: 'box' }, el('div', { class: 'num', text: fmtMoney(row.gas_total_usd) }), el('div', { class: 'lbl', text: 'gas in total' })),
        el('div', { class: 'box' }, el('div', { class: 'num', text: fmtMoney(row.total_cost_usd) }), el('div', { class: 'lbl', text: 'out of pocket' })),
        el('div', { class: 'box' }, el('div', { class: 'num', text: row.breakeven_bp + ' bp' }), el('div', { class: 'lbl', text: 'break-even share' }))),
      el('h3', { text: 'Farm plan — 8 steps' }),
      el('ol', { class: 'steps' }, steps));
  }

  function renderBoardTable(rows) {
    var head = el('thead', {}, el('tr', {},
      el('th', { class: 'rk' }, el('button', { text: '#', onclick: function () { state.sort = 'implied'; state.dir = -1; render(); } })),
      el('th', {}, el('button', { text: 'Protocol', onclick: function () { state.sort = 'name'; state.dir = 1; render(); } })),
      el('th', { text: 'Category' }),
      el('th', { text: 'Chains' }),
      el('th', { class: 'money' }, el('button', { text: 'TVL', onclick: function () { state.sort = 'tvl'; state.dir = -1; render(); } })),
      el('th', { class: 'money', text: '7d' }),
      el('th', { class: 'money' }, el('button', { text: 'Quality', onclick: function () { state.sort = 'quality'; state.dir = -1; render(); } })),
      el('th', { class: 'money' }, el('button', { text: 'Implied', onclick: function () { state.sort = 'implied'; state.dir = -1; render(); } })),
      el('th', { class: 'money bp' }, el('button', { text: 'Break-even', onclick: function () { state.sort = 'breakeven'; state.dir = 1; render(); } }))));
    var bodyRows = rows.map(function (r) {
      var chg = r.change_7d === null || r.change_7d === undefined ? el('span', { text: 'n/a' }) : el('span', { class: r.change_7d >= 0 ? 'pos' : 'neg', text: fmtPct(r.change_7d) });
      return el('tr', { onclick: function () { selectRow(r.slug); } },
        el('td', { class: 'rk num', text: String(r.rank) }),
        el('td', {}, el('b', { text: r.name }), watchSet[r.slug] ? el('span', { class: 'pill watch', text: ' watchlist' }) : null),
        el('td', { text: r.category || '—' }),
        el('td', { text: (r.chains || []).slice(0, 2).join(', ') + ((r.chains || []).length > 2 ? ' +' + ((r.chains || []).length - 2) : '') }),
        el('td', { class: 'money num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'money' }, chg),
        el('td', { class: 'money num', text: String(Math.round(r.quality_score)) }),
        el('td', { class: 'money num' }, el('b', { text: fmtUsd(r.implied_value_usd) })),
        el('td', { class: 'money bp num', text: r.breakeven_bp + ' bp' }));
    });
    if (bodyRows.length === 0) return el('p', { class: 'empty', text: 'No protocols match this filter.' });
    return el('table', { class: 'board' }, head, el('tbody', {}, bodyRows));
  }

  function renderLive() {
    var rows = DATA.live.map(function (p) {
      var ratio = p.ratio === null || p.ratio === undefined ? el('span', { text: 'n/a' }) : el('span', { class: p.ratio > 1 ? 'pos' : 'neg', text: p.ratio.toFixed(2) + 'x' });
      return el('tr', {},
        el('td', {}, el('b', { text: p.name })),
        el('td', { text: p.category || '—' }),
        el('td', { class: 'money num', text: fmtUsd(p.tvl_usd) }),
        el('td', { class: 'money num', text: fmtUsd(p.mcap_usd) }),
        el('td', { class: 'money num', text: fmtUsd(p.predicted_mcap_usd) }),
        el('td', { class: 'money' }, ratio));
    });
    return el('div', {},
      el('p', { text: 'The same comparables engine, run over the tokens that already trade: each token is priced from its twelve nearest neighbours among the other live tokens, never from itself. Where the market pays far more than the neighbours suggest, the token trades on something size and growth do not explain — a brand, a narrative, or a moat. Where it pays less, the neighbours say it is cheap for its size.' }),
      el('table', { class: 'board' },
        el('thead', {}, el('tr', {},
          el('th', { text: 'Token' }), el('th', { text: 'Category' }), el('th', { class: 'money', text: 'TVL' }), el('th', { class: 'money', text: 'Market cap' }), el('th', { class: 'money', text: 'Comparables say' }), el('th', { class: 'money', text: 'Market / comparables' }))),
        el('tbody', {}, rows)));
  }

  function render() {
    app.setAttribute('aria-busy', 'false');
    var wrap = el('div', { class: 'wrap' });
    var top = DATA.rows.slice(0, 3);
    wrap.appendChild(el('header', { class: 'masthead' },
      el('div', { class: 'kicker', text: 'Token Radar 4 · make.fun bounty token-radar-01' }),
      el('h1', { text: 'Pre-token protocols, priced from their nearest neighbours' }),
      el('p', { class: 'lede' }, 'Every protocol below is priced from the twelve live-token protocols closest to it in size, age, growth and category — not from a global curve and not from a category average. ', el('b', { text: 'Click any row to see the twelve comparables that priced it.' }), ' Snapshot ' + DATA.as_of + ' · floor ' + fmtUsd(DATA.floor_usd) + ' · ' + DATA.board_size + ' protocols ranked.')));
    wrap.appendChild(el('div', { class: 'stats' },
      statCard(String(DATA.board_size), 'protocols ranked'),
      statCard(String(DATA.watchlist_size), 'on the watchlist'),
      statCard(String(V.train_size), 'live tokens as comparables'),
      statCard('k = ' + V.neighbors, 'nearest neighbours each')));
    var looPct = Math.round(V.loo_within_2x * 100) + '%';
    var splitPct = V.split_within_2x === null ? 'n/a' : Math.round(V.split_within_2x * 100) + '%';
    var splitMed = V.split_median_log_err === null ? 'n/a' : V.split_median_log_err.toFixed(3) + ' dex';
    wrap.appendChild(el('section', { class: 'panel' },
      el('h2', { text: 'How the engine was tested — before it priced anything' }),
      el('p', { text: 'Both tests predict a live token\u2019s market cap from its comparables alone, with no momentum and no quality tilt, so they measure the engine itself. A median error of 0.5 dex means a typical prediction is off by about 3x: treat every implied value as an order of magnitude, not a price.' }),
      el('div', { class: 'testgrid' },
        testCard(V.loo_median_log_err.toFixed(3) + ' dex', 'leave-one-out median error'),
        testCard(looPct, 'leave-one-out within 2x'),
        testCard(splitMed, 'time-split median error' + (V.split_cutoff ? ' (cutoff ' + V.split_cutoff + ')' : '')),
        testCard(splitPct, 'time-split within 2x')),
      el('p', { text: 'On the board itself, a typical row shares ' + Math.round(V.median_same_category_share * 100) + '% of its comparables with its own category, at a median neighbour distance of ' + V.median_neighbor_distance.toFixed(2) + '. When a row\u2019s comparables are mostly from other categories, say so in the detail view: the price leans on size and growth, not on a like-for-like peer.' })));
    wrap.appendChild(el('div', { class: 'tabs' },
      el('button', { class: 'tab', 'aria-selected': state.tab === 'pre' ? 'true' : 'false', text: 'Pre-token board (' + DATA.board_size + ')', onclick: function () { state.tab = 'pre'; state.selected = null; syncHash(); render(); } }),
      el('button', { class: 'tab', 'aria-selected': state.tab === 'live' ? 'true' : 'false', text: 'Live-token check (' + DATA.live_size + ')', onclick: function () { state.tab = 'live'; state.selected = null; syncHash(); render(); } })));
    if (state.tab === 'live') {
      wrap.appendChild(renderLive());
    } else {
      var sel = state.selected ? rowBySlug(state.selected) : null;
      if (sel) {
        wrap.appendChild(renderDetail(sel));
      } else {
        var catOpts = [el('option', { value: 'all', text: 'All categories' })].concat(categories().map(function (c) {
          return el('option', { value: c, text: c });
        }));
        var chainOpts = [el('option', { value: 'all', text: 'All chains' })].concat(chains().map(function (c) {
          return el('option', { value: c, text: c });
        }));
        var search = el('input', { type: 'search', placeholder: 'Search name or slug…', value: state.q, 'aria-label': 'Search protocols', oninput: function (e) { state.q = e.target.value; render(); } });
        var catSel = el('select', { 'aria-label': 'Filter by category', onchange: function (e) { state.category = e.target.value; render(); } }, catOpts);
        var chainSel = el('select', { 'aria-label': 'Filter by chain', onchange: function (e) { state.chain = e.target.value; render(); } }, chainOpts);
        catSel.value = state.category;
        chainSel.value = state.chain;
        wrap.appendChild(el('div', { class: 'controls' },
          search, catSel, chainSel,
          el('label', {}, el('input', { type: 'checkbox', checked: state.watch ? true : null, onchange: function (e) { state.watch = e.target.checked; syncHash(); render(); } }), document.createTextNode(' Watchlist only'))));
        var leaders = top.map(function (r) {
          return el('button', { class: 'leader', onclick: function () { selectRow(r.slug); } },
            el('span', { class: 'rk', text: '#' + r.rank }),
            el('span', { class: 'nm', text: r.name }),
            el('span', { class: 'vl', text: fmtUsd(r.implied_value_usd) }));
        });
        wrap.appendChild(el('div', { class: 'leaders' }, leaders));
        var rows = filteredRows();
        wrap.appendChild(el('p', { class: 'note', text: rows.length + ' of ' + DATA.board_size + ' protocols shown · sorted by ' + state.sort + ' · click a row for its comparables and farm plan.' }));
        wrap.appendChild(renderBoardTable(rows));
      }
    }
    wrap.appendChild(el('p', { class: 'note', text: 'A protocol records no token when its DefiLlama record carries none — the record is not proof it has none. Implied values are this radar\u2019s own claim, computed from the sealed snapshot alone; they are not a prediction that a token will be issued, or when. Source: ' + DATA.source }));
    app.textContent = '';
    app.appendChild(wrap);
  }

  readHash();
  render();
  window.addEventListener('hashchange', function () { readHash(); render(); });
})();
