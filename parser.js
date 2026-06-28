// ============================================================
// parser.js
// Reads eBay Transaction Report + Orders Report CSVs in the
// browser using FileReader. No server needed.
// ============================================================

const CABLE_KW = ['cable', 'lighting', '8 pin', '8-pin', 'c to c', 'cablez', 'otg'];

function isCableSku(sku) {
  if (!sku) return false;
  const s = sku.toLowerCase();
  return CABLE_KW.some(k => s.includes(k));
}

// Determine postage type per order
// Single cable qty=1 → Large Letter; everything else → RM48
function inferPostage(sku, qty) {
  return (isCableSku(sku) && qty === 1) ? 'll' : 't48';
}

// ---- CSV parser (handles quoted fields with commas) ----
function parseCSV(text) {
  const rows = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    const cells = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQ = !inQ; }
      else if (c === ',' && !inQ) { cells.push(cur.trim()); cur = ''; }
      else { cur += c; }
    }
    cells.push(cur.trim());
    rows.push(cells);
  }
  return rows;
}

function toNum(v) { return parseFloat(String(v).replace(/[^0-9.\-]/g, '')) || 0; }

// ---- Find header row in Transaction CSV (has metadata at top) ----
function findHeaderRow(rows) {
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].some(c => c.toLowerCase().includes('transaction creation date') || c.toLowerCase().includes('type'))) {
      return i;
    }
  }
  return 0;
}

// ---- Parse Transaction Report ----
function parseTransactionCSV(text) {
  const rows = parseCSV(text);
  const headerIdx = findHeaderRow(rows);
  const headers = rows[headerIdx].map(h => h.toLowerCase().trim());

  const col = name => headers.findIndex(h => h.includes(name));

  const iType     = col('type');
  const iDate     = col('transaction creation date');
  const iOrderNum = col('order number');
  const iTitle    = col('item title');
  const iSku      = col('custom label');
  const iQty      = col('quantity');
  const iSubtotal = col('item subtotal');
  const iGross    = col('gross transaction amount');
  const iNet      = col('net amount');
  const iFvfFixed = col('final value fee – fixed');
  const iFvfVar   = col('final value fee – variable');
  const iRegFee   = col('regulatory operating fee');
  const iDesc     = col('description');

  const data = {
    orders: [],
    refunds: [],
    claims: [],
    otherFees: [],
    adjustments: [],
  };

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 3) continue;
    const type = (r[iType] || '').trim();
    if (!type) continue;

    const row = {
      type,
      date: (r[iDate] || '').trim(),
      orderNum: (r[iOrderNum] || '').trim(),
      title: (r[iTitle] || '').trim(),
      sku: (r[iSku] || '').trim(),
      qty: toNum(r[iQty]),
      subtotal: toNum(r[iSubtotal]),
      gross: toNum(r[iGross]),
      net: toNum(r[iNet]),
      fvfFixed: toNum(r[iFvfFixed]),
      fvfVar: toNum(r[iFvfVar]),
      regFee: toNum(r[iRegFee]),
      desc: (r[iDesc] || '').trim(),
    };
    row.totalFee = row.fvfFixed + row.fvfVar + row.regFee;

    if (type === 'Order') data.orders.push(row);
    else if (type === 'Refund') data.refunds.push(row);
    else if (type === 'Claim') data.claims.push(row);
    else if (type === 'Other fee') data.otherFees.push(row);
    else if (type === 'Adjustment') data.adjustments.push(row);
  }

  return data;
}

// ---- Parse Orders Report ----
function parseOrdersCSV(text) {
  const rows = parseCSV(text);
  // Find header: look for row containing 'order number'
  let headerIdx = 0;
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    if (rows[i].some(c => c.toLowerCase().includes('order number'))) {
      headerIdx = i; break;
    }
  }
  const headers = rows[headerIdx].map(h => h.toLowerCase().trim());
  const col = name => headers.findIndex(h => h.includes(name));

  const iOrderNum  = col('order number');
  const iSku       = col('custom label');
  const iTitle     = col('item title');
  const iQty       = col('quantity');
  const iDelivery  = col('delivery service');
  const iSaleDate  = col('sale date');
  const iSoldFor   = col('sold for');
  const iPostage   = col('postage and packaging');
  const iTotal     = col('total price');

  const orders = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[iOrderNum] || !r[iOrderNum].trim()) continue;
    orders.push({
      orderNum: r[iOrderNum].trim(),
      sku: (r[iSku] || '').trim(),
      title: (r[iTitle] || '').trim(),
      qty: toNum(r[iQty]) || 1,
      delivery: (r[iDelivery] || '').trim(),
      saleDate: (r[iSaleDate] || '').trim(),
      soldFor: toNum(r[iSoldFor]),
      postageCharged: toNum(r[iPostage]),
      total: toNum(r[iTotal]),
    });
  }
  return orders;
}

