// LeakBack Live Lab — 浏览器内真实水力引擎（EPANET 2.3 WebAssembly）+ 定位网络推理
// 与 src/leak/simgen.py、localize.py 的定义逐条对应。
import { Project, Workspace, NodeProperty, LinkProperty, TimeParameter, CountType, InitHydOption, NodeType, LinkType, Option } from './vendor/epanet-js/index.js';

export async function createLab(inpUrl, modelUrl) {
  const ws = new Workspace(); await ws.loadModule();
  const inp = await (await fetch(inpUrl)).text();
  ws.writeFile('net.inp', inp);
  const m = new Project(ws); m.open('net.inp', 'r.rpt', 'o.bin');
  m.setTimeParameter(TimeParameter.Duration, 0);
  m.setTimeParameter(TimeParameter.ReportStart, 0);

  // ---------- 拓扑 ----------
  const nN = m.getCount(CountType.NodeCount), nL = m.getCount(CountType.LinkCount);
  const coords = {};
  let sec = '';
  for (const raw of inp.split(/\r?\n/)) {
    const line = raw.split(';')[0].trim(); if (!line) continue;
    if (line.startsWith('[')) { sec = line.toUpperCase(); continue; }
    if (sec === '[COORDINATES]') { const [id, x, y] = line.split(/\s+/); coords[id] = [+x, +y]; }
  }
  const nodes = [], junctions = [], sources = [];
  for (let i = 1; i <= nN; i++) {
    const id = m.getNodeId(i), type = m.getNodeType(i);
    nodes.push({ i, id, type, xy: coords[id] || [0, 0], elev: m.getNodeValue(i, NodeProperty.Elevation) });
    if (type === NodeType.Junction) junctions.push(i);
    if (type === NodeType.Reservoir) sources.push(i);
  }
  const links = [];
  for (let i = 1; i <= nL; i++) {
    const ln = m.getLinkNodes(i), a = ln.node1, b = ln.node2;
    links.push({ i, id: m.getLinkId(i), type: m.getLinkType(i), a, b, len: m.getLinkValue(i, LinkProperty.Length) || 1,
      rough0: m.getLinkValue(i, LinkProperty.Roughness), dia0: m.getLinkValue(i, LinkProperty.Diameter) });
  }
  const adj = Array.from({ length: nN + 1 }, () => []);
  for (const l of links) { adj[l.a].push([l.b, l.len, l.i]); adj[l.b].push([l.a, l.len, l.i]); }
  // 节点基础用水量（可能有多个类别）
  const dem0 = {};
  for (const j of junctions) {
    const k = m.getNumberOfDemands(j); dem0[j] = [];
    for (let d = 1; d <= k; d++) dem0[j].push([m.getBaseDemand(j, d), m.getDemandPattern(j, d)]);
  }
  const tank = nodes.find((n) => n.type === NodeType.Tank);
  const tankLevel0 = tank ? m.getNodeValue(tank.i, NodeProperty.TankLevel) : 0;

  // ---------- 模型 ----------
  const model = modelUrl ? await fetch(modelUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null) : null;
  const sensorIds = model ? model.sensors : ['n1','n4','n31','n54','n105','n114','n163','n188','n215','n229','n288','n296','n332','n342','n410','n415','n429','n458','n469','n495','n506','n516','n519','n549','n613','n636','n644','n679','n722','n726','n740','n752','n769'];
  const sensors = sensorIds.map((id) => m.getNodeIndex(id));
  const juncIdx = model ? model.nodes.map((id) => m.getNodeIndex(id)) : junctions;   // 网络输出第 k 类 → 引擎节点下标

  // ---------- 状态 ----------
  let hour = 3, world = null, solves = 0, solveMs = 0;

  function solve() {
    const t = performance.now();
    m.openH(); m.initH(InitHydOption.NoSave); m.runH();
    const p = new Float64Array(nN + 1);
    for (let i = 1; i <= nN; i++) p[i] = m.getNodeValue(i, NodeProperty.Pressure);
    let q = 0; for (const s of sources) q -= m.getNodeValue(s, NodeProperty.Demand);
    m.closeH();
    solves++; solveMs += performance.now() - t;
    return { p, q };
  }
  function setHour(h) { hour = h; m.setTimeParameter(TimeParameter.PatternStart, Math.round(h * 3600)); }
  function setMult(x) { m.setOption(Option.DemandMult, x); }
  function setEmitter(node, dmm) {
    // 孔口出流 q = Cd·A·sqrt(2g·p)，Cd=0.75；单位换成 m3/h / sqrt(m)
    const d = dmm / 1000, C = d > 0 ? 0.75 * Math.PI * d * d / 4 * Math.sqrt(2 * 9.81) * 3600 : 0;
    m.setNodeValue(node, NodeProperty.Emitter, C);
  }

  // 「真实小镇」：与训练同一分布的随机扰动（seed 可复现）
  function rngOf(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  function gauss(r) { return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r()); }
  function setWorld(seed) {
    world = seed;
    const r = seed == null ? null : rngOf(seed);
    for (const l of links) {
      if (l.type !== LinkType.Pipe) continue;
      m.setLinkValue(l.i, LinkProperty.Roughness, r ? l.rough0 * (0.9 + 0.2 * r()) : l.rough0);
      m.setLinkValue(l.i, LinkProperty.Diameter, r ? l.dia0 * (1 + Math.max(-0.1, Math.min(0.1, 0.04 * gauss(r)))) : l.dia0);
    }
    const typeMult = {};
    for (const j of junctions) dem0[j].forEach(([b, pat], d) => {
      if (r && !(pat in typeMult)) typeMult[pat] = 0.9 + 0.2 * r();
      m.setBaseDemand(j, d + 1, r ? b * (0.9 + 0.2 * r()) * typeMult[pat] : b);
    });
    if (tank) m.setNodeValue(tank.i, NodeProperty.TankLevel, r ? 2.4 + 1.5 * r() : tankLevel0);
  }

  // 一次「观测」：基线三次拟合 g，漏损一次，得到 33 维特征（与 simgen.py 相同）
  function observe(leak, noise = 0, rnd = Math.random) {
    const P = [], Q = [];
    for (const k of [0.85, 1.0, 1.15]) { setMult(k); const r = solve(); P.push(r.p); Q.push(r.q); }
    setMult(1);
    const qm = (Q[0] + Q[1] + Q[2]) / 3, qv = Q.reduce((s, q) => s + (q - qm) ** 2, 0);
    const g = sensors.map((s) => { const pm = (P[0][s] + P[1][s] + P[2][s]) / 3; return Q.reduce((acc, q, k) => acc + (q - qm) * (P[k][s] - pm), 0) / qv; });
    let p1 = P[1], q1 = Q[1];
    if (leak) { setEmitter(leak.node, leak.dmm); const r = solve(); p1 = r.p; q1 = r.q; setEmitter(leak.node, 0); }
    const dQ = q1 - Q[1];
    // 训练时 Q 用 m3/s，这里是 m3/h；g 用同一单位拟合，g·ΔQ 与单位无关
    const nz = () => noise ? noise * Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd()) : 0;
    const x = sensors.map((s, k) => (p1[s] - P[1][s]) - g[k] * dQ + nz());   // 压力表读数噪声（米）
    const drop = new Float64Array(nN + 1); for (let i = 1; i <= nN; i++) drop[i] = P[1][i] - p1[i];
    return { x, drop, leakFlow: dQ, base: P[1], press: p1 };
  }

  // 定位网络（sklearn MLP：ReLU, ReLU, softmax）
  function infer(x, which = 'M1') {
    if (!model.models[which]) which = 'M1';
    const M = model.models[which];
    let n = Math.hypot(...x); let h = x.map((v) => v / Math.max(n, 1e-9));
    for (let L = 0; L < M.W.length; L++) {
      const W = M.W[L], b = M.b[L], out = new Float64Array(b.length);
      for (let j = 0; j < b.length; j++) { let s = b[j]; for (let i = 0; i < h.length; i++) s += h[i] * W[i][j]; out[j] = L < M.W.length - 1 ? Math.max(0, s) : s; }
      h = out;
    }
    const mx = Math.max(...h); let z = 0; const e = h.map((v) => { const t = Math.exp(v - mx); z += t; return t; });
    const P = new Float64Array(model.nodes.length); M.classes.forEach((c, j) => (P[c] = e[j] / z));
    const order = Array.from(P.keys()).sort((a, b) => P[b] - P[a]);
    let cum = 0, set = [];
    for (const k of order) { set.push(k); cum += P[k]; if (cum >= M.thr) break; }
    return { P, order, set: set.map((k) => juncIdx[k]), best: juncIdx[order[0]], conf: P[order[0]] };
  }

  // 管网最短路距离（米）
  function dist(from) {
    const d = new Float64Array(nN + 1).fill(Infinity); d[from] = 0;
    const seen = new Uint8Array(nN + 1), heap = [[0, from]];
    while (heap.length) {
      let bi = 0; for (let i = 1; i < heap.length; i++) if (heap[i][0] < heap[bi][0]) bi = i;
      const [du, u] = heap.splice(bi, 1)[0]; if (seen[u]) continue; seen[u] = 1;
      for (const [v, w] of adj[u]) if (du + w < d[v]) { d[v] = du + w; heap.push([d[v], v]); }
    }
    return d;
  }

  // ---------- 处置：应急降压（调减压阀）与维修关管 ----------
  const prvs = links.filter((l) => l.type === LinkType.PRV).map((l) => ({ ...l, set0: m.getLinkValue(l.i, LinkProperty.InitSetting) }));
  const demandNodes = junctions.filter((j) => dem0[j].some(([b]) => b > 0));
  // 漏点出流 = 有漏时总入流 - 无漏时总入流（同一阀门设置下）
  function leakFlow(leak) { const a = solve().q; setEmitter(leak.node, leak.dmm); const b = solve(); setEmitter(leak.node, 0); return { q: b.q - a, p: b.p }; }
  function minPressure(p) { let v = Infinity; for (const j of demandNodes) v = Math.min(v, p[j]); return v; }
  // 在保证所有用户节点压力 ≥ floor 的前提下，逐个减压阀往下调（1 m 步长），找漏量最小的设定
  function pressurePlan(leak, floor = 20) {
    const base = leakFlow(leak), set = prvs.map((v) => v.set0);
    const apply = () => prvs.forEach((v, k) => m.setLinkValue(v.i, LinkProperty.InitSetting, set[k]));
    let best = base.q;
    for (let pass = 0; pass < 2; pass++) for (let k = 0; k < prvs.length; k++) {
      while (set[k] > 5) {
        set[k] -= 1; apply(); const r = leakFlow(leak);
        if (minPressure(r.p) < floor || r.q > best - 1e-6) { set[k] += 1; apply(); break; }
        best = r.q;
      }
    }
    const after = leakFlow(leak), minAfter = minPressure(after.p), minBefore = minPressure(base.p);
    const plan = prvs.map((v, k) => ({ id: v.id, from: v.set0, to: set[k], a: v.a, b: v.b })).filter((x) => x.to !== x.from);
    prvs.forEach((v) => m.setLinkValue(v.i, LinkProperty.InitSetting, v.set0));
    return { before: base.q, after: after.q, plan, minBefore, minAfter, floor };
  }
  // 维修时关闭一根管道：哪些用户节点压力跌破 floor
  function isolate(linkIdx, floor = 20) {
    const base = solve();
    m.setLinkValue(linkIdx, LinkProperty.InitStatus, 0);
    const r = solve();
    m.setLinkValue(linkIdx, LinkProperty.InitStatus, 1);
    const hit = demandNodes.filter((j) => r.p[j] < floor && base.p[j] >= floor);
    let lost = 0; for (const j of hit) lost += dem0[j].reduce((s, [b]) => s + b, 0);
    return { hit, lost };
  }

  setHour(hour); setWorld(null);
  return { m, nodes, links, adj, sensors, junctions, model, observe, infer, dist, setHour, setWorld, setEmitter, solve, prvs, pressurePlan, isolate, leakFlow, minPressure, rngOf,
    get hour() { return hour; }, get world() { return world; }, get stats() { return { solves, ms: solves ? solveMs / solves : 0 }; } };
}
