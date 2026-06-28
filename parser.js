// ============================================================
// parser.js  — eBay Monthly Report
// Parses Transaction Report + Orders Report CSVs in-browser.
// ============================================================

const CABLE_KW = ['cable', 'lighting', '8 pin', '8-pin', 'c to c', 'cablez', 'otg'];

function isCableSku(sku) {
  if (!sku) return false;
  const s = sku.toLowerCase();
  return CABLE_KW.some(k => s.includes(k));
}

function inferPostage(sku, qty) {
  return (isCableSku(sku) && qty === 1) ? 'll' : 't48';
}

// ---- Robust CSV parser (handles quoted fields, commas, newlines) ----
function parseCSV(text) {
  // Normalise line endings
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows = [];
  let cur = '', inQ = false, cells = [];

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQ && text[i+1] === '"') { cur += '"'; i++; } // escaped quote
      else inQ = !inQ;
    } else if (c === ',' && !inQ) {
      cells.push(cur.trim()); cur = '';
    } else if (c === '\n' && !inQ) {
      cells.push(cur.trim()); cur = '';
      if (cells.some(v => v !== '')) rows.push(cells);
      cells = [];
    } else {
      cur += c;
    }
  }
  if (cur || cells.length) { cells.push(cur.trim()); if (cells.some(v => v !== '')) rows.push(cells); }
  return rows;
}

function toNum(v) {
  if (v === undefined || v === null || v === '' || v === '--') return 0;
  return parseFloat(String(v).replace(/[^0-9.\-]/g, '')) || 0;
}

// ---- Parse "31 May 2026" or "01/05/2026 00:00:00 AM BST" → YYYY-MM-DD ----
const MONTHS = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};

function parseEbayDate(s) {
  if (!s || s === '--') return null;
  s = s.trim();

  // "31 May 2026"
  const m1 = s.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if (m1) {
    const mo = MONTHS[m1[2].toLowerCase()];
    if (mo !== undefined) {
      const d = new Date(parseInt(m1[3]), mo, parseInt(m1[1]));
      return d.toISOString().slice(0,10);
    }
  }

  // "01/05/2026 ..." (DD/MM/YYYY or MM/DD/YYYY — eBay UK uses DD/MM)
  const m2 = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m2) {
    // Treat as DD/MM/YYYY for UK eBay
    const d = new Date(parseInt(m2[3]), parseInt(m2[2])-1, parseInt(m2[1]));
    return d.toISOString().slice(0,10);
  }

  // ISO
  const m3 = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m3) return m3[1];

  return null;
}

