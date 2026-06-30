// ============================================================
// dashboard.js — eBay Monthly Report
// 7 tabs: Overview, Profit & ROI, SKU Performance, SKU Health,
// Postage, eBay Expenses, Costs Setup
// ============================================================

let txFile = null, ordFile = null, REPORT = null, currentTab = 'overview';
let COSTS = {}, POSTAGE = { ll: 0, t48: 0, t24: 0 };

// ---- Thresholds for SKU health ----
const GOOD_FEE_MAX = 18, GOOD_REV_MIN = 20;
const BAD_FEE_MIN  = 25, BAD_REV_MIN  = 5;

function loadSaved() {
  try { const c = localStorage.getItem('emr_costs'); if (c) COSTS = JSON.parse(c); } catch(e){}
  try { const p = localStorage.getItem('emr_postage'); if (p) POSTAGE = {...POSTAGE,...JSON.parse(p)}; } catch(e){}
}
function saveToStorage() {
  try { localStorage.setItem('emr_costs', JSON.stringify(COSTS)); localStorage.setItem('emr_postage', JSON.stringify(POSTAGE)); } catch(e){}
}

// ---- File selection ----
function fileSelected(type, input) {
  const file = input.files[0]; if (!file) return;
  if (type === 'tx') { txFile = file; document.getElementById('txCard').classList.add('done'); document.getElementById('txStatus').textContent = '✓ ' + file.name; }
  else { ordFile = file; document.getElementById('ordCard').classList.add('done'); document.getElementById('ordStatus').textContent = '✓ ' + file.name; }
  const btn = document.getElementById('processBtn'), txt = document.getElementById('processBtnText');
  if (txFile && ordFile) { btn.disabled = false; txt.textContent = 'Generate Dashboard →'; }
  else { btn.disabled = true; txt.textContent = txFile ? 'Now upload Orders Report' : 'Now upload Transaction Report'; }
}

function processFiles() {
  const ov = document.createElement('div'); ov.className = 'loading-overlay';
  ov.innerHTML = '<div class="loading-spinner"></div><div class="loading-text">Reading your reports…</div>';
  document.body.appendChild(ov);
  loadSaved();
  const read = f => new Promise((res,rej) => { const r = new FileReader(); r.onload = e => res(e.target.result); r.onerror = rej; r.readAsText(f); });
  Promise.all([read(txFile), read(ordFile)]).then(([tx, ord]) => {
    try {
      REPORT = crunchData(tx, ord);
      document.body.removeChild(ov);
      showDashboard();
    } catch(err) {
      document.body.removeChild(ov);
      alert('Parse error: ' + err.message + '\n\nOpen browser console (F12) for details.');
      console.error(err);
    }
  }).catch(err => { document.body.removeChild(ov); alert('File read error: ' + err.message); });
}

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
  ['txCard','ordCard'].forEach(id => document.getElementById(id).classList.remove('done'));
  document.getElementById('txStatus').textContent = 'Click to upload CSV';
  document.getElementById('ordStatus').textContent = 'Click to upload CSV';
  document.getElementById('txInput').value = ''; document.getElementById('ordInput').value = '';
  document.getElementById('processBtn').disabled = true;
  document.getElementById('processBtnText').textContent = 'Upload both files to continue';
  document.getElementById('dashMain').innerHTML = '';
}

// ---- Tabs ----
const TAB_IDS = ['overview','profit','skus','health','postage','expenses','costs'];

function showTab(id) {
  currentTab = id;
  document.querySelectorAll('.tab').forEach((t,i) => t.classList.toggle('active', TAB_IDS[i] === id));
  document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');
  let panel = document.getElementById('panel-' + id);
  if (!panel) {
    panel = document.createElement('div');
    panel.className = 'tab-panel'; panel.id = 'panel-' + id;
    document.getElementById('dashMain').appendChild(panel);
    renderTab(id, panel);
  } else {
    if (id === 'costs' || id === 'profit' || id === 'health' || id === 'postage') renderTab(id, panel);
    if (id === 'skus') renderSkuTable();
  }
  panel.style.display = 'block';
}

function renderTab(id, el) {
  const fn = {overview:renderOverview, profit:renderProfit, skus:renderSkus,
               health:renderHealth, postage:renderPostage, expenses:renderExpenses, costs:renderCosts};
  if (fn[id]) fn[id](el);
}

// ---- Helpers ----
const f2  = n => '£' + Math.abs(n).toFixed(2);
const f0  = n => '£' + Math.round(Math.abs(n)).toLocaleString();
const pct = n => (isFinite(n) ? n.toFixed(1) : '0.0') + '%';
const num = n => Number(n).toLocaleString();

function mc(label, value, sub, col) {
  return `<div class="metric-card ${col}"><div class="mc-label">${label}</div><div class="mc-value ${col}">${value}</div><div class="mc-sub">${sub}</div></div>`;
}

function getProfit() {
  if (!REPORT) return null;
  const m = REPORT.metrics;
  let tGross=0, tCOGS=0, tPost=0, skusCosted=0;
  REPORT.allSkus.forEach(s => {
    const c = parseFloat(COSTS[s.sku] || 0);
    if (c > 0) {
      const pt = inferPostageType(s.sku, s.units, s.orders);
      const pc = pt === 'll' ? POSTAGE.ll : POSTAGE.t48;
      tGross += s.gross;
      // Bug fix 2: postage cost × orders (not units) — one label per order
      tCOGS += c * s.units;
      tPost += pc * s.orders;
      skusCosted++;
    }
  });
  // Bug fix 1: totalEbayFees must include ALL fees (FVF + Promoted + Other)
  // proportional to the costed SKUs' share of gross
  const grossFraction = m.grossSales > 0 ? tGross / m.grossSales : 0;
  const totalAllFees = m.totalFees + m.otherFeeTotal; // FVF + Promoted + Other
  const tEbayFees = totalAllFees * grossFraction;
  const tNet = tGross - tEbayFees;  // true net after ALL ebay fees
  const profit = tNet - tCOGS - tPost;
  const roi    = tCOGS > 0 ? (profit / tCOGS * 100) : null;
  const margin = tGross > 0 ? (profit / tGross * 100) : null;
  return { tGross, tNet, tCOGS, tPost, profit, roi, margin, skusCosted, totalEbayFees: tEbayFees };
}

function inferPostageType(sku, units, orders) {
  const avgQty = orders > 0 ? units / orders : 1;
  return (isCableSku(sku) && avgQty <= 1.2) ? 'll' : 't48';
}

function getSkuPostageCost(s) {
  const pt = inferPostageType(s.sku, s.units, s.orders);
  return pt === 'll' ? POSTAGE.ll : POSTAGE.t48;
}

