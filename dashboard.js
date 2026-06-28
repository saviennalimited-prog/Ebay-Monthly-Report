// ============================================================
// dashboard.js
// Handles file selection, rendering all tabs, charts,
// and localStorage persistence for costs/postage.
// ============================================================

// ---- State ----
let txFile = null, ordFile = null;
let REPORT = null;
let currentTab = 'overview';
let filteredSkus = [];

// Costs saved to localStorage so they persist between sessions
let COSTS = {};    // { sku: costPerUnit }
let POSTAGE = { ll: 0, t48: 0, t24: 0 };

function loadSavedCosts() {
  try {
    const c = localStorage.getItem('emr_costs');
    if (c) COSTS = JSON.parse(c);
    const p = localStorage.getItem('emr_postage');
    if (p) POSTAGE = { ...POSTAGE, ...JSON.parse(p) };
  } catch(e) {}
}

function saveCostsToStorage() {
  try {
    localStorage.setItem('emr_costs', JSON.stringify(COSTS));
    localStorage.setItem('emr_postage', JSON.stringify(POSTAGE));
  } catch(e) {}
}

// ---- File selection ----
function fileSelected(type, input) {
  const file = input.files[0];
  if (!file) return;
  if (type === 'tx') {
    txFile = file;
    document.getElementById('txCard').classList.add('done');
    document.getElementById('txStatus').textContent = '✓ ' + file.name;
  } else {
    ordFile = file;
    document.getElementById('ordCard').classList.add('done');
    document.getElementById('ordStatus').textContent = '✓ ' + file.name;
  }
  const btn = document.getElementById('processBtn');
  const txt = document.getElementById('processBtnText');
  if (txFile && ordFile) {
    btn.disabled = false;
    txt.textContent = 'Generate Dashboard →';
  } else {
    btn.disabled = true;
    txt.textContent = txFile ? 'Now upload Orders Report' : 'Now upload Transaction Report';
  }
}

// ---- Process files ----
function processFiles() {
  const overlay = document.createElement('div');
  overlay.className = 'loading-overlay';
  overlay.innerHTML = '<div class="loading-spinner"></div><div class="loading-text">Reading your reports…</div>';
  document.body.appendChild(overlay);

  loadSavedCosts();

  const readFile = f => new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = e => res(e.target.result);
    reader.onerror = rej;
    reader.readAsText(f);
  });

  Promise.all([readFile(txFile), readFile(ordFile)]).then(([txText, ordText]) => {
    try {
      REPORT = crunchData(txText, ordText);
      filteredSkus = [...REPORT.allSkus];
      document.body.removeChild(overlay);
      showDashboard();
    } catch(err) {
      document.body.removeChild(overlay);
      alert('Could not parse your files. Please make sure you uploaded the Transaction Report and Orders Report in CSV format.\n\nError: ' + err.message);
      console.error(err);
    }
  }).catch(err => {
    document.body.removeChild(overlay);
    alert('Error reading files: ' + err.message);
  });
}

// ---- Show dashboard ----
function showDashboard() {
  document.getElementById('uploadPage').style.display = 'none';
  document.getElementById('dashPage').style.display = 'block';
  document.getElementById('hdrPeriod').textContent = REPORT.period;
  showTab('overview');
}

function goBack() {
  document.getElementById('dashPage').style.display = 'none';
  document.getElementById('uploadPage').style.display = 'flex';
  txFile = null; ordFile = null; REPORT = null;
  document.getElementById('txCard').classList.remove('done');
  document.getElementById('ordCard').classList.remove('done');
  document.getElementById('txStatus').textContent = 'Click to upload CSV';
  document.getElementById('ordStatus').textContent = 'Click to upload CSV';
  document.getElementById('txInput').value = '';
  document.getElementById('ordInput').value = '';
  document.getElementById('processBtn').disabled = true;
  document.getElementById('processBtnText').textContent = 'Upload both files to continue';
}