// ---- Parse Transaction CSV ----
// Structure: lines 0-10 are metadata/notes, line 11 is the header, line 12+ are data
function parseTransactionCSV(text) {
  const rows = parseCSV(text);

  // Find header row: contains "Transaction creation date"
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    if (rows[i].some(c => c.toLowerCase().includes('transaction creation date'))) {
      headerIdx = i; break;
    }
  }
  if (headerIdx === -1) throw new Error('Could not find header row in Transaction CSV. Please make sure you uploaded the Transaction Report.');

  // Extract period from metadata rows (look for "Start date" / "End date")
  let startDate = null, endDate = null;
  for (let i = 0; i < headerIdx; i++) {
    const row = rows[i];
    if (row[0] && row[0].toLowerCase().includes('start date') && row[1]) {
      startDate = parseEbayDate(row[1].split(' ')[0] + ' ' + row[1].split(' ')[1] + ' ' + row[1].split(' ')[2]);
      // fallback: parse "01/05/2026"
      if (!startDate) {
        const m = row[1].match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (m) startDate = `${m[3]}-${m[2]}-${m[1]}`;
      }
    }
    if (row[0] && row[0].toLowerCase().includes('end date') && row[1]) {
      const m = row[1].match(/(\d{2})\/(\d{2})\/(\d{4})/);
      if (m) endDate = `${m[3]}-${m[2]}-${m[1]}`;
    }
  }

  const headers = rows[headerIdx].map(h => h.toLowerCase());
  const ci = name => headers.findIndex(h => h.includes(name));

  const iDate    = ci('transaction creation date');
  const iType    = ci('type');
  const iOrder   = ci('order number');
  const iTitle   = ci('item title');
  const iSku     = ci('custom label');
  const iQty     = ci('quantity');
  const iSub     = ci('item subtotal');
  const iGross   = ci('gross transaction amount');
  const iNet     = ci('net amount');
  const iFvfFix  = ci('final value fee – fixed');
  const iFvfVar  = ci('final value fee – variable');
  const iReg     = ci('regulatory operating fee');
  const iDesc    = ci('description');

  console.log('TX header cols found:', {iDate,iType,iOrder,iSku,iQty,iGross,iNet,iFvfFix,iFvfVar,iReg});

  const data = { orders:[], refunds:[], claims:[], otherFees:[], adjustments:[], startDate, endDate };

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 3) continue;
    const type = (r[iType] || '').trim();
    if (!type || type === '--') continue;

    const row = {
      type,
      date: parseEbayDate(r[iDate]) || '',
      orderNum: (r[iOrder] || '').trim(),
      title:    (r[iTitle] || '').trim(),
      sku:      (r[iSku]   || '').trim(),
      qty:      Math.max(1, toNum(r[iQty])),
      subtotal: toNum(r[iSub]),
      gross:    toNum(r[iGross]),
      net:      toNum(r[iNet]),
      fvfFixed: toNum(r[iFvfFix]),
      fvfVar:   toNum(r[iFvfVar]),
      regFee:   toNum(r[iReg]),
      desc:     (r[iDesc] || '').trim(),
    };
    row.totalFee = row.fvfFixed + row.fvfVar + row.regFee;

    if (type === 'Order')     data.orders.push(row);
    else if (type === 'Refund')    data.refunds.push(row);
    else if (type === 'Claim')     data.claims.push(row);
    else if (type === 'Other fee') data.otherFees.push(row);
    else if (type === 'Adjustment') data.adjustments.push(row);
  }

  console.log(`TX parsed: ${data.orders.length} orders, ${data.refunds.length} refunds, ${data.claims.length} claims`);
  return data;
}

// ---- Parse Orders CSV ----
// Structure: line 0 is blank/junk, line 1 is header, line 2 is blank, line 3+ are data
function parseOrdersCSV(text) {
  const rows = parseCSV(text);

  // Find header row: contains "order number"
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    if (rows[i].some(c => c.toLowerCase().includes('order number'))) {
      headerIdx = i; break;
    }
  }
  if (headerIdx === -1) throw new Error('Could not find header row in Orders CSV. Please make sure you uploaded the Orders Report.');

  const headers = rows[headerIdx].map(h => h.toLowerCase());
  const ci = name => headers.findIndex(h => h.includes(name));

  const iOrder    = ci('order number');
  const iSku      = ci('custom label');
  const iTitle    = ci('item title');
  const iQty      = ci('quantity');
  const iDelivery = ci('delivery service');
  const iSaleDate = ci('sale date');
  const iSoldFor  = ci('sold for');

  console.log('ORD header cols found:', {iOrder,iSku,iQty,iDelivery});

  const orders = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[iOrder] || !r[iOrder].trim()) continue;
    orders.push({
      orderNum: r[iOrder].trim(),
      sku:      (r[iSku]      || '').trim(),
      title:    (r[iTitle]    || '').trim(),
      qty:      Math.max(1, toNum(r[iQty]) || 1),
      delivery: (r[iDelivery] || '').trim(),
      saleDate: parseEbayDate(r[iSaleDate]) || '',
      soldFor:  toNum(r[iSoldFor]),
    });
  }

  console.log(`ORD parsed: ${orders.length} orders`);
  return orders;
}

// ---- Format period label from dates ----
function formatPeriod(startDate, endDate, orders) {
  // Try from metadata first
  if (startDate) {
    const d = new Date(startDate);
    const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return MO[d.getMonth()] + ' ' + d.getFullYear();
  }
  // Fall back to order dates
  const dates = orders.map(o => o.date).filter(Boolean).sort();
  if (dates.length) {
    const first = new Date(dates[0]);
    const last  = new Date(dates[dates.length-1]);
    const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    if (first.getMonth() === last.getMonth() && first.getFullYear() === last.getFullYear()) {
      return MO[first.getMonth()] + ' ' + first.getFullYear();
    }
    return MO[first.getMonth()] + '–' + MO[last.getMonth()] + ' ' + last.getFullYear();
  }
  return 'Unknown period';
}

