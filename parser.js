// ============================================================
// parser.js — eBay Monthly Report  (v3 - robust rewrite)
// Parses eBay UK Transaction Report + Orders Report CSVs
// entirely in the browser. No server required.
// ============================================================

// ---- Postage logic ----
// Large Letter: cables/OTG/packs WITHOUT plug in SKU name
// RM48: anything containing 'plug', accessories, screen protectors, card readers
const LL_KW = ['1 pack white','1 pack black','1m c to c','2m c to c','3m c to c',
               '1m 8-pin','2m 8-pin','3m 8-pin','otg','1m lighting','2m lighting','3m lighting',
               '1 m c to c','2 m c to c','3 m c to c','1 m 8 pin','2 m 8 pin','3 m 8 pin',
               '1m 8pin','2m 8pin','3m 8pin','cablez','lighting'];
const PLUG_KW = ['plug'];

function isCableSku(sku) {
  if (!sku) return false;
  const s = sku.toLowerCase();
  if (PLUG_KW.some(k => s.includes(k))) return false; // has plug → always T48
  return LL_KW.some(k => s.includes(k));
}

function inferPostage(sku, qty) {
  return isCableSku(sku) ? 'll' : 't48';
}

// ---- Strip UTF-8 BOM if present ----
function stripBOM(text) {
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}

