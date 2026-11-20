/* 三个排版样例共用的绘图函数：德州地图、小镇管网、成绩条。数据全部来自 ../data.js、../console/data.js、../site/results.js。 */
(function () {
  const TX = window.LEAKBACK, LT = window.LB2, R = window.LBR, NS = 'http://www.w3.org/2000/svg';
  const mk = (t, a, p) => { const n = document.createElementNS(NS, t); for (const k in a) n.setAttribute(k, a[k]); if (p) p.appendChild(n); return n; };
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const t0 = new Date('2019-01-01T00:00:00').getTime(), STEP = 12 * 3600e3, N = 730;
  const idx = (s) => Math.round((new Date(s.replace(' ', 'T')).getTime() - t0) / STEP);
  const zAt = new Array(N).fill(null); LT.t.forEach((s, k) => { const i = idx(s); if (i >= 0 && i < N) zAt[i] = LT.z[k]; });
  const alarms = LT.alarms.map((a) => ({ ...a, i: idx(a.t) }));
  // 漏水量原本按「监测时段」排列（有学习期空档），这里展开成全年每 12 小时一格，空档沿用上一格
  const tIdx = LT.t.map(idx);
  const leaks = LT.leaks.filter((l) => !l.carry).map((l) => {
    const full = new Array(N).fill(null);
    tIdx.forEach((i, k) => { if (i >= 0 && i < N) full[i] = l.flow[k]; });
    let last = 0; for (let i = 0; i < N; i++) { if (full[i] == null) full[i] = last; else last = full[i]; }
    const si = Math.max(0, idx(l.start)), ei = Math.min(N - 1, idx(l.end));
    for (let i = 0; i < N; i++) if (i < si || i > ei) full[i] = 0;
    return { ...l, flow: full, si, ei };
  });
  const pipeById = Object.fromEntries(LT.pipes.map((p) => [p.id, p]));
  const pathOf = (ids) => ids.map((id) => pipeById[id]).filter(Boolean).map((p) => 'M' + p.p.map((q) => q.join(',')).join('L')).join('');

  function texas(svg, o = {}) {
    const c = Object.assign({ hi: 'var(--blue)', mid: 'var(--blue-2)', no: 'var(--tx-no)', dc: 'var(--ink)', stroke: '#fff', labels: true, dots: true, labFill: '#fff' }, o);
    svg.setAttribute('viewBox', `-10 -10 ${TX.meta.width + 20} ${TX.meta.height + 20}`);
    TX.regions.forEach((r) => {
      const use = r.dcShare * TX.meta.harc.y2025, x = use > 0 ? r.recov / use : 0;
      mk('path', { d: r.path, fill: use <= 0 ? c.no : x >= 2 ? c.hi : c.mid, stroke: c.stroke, 'stroke-width': 2.4 }, svg);
    });
    if (c.dots) TX.dcs.forEach((d) => mk('circle', { cx: d.x, cy: d.y, r: (2.4 + 12 * Math.sqrt(d.share)).toFixed(1), fill: c.dc, stroke: '#fff', 'stroke-width': 1.2 }, svg));
    if (c.labels) TX.regions.filter((r) => r.dcShare > 0.02).forEach((r) => { const t = mk('text', { x: r.lx, y: r.ly, 'text-anchor': 'middle', fill: c.labFill, style: 'font:800 24px var(--disp)' }, svg); const x = r.recov / (r.dcShare * TX.meta.harc.y2025); t.textContent = (x >= 10 ? x.toFixed(0) : x.toFixed(1)) + '×'; });
  }

  function town(svg, o = {}) {
    const c = Object.assign({ i: 327, reveal: true, loc: true, pipe: 'var(--pipe)', sensorR: 8, labels: true, pad: 20, aiText: 'AI', distText: (m) => m + ' m' }, o);
    svg.setAttribute('viewBox', `${-c.pad} ${-c.pad} ${LT.meta.width + 2 * c.pad} ${LT.meta.height + 2 * c.pad}`);
    const g = mk('g', {}, svg), bk = { a: [], b: [], c: [] };
    LT.pipes.forEach((p) => { const k = p.d >= 180 ? 'a' : p.d >= 110 ? 'b' : 'c'; bk[k].push('M' + p.p.map((q) => q.join(',')).join('L')); });
    [['c', 1.2], ['b', 2], ['a', 3.2]].forEach(([k, w]) => mk('path', { d: bk[k].join(''), fill: 'none', stroke: c.pipe, 'stroke-width': w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g));
    const a = alarms.filter((x) => x.i <= c.i && c.i - x.i < 12).pop();
    if (c.loc && a && a.loc && a.loc.set_pipes) mk('path', { d: pathOf(a.loc.set_pipes), fill: 'none', stroke: 'var(--blue)', 'stroke-width': 7, 'stroke-opacity': .22, 'stroke-linecap': 'round' }, g);
    const z = zAt[c.i];
    LT.sensors.forEach((s, k) => {
      const v = z ? Math.max(-1, Math.min(0, z[k] / 4)) : 0;
      mk('circle', { cx: s.xy[0], cy: s.xy[1], r: z && z[k] < -2 ? c.sensorR + 2 : c.sensorR, fill: z ? `oklch(${(0.93 + 0.30 * v).toFixed(3)} ${(0.01 - 0.18 * v).toFixed(3)} 42)` : 'oklch(0.86 0.01 250)', stroke: '#fff', 'stroke-width': 2.2 }, g);
    });
    if (c.reveal) leaks.filter((l) => l.si <= c.i && c.i <= l.ei).forEach((l) => mk('circle', { cx: l.xy[0], cy: l.xy[1], r: 7 + Math.sqrt(l.flow[c.i] || 0) * 1.4, fill: 'var(--leak)', stroke: '#fff', 'stroke-width': 2.5 }, g));
    if (c.loc && a && a.loc) {
      const xy = LT.nodes[a.loc.pred_node];
      if (xy) {
        const tl = c.reveal && leaks.find((l) => l.id === a.loc.nearest_true);
        if (tl) { mk('line', { x1: xy[0], y1: xy[1], x2: tl.xy[0], y2: tl.xy[1], stroke: 'var(--leak)', 'stroke-width': 1.6, 'stroke-dasharray': '4 4' }, g); if (c.labels) { const t = mk('text', { x: tl.xy[0] + 12, y: tl.xy[1] + 24, fill: 'var(--leak)', style: 'font:700 15px var(--ui);paint-order:stroke;stroke:#fff;stroke-width:5px;stroke-linejoin:round' }, g); t.textContent = c.distText(a.loc.dist_m); } }
        mk('circle', { cx: xy[0], cy: xy[1], r: 17, fill: 'none', stroke: 'var(--blue)', 'stroke-width': 3 }, g);
        mk('circle', { cx: xy[0], cy: xy[1], r: 4.5, fill: 'var(--blue)' }, g);
        if (c.labels) { const t = mk('text', { x: xy[0] + 24, y: xy[1] - 14, fill: 'var(--blue)', style: 'font:700 15px var(--ui);paint-order:stroke;stroke:#fff;stroke-width:5px;stroke-linejoin:round' }, g); t.textContent = c.aiText; }
      }
    }
    return a;
  }

  function sensorSeries(sensorId, iFrom, iTo) {
    const k = LT.sensors.findIndex((s) => s.id === sensorId);
    const out = [];
    for (let i = iFrom; i <= iTo; i++) out.push(zAt[i] ? zAt[i][k] : null);
    return out;
  }

  window.KIT = { TX, LT, R, mk, fmt, texas, town, alarms, leaks, zAt, idx, N, t0, STEP, sensorSeries,
    fixBG: TX.meta.recov, useBG: TX.meta.harc.y2025, chosen: R.methods[R.chosen], classic: R.methods.B0_nominal_cosine };
})();