// ---- Main crunch ----
function crunchData(txText, ordText) {
  const tx  = parseTransactionCSV(txText);
  const ord = parseOrdersCSV(ordText);

  const period = formatPeriod(tx.startDate, tx.endDate, tx.orders);

  // Metrics
  const grossSales    = tx.orders.reduce((s,o) => s + o.gross, 0);
  const netRevenue    = tx.orders.reduce((s,o) => s + o.net,   0);
  const totalUnits    = tx.orders.reduce((s,o) => s + o.qty,   0);
  const totalFvfFixed = tx.orders.reduce((s,o) => s + o.fvfFixed, 0);
  const totalFvfVar   = tx.orders.reduce((s,o) => s + o.fvfVar,   0);
  const totalRegFee   = tx.orders.reduce((s,o) => s + o.regFee,   0);
  const totalFees     = totalFvfFixed + totalFvfVar + totalRegFee;
  const refundTotal   = tx.refunds.reduce((s,r)    => s + r.net, 0);
  const claimTotal    = tx.claims.reduce((s,c)     => s + c.net, 0);
  const adjTotal      = tx.adjustments.reduce((s,a) => s + a.net, 0);
  const otherFeeTotal = tx.otherFees.reduce((s,f)  => s + f.net, 0);

  const promotedFees = tx.otherFees
    .filter(f => f.desc.toLowerCase().includes('promoted') || f.desc.toLowerCase().includes('ad fee'))
    .reduce((s,f) => s + f.net, 0);

  const uniqueOrders = new Set(tx.orders.map(o => o.orderNum)).size;
  const payout = grossSales + refundTotal + claimTotal + totalFees + otherFeeTotal + adjTotal;

  // Per-SKU
  const skuMap = {};
  for (const o of tx.orders) {
    const sku = o.sku || '(no label)';
    if (!skuMap[sku]) skuMap[sku] = { sku, orders:0, units:0, gross:0, net:0, fees:0, fvfFixed:0, fvfVar:0, regFee:0 };
    const s = skuMap[sku];
    s.orders++; s.units += o.qty; s.gross += o.gross; s.net += o.net;
    s.fvfFixed += o.fvfFixed; s.fvfVar += o.fvfVar; s.regFee += o.regFee;
    s.fees += o.totalFee;
  }

  const allSkus = Object.values(skuMap).map(s => ({
    ...s,
    fee_pct:  s.gross > 0 ? Math.abs(s.fees) / s.gross * 100 : 0,
    avg_val:  s.orders > 0 ? s.gross / s.orders : 0,
  })).sort((a,b) => b.gross - a.gross);

  // Postage split from orders
  let llCount = 0, t48Count = 0;
  for (const o of ord) {
    if (inferPostage(o.sku, o.qty) === 'll') llCount++; else t48Count++;
  }

  // Daily
  const dailyMap = {};
  for (const o of tx.orders) {
    const d = o.date || 'unknown';
    if (!dailyMap[d]) dailyMap[d] = { date:d, sales:0, count:0, units:0 };
    dailyMap[d].sales += o.gross;
    dailyMap[d].count++;
    dailyMap[d].units += o.qty;
  }
  const daily = Object.values(dailyMap)
    .filter(d => d.date !== 'unknown')
    .sort((a,b) => a.date.localeCompare(b.date));

  return {
    period,
    metrics: {
      grossSales, netRevenue, totalUnits,
      uniqueOrders, totalOrderLines: tx.orders.length,
      uniqueSkus: allSkus.length,
      avgOrderValue: uniqueOrders > 0 ? grossSales / uniqueOrders : 0,
      totalFees:     Math.abs(totalFees),
      totalFvfFixed: Math.abs(totalFvfFixed),
      totalFvfVar:   Math.abs(totalFvfVar),
      totalRegFee:   Math.abs(totalRegFee),
      refundTotal:   Math.abs(refundTotal),
      claimTotal:    Math.abs(claimTotal),
      promotedFees:  Math.abs(promotedFees),
      otherFeeTotal: Math.abs(otherFeeTotal),
      adjTotal:      Math.abs(adjTotal),
      payout:        Math.abs(payout),
      feeRate: grossSales > 0 ? (Math.abs(totalFees) + Math.abs(otherFeeTotal)) / grossSales * 100 : 0,
    },
    allSkus,
    daily,
    postage: { ll: llCount, t48: t48Count },
  };
}