function getSkuProfit(s) {
  const cost = parseFloat(COSTS[s.sku] || 0);
  if (!cost) return null;
  const m = REPORT.metrics;
  const totalFeeRate = m.grossSales > 0 ? (m.totalFees + m.otherFeeTotal) / m.grossSales : 0;
  const skuNet = s.gross - (s.gross * totalFeeRate);
  const pc = getSkuPostageCost(s);
  return skuNet - (cost * s.units) - (pc * s.orders);
}

// ---- OVERVIEW ----
function renderOverview(el) {
  const m = REPORT.metrics;
  const p = getProfit();
  const hasCosts = p && p.skusCosted > 0;
  el.innerHTML = `
    <div class="print-title"><h2>eBay Monthly Report</h2><p>${REPORT.period}</p></div>
    <div class="metric-grid">
      ${mc('Gross Sales',    f0(m.grossSales),    REPORT.period, 'c-bl')}
      ${mc('Net Revenue',    f0(m.netRevenue),    'After all eBay fees', 'c-gr')}
      ${mc('Total Orders',   num(m.uniqueOrders), num(m.totalOrderLines)+' order lines', 'c-bl')}
      ${mc('Units Shipped',  num(m.totalUnits),   'Avg '+(m.totalUnits/m.uniqueOrders).toFixed(1)+' per order', 'c-bl')}
      ${mc('eBay Fees',      f0(m.totalFees+m.otherFeeTotal), pct(m.feeRate)+' take rate', 'c-rd')}
      ${mc('Refunds & Claims',f0(m.refundTotal+m.claimTotal), f2(m.refundTotal)+' · '+f2(m.claimTotal)+' claims','c-am')}
      ${mc('Avg Order Value', f2(m.avgOrderValue), 'Across '+num(m.uniqueOrders)+' orders', 'c-pu')}
      ${mc('Active SKUs',    num(m.uniqueSkus),   'Unique custom labels', 'c-bl')}
    </div>
    ${hasCosts ? `<div class="metric-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:18px">
      ${mc('Est. Net Profit', (p.profit>=0?'+':'')+f0(p.profit), p.skusCosted+' of '+m.uniqueSkus+' SKUs costed', p.profit>=0?'c-gr':'c-rd')}
      ${mc('ROI', p.roi!==null?pct(p.roi):'—', 'Return on cost of goods', p.roi>=0?'c-gr':'c-rd')}
      ${mc('Profit Margin', p.margin!==null?pct(p.margin):'—', 'Net profit ÷ gross sales', p.margin>=20?'c-gr':'c-am')}
    </div>` : `<div style="background:rgba(79,142,247,.07);border:1px solid rgba(79,142,247,.2);border-radius:var(--r);padding:12px 16px;margin-bottom:18px;font-size:12px;color:var(--mu)">
      💡 Enter your cost prices in <strong style="color:var(--ac);cursor:pointer" onclick="showTab('costs')">Costs Setup</strong> to see profit, ROI and margin here.
    </div>`}
    <div class="g-32">
      <div class="card"><div class="card-title">Daily Sales <span class="card-badge">Gross Revenue</span></div>
        <canvas id="dailyChart" height="155" style="width:100%;display:block"></canvas></div>
      <div class="card"><div class="card-title">Fee Breakdown</div>
        <div class="donut-wrap"><svg id="donutSvg" width="110" height="110" viewBox="0 0 110 110" style="flex-shrink:0"></svg>
          <div class="donut-legend" id="donutLegend"></div></div></div>
    </div>
    <div class="g2">
      <div class="card"><div class="card-title">Top 10 SKUs by Revenue</div><div id="topBars"></div></div>
      <div class="card">
        <div class="card-title">Fulfilment Summary</div>
        <div class="stat-pair">
          <div class="stat-box am"><div class="stat-box-label">📮 RM Large Letter</div>
            <div class="stat-box-val" style="color:var(--am)">${num(REPORT.postage.ll)}</div>
            <div class="stat-box-sub">Single cable orders</div></div>
          <div class="stat-box ac"><div class="stat-box-label">📦 RM Tracked 48</div>
            <div class="stat-box-val" style="color:var(--ac)">${num(REPORT.postage.t48)}</div>
            <div class="stat-box-sub">Qty 2+ / accessories</div></div>
        </div>
        <div style="background:rgba(124,92,252,.1);border:1px solid rgba(124,92,252,.25);border-radius:8px;padding:10px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center">
          <div><div style="font-size:11px;color:var(--mu)">Promoted Listings</div>
            <div style="font-size:10px;color:var(--mu);margin-top:1px">${pct(m.promotedFees/m.grossSales*100)} of gross sales</div></div>
          <div style="font-family:var(--mono);font-weight:600;color:var(--rd)">-${f0(m.promotedFees)}</div>
        </div>
        <div class="card-title" style="margin-bottom:10px">Payout Reconciliation</div>
        <div class="sum-box">
          <div class="sum-row"><span class="sum-label">Gross Orders</span><span class="td-mono td-gr">+${f2(m.grossSales)}</span></div>
          <div class="sum-row"><span class="sum-label">Refunds & Claims</span><span class="td-mono td-rd">-${f2(m.refundTotal+m.claimTotal)}</span></div>
          <div class="sum-row"><span class="sum-label">All eBay Fees</span><span class="td-mono td-rd">-${f2(m.totalFees+m.otherFeeTotal)}</span></div>
          <div class="sum-row"><span class="sum-label">Adjustments</span><span class="td-mono td-rd">-${f2(m.adjTotal)}</span></div>
          <div class="sum-row"><span class="sum-total-label">Total Paid Out</span><span class="td-mono" style="font-size:16px">${f2(m.payout)}</span></div>
        </div>
      </div>
    </div>`;
  requestAnimationFrame(() => { drawDailyChart(); drawDonut(); drawTopBars(); });
}