// ---- Split one CSV line into cells (handles quoted commas) ----
function splitLine(line) {
  const cells = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      // Handle escaped double-quote ""
      if (inQ && line[i+1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) {
      cells.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  cells.push(cur.trim());
  return cells;
}

function toNum(v) {
  if (!v || v === '--' || v === '') return 0;
  const n = parseFloat(String(v).replace(/[^\d.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}

// ---- Parse eBay date "31 May 2026" → "2026-05-31" ----
const MO = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};

function parseDate(s) {
  if (!s || s === '--') return '';
  s = s.trim();
  // "31 May 2026"
  const m1 = s.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
  if (m1) {
    const mo = MO[m1[2].toLowerCase()];
    if (mo !== undefined) {
      const yr = m1[3], day = m1[1].padStart(2,'0'), moS = String(mo+1).padStart(2,'0');
      return `${yr}-${moS}-${day}`;
    }
  }
  // "01/05/2026" DD/MM/YYYY (UK eBay format)
  const m2 = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m2) return `${m2[3]}-${m2[2]}-${m2[1]}`;
  // Already YYYY-MM-DD
  const m3 = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m3) return m3[1];
  return '';
}

// ---- Parse Transaction Report ----
function parseTransactionCSV(rawText) {
  const text = stripBOM(rawText);
  const lines = text.split('\n').map(l => l.replace(/\r$/, ''));

  console.log('[TX] Total lines:', lines.length);

  // Find header line (contains "Transaction creation date")
  let headerIdx = -1;
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    if (lines[i].toLowerCase().includes('transaction creation date')) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    throw new Error('Transaction CSV: cannot find header row. Check you uploaded the correct file.');
  }
  console.log('[TX] Header at line:', headerIdx);

  // Extract period from metadata lines
  let startDate = '', endDate = '';
  for (let i = 0; i < headerIdx; i++) {
    const cells = splitLine(lines[i]);
    if (cells[0] && cells[0].toLowerCase().includes('start date') && cells[1]) {
      startDate = parseDate(cells[1].split(' ').slice(0,3).join(' '));
      if (!startDate) {
        const m = cells[1].match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (m) startDate = `${m[3]}-${m[2]}-${m[1]}`;
      }
    }
    if (cells[0] && cells[0].toLowerCase().includes('end date') && cells[1]) {
      const m = cells[1].match(/(\d{2})\/(\d{2})\/(\d{4})/);
      if (m) endDate = `${m[3]}-${m[2]}-${m[1]}`;
    }
  }
  console.log('[TX] Period:', startDate, '→', endDate);

  // Parse header to find column indices
  const headers = splitLine(lines[headerIdx]).map(h => h.toLowerCase());
  console.log('[TX] Header cols:', headers.length, '| First 5:', headers.slice(0,5));

  const ci = (name) => headers.findIndex(h => h.includes(name));

  // Use column names that are safe (no special chars where possible)
  const cols = {
    date:     ci('transaction creation date'),
    type:     ci('type'),
    order:    ci('order number'),
    title:    ci('item title'),
    sku:      ci('custom label'),
    qty:      ci('quantity'),
    sub:      ci('item subtotal'),
    gross:    ci('gross transaction amount'),
    net:      ci('net amount'),
    desc:     ci('description'),
    reg:      ci('regulatory operating fee'),
  };

  // FVF columns: search more broadly since em-dash may vary
  cols.fvfFixed = headers.findIndex(h => h.includes('final value fee') && h.includes('fixed'));
  cols.fvfVar   = headers.findIndex(h => h.includes('final value fee') && h.includes('variable'));

  console.log('[TX] Key cols:', JSON.stringify(cols));

  const data = { orders:[], refunds:[], claims:[], otherFees:[], adjustments:[], startDate, endDate };

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line === '--' || line.replace(/,/g,'').trim() === '') continue;

    const r = splitLine(lines[i]);
    const type = (r[cols.type] || '').trim();
    if (!type || type === '--') continue;

    const row = {
      type,
      date:     parseDate(r[cols.date]),
      orderNum: (r[cols.order] || '').trim(),
      title:    (r[cols.title] || '').trim(),
      sku:      (r[cols.sku]   || '').trim(),
      qty:      Math.max(1, toNum(r[cols.qty])),
      subtotal: toNum(r[cols.sub]),
      gross:    toNum(r[cols.gross]),
      net:      toNum(r[cols.net]),
      fvfFixed: toNum(r[cols.fvfFixed]),
      fvfVar:   toNum(r[cols.fvfVar]),
      regFee:   toNum(r[cols.reg]),
      desc:     (r[cols.desc] || '').trim(),
    };
    row.totalFee = row.fvfFixed + row.fvfVar + row.regFee;

    if      (type === 'Order')     data.orders.push(row);
    else if (type === 'Refund')    data.refunds.push(row);
    else if (type === 'Claim')     data.claims.push(row);
    else if (type === 'Other fee') data.otherFees.push(row);
    else if (type === 'Adjustment') data.adjustments.push(row);
  }

  console.log(`[TX] Parsed: ${data.orders.length} orders, ${data.refunds.length} refunds, ${data.claims.length} claims, ${data.otherFees.length} other fees`);

  if (data.orders.length === 0) {
    throw new Error(`Transaction CSV parsed but found 0 orders. Header was at line ${headerIdx}. Cols: ${JSON.stringify(cols)}. First data line: "${lines[headerIdx+1]}"`);
  }

  return data;
}

// ---- Parse Orders Report ----
function parseOrdersCSV(rawText) {
  const text = stripBOM(rawText);
  const lines = text.split('\n').map(l => l.replace(/\r$/, ''));

  console.log('[ORD] Total lines:', lines.length);

  // Find header line
  let headerIdx = -1;
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    if (lines[i].toLowerCase().includes('order number')) {
      headerIdx = i; break;
    }
  }
  if (headerIdx === -1) throw new Error('Orders CSV: cannot find header row.');
  console.log('[ORD] Header at line:', headerIdx);

  const headers = splitLine(lines[headerIdx]).map(h => h.toLowerCase());
  const ci = (name) => headers.findIndex(h => h.includes(name));

  const cols = {
    order:    ci('order number'),
    sku:      ci('custom label'),
    title:    ci('item title'),
    qty:      ci('quantity'),
    delivery: ci('delivery service'),
    saleDate: ci('sale date'),
    soldFor:  ci('sold for'),
  };

  console.log('[ORD] Key cols:', JSON.stringify(cols));

  const orders = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.replace(/,/g,'').trim() === '') continue;
    const r = splitLine(lines[i]);
    const orderNum = (r[cols.order] || '').trim();
    if (!orderNum) continue;
    orders.push({
      orderNum,
      sku:      (r[cols.sku]      || '').trim(),
      title:    (r[cols.title]    || '').trim(),
      qty:      Math.max(1, toNum(r[cols.qty]) || 1),
      delivery: (r[cols.delivery] || '').trim(),
      saleDate: parseDate(r[cols.saleDate]) || '',
      soldFor:  toNum(r[cols.soldFor]),
    });
  }

  console.log(`[ORD] Parsed: ${orders.length} orders`);
  return orders;
}

