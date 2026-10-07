/* Dashboard de mercado — Dinámica
 * Lee en vivo dos Google Sheets públicos (endpoint gviz, JSON) y calcula todo en el navegador.
 * Para cambiar fuentes o agrupaciones, editar CONFIG.
 */
const CONFIG = {
  MAIN_SHEET: '1mtd9Dh5brapXTRqhEsup51hISI3rYMHq3cKBJjM5bok',
  GLOBAL_SHEET: '1KBSKerbOZ_L4xSxQcfR3LjEhCzhd8q0ut7Kmk4Zr0uw',
  RATES_START: '2024-01-01',          // inicio de la serie descargada para el gráfico de tasas
  // Grupos de Hist (Px) que entran en la tabla local, con el nombre a mostrar.
  // cf: columna de CFs a usar para el flujo ('H' = CF nominal en la moneda de cotización ARS, 'K' = HD en USD)
  LOCAL_GROUPS: [
    { key: 'Lecaps',    label: 'Lecaps',             cf: 'H' },
    { key: 'FRNs',      label: 'FRNs (T. Variable)', cf: 'H' },
    { key: 'CER',       label: 'CER',                cf: 'H' },
    { key: 'Bolis',     label: 'Bolis (USD-L)',      cf: 'H' },
    { key: 'Globales',  label: 'Globales',           cf: 'K' },
    { key: 'Bonares',   label: 'Bonares',            cf: 'K' },
    { key: 'Bopreales', label: 'Bopreales',          cf: 'K' },
  ],
  LOCAL_REFS: [
    { col: 'Índice CER',    label: 'Índice CER' },
    { col: 'FX',            label: 'FX (TC Oficial)' },
    { col: 'CCL',           label: 'CCL' },
    { col: 'Índice TAMAR',  label: 'Índice TAMAR' },
  ],
  GROUP_MARKERS: ['Lecaps', 'FRNs', 'Botes', 'CER', 'Duales', 'Bolis', 'Globales', 'Bonares', 'Bopreales', 'Referencias'],
  // Filtro de datos sucios: un bono con retorno fuera de este rango en el período se descarta del promedio
  OUTLIER: { '5d': 0.25, '30d': 0.5, '90d': 1.0, 'YTD': 2.0 },
  GLOBAL_LABELS: [ // [texto en la hoja (regex), nombre a mostrar]
    [/tesoro|treasur/i, 'Treasuries 10y'],
    [/alto rendimiento|high yield/i, 'Bonos de Alto Rendimiento'],
    [/usd.*emergentes|usd.*em/i, 'Bonos USD Emergentes'],
    [/moneda local/i, 'Bonos Moneda Local Emergentes'],
    [/s&p/i, 'S&P 500'],
    [/nasdaq/i, 'Nasdaq'],
    [/acciones.*emergentes/i, 'Acciones Emergentes'],
    [/brasil/i, 'Acciones Brasil'],
    [/oro|gold/i, 'Oro'],
    [/soja|soy/i, 'Soja'],
    [/crudo|oil/i, 'Crudo'],
    [/gnl|gas/i, 'GNL (Euro)'],
  ],
  // Series del gráfico de tasas. conv: cómo llevar el dato de la hoja a TEA decimal.
  RATES: [
    { name: 'TAMAR',     sheet: 'Hist (Px)',  col: 'TAMAR', conv: 'tna30pct' },
    { name: 'TIR TY30P', sheet: 'Hist (YTM)', col: 'TY30P', conv: 'tem' },
    { name: 'TIR DICP',  sheet: 'Hist (YTM)', col: 'DICP',  conv: 'tea' },
    { name: 'TIR GD35',  sheet: 'Hist (YTM)', col: 'GD35',  conv: 'tea' },
  ],
};

const PERIODS = ['5d', '30d', '90d', 'YTD'];
const DAY = 86400000;