// ---- PROFIT & ROI ----
function renderProfit(el) {
  const m = REPORT.metrics;
  const p = getProfit();
  if (!p || p.skusCosted === 0) {
    el.innerHTML = `<div class="card" style="text-align:center;padding:40px">
      <div style="font-size:32px;margin-bottom:12px">💰</div>
      <div style="font-size:16px;font-weight:600;margin-bottom:8px">No cost data yet</div>
      <div style="font-size:13px;color:var(--mu);margin-bottom:20px">Enter your buying cost per SKU and postage rates to see full profit breakdown.</div>
      <button class="btn btn-pdf" onclick="showTab('costs')" style="margin:0 auto">Go to Costs Setup →</button>
    </div>`; return;
  }

  const totalPost = REPORT.postage.ll * POSTAGE.ll + REPORT.postage.t48 * POSTAGE.t48;
  const profitCls = p.profit >= 0 ? 'pos' : 'neg';

  el.innerHTML = `
    <div class="print-title"><h2>Profit & ROI — ${REPORT.period}</h2></div>
    <div class="profit-box">
      <div style="font-size:12px;color:var(--mu)">Estimated Net Profit (${p.skusCosted} of ${m.uniqueSkus} SKUs costed)</div>
      <div class="profit-big ${profitCls}">${p.profit>=0?'+':''}${f0(p.profit)}</div>
      <div style="font-size:12px;color:var(--mu)">Based on entered costs — fill in remaining SKUs for full accuracy</div>
    </div>

    <div class="roi-grid">
      <div class="roi-card">
        <div class="roi-label">ROI</div>
        <div class="roi-val" style="color:${p.roi>=0?'var(--gr)':'var(--rd)'}">${p.roi!==null?pct(p.roi):'—'}</div>
        <div style="font-size:10px;color:var(--mu);margin-top:4px">Profit ÷ Cost of Goods</div>
      </div>
      <div class="roi-card">
        <div class="roi-label">Profit Margin</div>
        <div class="roi-val" style="color:${p.margin>=20?'var(--gr)':p.margin>=10?'var(--am)':'var(--rd)'}">${p.margin!==null?pct(p.margin):'—'}</div>
        <div style="font-size:10px;color:var(--mu);margin-top:4px">Net Profit ÷ Gross Sales</div>
      </div>
      <div class="roi-card">
        <div class="roi-label">eBay Take Rate</div>
        <div class="roi-val" style="color:var(--rd)">${pct(m.feeRate)}</div>
        <div style="font-size:10px;color:var(--mu);margin-top:4px">All fees ÷ Gross Sales</div>
      </div>
    </div>

    <div class="g2">
      <div class="card">
        <div class="card-title">Full Profit Breakdown</div>
        <div class="sum-box">
          <div class="sum-row"><span class="sum-label">Gross Sales</span><span class="td-mono td-gr">+${f2(p.tGross)}</span></div>
          <div class="sum-row"><span class="sum-label">eBay Fees (FVF + Promoted + Other)</span><span class="td-mono td-rd">-${f2(p.totalEbayFees)}</span></div>
          <div class="sum-row"><span class="sum-label">Net Revenue (after eBay)</span><span class="td-mono td-ac">${f2(p.tNet)}</span></div>
          <div class="sum-row"><span class="sum-label">Cost of Goods (COGS)</span><span class="td-mono td-rd">-${f2(p.tCOGS)}</span></div>
          <div class="sum-row"><span class="sum-label">Postage Costs (LL + RM48)</span><span class="td-mono td-rd">-${f2(p.tPost)}</span></div>
          <div class="sum-row"><span class="sum-total-label">Net Profit</span><span class="td-mono ${profitCls==='pos'?'td-gr':'td-rd'}" style="font-size:17px">${p.profit>=0?'+':''}${f2(p.profit)}</span></div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">Where Every £1 of Sales Goes</div>
        ${[
          {l:'eBay Fees',     v:p.totalEbayFees,  t:p.tGross, c:'var(--rd)'},
          {l:'Cost of Goods', v:p.tCOGS,           t:p.tGross, c:'var(--am)'},
          {l:'Postage Costs', v:p.tPost,           t:p.tGross, c:'var(--ac2)'},
          {l:'Net Profit',    v:p.profit,          t:p.tGross, c:'var(--gr)'},
        ].map(item => {
          const r = p.tGross > 0 ? Math.abs(item.v)/p.tGross*100 : 0;
          return `<div class="bar-item">
            <div class="bar-head"><span class="bar-label">${item.l}</span>
              <span class="bar-val" style="color:${item.c}">${pct(r)}</span></div>
            <div class="bar-track"><div class="bar-fill" style="width:${Math.min(r,100).toFixed(1)}%;background:${item.c}"></div></div>
          </div>`;
        }).join('')}
        <div style="margin-top:16px;background:var(--sf2);border-radius:8px;padding:12px;font-size:11px;color:var(--mu)">
          <strong style="color:var(--tx)">£1 of sales breaks down as:</strong><br>
          ${p.tGross>0?`${pct(p.totalEbayFees/p.tGross*100)} eBay fees · ${pct(p.tCOGS/p.tGross*100)} cost of goods · ${pct(p.tPost/p.tGross*100)} postage · <strong style="color:${p.profit>=0?'var(--gr)':'var(--rd)'}">${pct(p.margin)} profit</strong>`:'—'}
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Top SKUs by Profit <span class="card-badge">Only SKUs with cost entered</span></div>
      <div class="table-wrap scroll-body">
        <table>
          <thead><tr><th>#</th><th>SKU</th><th>Orders</th><th>Gross</th><th>eBay Fees</th><th>Net Rev</th><th>COGS</th><th>Postage</th><th>Net Profit</th><th>Margin</th><th>ROI</th></tr></thead>
          <tbody>${REPORT.allSkus.filter(s=>parseFloat(COSTS[s.sku]||0)>0)
            .map(s => {
              const c=parseFloat(COSTS[s.sku]),pc=getSkuPostageCost(s);
              const _feeRate=REPORT.metrics.grossSales>0?(REPORT.metrics.totalFees+REPORT.metrics.otherFeeTotal)/REPORT.metrics.grossSales:0;
              const _skuNet=s.gross-(s.gross*_feeRate);
              const cogs=c*s.units,post=pc*s.orders,profit=_skuNet-cogs-post;
              const margin=s.gross>0?profit/s.gross*100:0,roi=cogs>0?profit/cogs*100:null;
              const cls=profit>=0?'td-gr':'td-rd';
              return `<tr><td class="td-rank"></td><td class="td-sku" title="${s.sku}">${s.sku}</td>
                <td class="td-mu">${s.orders}</td><td class="td-mono td-ac">${f2(s.gross)}</td>
                <td class="td-mono td-rd">-${f2(Math.abs(s.fees))}</td><td class="td-mono td-gr">${f2(s.net)}</td>
                <td class="td-mono td-mu">-${f2(cogs)}</td><td class="td-mono td-mu">-${f2(post)}</td>
                <td class="td-mono ${cls}">${profit>=0?'+':''}${f2(profit)}</td>
                <td class="td-mono ${cls}">${pct(margin)}</td>
                <td class="td-mono ${cls}">${roi!==null?pct(roi):'—'}</td></tr>`;
            }).sort((a,b)=>0).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

// ---- SKU PERFORMANCE ----
function renderSkus(el) {
  el.innerHTML = `
    <div class="controls-row">
      <input class="search-bar" style="margin:0;flex:1" type="text" id="skuSearch" placeholder="Search SKU…" oninput="renderSkuTable()">
      <select class="sel" id="skuSortSel" onchange="renderSkuTable()">
        <option value="gross">Revenue ↓</option><option value="orders">Orders ↓</option>
        <option value="units">Units ↓</option><option value="net">Net Revenue ↓</option>
        <option value="fee_pct">Fee % ↓</option>
      </select>
    </div>
    <div class="card">
      <div class="card-title">All SKUs — ${REPORT.period} <span class="card-badge" id="skuCountBadge">${REPORT.allSkus.length} SKUs</span></div>
      <div class="table-wrap scroll-body">
        <table>
          <thead><tr><th>#</th><th>SKU</th><th>Orders</th><th>Units</th><th>Gross</th><th>eBay Fees</th><th>Net Rev</th><th>Fee %</th><th>Avg Order</th><th>Postage</th><th>Cost/Unit</th><th>Est. Profit</th></tr></thead>
          <tbody id="skuTableBody"></tbody>
        </table>
      </div>
    </div>`;
  renderSkuTable();
}

function renderSkuTable() {
  const body = document.getElementById('skuTableBody'); if (!body) return;
  const q = (document.getElementById('skuSearch')?.value||'').toLowerCase();
  const sk = document.getElementById('skuSortSel')?.value||'gross';
  let skus = REPORT.allSkus.filter(s => s.sku.toLowerCase().includes(q));
  skus = [...skus].sort((a,b)=>b[sk]-a[sk]);
  document.getElementById('skuCountBadge').textContent = skus.length + ' SKUs';
  body.innerHTML = skus.map((s,i) => {
    const cost = parseFloat(COSTS[s.sku]||0);
    const pt = inferPostageType(s.sku,s.units,s.orders);
    const pBadge = pt==='ll'?'<span class="badge badge-ll">📮 Large Letter</span>':'<span class="badge badge-t48">📦 RM48</span>';
    let profHtml = '<span class="badge badge-na">Enter cost</span>';
    if (cost>0) { const pr=getSkuProfit(s); const cls=pr>=0?'badge-pos':'badge-neg'; profHtml=`<span class="badge ${cls}">${pr>=0?'+':''}${f2(pr)}</span>`; }
    const fc = s.fee_pct>25?'td-rd':s.fee_pct>20?'td-am':'td-mu';
    return `<tr><td class="td-rank">${i+1}</td><td class="td-sku" title="${s.sku}">${s.sku}</td>
      <td class="td-mono td-ac">${s.orders}</td><td class="td-mu">${s.units}</td>
      <td class="td-mono td-ac">${f2(s.gross)}</td><td class="td-mono td-rd">-${f2(Math.abs(s.fees))}</td>
      <td class="td-mono td-gr">${f2(s.net)}</td><td class="td-mono ${fc}">${pct(s.fee_pct)}</td>
      <td class="td-mu">${f2(s.avg_val)}</td><td>${pBadge}</td>
      <td>${cost>0?'<span class="td-mono td-mu">'+f2(cost)+'</span>':'<span class="td-mu">—</span>'}</td>
      <td>${profHtml}</td></tr>`;
  }).join('');
}

// ---- SKU HEALTH ----
function renderHealth(el) {
  const good = REPORT.allSkus.filter(s => s.fee_pct < GOOD_FEE_MAX && s.gross > GOOD_REV_MIN);
  const bad  = REPORT.allSkus.filter(s => s.fee_pct > BAD_FEE_MIN  && s.gross > BAD_REV_MIN);
  const warn = REPORT.allSkus.filter(s => s.fee_pct >= GOOD_FEE_MAX && s.fee_pct <= BAD_FEE_MIN && s.gross > GOOD_REV_MIN);

  el.innerHTML = `
    <div class="metric-grid" style="grid-template-columns:repeat(3,1fr)">
      ${mc('✅ Good SKUs', good.length, 'Fee rate under '+GOOD_FEE_MAX+'% · revenue over £'+GOOD_REV_MIN, 'c-gr')}
      ${mc('⚠️ Watch SKUs', warn.length, 'Fee rate '+GOOD_FEE_MAX+'–'+BAD_FEE_MIN+'%', 'c-am')}
      ${mc('🚨 Bad SKUs', bad.length, 'Fee rate over '+BAD_FEE_MIN+'% · revenue over £'+BAD_REV_MIN, 'c-rd')}
    </div>

    <div class="sku-health-grid">
      <div class="health-card good">
        <div class="health-title">✅ Good SKUs <span class="badge badge-good">${good.length}</span></div>
        <div style="font-size:11px;color:var(--mu);margin-bottom:10px">Fee rate &lt;${GOOD_FEE_MAX}% with revenue &gt;£${GOOD_REV_MIN} — these are your best performers</div>
        ${good.sort((a,b)=>b.gross-a.gross).map(s => `
          <div class="health-sku-row">
            <div class="health-sku-name" title="${s.sku}">${s.sku}</div>
            <div style="display:flex;gap:8px;align-items:center">
              <span class="health-sku-val td-ac">${f0(s.gross)}</span>
              <span class="badge badge-good">${pct(s.fee_pct)}</span>
            </div>
          </div>`).join('')}
      </div>
      <div class="health-card bad">
        <div class="health-title">🚨 Bad SKUs <span class="badge badge-bad">${bad.length}</span></div>
        <div style="font-size:11px;color:var(--mu);margin-bottom:10px">Fee rate &gt;${BAD_FEE_MIN}% with revenue &gt;£${BAD_REV_MIN} — review pricing, listing type, or consider dropping</div>
        ${bad.sort((a,b)=>b.fee_pct-a.fee_pct).map(s => `
          <div class="health-sku-row">
            <div class="health-sku-name" title="${s.sku}">${s.sku}</div>
            <div style="display:flex;gap:8px;align-items:center">
              <span class="health-sku-val td-ac">${f0(s.gross)}</span>
              <span class="badge badge-bad">${pct(s.fee_pct)}</span>
            </div>
          </div>`).join('')}
      </div>
    </div>

    <div class="card">
      <div class="card-title">⚠️ Watch SKUs <span class="badge badge-warn">${warn.length}</span>
        <span style="font-size:11px;color:var(--mu);margin-left:4px">Fee rate ${GOOD_FEE_MAX}–${BAD_FEE_MIN}% — monitor these</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>SKU</th><th>Orders</th><th>Gross</th><th>Fee %</th><th>Net Rev</th></tr></thead>
          <tbody>${warn.sort((a,b)=>b.gross-a.gross).map(s=>`<tr>
            <td class="td-sku" title="${s.sku}">${s.sku}</td>
            <td class="td-mu">${s.orders}</td><td class="td-mono td-ac">${f2(s.gross)}</td>
            <td class="td-mono td-am">${pct(s.fee_pct)}</td><td class="td-mono td-gr">${f2(s.net)}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
    </div>

    <div class="card" style="margin-top:14px">
      <div class="card-title">💡 Suggestions & Improvements</div>
      ${buildSuggestions(good, bad, warn).map(s=>`
        <div class="suggestion-card">
          <div class="sug-header">
            <div class="sug-icon">${s.icon}</div>
            <div>
              <div class="sug-title">${s.title}<span class="sug-tag ${s.priority}">${s.priority.toUpperCase()}</span></div>
              <div class="sug-body">${s.body}</div>
            </div>
          </div>
        </div>`).join('')}
    </div>`;
}

function buildSuggestions(good, bad, warn) {
  const m = REPORT.metrics;
  const suggestions = [];

  if (bad.length > 0) {
    const worst = bad[0];
    suggestions.push({icon:'🚨',priority:'high',title:'Review bad SKUs immediately',
      body:`You have ${bad.length} SKUs with eBay fee rates over ${BAD_FEE_MIN}%. The worst is <strong>${worst.sku}</strong> at ${pct(worst.fee_pct)}. Consider: raising prices, switching to fixed-price listing, removing from promoted listings, or consolidating into multi-packs.`});
  }

  if (m.promotedFees/m.grossSales > 0.18) {
    suggestions.push({icon:'📢',priority:'high',title:'Promoted listing spend is very high',
      body:`Promoted listings cost ${pct(m.promotedFees/m.grossSales*100)} of your gross sales (£${Math.round(m.promotedFees)}). Industry benchmark is 5–12%. Review your ad rates per listing — lower them on good organic-ranking SKUs and keep promoted only on new or lower-visibility listings.`});
  }

  if (m.feeRate > 30) {
    suggestions.push({icon:'💸',priority:'high',title:'Overall eBay take rate over 30%',
      body:`eBay is taking ${pct(m.feeRate)} of your gross revenue. This is high. The main lever is reducing promoted listing rates. Also check if any SKUs qualify for lower fee categories.`});
  }

  const refundRate = (m.refundTotal+m.claimTotal)/m.grossSales;
  if (refundRate > 0.02) {
    suggestions.push({icon:'↩️',priority:'med',title:'Refund & claims rate above 2%',
      body:`Refunds and claims total ${pct(refundRate*100)} of gross (£${Math.round(m.refundTotal+m.claimTotal)}). Review your listing photos and descriptions — most refunds are "item not as described". Add clearer compatibility notes especially for cables and screen protectors.`});
  }

  if (good.length > 0) {
    const topGood = good.sort((a,b)=>b.gross-a.gross).slice(0,3).map(s=>s.sku).join(', ');
    suggestions.push({icon:'📈',priority:'med',title:'Scale your best performing SKUs',
      body:`Your top good SKUs — <strong>${topGood}</strong> — have low fee rates and strong revenue. Consider increasing stock, running a lower promoted rate on these (they already sell well organically), or creating bundle variations to increase average order value.`});
  }

  if (m.avgOrderValue < 7) {
    suggestions.push({icon:'🛒',priority:'med',title:'Increase average order value',
      body:`Your average order value is ${f2(m.avgOrderValue)}. Bundling products (e.g. cable + screen protector packs) typically increases AOV by 30–50% and reduces your per-order postage cost. The Fixed Value Fee of £0.36 per order hurts more on low-value orders.`});
  }

  if (REPORT.postage.ll / (REPORT.postage.ll + REPORT.postage.t48) > 0.25) {
    suggestions.push({icon:'📮',priority:'low',title:'Large Letter volume is significant',
      body:`${num(REPORT.postage.ll)} orders (${pct(REPORT.postage.ll/(REPORT.postage.ll+REPORT.postage.t48)*100)}) go via Royal Mail Large Letter. If your LL cost is over £1.50, consider whether bundling these into 2-packs would move them to RM48 while increasing revenue per order.`});
  }

  suggestions.push({icon:'📊',priority:'low',title:'Track month-over-month trends',
    body:`Save this PDF each month and compare: gross sales, fee rate, promoted spend %, and number of bad SKUs. Even a 1% reduction in your eBay take rate on £11,000/month gross saves over £1,300/year.`});

  suggestions.push({icon:'🏷️',priority:'low',title:'Add cost prices to all SKUs',
    body:`You have ${m.uniqueSkus} active SKUs. Adding cost prices to all of them gives you accurate profit per SKU, making it easy to spot which products are actually worth selling. Start with your top 20 by revenue for maximum insight.`});

  return suggestions;
}

// ---- POSTAGE ----
function renderPostage(el) {
  const llCost  = parseFloat(POSTAGE.ll  || 0);
  const t48Cost = parseFloat(POSTAGE.t48 || 0);
  const llTotal  = REPORT.postage.ll  * llCost;
  const t48Total = REPORT.postage.t48 * t48Cost;
  const grandTotal = llTotal + t48Total;
  const hasCosts = llCost > 0 || t48Cost > 0;

  el.innerHTML = `
    <div class="print-title"><h2>Postage Report — ${REPORT.period}</h2></div>
    ${!hasCosts ? `<div style="background:rgba(247,185,85,.1);border:1px solid rgba(247,185,85,.3);border-radius:var(--r);padding:12px 16px;margin-bottom:18px;font-size:12px;color:var(--am)">
      ⚠️ Enter your postage costs in <strong style="cursor:pointer" onclick="showTab('costs')">Costs Setup</strong> to see total postage spend.
    </div>` : ''}

    <div class="metric-grid" style="grid-template-columns:repeat(4,1fr)">
      ${mc('LL Orders',    num(REPORT.postage.ll),  'Royal Mail Large Letter', 'c-am')}
      ${mc('RM48 Orders',  num(REPORT.postage.t48), 'Royal Mail Tracked 48', 'c-bl')}
      ${mc('LL Postage Cost', hasCosts&&llCost>0?f0(llTotal):'Enter cost', llCost>0?num(REPORT.postage.ll)+' × '+f2(llCost):'Set in Costs Setup', 'c-am')}
      ${mc('RM48 Postage Cost', hasCosts&&t48Cost>0?f0(t48Total):'Enter cost', t48Cost>0?num(REPORT.postage.t48)+' × '+f2(t48Cost):'Set in Costs Setup', 'c-bl')}
    </div>

    <div class="post-split">
      <div class="post-card ll">
        <div class="post-card-icon">📮</div>
        <div class="post-card-name">Royal Mail Large Letter</div>
        <div class="post-stat-row"><span class="post-stat-label">Total Orders</span><span class="post-stat-val td-am">${num(REPORT.postage.ll)}</span></div>
        <div class="post-stat-row"><span class="post-stat-label">Cost per Label</span><span class="post-stat-val">${llCost>0?f2(llCost):'Not set'}</span></div>
        <div class="post-stat-row"><span class="post-stat-label">Total Postage Spend</span><span class="post-stat-val td-rd">${llCost>0?'-'+f0(llTotal):'—'}</span></div>
        <div class="post-stat-row"><span class="post-stat-label">% of All Orders</span><span class="post-stat-val">${pct(REPORT.postage.ll/(REPORT.postage.ll+REPORT.postage.t48)*100)}</span></div>
        <div style="margin-top:10px;font-size:10px;color:var(--mu)">Used for: single cable orders (qty=1)</div>
      </div>
      <div class="post-card t48">
        <div class="post-card-icon">📦</div>
        <div class="post-card-name">Royal Mail Tracked 48</div>
        <div class="post-stat-row"><span class="post-stat-label">Total Orders</span><span class="post-stat-val td-ac">${num(REPORT.postage.t48)}</span></div>
        <div class="post-stat-row"><span class="post-stat-label">Cost per Label</span><span class="post-stat-val">${t48Cost>0?f2(t48Cost):'Not set'}</span></div>
        <div class="post-stat-row"><span class="post-stat-label">Total Postage Spend</span><span class="post-stat-val td-rd">${t48Cost>0?'-'+f0(t48Total):'—'}</span></div>
        <div class="post-stat-row"><span class="post-stat-label">% of All Orders</span><span class="post-stat-val">${pct(REPORT.postage.t48/(REPORT.postage.ll+REPORT.postage.t48)*100)}</span></div>
        <div style="margin-top:10px;font-size:10px;color:var(--mu)">Used for: qty 2+ orders, accessories, screen protectors</div>
      </div>
    </div>

    ${hasCosts ? `<div class="sum-box">
      <div class="sum-row"><span class="sum-label">📮 RM Large Letter (${num(REPORT.postage.ll)} × ${f2(llCost)})</span><span class="td-mono td-rd">-${f0(llTotal)}</span></div>
      <div class="sum-row"><span class="sum-label">📦 RM Tracked 48 (${num(REPORT.postage.t48)} × ${f2(t48Cost)})</span><span class="td-mono td-rd">-${f0(t48Total)}</span></div>
      <div class="sum-row"><span class="sum-total-label">Total Postage Spend</span><span class="td-mono td-rd" style="font-size:17px">-${f0(grandTotal)}</span></div>
    </div>
    <div style="font-size:11px;color:var(--mu);text-align:center;margin-top:8px">
      Postage = ${pct(grandTotal/REPORT.metrics.grossSales*100)} of gross sales · ${pct(grandTotal/(REPORT.metrics.grossSales-REPORT.metrics.totalFees-REPORT.metrics.otherFeeTotal)*100)} of net revenue
    </div>` : ''}

    <div class="card" style="margin-top:14px">
      <div class="card-title">Postage Type per SKU <span class="card-badge">Based on SKU name + avg qty</span></div>
      <div class="g2">
        <div>
          <div style="font-size:12px;font-weight:600;color:var(--am);margin-bottom:10px">📮 Large Letter SKUs</div>
          ${REPORT.allSkus.filter(s=>inferPostageType(s.sku,s.units,s.orders)==='ll').map(s=>`
            <div class="health-sku-row"><span class="health-sku-name" title="${s.sku}">${s.sku}</span>
            <span class="td-mono td-mu" style="font-size:11px">${s.orders} orders</span></div>`).join('')}
        </div>
        <div>
          <div style="font-size:12px;font-weight:600;color:var(--ac);margin-bottom:10px">📦 RM Tracked 48 SKUs</div>
          ${REPORT.allSkus.filter(s=>inferPostageType(s.sku,s.units,s.orders)==='t48').map(s=>`
            <div class="health-sku-row"><span class="health-sku-name" title="${s.sku}">${s.sku}</span>
            <span class="td-mono td-mu" style="font-size:11px">${s.orders} orders</span></div>`).join('')}
        </div>
      </div>
    </div>`;
}

// ---- EBAY EXPENSES ----
function renderExpenses(el) {
  const m = REPORT.metrics;
  const feeRateTotal = m.grossSales > 0 ? (m.totalFees+m.otherFeeTotal)/m.grossSales*100 : 0;
  const sortedByFees = [...REPORT.allSkus].sort((a,b)=>Math.abs(b.fees)-Math.abs(a.fees));

  el.innerHTML = `
    <div class="print-title"><h2>eBay Expenses — ${REPORT.period}</h2></div>
    <div class="metric-grid" style="grid-template-columns:repeat(3,1fr)">
      ${mc('FVF Fixed',        f0(m.totalFvfFixed),  f2(m.totalFvfFixed/m.uniqueOrders)+' per order', 'c-rd')}
      ${mc('FVF Variable',     f0(m.totalFvfVar),    pct(m.totalFvfVar/m.grossSales*100)+' of subtotal', 'c-rd')}
      ${mc('Regulatory Fee',   f0(m.totalRegFee),    pct(m.totalRegFee/m.grossSales*100)+' of gross', 'c-rd')}
      ${mc('Promoted Listings',f0(m.promotedFees),   pct(m.promotedFees/m.grossSales*100)+' of gross', 'c-am')}
      ${mc('Other Fees',       f0(m.otherFeeTotal-m.promotedFees), 'Misc eBay charges', 'c-am')}
      ${mc('Refunds + Claims', f0(m.refundTotal+m.claimTotal), f2(m.refundTotal)+' refunds · '+f2(m.claimTotal)+' claims', 'c-rd')}
    </div>

    <div class="g2">
      <div class="card">
        <div class="card-title">Financial Reconciliation</div>
        <div class="sum-box">
          <div class="sum-row"><span class="sum-label">Gross Orders</span><span class="td-mono td-gr">+${f2(m.grossSales)}</span></div>
          <div class="sum-row"><span class="sum-label">Gross Refunds</span><span class="td-mono td-rd">-${f2(m.refundTotal)}</span></div>
          <div class="sum-row"><span class="sum-label">Gross Claims</span><span class="td-mono td-rd">-${f2(m.claimTotal)}</span></div>
          <div class="sum-row"><span class="sum-label">Transaction Fees (FVF Fixed + Variable + Reg)</span><span class="td-mono td-rd">-${f2(m.totalFvfFixed+m.totalFvfVar+m.totalRegFee)}</span></div>
          <div class="sum-row"><span class="sum-label">Promoted Listing Fees</span><span class="td-mono td-rd">-${f2(m.promotedFees)}</span></div>
          <div class="sum-row"><span class="sum-label">Other Fees</span><span class="td-mono td-rd">-${f2(m.otherFeeTotal-m.promotedFees)}</span></div>
          <div class="sum-row"><span class="sum-label">Adjustments</span><span class="td-mono td-rd">-${f2(m.adjTotal)}</span></div>
          <div class="sum-row"><span class="sum-total-label">Total Payout to Bank</span><span class="td-mono" style="font-size:16px">${f2(m.payout)}</span></div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">Fee Rate Analysis</div>
        ${[
          {l:'FVF Fixed per order', v:f2(m.totalFvfFixed/m.uniqueOrders), sub:f0(m.totalFvfFixed)+' ÷ '+num(m.uniqueOrders)+' orders', col:'td-rd'},
          {l:'FVF Variable % of sales', v:pct(m.totalFvfVar/m.grossSales*100), sub:f0(m.totalFvfVar)+' ÷ '+f0(m.grossSales)+' gross', col:'td-rd'},
          {l:'Promoted Listing rate', v:pct(m.promotedFees/m.grossSales*100), sub:f0(m.promotedFees)+' ÷ '+f0(m.grossSales), col:'td-pu'},
          {l:'Regulatory fee rate', v:pct(m.totalRegFee/m.grossSales*100), sub:f0(m.totalRegFee)+' on gross', col:'td-mu'},
        ].map(r=>`<div class="breakdown-row">
          <div><div class="breakdown-label">${r.l}</div><div class="breakdown-sublabel">${r.sub}</div></div>
          <div class="breakdown-val ${r.col}">${r.v}</div>
        </div>`).join('')}
        <div style="background:rgba(247,85,85,.06);border:1px solid rgba(247,85,85,.2);border-radius:8px;padding:14px;text-align:center;margin-top:14px">
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
          <thead><tr><th>#</th><th>SKU</th><th>Orders</th><th>Units</th><th>Gross</th><th>FVF Fixed</th><th>FVF Variable</th><th>Reg Fee</th><th>Total Fees</th><th>Fee %</th><th>Net Rev</th></tr></thead>
          <tbody>${sortedByFees.map((s,i)=>`<tr>
            <td class="td-rank">${i+1}</td><td class="td-sku" title="${s.sku}">${s.sku}</td>
            <td class="td-mu">${s.orders}</td><td class="td-mu">${s.units}</td>
            <td class="td-mono td-ac">${f2(s.gross)}</td>
            <td class="td-mono td-rd">-${f2(Math.abs(s.fvfFixed||0))}</td>
            <td class="td-mono td-rd">-${f2(Math.abs(s.fvfVar||0))}</td>
            <td class="td-mono td-mu">-${f2(Math.abs(s.regFee||0))}</td>
            <td class="td-mono td-rd">-${f2(Math.abs(s.fees))}</td>
            <td class="td-mono ${s.fee_pct>25?'td-rd':s.fee_pct>20?'td-am':'td-mu'}">${pct(s.fee_pct)}</td>
            <td class="td-mono td-gr">${f2(s.net)}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
    </div>`;
}

// ---- COSTS SETUP ----
function renderCosts(el) {
  el.innerHTML = `
    <div class="card mb14">
      <div class="card-title">Postage Costs per Service <span class="card-badge">Saved to your browser — persists each month</span></div>
      <div class="postage-grid">
        <div class="postage-card">
          <div class="postage-name">📮 Royal Mail Large Letter</div>
          <div class="postage-sub" style="color:var(--am)">Single cable orders (qty = 1)</div>
          <div class="cost-inp-wrap"><span>£</span><input class="cost-inp" type="number" step="0.01" id="post_ll" value="${POSTAGE.ll||''}" placeholder="0.00" oninput="savePostage()"></div>
          <div class="postage-count">${REPORT.postage.ll} orders · Est. ${POSTAGE.ll>0?'-'+f0(REPORT.postage.ll*POSTAGE.ll):'—'} total</div>
        </div>
        <div class="postage-card">
          <div class="postage-name">📦 Royal Mail Tracked 48</div>
          <div class="postage-sub" style="color:var(--ac)">Qty 2+ / non-cable / accessories</div>
          <div class="cost-inp-wrap"><span>£</span><input class="cost-inp" type="number" step="0.01" id="post_t48" value="${POSTAGE.t48||''}" placeholder="0.00" oninput="savePostage()"></div>
          <div class="postage-count">${REPORT.postage.t48} orders · Est. ${POSTAGE.t48>0?'-'+f0(REPORT.postage.t48*POSTAGE.t48):'—'} total</div>
        </div>
        <div class="postage-card">
          <div class="postage-name">🚀 Royal Mail Tracked 24</div>
          <div class="postage-sub" style="color:var(--mu)">Express orders</div>
          <div class="cost-inp-wrap"><span>£</span><input class="cost-inp" type="number" step="0.01" id="post_t24" value="${POSTAGE.t24||''}" placeholder="0.00" oninput="savePostage()"></div>
          <div class="postage-count">Occasional orders</div>
        </div>
      </div>
      <div id="costPostageSummary"></div>
    </div>

    <div class="card">
      <div class="card-title">Cost Price per SKU <span class="card-badge">Enter your buying cost per unit</span></div>
      <input class="search-bar" type="text" id="costSearch" placeholder="Search SKU…" oninput="filterCostSkus()">
      <div class="sku-cost-grid" id="costSkuGrid"></div>
    </div>
    <div id="profitSummaryBottom" style="margin-top:14px"></div>`;

  renderCostSkus(REPORT.allSkus);
  updateCostSummary();
}

function savePostage() {
  POSTAGE.ll  = parseFloat(document.getElementById('post_ll')?.value)  || 0;
  POSTAGE.t48 = parseFloat(document.getElementById('post_t48')?.value) || 0;
  POSTAGE.t24 = parseFloat(document.getElementById('post_t24')?.value) || 0;
  saveToStorage();
  updateCostSummary();
}

function renderCostSkus(skus) {
  const grid = document.getElementById('costSkuGrid'); if (!grid) return;
  grid.innerHTML = skus.map(s => {
    const val = COSTS[s.sku] !== undefined ? COSTS[s.sku] : '';
    return `<div class="sku-cost-row">
      <div class="sku-cost-name" title="${s.sku}">${s.sku}</div>
      <div style="display:flex;align-items:center;gap:3px">
        <span style="color:var(--mu);font-size:10px">£</span>
        <input class="sku-mini-inp${val!==''?' has-val':''}" type="number" step="0.01" min="0"
          data-sku="${s.sku}" value="${val}" placeholder="0.00" oninput="updateCost(this)">
      </div>
    </div>`;
  }).join('');
}

function filterCostSkus() {
  const q = (document.getElementById('costSearch')?.value||'').toLowerCase();
  renderCostSkus(REPORT.allSkus.filter(s=>s.sku.toLowerCase().includes(q)));
}

function updateCost(inp) {
  const sku = inp.dataset.sku; const v = parseFloat(inp.value);
  if (!isNaN(v) && v >= 0) { COSTS[sku] = v; inp.classList.add('has-val'); }
  else { delete COSTS[sku]; inp.classList.remove('has-val'); }
  saveToStorage();
  updateCostSummary();
}

function updateCostSummary() {
  const p = getProfit();
  const el = document.getElementById('profitSummaryBottom'); if (!el) return;
  if (!p || p.skusCosted === 0) { el.innerHTML = ''; return; }
  const cls = p.profit>=0?'td-gr':'td-rd';
  el.innerHTML = `<div class="sum-box">
    <div style="font-size:11px;color:var(--mu);margin-bottom:10px">${p.skusCosted} of ${REPORT.allSkus.length} SKUs have cost entered</div>
    <div class="sum-row"><span class="sum-label">Gross Sales (costed SKUs)</span><span class="td-mono td-gr">+${f2(p.tGross)}</span></div>
    <div class="sum-row"><span class="sum-label">eBay Fees</span><span class="td-mono td-rd">-${f2(p.totalEbayFees)}</span></div>
    <div class="sum-row"><span class="sum-label">Net Revenue</span><span class="td-mono td-ac">${f2(p.tNet)}</span></div>
    <div class="sum-row"><span class="sum-label">Cost of Goods (COGS)</span><span class="td-mono td-rd">-${f2(p.tCOGS)}</span></div>
    <div class="sum-row"><span class="sum-label">Postage Costs</span><span class="td-mono td-rd">-${f2(p.tPost)}</span></div>
    <div class="sum-row"><span class="sum-total-label">Estimated Net Profit</span><span class="td-mono ${cls}" style="font-size:17px">${p.profit>=0?'+':''}${f2(p.profit)}</span></div>
    <div style="text-align:center;font-size:11px;color:var(--mu);margin-top:6px">
      Margin: <strong class="${cls}">${pct(p.margin)}</strong> · ROI: <strong class="${cls}">${p.roi!==null?pct(p.roi):'—'}</strong>
    </div>
  </div>`;
}

// ---- CHARTS ----
function drawDailyChart() {
  const cvs = document.getElementById('dailyChart'); if (!cvs) return;
  const ctx = cvs.getContext('2d');
  const W = cvs.offsetWidth||400, H = 155;
  cvs.width = W; cvs.height = H;
  const vals = REPORT.daily.map(d=>d.sales), max = Math.max(...vals)||1;
  const pad = {l:50,r:8,t:12,b:26}, cw=W-pad.l-pad.r, ch=H-pad.t-pad.b;
  const bw = Math.max(1, cw/vals.length-1.5);
  ctx.clearRect(0,0,W,H);
  [0,.25,.5,.75,1].forEach(f=>{
    const y=pad.t+ch*(1-f); ctx.strokeStyle='#252b3a'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(pad.l,y); ctx.lineTo(W-pad.r,y); ctx.stroke();
    ctx.fillStyle='#6b7494'; ctx.font='9px Inter'; ctx.textAlign='right';
    ctx.fillText('£'+Math.round(max*f),pad.l-3,y+3);
  });
  REPORT.daily.forEach((d,i)=>{
    const x=pad.l+i*(cw/vals.length)+0.5, h=(d.sales/max)*ch, y=pad.t+ch-h;
    const grad=ctx.createLinearGradient(0,y,0,y+h);
    grad.addColorStop(0,d.sales===max?'#4f8ef7':'#7c5cfc'); grad.addColorStop(1,'rgba(79,142,247,.12)');
    ctx.fillStyle=grad; ctx.beginPath();
    if(ctx.roundRect) ctx.roundRect(x,y,bw,h,2); else ctx.rect(x,y,bw,h);
    ctx.fill();
    if(d.sales===max){ctx.fillStyle='#e8eaf0';ctx.font='bold 8px Inter';ctx.textAlign='center';ctx.fillText('£'+Math.round(d.sales),x+bw/2,y-3);}
    const day=parseInt(d.date.slice(8));
    if(day===1||day%5===0||i===vals.length-1){ctx.fillStyle='#6b7494';ctx.font='9px Inter';ctx.textAlign='center';ctx.fillText(String(day),x+bw/2,H-6);}
  });
}

function drawDonut() {
  const m = REPORT.metrics;
  const segs=[{l:'FVF Fixed',v:m.totalFvfFixed,c:'#f75555'},{l:'FVF Variable',v:m.totalFvfVar,c:'#ff9f43'},
    {l:'Promoted',v:m.promotedFees,c:'#7c5cfc'},{l:'Other Fees',v:m.otherFeeTotal-m.promotedFees,c:'#f7b955'},
    {l:'Refunds',v:m.refundTotal+m.claimTotal,c:'#ff6b81'}].filter(s=>s.v>0);
  const tot=segs.reduce((s,x)=>s+x.v,0);
  const svg=document.getElementById('donutSvg'); if(!svg||!tot) return;
  const cx=55,cy=55,r=40,ri=25; let angle=-Math.PI/2,paths='';
  segs.forEach(sg=>{
    const sw=(sg.v/tot)*2*Math.PI;
    const x1=cx+r*Math.cos(angle),y1=cy+r*Math.sin(angle),x2=cx+r*Math.cos(angle+sw),y2=cy+r*Math.sin(angle+sw);
    const xi1=cx+ri*Math.cos(angle),yi1=cy+ri*Math.sin(angle),xi2=cx+ri*Math.cos(angle+sw),yi2=cy+ri*Math.sin(angle+sw);
    const lg=sw>Math.PI?1:0;
    paths+=`<path d="M${x1},${y1}A${r},${r}0 ${lg},1 ${x2},${y2}L${xi2},${yi2}A${ri},${ri}0 ${lg},0 ${xi1},${yi1}Z" fill="${sg.c}" opacity=".85"/>`;
    angle+=sw;
  });
  svg.innerHTML=paths+`<text x="55" y="51" text-anchor="middle" fill="#6b7494" font-size="8" font-family="Inter">Fees</text>
    <text x="55" y="62" text-anchor="middle" fill="#f75555" font-size="9.5" font-family="JetBrains Mono" font-weight="600">-${f0(tot)}</text>`;
  document.getElementById('donutLegend').innerHTML=segs.map(s=>`<div class="donut-row">
    <div class="donut-dot" style="background:${s.c}"></div><div class="donut-name">${s.l}</div>
    <div class="donut-val">-${f0(s.v)}</div></div>`).join('');
}

function drawTopBars() {
  const top=REPORT.allSkus.slice(0,10), mx=top[0]?.gross||1;
  document.getElementById('topBars').innerHTML=top.map((s,i)=>`
    <div class="bar-item">
      <div class="bar-head">
        <span class="bar-label">${i+1}. ${s.sku} <span style="color:var(--mu);font-size:10px">(${s.orders} orders)</span></span>
        <span class="bar-val td-ac">${f0(s.gross)}</span>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${(s.gross/mx*100).toFixed(1)}%;background:${i<3?'var(--ac)':'var(--ac2)'}"></div></div>
    </div>`).join('');
}

// ---- PDF ----
function printReport() {
  const main = document.getElementById('dashMain');
  TAB_IDS.forEach(id => {
    let p = document.getElementById('panel-'+id);
    if (!p) { p=document.createElement('div'); p.className='tab-panel'; p.id='panel-'+id; main.appendChild(p); renderTab(id,p); }
    p.style.display = 'block';
  });
  setTimeout(()=>{ window.print();
    setTimeout(()=>{ TAB_IDS.forEach(id=>{ const p=document.getElementById('panel-'+id); if(p) p.style.display=id===currentTab?'block':'none'; }); },500);
  },400);
}

window.addEventListener('load', loadSaved);
window.addEventListener('resize', ()=>{ if(currentTab==='overview') drawDailyChart(); });