// ---- Tabs ----
function showTab(id) {
  currentTab = id;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');
  const tabs = ['overview','skus','costs','expenses'];
  document.querySelectorAll('.tab')[tabs.indexOf(id)].classList.add('active');

  // Render the tab panel
  const main = document.getElementById('dashMain');
  let panel = document.getElementById('panel-' + id);
  if (!panel) {
    panel = document.createElement('div');
    panel.className = 'tab-panel';
    panel.id = 'panel-' + id;
    main.appendChild(panel);
    renderTab(id, panel);
  } else {
    if (id === 'costs') renderCostsTab(panel);
    if (id === 'skus') renderSkuTable();
  }
  panel.style.display = 'block';
}

function renderTab(id, el) {
  if (id === 'overview') renderOverviewTab(el);
  else if (id === 'skus') renderSkusTab(el);
  else if (id === 'costs') renderCostsTab(el);
  else if (id === 'expenses') renderExpensesTab(el);
}

// ---- Helpers ----
const f2 = n => '£' + Math.abs(n).toFixed(2);
const f0 = n => '£' + Math.round(Math.abs(n)).toLocaleString();
const pct = n => n.toFixed(1) + '%';
const num = n => n.toLocaleString();

function metricCard(label, value, sub, colorClass) {
  return `<div class="metric-card ${colorClass}">
    <div class="mc-label">${label}</div>
    <div class="mc-value ${colorClass}">${value}</div>
    <div class="mc-sub">${sub}</div>
  </div>`;
}

// ---- OVERVIEW TAB ----
function renderOverviewTab(el) {
  const m = REPORT.metrics;
  el.innerHTML = `
    <div class="print-title"><h2>eBay Monthly Report</h2><p>Period: ${REPORT.period}</p></div>

    <div class="metric-grid">
      ${metricCard('Gross Sales', f0(m.grossSales), REPORT.period, 'c-bl')}
      ${metricCard('Net Revenue', f0(m.netRevenue), 'After all eBay fees', 'c-gr')}
      ${metricCard('Total Orders', num(m.uniqueOrders), num(m.totalOrderLines) + ' order lines', 'c-bl')}
      ${metricCard('Units Shipped', num(m.totalUnits), 'Avg ' + (m.totalUnits/m.uniqueOrders).toFixed(1) + ' per order', 'c-bl')}
      ${metricCard('eBay Fees', f0(m.totalFees + m.otherFeeTotal), pct(m.feeRate) + ' take rate', 'c-rd')}
      ${metricCard('Refunds & Claims', f0(m.refundTotal + m.claimTotal), f2(m.refundTotal) + ' refunds · ' + f2(m.claimTotal) + ' claims', 'c-am')}
      ${metricCard('Avg Order Value', f2(m.avgOrderValue), 'Across ' + num(m.uniqueOrders) + ' orders', 'c-pu')}
      ${metricCard('Active SKUs', num(m.uniqueSkus), 'Unique custom labels', 'c-bl')}
    </div>

    <div class="g-32">
      <div class="card">
        <div class="card-title">Daily Sales <span class="card-badge">Gross Revenue</span></div>
        <canvas id="dailyChart" height="160" style="width:100%;display:block"></canvas>
      </div>
      <div class="card">
        <div class="card-title">Fee Breakdown</div>
        <div class="donut-wrap">
          <svg id="donutSvg" width="110" height="110" viewBox="0 0 110 110" style="flex-shrink:0"></svg>
          <div class="donut-legend" id="donutLegend"></div>
        </div>
      </div>
    </div>

    <div class="g2">
      <div class="card">
        <div class="card-title">Top 10 SKUs by Revenue</div>
        <div id="topBars"></div>
      </div>
      <div class="card">
        <div class="card-title">Fulfilment & Payout</div>
        <div class="stat-pair">
          <div class="stat-box am">
            <div class="stat-box-label">📮 RM Large Letter</div>
            <div class="stat-box-val" style="color:var(--am)">${num(REPORT.postage.ll)}</div>
            <div class="stat-box-sub">Single cable orders</div>
          </div>
          <div class="stat-box ac">
            <div class="stat-box-label">📦 RM Tracked 48</div>
            <div class="stat-box-val" style="color:var(--ac)">${num(REPORT.postage.t48)}</div>
            <div class="stat-box-sub">Qty 2+ / non-cable</div>
          </div>
        </div>
        <div style="background:rgba(124,92,252,.1);border:1px solid rgba(124,92,252,.25);border-radius:8px;padding:10px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center">
          <div>
            <div style="font-size:11px;color:var(--mu)">Promoted Listings</div>
            <div style="font-size:10px;color:var(--mu);margin-top:1px">${pct(m.promotedFees/m.grossSales*100)} of gross sales</div>
          </div>
          <div style="font-family:var(--mono);font-weight:600;color:var(--rd)">-${f0(m.promotedFees)}</div>
        </div>
        <div class="card-title" style="margin-bottom:10px">Payout Reconciliation</div>
        <div class="sum-box">
          <div class="sum-row"><span class="sum-label">Gross Orders</span><span class="td-mono td-gr">+${f2(m.grossSales)}</span></div>
          <div class="sum-row"><span class="sum-label">Refunds & Claims</span><span class="td-mono td-rd">-${f2(m.refundTotal+m.claimTotal)}</span></div>
          <div class="sum-row"><span class="sum-label">All eBay Fees</span><span class="td-mono td-rd">-${f2(m.totalFees+m.otherFeeTotal)}</span></div>
          <div class="sum-row"><span class="sum-label">Adjustments</span><span class="td-mono td-rd">-${f2(m.adjTotal)}</span></div>
          <div class="sum-row"><span class="sum-total-label">Total Paid Out</span><span class="td-mono" style="font-size:17px">${f2(m.payout)}</span></div>
        </div>
      </div>
    </div>
  `;

  requestAnimationFrame(() => {
    drawDailyChart();
    drawDonut();
    drawTopBars();
  });
}