/* ---------------- utilidades de datos ---------------- */
async function gviz(key, sheet, { range, tq } = {}) {
  let u = `https://docs.google.com/spreadsheets/d/${key}/gviz/tq?tqx=out:json&headers=0&sheet=${encodeURIComponent(sheet)}`;
  if (range) u += '&range=' + range;
  if (tq) u += '&tq=' + encodeURIComponent(tq);
  const res = await fetch(u);
  const t = await res.text();
  if (!t.includes('setResponse')) throw new Error(`No se pudo leer "${sheet}" (¿la hoja está compartida como "Cualquier persona con el enlace"?)`);
  const j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
  if (j.status === 'error') throw new Error(`"${sheet}": ${j.errors.map(e => e.detailed_message || e.message).join('; ')}`);
  return j.table;
}
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  ene: 0, abr: 3, ago: 7, set: 8, dic: 11 };
function num(c) {
  if (!c || c.v == null) return null;
  const v = c.v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const s = v.replace(/,/g, '').replace('%', '').trim();
    if (/^-?\d+(\.\d+)?$/.test(s)) return v.includes('%') ? +s / 100 : +s;
  }
  return null;
}
function dateOf(c) {
  if (!c || c.v == null) return null;
  const v = c.v;
  if (typeof v === 'string') {
    let m = /^Date\((\d+),(\d+),(\d+)/.exec(v);
    if (m) return Date.UTC(+m[1], +m[2], +m[3]);
    m = /^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/.exec(v.trim());
    if (m && MONTHS[m[2].toLowerCase()] != null) {
      let y = +m[3]; if (y < 100) y += 2000;
      return Date.UTC(y, MONTHS[m[2].toLowerCase()], +m[1]);
    }
  }
  return null;
}
const colLetter = i => { let s = ''; i += 1; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };
const isoDate = t => new Date(t).toISOString().slice(0, 10);

/* ---------------- Hist (Px): precios ---------------- */
async function loadPrices() {
  const hdr = (await gviz(CONFIG.MAIN_SHEET, 'Hist (Px)', { range: 'A2:HZ2' })).rows[0].c.map(c => (c && c.v != null ? String(c.v).trim() : ''));
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear() - 1, 11, 1)); // desde dic del año anterior (cubre YTD y 90d)
  const startStr = isoDate(Math.min(start.getTime(), Date.now() - 120 * DAY));
  const tbl = await gviz(CONFIG.MAIN_SHEET, 'Hist (Px)', { tq: `select * where B >= date '${startStr}'` });
  // grupos -> columnas
  const groups = {}; let cur = null;
  hdr.forEach((h, i) => {
    if (i < 3 || !h) return;
    if (CONFIG.GROUP_MARKERS.includes(h)) { cur = h; groups[cur] = []; return; }
    if (cur && !groups[cur].some(b => b.ticker === h)) groups[cur].push({ ticker: h, i });
  });
  // filas (dedupe por fecha; la fila "hoy" de arriba de la hoja se usa si no hay histórico de esa fecha)
  const byDate = new Map();
  tbl.rows.forEach(r => {
    const d = dateOf(r.c[1]); if (d == null) return;
    const row = { d, l: dateOf(r.c[2]) ?? d, px: r.c.map(num) };
    const prev = byDate.get(d);
    if (!prev) byDate.set(d, row);
    else row.px.forEach((v, i) => { if (prev.px[i] == null && v != null) prev.px[i] = v; });
  });
  const rows = [...byDate.values()].sort((a, b) => a.d - b.d);
  return { hdr, groups, rows };
}

/* ---------------- CFs ---------------- */
async function loadCFs() {
  const tbl = await gviz(CONFIG.MAIN_SHEET, 'CFs', { range: 'A1:K5000' });
  const map = {};
  tbl.rows.forEach(r => {
    const tk = r.c[1] && r.c[1].v != null ? String(r.c[1].v).trim() : '';
    const corte = dateOf(r.c[2]);
    if (!tk || corte == null) return;
    (map[tk] = map[tk] || []).push({ corte, pago: dateOf(r.c[3]), H: num(r.c[7]) || 0, K: num(r.c[10]) || 0 });
  });
  return map;
}
function cfsFor(cfs, ticker) {
  if (cfs[ticker]) return cfs[ticker];
  const base = ticker.replace(/[tms]$/, '');   // TTM26t, TY30Pm, D30O6s -> ticker base
  return cfs[base] || [];
}

