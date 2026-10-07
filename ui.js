/* Render del dashboard. Depende de app.js (window.DashData) y ECharts. */
(() => {
  const D = window.DashData;
  const $ = s => document.querySelector(s);
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const SERIES_VARS = ['--green', '--blue', '--amber', '--violet'];
  const palette = () => SERIES_VARS.map(css);
  const nf = (d) => new Intl.NumberFormat('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const pct = (v, d = 1, sign = true) => {
    if (v == null || !Number.isFinite(v)) return '—';
    const x = +(v * 100).toFixed(d);
    return (sign && x > 0 ? '+' : '') + nf(d).format(x === 0 ? 0 : x) + '%';
  };
  const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const fdate = t => { if (t == null) return '—'; const d = new Date(t); return `${String(d.getUTCDate()).padStart(2, '0')}-${MES[d.getUTCMonth()]}-${String(d.getUTCFullYear()).slice(2)}`; };
  const charts = [];
  let state = { local: null, global: null, curves: null, rates: null, range: '1A', hidden: new Set() };

  /* ---------- tooltip propio para tablas ---------- */
  const tip = $('#tip');
  function showTip(html, ev) {
    tip.innerHTML = html; tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let x = ev.clientX + 14, y = ev.clientY + 14;
    if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - 14;
    if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - 14;
    tip.style.left = Math.max(8, x) + 'px'; tip.style.top = Math.max(8, y) + 'px';
  }
  const hideTip = () => { tip.hidden = true; };

  /* ---------- tablas ---------- */
  function heat(v, maxAbs) {
    if (v == null || !maxAbs) return '';
    const a = 0.07 + 0.38 * Math.min(1, Math.abs(v) / maxAbs);
    return `background: rgba(var(${v >= 0 ? '--pos' : '--neg'}), ${a.toFixed(3)})`;
  }
  function renderTable(el, rows, opts = {}) {
    const P = D.PERIODS;
    const head = ['', ...P.map(p => p === '5d' ? '5d' : p)];
    el.querySelector('thead').innerHTML = '<tr>' + head.map(h => `<th>${h}</th>`).join('') + '</tr>';
    const maxAbs = Object.fromEntries(P.map(p => [p, Math.max(...rows.map(r => Math.abs(r.values[p] ?? 0)))]));
    const body = [];
    rows.forEach((r, i) => {
      if (opts.sepBefore && opts.sepBefore.includes(i)) body.push('<tr class="sep"><td colspan="5"></td></tr>');
      body.push('<tr>' + `<td>${r.label}</td>` + P.map(p => {
        const v = r.values[p];
        const ch = r.chained && r.chained.includes(p) ? '<sup class="ch">*</sup>' : '';
        const det = r.detail && (r.detail[p]?.length || ch) ? ' has-detail' : '';
        return `<td class="v${v == null ? ' na' : ''}${det}" data-i="${i}" data-p="${p}" style="${heat(v, maxAbs[p])}">${pct(v)}${ch}</td>`;
      }).join('') + '</tr>');
    });
    el.querySelector('tbody').innerHTML = body.join('');
    if (opts.anchors) {
      el.querySelectorAll('td.has-detail').forEach(td => {
        td.addEventListener('mousemove', ev => {
          const r = rows[+td.dataset.i], p = td.dataset.p, det = r.detail[p] || [];
          let h = `<div class="t">${r.label} · ${p}</div><div class="r"><span>Desde</span><span>${fdate(opts.anchors[p])}</span></div>`;
          if (r.chained && r.chained.includes(p)) h += `<div class="r"><span>Método</span><span>Índice encadenado</span></div><div class="muted" style="margin-top:4px">Ningún bono del grupo cotiza en ambos extremos; se encadena el promedio diario.</div>`;
          else {
            h += `<div class="r"><span>Bonos</span><span>${det.length}</span></div>`;
            const show = det.length <= 8 ? det : [...det.slice(0, 4), null, ...det.slice(-3)];
            h += '<div style="margin-top:4px">' + show.map(x => x ? `<div class="r"><span>${x.t}</span><span>${pct(x.r)}</span></div>` : '<div class="r"><span>…</span><span></span></div>').join('') + '</div>';
          }
          showTip(h, ev);
        });
        td.addEventListener('mouseleave', hideTip);
      });
    }
  }

  /* ---------- ECharts base ---------- */
  function baseAxis() {
    return {
      axisLine: { lineStyle: { color: css('--border-strong') } }, axisTick: { show: false },
      axisLabel: { color: css('--axis'), fontFamily: 'Inter', fontSize: 11 },
      splitLine: { lineStyle: { color: css('--grid') } }, nameTextStyle: { color: css('--muted'), fontSize: 11, fontFamily: 'Inter' },
    };
  }
  function tooltipBase() {
    return { backgroundColor: css('--card-solid'), borderColor: css('--border-strong'), borderWidth: 1, padding: [8, 10],
      textStyle: { color: css('--text'), fontFamily: 'Inter', fontSize: 12 }, extraCssText: 'border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.3);' };
  }
  function mkChart(el) { const c = echarts.init(el, null, { renderer: 'svg' }); charts.push(c); return c; }

  /* ---------- curvas ---------- */
  function logFit(pts) {
    const p = pts.filter(q => q.x > 0);
    if (p.length < 3) return null;
    const n = p.length, lx = p.map(q => Math.log(q.x));
    const mx = lx.reduce((s, x) => s + x, 0) / n, my = p.reduce((s, q) => s + q.y, 0) / n;
    let sxy = 0, sxx = 0; p.forEach((q, i) => { sxy += (lx[i] - mx) * (q.y - my); sxx += (lx[i] - mx) ** 2; });
    if (!sxx) return null;
    const b = sxy / sxx, a = my - b * mx;
    // si el ajuste explica poco (R² < 0,3) no se dibuja
    const ssr = p.reduce((s, q, i) => s + (q.y - (a + b * lx[i])) ** 2, 0), sst = p.reduce((s, q) => s + (q.y - my) ** 2, 0);
    if (!sst || 1 - ssr / sst < 0.3) return null;
    const xmin = Math.min(...p.map(q => q.x)), xmax = Math.max(...p.map(q => q.x));
    const out = []; for (let k = 0; k <= 40; k++) { const x = xmin * Math.pow(xmax / xmin, k / 40); out.push([x, a + b * Math.log(x)]); }
    return out;
  }
  function renderCurves(curves) {
    const host = $('#curves');
    host.innerHTML = '';
    curves.forEach(cv => {
      const card = document.createElement('div');
      card.className = 'card curve-card';
      const multi = cv.series.filter(s => s.data.length).length > 1;
      const cols = palette();
      card.innerHTML = `<div class="card-head"><h3>${cv.title}</h3>${multi ? '<div class="legend">' + cv.series.filter(s => s.data.length).map((s, k) => `<button tabindex="-1"><i class="dot" style="background:${cols[cv.series.indexOf(s)]}"></i>${s.name}</button>`).join('') + '</div>' : `<small>${cv.series[0].data.length} bonos</small>`}</div><div class="chart"></div>`;
      host.appendChild(card);
      const ch = mkChart(card.querySelector('.chart'));
      const series = [];
      cv.series.forEach((s, k) => {
        if (!s.data.length) return;
        const col = cols[k];
        series.push({ name: s.name, type: 'scatter', symbolSize: 9, itemStyle: { color: col, borderColor: css('--bg-2'), borderWidth: 1.5 },
          data: s.data.map(p => ({ value: [p.x, p.y], t: p.t, mat: p.mat, spread: p.spread })),
          label: { show: true, formatter: d => d.data.t, position: 'top', distance: 4, fontSize: 10, color: css('--text-2'), fontFamily: 'Inter' },
          labelLayout: { hideOverlap: true }, emphasis: { scale: 1.4, focus: 'series' }, z: 3 });
        const fit = logFit(s.data);
        if (fit) series.push({ name: s.name + ' (ajuste)', type: 'line', data: fit, showSymbol: false, silent: true, smooth: true,
          lineStyle: { color: col, width: 2, opacity: 0.55, type: k ? 'dashed' : 'solid' }, z: 2, tooltip: { show: false } });
      });
      const allY = cv.series.flatMap(s => s.data.map(p => p.y));
      const yPad = (Math.max(...allY) - Math.min(...allY)) * 0.15 || 0.01;
      ch.setOption({
        animation: false,
        grid: { left: 48, right: 14, top: 22, bottom: 34 },
        tooltip: { ...tooltipBase(), trigger: 'item', formatter: d => {
          const x = d.data; if (!x || !x.t) return '';
          return `<b>${x.t}</b> <span style="color:${css('--muted')}">${d.seriesName}</span><br>TIR: <b>${pct(x.value[1], 2, false)}</b><br>Duration: ${nf(2).format(x.value[0])} años${x.mat ? '<br>Vto: ' + x.mat : ''}${x.spread != null && cv.id === 'bontam' ? '<br>Spread: ' + pct(x.spread, 2) : ''}`;
        } },
        xAxis: { ...baseAxis(), type: 'value', name: 'Duration (años)', nameLocation: 'middle', nameGap: 24, min: 0, scale: false,
          axisLabel: { ...baseAxis().axisLabel, formatter: v => nf(1).format(v) } },
        yAxis: { ...baseAxis(), type: 'value', scale: true, min: v => +(v.min - yPad).toFixed(4), max: v => +(v.max + yPad).toFixed(4),
          axisLabel: { ...baseAxis().axisLabel, formatter: v => nf(0).format(v * 100) + '%' } },
        series,
      });
    });
  }

  /* ---------- tasas ---------- */
  function rangeStart(r, last) {
    const d = new Date(last);
    if (r === '3M') d.setUTCMonth(d.getUTCMonth() - 3);
    else if (r === '6M') d.setUTCMonth(d.getUTCMonth() - 6);
    else if (r === '1A') d.setUTCFullYear(d.getUTCFullYear() - 1);
    else if (r === 'YTD') return Date.UTC(d.getUTCFullYear() - 1, 11, 31);
    else return null;
    return d.getTime();
  }
  let ratesChart = null;
  function renderRates(rates) {
    const el = $('#rates-chart');
    if (!ratesChart) ratesChart = mkChart(el);
    const cols = palette();
    const last = Math.max(...rates.map(s => s.data.at(-1)?.[0] ?? 0));
    const min = rangeStart(state.range, last);
    // eje Y ajustado a lo visible
    let lo = Infinity, hi = -Infinity;
    rates.forEach(s => { if (state.hidden.has(s.name)) return; s.data.forEach(([t, v]) => { if (min == null || t >= min) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }); });
    const pad = (hi - lo) * 0.08 || 0.01;
    ratesChart.setOption({
      animation: false,
      grid: { left: 52, right: 16, top: 16, bottom: 30 },
      tooltip: { ...tooltipBase(), trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: css('--border-strong') } },
        formatter: ps => `<b>${fdate(ps[0].value[0])}</b><br>` + ps.map(p => `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:6px"></span>${p.seriesName}: <b>${pct(p.value[1], 2, false)}</b>`).join('<br>') },
      xAxis: { ...baseAxis(), type: 'time', min: min ?? 'dataMin', max: 'dataMax', splitLine: { show: false },
        axisLabel: { ...baseAxis().axisLabel, hideOverlap: true, formatter: v => { const d = new Date(v); return `${MES[d.getUTCMonth()]}-${String(d.getUTCFullYear()).slice(2)}`; } } },
      yAxis: { ...baseAxis(), type: 'value', min: Number.isFinite(lo) ? lo - pad : null, max: Number.isFinite(hi) ? hi + pad : null,
        axisLabel: { ...baseAxis().axisLabel, formatter: v => nf(0).format(v * 100) + '%' } },
      series: rates.map((s, k) => ({ name: s.name, type: 'line', showSymbol: false, symbol: 'circle', symbolSize: 7, data: s.data,
        lineStyle: { width: 2, color: cols[k] }, itemStyle: { color: cols[k], borderColor: css('--bg-2'), borderWidth: 2 },
        emphasis: { focus: 'none' }, connectNulls: true })),
      legend: { show: false, selected: Object.fromEntries(rates.map(s => [s.name, !state.hidden.has(s.name)])) },
    }, { replaceMerge: ['series'] });
    // leyenda HTML con último valor
    $('#rates-legend').innerHTML = rates.map((s, k) => `<button data-n="${s.name}" class="${state.hidden.has(s.name) ? 'off' : ''}"><i style="background:${cols[k]}"></i>${s.name} <b>${pct(s.data.at(-1)?.[1], 1, false)}</b></button>`).join('');
    $('#rates-legend').querySelectorAll('button').forEach(b => b.onclick = () => {
      const n = b.dataset.n; state.hidden.has(n) ? state.hidden.delete(n) : state.hidden.add(n); renderRates(state.rates);
    });
    $('#rates-foot').textContent = `TAMAR: TNA convertida a TEA (capitalización 30 días). TY30P: TEM de la hoja anualizada. DICP: TIR real; GD35: TIR en USD. Último dato: ${fdate(last)}.`;
  }
  $('#rates-range').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    state.range = b.dataset.r;
    $('#rates-range').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    if (state.rates) renderRates(state.rates);
  });

  /* ---------- errores ---------- */
  const errors = [];
  function addError(where, e) {
    console.error(where, e);
    errors.push(`<b>${where}:</b> ${e.message || e}`);
    const el = $('#error'); el.innerHTML = errors.join('<br>'); el.hidden = false;
  }
  function failBox(sel, msg) { const el = $(sel); if (el) el.innerHTML = `<tr><td class="na" colspan="5">${msg}</td></tr>`; }

  /* ---------- carga ---------- */
  async function loadAll() {
    errors.length = 0; $('#error').hidden = true;
    const btn = $('#refresh'); btn.classList.add('spin'); btn.disabled = true;
    const jobs = [
      (async () => {
        const [P, C] = await Promise.all([D.loadPrices(), D.loadCFs()]);
        state.local = D.computeLocal(P, C);
        renderTable($('#tbl-local'), state.local.rows, { sepBefore: [D.CONFIG.LOCAL_GROUPS.length], anchors: state.local.anchors });
        const ch = state.local.rows.some(r => r.chained);
        $('#local-foot').innerHTML = `Desde: 5d ${fdate(state.local.anchors['5d'])} · 30d ${fdate(state.local.anchors['30d'])} · 90d ${fdate(state.local.anchors['90d'])} · YTD ${fdate(state.local.anchors.YTD)}. Pasá el mouse sobre una celda para ver el detalle por bono.` + (ch ? ' <sup class="ch">*</sup> Índice encadenado: ningún bono del grupo cotiza en todo el período.' : '');
        const a = $('#asof'); a.textContent = 'Datos al ' + fdate(state.local.asOf); a.classList.add('live');
      })().catch(e => { addError('Retornos locales', e); failBox('#tbl-local tbody', 'No disponible'); }),
      (async () => { state.global = await D.loadGlobal(); renderTable($('#tbl-global'), state.global); })()
        .catch(e => { addError('Activos internacionales', e); failBox('#tbl-global tbody', 'No disponible: revisar que la planilla esté compartida como “Cualquier persona con el enlace”.'); }),
      (async () => { state.curves = D.buildCurves(await D.loadPanel()); renderCurves(state.curves); })()
        .catch(e => addError('Curvas', e)),
      (async () => { state.rates = await D.loadRates(); renderRates(state.rates); })()
        .catch(e => addError('Tasas históricas', e)),
    ];
    await Promise.all(jobs);
    btn.classList.remove('spin'); btn.disabled = false;
  }

  function rerenderCharts() {
    charts.forEach(c => c.dispose()); charts.length = 0; ratesChart = null;
    if (state.curves) renderCurves(state.curves);
    if (state.rates) renderRates(state.rates);
  }
  $('#refresh').onclick = loadAll;
  $('#theme').onclick = () => {
    const root = document.documentElement;
    root.dataset.theme = root.dataset.theme === 'light' ? 'dark' : 'light';
    try { localStorage.setItem('dyn-theme', root.dataset.theme); } catch (e) {}
    rerenderCharts();
  };
  let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => charts.forEach(c => c.resize()), 120); });
  // refresco automático cada 10 minutos mientras la pestaña está visible
  setInterval(() => { if (document.visibilityState === 'visible') loadAll(); }, 10 * 60 * 1000);
  loadAll();
})();