// ---- Main crunch function ----
function crunchData(txText, ordText) {
  const tx = parseTransactionCSV(txText);
  const ord = parseOrdersCSV(ordText);

  // ---- Detect period from dates ----
  const dates = tx.orders.map(o => o.date).filter(Boolean);
  let periodLabel = 'Unknown period';
  if (dates.length) {
    // Try to detect month/year
    const parseDate = s => {
      // formats: "27 May 2026", "05/27/2026", "2026-05-27"
      const d = new Date(s);
      if (!isNaN(d)) return d;
      const parts = s.split(/[\/\-\s]/);
      return null;
    };
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const allDates = dates.map(s => new Date(s)).filter(d => !isNaN(d));
    if (allDates.length) {
      allDates.sort((a,b) => a-b);
      const first = allDates[0], last = allDates[allDates.length-1];
      const mo = months[first.getMonth()];
      const yr = first.getFullYear();
      if (first.getMonth() === last.getMonth()) {
        periodLabel = `${mo} ${yr}`;
      } else {
        periodLabel = `${months[first.getMonth()]} – ${months[last.getMonth()]} ${yr}`;
      }
    }
  }

  // ---- Top-level metrics ----
  const grossSales   = tx.orders.reduce((s, o) => s + o.gross, 0);
  const netRevenue   = tx.orders.reduce((s, o) => s + o.net, 0);
  const totalUnits   = tx.orders.reduce((s, o) => s + o.qty, 0);
  const totalFvfFixed = tx.orders.reduce((s, o) => s + o.fvfFixed, 0);
  const totalFvfVar  = tx.orders.reduce((s, o) => s + o.fvfVar, 0);
  const totalRegFee  = tx.orders.reduce((s, o) => s + o.regFee, 0);
  const totalFees    = totalFvfFixed + totalFvfVar + totalRegFee;
  const refundTotal  = tx.refunds.reduce((s, r) => s + r.net, 0);
  const claimTotal   = tx.claims.reduce((s, c) => s + c.net, 0);
  const adjTotal     = tx.adjustments.reduce((s, a) => s + a.net, 0);

  // Promoted listing fees
  const promotedFees = tx.otherFees
    .filter(f => f.desc.toLowerCase().includes('promoted') || f.desc.toLowerCase().includes('ad fee'))
    .reduce((s, f) => s + f.net, 0);
  const otherFeeTotal = tx.otherFees.reduce((s, f) => s + f.net, 0);

  // Payout = gross + refunds (negative) + fees (negative) + adj (negative)
  const payout = grossSales + refundTotal + claimTotal + totalFees + otherFeeTotal + adjTotal;

  // Unique orders
  const uniqueOrders = new Set(tx.orders.map(o => o.orderNum)).size;

  // ---- Per-SKU aggregation ----
  const skuMap = {};
  for (const o of tx.orders) {
    const sku = o.sku || '(no label)';
    if (!skuMap[sku]) {
      skuMap[sku] = { sku, orders: 0, units: 0, gross: 0, net: 0, fees: 0, fvfFixed: 0, fvfVar: 0, regFee: 0 };
    }
    const s = skuMap[sku];
    s.orders++; s.units += o.qty; s.gross += o.gross; s.net += o.net;
    s.fvfFixed += o.fvfFixed; s.fvfVar += o.fvfVar; s.regFee += o.regFee;
    s.fees += o.totalFee;
  }

  const allSkus = Object.values(skuMap).map(s => ({
    ...s,
    fee_pct: s.gross > 0 ? Math.abs(s.fees) / s.gross * 100 : 0,
    avg_val: s.orders > 0 ? s.gross / s.orders : 0,
  })).sort((a, b) => b.gross - a.gross);

  // ---- Postage split from orders report ----
  let llCount = 0, t48Count = 0;
  for (const o of ord) {
    const pt = inferPostage(o.sku, o.qty);
    if (pt === 'll') llCount++; else t48Count++;
  }

  // ---- Daily sales ----
  const dailyMap = {};
  for (const o of tx.orders) {
    let d = o.date;
    // normalise to YYYY-MM-DD
    try {
      const parsed = new Date(d);
      if (!isNaN(parsed)) {
        d = parsed.toISOString().slice(0, 10);
      }
    } catch(e) {}
    if (!dailyMap[d]) dailyMap[d] = { date: d, sales: 0, count: 0, units: 0 };
    dailyMap[d].sales += o.gross;
    dailyMap[d].count++;
    dailyMap[d].units += o.qty;
  }
  const daily = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

  return {
    period: periodLabel,
    metrics: {
      grossSales, netRevenue, totalUnits,
      uniqueOrders, totalOrderLines: tx.orders.length,
      uniqueSkus: allSkus.length,
      avgOrderValue: uniqueOrders > 0 ? grossSales / uniqueOrders : 0,
      totalFees: Math.abs(totalFees),
      totalFvfFixed: Math.abs(totalFvfFixed),
      totalFvfVar: Math.abs(totalFvfVar),
      totalRegFee: Math.abs(totalRegFee),
      refundTotal: Math.abs(refundTotal),
      claimTotal: Math.abs(claimTotal),
      promotedFees: Math.abs(promotedFees),
      otherFeeTotal: Math.abs(otherFeeTotal),
      adjTotal: Math.abs(adjTotal),
      payout: Math.abs(payout),
      feeRate: grossSales > 0 ? (Math.abs(totalFees) + Math.abs(otherFeeTotal)) / grossSales * 100 : 0,
    },
    allSkus,
    daily,
    postage: { ll: llCount, t48: t48Count },
  };
}