/* ---------------- Retornos totales locales ---------------- */
function anchorIndex(rows, period) {
  const n = rows.length - 1, t1 = rows[n].d;
  if (period === '5d') return Math.max(0, n - 5);
  let target;
  if (period === '30d') target = t1 - 30 * DAY;
  else if (period === '90d') target = t1 - 90 * DAY;
  else target = Date.UTC(new Date(t1).getUTCFullYear() - 1, 11, 31);
  let idx = -1;
  for (let i = 0; i <= n; i++) if (rows[i].d <= target) idx = i;
  return idx;
}
function lastValid(rows, col, upto) { // último precio disponible en o antes de upto
  for (let i = upto; i >= 0; i--) { const v = rows[i].px[col]; if (v != null && v > 0) return i; }
  return -1;
}
function bondTR(rows, cfs, b, i0, i1, cfCol) {
  const p0 = rows[i0].px[b.i], p1 = rows[i1].px[b.i];
  if (!(p0 > 0) || !(p1 > 0)) return null;
  const l0 = rows[i0].l, l1 = rows[i1].l;
  // un flujo se cobra si al inicio el precio era "con cupón" (liq <= corte) y al final "ex cupón" (liq > corte)
  let cf = 0;
  for (const f of cfsFor(cfs, b.ticker)) if (f.corte >= l0 && f.corte < l1) cf += f[cfCol];
  return (p1 + cf) / p0 - 1;
}
// Índice encadenado: promedio diario de los bonos disponibles cada día, compuesto.
// Se usa sólo si ningún bono del grupo cotiza en ambos extremos del período (p.ej. Bolis YTD).
function chainTR(rows, cfs, bonds, i0, i1, cfCol) {
  let idx = 1, days = 0;
  for (let k = i0 + 1; k <= i1; k++) {
    const rs = [];
    for (const b of bonds) {
      const r = bondTR(rows, cfs, b, k - 1, k, cfCol);
      if (r != null && Math.abs(r) < 0.15) rs.push(r);
    }
    if (rs.length) { idx *= 1 + rs.reduce((s, x) => s + x, 0) / rs.length; days++; }
  }
  return days ? idx - 1 : null;
}
function computeLocal(P, cfs) {
  const { rows, groups, hdr } = P;
  const n = rows.length - 1;
  const out = [];
  for (const g of CONFIG.LOCAL_GROUPS) {
    const bonds = groups[g.key] || [];
    const res = { label: g.label, values: {}, detail: {} };
    for (const per of PERIODS) {
      const i0 = anchorIndex(rows, per);
      const list = [];
      if (i0 >= 0) for (const b of bonds) {
        const r = bondTR(rows, cfs, b, i0, n, g.cf);
        if (r != null && Math.abs(r) <= CONFIG.OUTLIER[per]) list.push({ t: b.ticker, r });
      }
      if (list.length) res.values[per] = list.reduce((s, x) => s + x.r, 0) / list.length;
      else if (i0 >= 0) { res.values[per] = chainTR(rows, cfs, bonds, i0, n, g.cf); if (res.values[per] != null) res.chained = (res.chained || []).concat(per); }
      else res.values[per] = null;
      res.detail[per] = list.sort((a, b) => b.r - a.r);
    }
    out.push(res);
  }
  for (const ref of CONFIG.LOCAL_REFS) {
    const col = hdr.indexOf(ref.col);
    const res = { label: ref.label, values: {}, detail: {} };
    for (const per of PERIODS) {
      const i0 = anchorIndex(rows, per);
      const a = i0 >= 0 ? lastValid(rows, col, i0) : -1, z = lastValid(rows, col, n);
      res.values[per] = col >= 0 && a >= 0 && z >= 0 ? rows[z].px[col] / rows[a].px[col] - 1 : null;
    }
    out.push(res);
  }
  const anchors = Object.fromEntries(PERIODS.map(p => [p, rows[anchorIndex(rows, p)]?.d]));
  return { rows: out, asOf: rows[n].d, anchors };
}

/* ---------------- Internacionales ---------------- */
async function loadGlobal() {
  const tbl = await gviz(CONFIG.GLOBAL_SHEET, 'Global', { range: 'C1:H40' });
  const out = [];
  tbl.rows.forEach(r => {
    const name = r.c[0] && r.c[0].v ? String(r.c[0].v).trim() : '';
    const vals = [2, 3, 4, 5].map(i => num(r.c[i]));
    if (!name || vals.every(v => v == null)) return;
    const m = CONFIG.GLOBAL_LABELS.find(([re]) => re.test(name));
    out.push({ label: m ? m[1] : name, src: name, values: Object.fromEntries(PERIODS.map((p, k) => [p, vals[k]])) });
  });
  return out;
}

/* ---------------- Curvas (hoja Panel) ---------------- */
// columnas de Panel (0 = A)
const PANEL_SECTIONS = ['Pesos', 'Lecaps', 'Botes', 'CER', 'FRNs', 'Duales', 'Bolis', 'Futuros', 'Sintéticos ARS', 'Sintéticos USD',
  'Dólares', 'Bonares', 'Globales', 'Bopreales', 'Badlar', 'Provinciales', 'ONs'];