// ---- Daily Chart ----
function drawDailyChart() {
  const cvs = document.getElementById('dailyChart');
  if (!cvs) return;
  const ctx = cvs.getContext('2d');
  const W = cvs.offsetWidth || 400; const H = 160;
  cvs.width = W; cvs.height = H;
  const daily = REPORT.daily;
  const vals = daily.map(d => d.sales);
  const max = Math.max(...vals) || 1;
  const pad = {l:50,r:8,t:12,b:26};
  const cw = W-pad.l-pad.r; const ch = H-pad.t-pad.b;
  const bw = Math.max(1, cw/vals.length - 1.5);
  ctx.clearRect(0,0,W,H);

  [0,.25,.5,.75,1].forEach(f => {
    const y = pad.t+ch*(1-f);
    ctx.strokeStyle='#252b3a'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(pad.l,y); ctx.lineTo(W-pad.r,y); ctx.stroke();
    ctx.fillStyle='#6b7494'; ctx.font='9px Inter'; ctx.textAlign='right';
    ctx.fillText('£'+Math.round(max*f), pad.l-3, y+3);
  });

  daily.forEach((d,i) => {
    const x = pad.l + i*(cw/vals.length) + 0.5;
    const h = (d.sales/max)*ch; const y = pad.t+ch-h;
    const isHigh = d.sales === max;
    const grad = ctx.createLinearGradient(0,y,0,y+h);
    grad.addColorStop(0, isHigh ? '#4f8ef7' : '#7c5cfc');
    grad.addColorStop(1, 'rgba(79,142,247,0.12)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x,y,bw,h,2);
    else ctx.rect(x,y,bw,h);
    ctx.fill();
    if (isHigh) {
      ctx.fillStyle='#e8eaf0'; ctx.font='bold 8px Inter'; ctx.textAlign='center';
      ctx.fillText('£'+Math.round(d.sales), x+bw/2, y-3);
    }
    const day = parseInt(d.date.slice(8));
    if (day===1 || day%5===0 || i===vals.length-1) {
      ctx.fillStyle='#6b7494'; ctx.font='9px Inter'; ctx.textAlign='center';
      ctx.fillText(String(day), x+bw/2, H-6);
    }
  });
}

// ---- Donut ----
function drawDonut() {
  const m = REPORT.metrics;
  const segs = [
    {l:'FVF Fixed',  v: m.totalFvfFixed,  c:'#f75555'},
    {l:'FVF Variable',v: m.totalFvfVar,   c:'#ff9f43'},
    {l:'Promoted',   v: m.promotedFees,   c:'#7c5cfc'},
    {l:'Other Fees', v: m.otherFeeTotal - m.promotedFees, c:'#f7b955'},
    {l:'Refunds',    v: m.refundTotal + m.claimTotal, c:'#ff6b81'},
  ].filter(s => s.v > 0);
  const tot = segs.reduce((s,x) => s+x.v, 0);
  const svg = document.getElementById('donutSvg');
  if (!svg || !tot) return;
  const cx=55,cy=55,r=40,ri=25;
  let angle=-Math.PI/2, paths='';
  segs.forEach(sg => {
    const sw = (sg.v/tot)*2*Math.PI;
    const x1=cx+r*Math.cos(angle),y1=cy+r*Math.sin(angle);
    const x2=cx+r*Math.cos(angle+sw),y2=cy+r*Math.sin(angle+sw);
    const xi1=cx+ri*Math.cos(angle),yi1=cy+ri*Math.sin(angle);
    const xi2=cx+ri*Math.cos(angle+sw),yi2=cy+ri*Math.sin(angle+sw);
    const lg=sw>Math.PI?1:0;
    paths += `<path d="M${x1},${y1}A${r},${r}0 ${lg},1 ${x2},${y2}L${xi2},${yi2}A${ri},${ri}0 ${lg},0 ${xi1},${yi1}Z" fill="${sg.c}" opacity=".85"/>`;
    angle+=sw;
  });
  svg.innerHTML = paths + `<text x="55" y="51" text-anchor="middle" fill="#6b7494" font-size="8" font-family="Inter">Fees</text>
    <text x="55" y="62" text-anchor="middle" fill="#f75555" font-size="9.5" font-family="JetBrains Mono" font-weight="600">-${f0(tot)}</text>`;
  document.getElementById('donutLegend').innerHTML = segs.map(s =>
    `<div class="donut-row">
      <div class="donut-dot" style="background:${s.c}"></div>
      <div class="donut-name">${s.l}</div>
      <div class="donut-val">-${f0(s.v)}</div>
    </div>`
  ).join('');
}

// ---- Top bars ----
function drawTopBars() {
  const top = REPORT.allSkus.slice(0,10);
  const mx = top[0]?.gross || 1;
  document.getElementById('topBars').innerHTML = top.map((s,i) =>
    `<div class="bar-item">
      <div class="bar-head">
        <span class="bar-label">${i+1}. ${s.sku} <span style="color:var(--mu);font-size:10px">(${s.orders} orders)</span></span>
        <span class="bar-val td-ac">${f0(s.gross)}</span>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${(s.gross/mx*100).toFixed(1)}%;background:${i<3?'var(--ac)':'var(--ac2)'}"></div></div>
    </div>`
  ).join('');
}

// ---- SKU TAB ----
function renderSkusTab(el) {
  el.innerHTML = `
    <div class="controls-row">
      <input class="search-bar" type="text" id="skuSearch" placeholder="Search SKU / custom label…" oninput="filterSkus()">
      <select class="sel" id="skuSortSel" onchange="filterSkus()">
        <option value="gross">Revenue ↓</option>
        <option value="orders">Orders ↓</option>
        <option value="units">Units ↓</option>
        <option value="net">Net Revenue ↓</option>
        <option value="fee_pct">Fee % ↓</option>
      </select>
    </div>
    <div class="card">
      <div class="card-title">All SKUs — ${REPORT.period} <span class="card-badge" id="skuCountBadge">${REPORT.allSkus.length} SKUs</span>
        <span style="margin-left:auto;font-size:11px;color:var(--mu)">Enter costs in Costs tab to see profit</span>
      </div>
      <div class="table-wrap scroll-body">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Custom Label (SKU)</th>
              <th>Orders</th>
              <th>Units</th>
              <th>Gross Sales</th>
              <th>eBay Fees</th>
              <th>Net Revenue</th>
              <th>Fee %</th>
              <th>Avg Order</th>
              <th>Postage</th>
              <th>Cost/Unit</th>
              <th>Est. Profit</th>
            </tr>
          </thead>
          <tbody id="skuTableBody"></tbody>
        </table>
      </div>
    </div>
  `;
  renderSkuTable();
}

function inferPostageType(sku, units, orders) {
  // If avg units per order is 1 and it's a cable → Large Letter
  const avgQty = orders > 0 ? units / orders : 1;
  return (isCableSku(sku) && avgQty <= 1.2) ? 'll' : 't48';
}

function renderSkuTable() {
  const body = document.getElementById('skuTableBody');
  const badge = document.getElementById('skuCountBadge');
  if (!body) return;

  const q = (document.getElementById('skuSearch')?.value || '').toLowerCase();
  const sortKey = document.getElementById('skuSortSel')?.value || 'gross';
  let skus = REPORT.allSkus.filter(s => s.sku.toLowerCase().includes(q));
  skus = [...skus].sort((a,b) => b[sortKey] - a[sortKey]);

  if (badge) badge.textContent = skus.length + ' SKUs';

  body.innerHTML = skus.map((s, i) => {
    const cost = parseFloat(COSTS[s.sku] || 0);
    const pt = inferPostageType(s.sku, s.units, s.orders);
    const pCost = pt === 'll' ? POSTAGE.ll : POSTAGE.t48;
    const pBadge = pt === 'll'
      ? '<span class="badge badge-ll">📮 Large Letter</span>'
      : '<span class="badge badge-t48">📦 RM48</span>';

    let profitHtml = '<span class="badge badge-na">Enter cost</span>';
    if (cost > 0) {
      const totalCost = (cost + pCost) * s.units;
      const profit = s.net - totalCost;
      const cls = profit >= 0 ? 'badge-pos' : 'badge-neg';
      profitHtml = `<span class="badge ${cls}">${profit >= 0 ? '+' : ''}${f2(profit)}</span>`;
    }
    const feeClass = s.fee_pct > 25 ? 'td-rd' : s.fee_pct > 20 ? 'td-am' : 'td-mu';
    return `<tr>
      <td class="td-rank">${i+1}</td>
      <td class="td-sku" title="${s.sku}">${s.sku}</td>
      <td class="td-mono td-ac">${s.orders}</td>
      <td class="td-mu">${s.units}</td>
      <td class="td-mono td-ac">${f2(s.gross)}</td>
      <td class="td-mono td-rd">-${f2(Math.abs(s.fees))}</td>
      <td class="td-mono td-gr">${f2(s.net)}</td>
      <td class="td-mono ${feeClass}">${pct(s.fee_pct)}</td>
      <td class="td-mu">${f2(s.avg_val)}</td>
      <td>${pBadge}</td>
      <td>${cost > 0 ? '<span class="td-mono td-mu">'+f2(cost)+'</span>' : '<span class="td-mu">—</span>'}</td>
      <td>${profitHtml}</td>
    </tr>`;
  }).join('');
}

function filterSkus() { renderSkuTable(); }

// ---- COSTS TAB ----
function renderCostsTab(el) {
  el.innerHTML = `
    <div class="card" style="margin-bottom:14px">
      <div class="card-title">Postage Costs per Service <span class="card-badge">Saved automatically to your browser</span></div>
      <div class="postage-grid">
        <div class="postage-card">
          <div class="postage-name">📮 Royal Mail Large Letter</div>
          <div class="postage-sub" style="color:var(--am)">Single cable orders (qty = 1)</div>
          <div class="cost-inp-wrap"><span>£</span><input class="cost-inp" type="number" step="0.01" id="post_ll" value="${POSTAGE.ll||''}" placeholder="0.00" oninput="savePostage()"></div>
          <div class="postage-count">${REPORT.postage.ll} orders use this</div>
        </div>
        <div class="postage-card">
          <div class="postage-name">📦 Royal Mail Tracked 48</div>
          <div class="postage-sub" style="color:var(--ac)">Qty 2+ / non-cable / accessories</div>
          <div class="cost-inp-wrap"><span>£</span><input class="cost-inp" type="number" step="0.01" id="post_t48" value="${POSTAGE.t48||''}" placeholder="0.00" oninput="savePostage()"></div>
          <div class="postage-count">${REPORT.postage.t48} orders use this</div>
        </div>
        <div class="postage-card">
          <div class="postage-name">🚀 Royal Mail Tracked 24</div>
          <div class="postage-sub" style="color:var(--mu)">Express orders</div>
          <div class="cost-inp-wrap"><span>£</span><input class="cost-inp" type="number" step="0.01" id="post_t24" value="${POSTAGE.t24||''}" placeholder="0.00" oninput="savePostage()"></div>
          <div class="postage-count">Occasional orders</div>
        </div>
      </div>
      <div class="profit-summary" id="profitSummary"></div>
    </div>

    <div class="card">
      <div class="card-title">Cost Price per SKU <span class="card-badge">Enter your buying cost per unit</span></div>
      <input class="search-bar" type="text" id="costSearch" placeholder="Search SKU…" oninput="filterCostSkus()">
      <div class="sku-cost-grid" id="costSkuGrid"></div>
    </div>
  `;
  renderCostSkus(REPORT.allSkus);
  updateProfitSummary();
}

function savePostage() {
  POSTAGE.ll  = parseFloat(document.getElementById('post_ll')?.value)  || 0;
  POSTAGE.t48 = parseFloat(document.getElementById('post_t48')?.value) || 0;
  POSTAGE.t24 = parseFloat(document.getElementById('post_t24')?.value) || 0;
  saveCostsToStorage();
  updateProfitSummary();
}

function renderCostSkus(skus) {
  const grid = document.getElementById('costSkuGrid');
  if (!grid) return;
  grid.innerHTML = skus.map(s => {
    const val = COSTS[s.sku] !== undefined ? COSTS[s.sku] : '';
    const hasCls = val !== '' ? ' has-val' : '';
    return `<div class="sku-cost-row">
      <div class="sku-cost-name" title="${s.sku}">${s.sku}</div>
      <div style="display:flex;align-items:center;gap:3px">
        <span style="color:var(--mu);font-size:10px">£</span>
        <input class="sku-mini-inp${hasCls}" type="number" step="0.01" min="0"
          data-sku="${s.sku}" value="${val}" placeholder="0.00"
          oninput="updateCost(this)">
      </div>
    </div>`;
  }).join('');
}

function filterCostSkus() {
  const q = (document.getElementById('costSearch')?.value || '').toLowerCase();
  renderCostSkus(REPORT.allSkus.filter(s => s.sku.toLowerCase().includes(q)));
}

function updateCost(inp) {
  const sku = inp.dataset.sku;
  const v = parseFloat(inp.value);
  if (!isNaN(v) && v >= 0) { COSTS[sku] = v; inp.classList.add('has-val'); }
  else { delete COSTS[sku]; inp.classList.remove('has-val'); }
  saveCostsToStorage();
  updateProfitSummary();
}

function updateProfitSummary() {
  const el = document.getElementById('profitSummary');
  if (!el) return;
  const withCost = REPORT.allSkus.filter(s => COSTS[s.sku] > 0);
  if (withCost.length === 0) { el.innerHTML = ''; return; }

  let tGross=0, tNet=0, tCOGS=0, tPost=0;
  withCost.forEach(s => {
    const c = COSTS[s.sku] || 0;
    const pt = inferPostageType(s.sku, s.units, s.orders);
    const pc = pt === 'll' ? POSTAGE.ll : POSTAGE.t48;
    tGross += s.gross; tNet += s.net;
    tCOGS += c * s.units;
    tPost += pc * s.orders;
  });
  const profit = tNet - tCOGS - tPost;
  const margin = tGross > 0 ? (profit/tGross*100) : 0;
  const cls = profit >= 0 ? 'td-gr' : 'td-rd';

  el.innerHTML = `<div class="sum-box" style="margin-top:14px">
    <div style="font-size:11px;color:var(--mu);margin-bottom:10px">${withCost.length} of ${REPORT.allSkus.length} SKUs have cost entered</div>
    <div class="sum-row"><span class="sum-label">Gross Sales (costed SKUs)</span><span class="td-mono td-gr">+${f2(tGross)}</span></div>
    <div class="sum-row"><span class="sum-label">eBay Fees</span><span class="td-mono td-rd">-${f2(tGross-tNet)}</span></div>
    <div class="sum-row"><span class="sum-label">Net Revenue</span><span class="td-mono td-ac">${f2(tNet)}</span></div>
    <div class="sum-row"><span class="sum-label">Cost of Goods</span><span class="td-mono td-rd">-${f2(tCOGS)}</span></div>
    <div class="sum-row"><span class="sum-label">Postage Costs</span><span class="td-mono td-rd">-${f2(tPost)}</span></div>
    <div class="sum-row"><span class="sum-total-label">Estimated Net Profit</span><span class="td-mono ${cls}" style="font-size:17px">${profit>=0?'+':''}${f2(profit)}</span></div>
    <div style="text-align:center;font-size:11px;color:var(--mu);margin-top:6px">Profit margin: <strong class="${cls}">${pct(margin)}</strong> of gross</div>
  </div>`;
}

// ---- EXPENSES TAB ----
function renderExpensesTab(el) {
  const m = REPORT.metrics;
  const feeRateTotal = m.grossSales > 0 ? (m.totalFees + m.otherFeeTotal) / m.grossSales * 100 : 0;

  const sortedByFees = [...REPORT.allSkus].sort((a,b) => Math.abs(b.fees) - Math.abs(a.fees));

  el.innerHTML = `
    <div class="metric-grid" style="grid-template-columns:repeat(3,1fr)">
      ${metricCard('FVF Fixed', f0(m.totalFvfFixed), '£' + (m.totalFvfFixed/m.uniqueOrders).toFixed(2) + ' per order', 'c-rd')}
      ${metricCard('FVF Variable', f0(m.totalFvfVar), pct(m.totalFvfVar/m.grossSales*100) + ' of subtotal', 'c-rd')}
      ${metricCard('Regulatory Fee', f0(m.totalRegFee), pct(m.totalRegFee/m.grossSales*100) + ' of gross', 'c-rd')}
      ${metricCard('Promoted Listings', f0(m.promotedFees), pct(m.promotedFees/m.grossSales*100) + ' of gross', 'c-am')}
      ${metricCard('Other Fees', f0(m.otherFeeTotal - m.promotedFees), 'Misc eBay charges', 'c-am')}
      ${metricCard('Refunds + Claims', f0(m.refundTotal + m.claimTotal), f2(m.refundTotal) + ' refunds · ' + f2(m.claimTotal) + ' claims', 'c-rd')}
    </div>

    <div class="g2">
      <div class="card">
        <div class="card-title">Financial Reconciliation</div>
        <div class="sum-box">
          <div class="sum-row"><span class="sum-label">Gross Orders</span><span class="td-mono td-gr">+${f2(m.grossSales)}</span></div>
          <div class="sum-row"><span class="sum-label">Gross Refunds</span><span class="td-mono td-rd">-${f2(m.refundTotal)}</span></div>
          <div class="sum-row"><span class="sum-label">Gross Claims</span><span class="td-mono td-rd">-${f2(m.claimTotal)}</span></div>
          <div class="sum-row"><span class="sum-label">Transaction Fees (FVF)</span><span class="td-mono td-rd">-${f2(m.totalFvfFixed+m.totalFvfVar+m.totalRegFee)}</span></div>
          <div class="sum-row"><span class="sum-label">Promoted Listing Fees</span><span class="td-mono td-rd">-${f2(m.promotedFees)}</span></div>
          <div class="sum-row"><span class="sum-label">Other Fees</span><span class="td-mono td-rd">-${f2(m.otherFeeTotal-m.promotedFees)}</span></div>
          <div class="sum-row"><span class="sum-label">Adjustments</span><span class="td-mono td-rd">-${f2(m.adjTotal)}</span></div>
          <div class="sum-row"><span class="sum-total-label">Total Payout to Bank</span><span class="td-mono" style="font-size:16px">${f2(m.payout)}</span></div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">Fee Rate Analysis</div>
        <div style="margin-bottom:14px">
          <div style="display:flex;justify-content:space-between;margin-bottom:3px"><span style="font-size:11px;color:var(--mu)">FVF Fixed rate per order</span><span class="td-mono td-rd" style="font-size:11px">${f2(m.totalFvfFixed/m.uniqueOrders)}</span></div>
          <div style="font-size:10px;color:var(--mu);margin-bottom:10px">${f0(m.totalFvfFixed)} ÷ ${num(m.uniqueOrders)} orders</div>
          <div style="display:flex;justify-content:space-between;margin-bottom:3px"><span style="font-size:11px;color:var(--mu)">FVF Variable % of sales</span><span class="td-mono td-rd" style="font-size:11px">${pct(m.totalFvfVar/m.grossSales*100)}</span></div>
          <div style="font-size:10px;color:var(--mu);margin-bottom:10px">${f0(m.totalFvfVar)} ÷ ${f0(m.grossSales)} gross</div>
          <div style="display:flex;justify-content:space-between;margin-bottom:3px"><span style="font-size:11px;color:var(--mu)">Promoted Listings rate</span><span class="td-mono" style="font-size:11px;color:var(--ac2)">${pct(m.promotedFees/m.grossSales*100)}</span></div>
          <div style="font-size:10px;color:var(--mu);margin-bottom:12px">${f0(m.promotedFees)} ÷ ${f0(m.grossSales)} gross</div>
        </div>
        <div style="background:rgba(247,85,85,.06);border:1px solid rgba(247,85,85,.2);border-radius:8px;padding:14px;text-align:center">
          <div style="font-size:10px;color:var(--mu);margin-bottom:4px">Total eBay Take Rate</div>
          <div style="font-family:var(--mono);font-size:34px;font-weight:600;color:var(--rd)">${pct(feeRateTotal)}</div>
          <div style="font-size:10px;color:var(--mu);margin-top:3px">${f0(m.totalFees+m.otherFeeTotal)} fees on ${f0(m.grossSales)} gross</div>
          <div style="background:var(--sf2);border-radius:3px;height:7px;margin-top:10px;overflow:hidden">
            <div style="width:${Math.min(feeRateTotal,100).toFixed(1)}%;height:100%;background:var(--rd);border-radius:3px"></div>
          </div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:14px">
      <div class="card-title">All SKUs — Fees Detail <span class="card-badge">Sorted by fees paid</span></div>
      <div class="table-wrap scroll-body" style="max-height:380px">
        <table>
          <thead><tr><th>#</th><th>SKU</th><th>Orders</th><th>Units</th><th>Gross</th><th>eBay Fees</th><th>Fee %</th><th>Net Revenue</th></tr></thead>
          <tbody>${sortedByFees.map((s,i) => `<tr>
            <td class="td-rank">${i+1}</td>
            <td class="td-sku" title="${s.sku}">${s.sku}</td>
            <td class="td-mu">${s.orders}</td>
            <td class="td-mu">${s.units}</td>
            <td class="td-mono td-ac">${f2(s.gross)}</td>
            <td class="td-mono td-rd">-${f2(Math.abs(s.fees))}</td>
            <td class="td-mono ${s.fee_pct>25?'td-rd':s.fee_pct>20?'td-am':'td-mu'}">${pct(s.fee_pct)}</td>
            <td class="td-mono td-gr">${f2(s.net)}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
    </div>
  `;
}

// ---- PDF Print ----
function printReport() {
  // Render all tabs invisibly first
  const main = document.getElementById('dashMain');
  const ids = ['overview','skus','costs','expenses'];
  ids.forEach(id => {
    let p = document.getElementById('panel-'+id);
    if (!p) {
      p = document.createElement('div');
      p.className = 'tab-panel'; p.id = 'panel-'+id;
      main.appendChild(p);
      renderTab(id, p);
    }
    p.style.display = 'block';
  });
  // Short delay to let charts render
  setTimeout(() => {
    window.print();
    // Restore: hide all except current
    setTimeout(() => {
      ids.forEach(id => {
        const p = document.getElementById('panel-'+id);
        if (p) p.style.display = id === currentTab ? 'block' : 'none';
      });
    }, 500);
  }, 300);
}

// ---- Init ----
window.addEventListener('load', loadSavedCosts);
window.addEventListener('resize', () => {
  if (currentTab === 'overview') drawDailyChart();
});