// ---- Format period label ----
function formatPeriod(startDate, txOrders) {
  const MONAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  if (startDate) {
    const d = new Date(startDate + 'T12:00:00Z');
    if (!isNaN(d)) return MONAMES[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }
  // Fallback: use order dates
  const dates = txOrders.map(o => o.date).filter(Boolean).sort();
  if (dates.length) {
    const first = new Date(dates[0] + 'T12:00:00Z');
    const last  = new Date(dates[dates.length-1] + 'T12:00:00Z');
    if (!isNaN(first)) {
      const mo = MONAMES[first.getUTCMonth()], yr = first.getUTCFullYear();
      if (first.getUTCMonth() === last.getUTCMonth()) return mo + ' ' + yr;
      return mo + '–' + MONAMES[last.getUTCMonth()] + ' ' + yr;
    }
  }
  return 'Unknown period';
}

// ---- Main crunch ----
function crunchData(txText, ordText) {
  const tx  = parseTransactionCSV(txText);
  const ord = parseOrdersCSV(ordText);

  const period = formatPeriod(tx.startDate, tx.orders);
  console.log('[CRUNCH] Period:', period, '| Orders:', tx.orders.length);

  const sum = (arr, fn) => arr.reduce((s, o) => s + fn(o), 0);

  const grossSales    = sum(tx.orders, o => o.gross);
  const netRevenue    = sum(tx.orders, o => o.net);
  const totalUnits    = sum(tx.orders, o => o.qty);
  const totalFvfFixed = sum(tx.orders, o => o.fvfFixed);
  const totalFvfVar   = sum(tx.orders, o => o.fvfVar);
  const totalRegFee   = sum(tx.orders, o => o.regFee);
  const totalFees     = totalFvfFixed + totalFvfVar + totalRegFee;
  const refundTotal   = sum(tx.refunds, r => r.net);
  const claimTotal    = sum(tx.claims,  c => c.net);
  const adjTotal      = sum(tx.adjustments, a => a.net);
  const otherFeeTotal = sum(tx.otherFees,   f => f.net);

  const promotedFees  = sum(
    tx.otherFees.filter(f => f.desc.toLowerCase().includes('promoted') || f.desc.toLowerCase().includes('ad fee')),
    f => f.net
  );

  const uniqueOrders = new Set(tx.orders.map(o => o.orderNum)).size;
  const payout = grossSales + refundTotal + claimTotal + totalFees + otherFeeTotal + adjTotal;

  console.log(`[CRUNCH] Gross: £${grossSales.toFixed(2)}, Net: £${netRevenue.toFixed(2)}, Fees: £${totalFees.toFixed(2)}`);

  // Per-SKU aggregation
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
    fee_pct: s.gross > 0 ? Math.abs(s.fees) / s.gross * 100 : 0,
    avg_val: s.orders > 0 ? s.gross / s.orders : 0,
  })).sort((a,b) => b.gross - a.gross);

  // Postage split
  let llCount = 0, t48Count = 0;
  for (const o of ord) {
    if (inferPostage(o.sku, o.qty) === 'll') llCount++; else t48Count++;
  }

  // Daily sales
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
      uniqueOrders,
      totalOrderLines: tx.orders.length,
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
      feeRate: grossSales > 0
        ? (Math.abs(totalFees) + Math.abs(otherFeeTotal)) / grossSales * 100
        : 0,
    },
    allSkus,
    daily,
    postage: { ll: llCount, t48: t48Count },
  };
}