const PANEL = { ticker: 1, price: 3, cerTEA: 12, spread: 15, tna: 16, fijaTEA: 18, tem: 19, dlTEA: 23, hdTEA: 26, mcd: 29, mat: 37 };
async function loadPanel() {
  const tbl = await gviz(CONFIG.MAIN_SHEET, 'Panel', { range: 'A1:AL300' });
  const sections = {}; let cur = null;
  tbl.rows.forEach(r => {
    const tk = r.c[PANEL.ticker] && r.c[PANEL.ticker].v != null ? String(r.c[PANEL.ticker].v).trim() : '';
    if (!tk) return;
    const price = r.c[PANEL.price] && r.c[PANEL.price].v;
    if (PANEL_SECTIONS.includes(tk)) { cur = tk; sections[cur] = sections[cur] || []; return; }
    if (price == null || price === '') return;
    if (!cur) return;
    const g = k => num(r.c[PANEL[k]]);
    sections[cur].push({ t: tk, mcd: g('mcd'), cer: g('cerTEA'), fija: g('fijaTEA'), dl: g('dlTEA'), hd: g('hdTEA'), spread: g('spread'), mat: r.c[PANEL.mat] && r.c[PANEL.mat].f });
  });
  return sections;
}
function buildCurves(S) {
  const pts = (sec, y, filter = () => true) => (S[sec] || []).filter(filter).filter(b => b[y] != null && b.mcd != null && b.mcd > 0).map(b => ({ t: b.t, x: b.mcd, y: b[y], mat: b.mat, spread: b.spread }));
  const notSuffix = b => !/[tms]$/.test(b.t);
  return [
    { id: 'cer', title: 'Curva CER', ylab: 'TIR real (TEA)', series: [{ name: 'CER', data: pts('CER', 'cer', b => !/^TXM/.test(b.t)) }] },
    { id: 'duales', title: 'Duales / CER', ylab: 'TIR real (TEA)', series: [
        { name: 'Duales TAMAR/CER', data: pts('CER', 'cer', b => /^TXM/.test(b.t)) },
        { name: 'CER', data: pts('CER', 'cer', b => !/^TXM/.test(b.t)) } ] },
    { id: 'fija', title: 'Tasa Fija', ylab: 'TIR (TEA)', series: [
        { name: 'Lecaps / Boncaps', data: pts('Lecaps', 'fija') },
        { name: 'Bonte', data: pts('Botes', 'fija', notSuffix) } ] },
    { id: 'bontam', title: 'Bontams', ylab: 'TIR estimada (TEA)', series: [{ name: 'Bontams', data: pts('FRNs', 'fija', b => /^TM/.test(b.t) && notSuffix(b)) }] },
    { id: 'bolis', title: 'Bolis & Sintéticos', ylab: 'TIR USD-linked (TEA)', series: [
        { name: 'Bolis', data: pts('Bolis', 'dl') },
        { name: 'Sintéticos (Lecap + futuro)', data: pts('Sintéticos USD', 'dl') } ] },
    { id: 'hd', title: 'Hard Dollar', ylab: 'TIR USD (TEA)', series: [
        { name: 'Globales', data: pts('Globales', 'hd') },
        { name: 'Bonares', data: pts('Bonares', 'hd') },
        { name: 'Bopreales', data: pts('Bopreales', 'hd') } ] },
  ];
}

/* ---------------- Tasas históricas ---------------- */
async function loadRates() {
  const bySheet = {};
  CONFIG.RATES.forEach(s => (bySheet[s.sheet] = bySheet[s.sheet] || []).push(s));
  const out = [];
  for (const [sheet, list] of Object.entries(bySheet)) {
    const hdr = (await gviz(CONFIG.MAIN_SHEET, sheet, { range: 'A2:HZ2' })).rows[0].c.map(c => (c && c.v != null ? String(c.v).trim() : ''));
    const cols = list.map(s => hdr.indexOf(s.col));
    const sel = ['B', ...cols.filter(i => i >= 0).map(colLetter)].join(', ');
    const tbl = await gviz(CONFIG.MAIN_SHEET, sheet, { tq: `select ${sel} where B >= date '${CONFIG.RATES_START}' order by B` });
    list.forEach((s, k) => {
      if (cols[k] < 0) return;
      const j = 1 + cols.filter(i => i >= 0).indexOf(cols[k]);
      const seen = new Map();
      tbl.rows.forEach(r => {
        const d = dateOf(r.c[0]); let v = num(r.c[j]);
        if (d == null || v == null) return;
        v = convRate(v, s.conv);
        if (v == null || !Number.isFinite(v) || v <= -0.5 || v > 5) return;
        seen.set(d, v);
      });
      out.push({ name: s.name, data: [...seen.entries()].sort((a, b) => a[0] - b[0]) });
    });
  }
  return CONFIG.RATES.map(s => out.find(o => o.name === s.name)).filter(Boolean);
}
function convRate(v, conv) {
  switch (conv) {
    case 'tem': return Math.pow(1 + v, 12) - 1;
    case 'tna30pct': { const tna = v > 1 ? v / 100 : v; return Math.pow(1 + tna * 30 / 365, 365 / 30) - 1; }
    default: return v > 1 ? v / 100 : v;
  }
}

window.DashData = { loadPrices, loadCFs, computeLocal, loadGlobal, loadPanel, buildCurves, loadRates, PERIODS, CONFIG };
