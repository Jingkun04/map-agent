// ===================== GAME-MAP VIEW (top-down render + fog of war + icons) =====================
// Renders the same 3D scene with a slightly tilted orthographic camera (plan oblique), then
// post-processes the image on a 2D canvas: explored-area mask, grid, vignette, icons, labels.
const GM = {
  size: 1600, tilt: 0.34, fog: true, key: null, cam: null, icons: [], hover: null, zoom: 1, center: null, focus: null,
  ink: "#f2e7d2", gold: "#d9ae63", dim: "rgba(238,226,203,0.72)",
};
const GM_ICON = {
  town: { kind: "waypoint" }, cathedral: { kind: "poi" }, church: { kind: "poi" }, chapel: { kind: "poi" },
  hospital: { kind: "poi" }, clinic: { kind: "poi" }, market: { kind: "trade" }, cityhall: { kind: "poi" },
  library: { kind: "poi" }, school: { kind: "poi" }, station: { kind: "poi" }, factory: { kind: "poi" },
  keep: { kind: "poi" }, lighthouse: { kind: "poi" }, plaza: { kind: "quest" },
};

function gmCanvas() { return $("#gmCanvas"); }
function gmCamera() {
  const half = V3.SIZE * 0.52 / GM.zoom, t = GM.tilt, D = 2600;
  const c = GM.center || { x: 0, z: 0 };
  const cam = new THREE.OrthographicCamera(-half, half, half * Math.cos(t), -half * Math.cos(t), 10, 6000);
  cam.position.set(c.x, D * Math.cos(t), c.z + D * Math.sin(t));
  cam.lookAt(c.x, 0, c.z);
  cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  return cam;
}
function gmProject(cam, x, y, z, size) {
  const v = new THREE.Vector3(x, y, z).project(cam);
  return [(v.x + 1) / 2 * size, (1 - v.y) / 2 * size];
}
// one offscreen render of the scene from straight above
function gmRenderScene(size) {
  const r = V3.r, old = { w: r.domElement.width, h: r.domElement.height, pr: r.getPixelRatio() };
  const sc = V3.sun.shadow.camera, keep = { l: sc.left, rr: sc.right, t: sc.top, b: sc.bottom };
  const markersVisible = V3.markers.visible;
  V3.markers.visible = false;                       // violation pins belong to the working views, not this one
  sc.left = -780; sc.right = 780; sc.top = 780; sc.bottom = -780; sc.updateProjectionMatrix();
  V3.sun.position.set(-700, 900, -520); V3.sun.target.position.set(0, 0, 0); V3.sun.target.updateMatrixWorld();
  const expo = r.toneMappingExposure; r.toneMappingExposure = 1.3;
  r.setPixelRatio(1); r.setSize(size, size, false);
  const cam = GM.cam = gmCamera();
  r.render(V3.scene, cam);
  const out = document.createElement("canvas"); out.width = out.height = size;
  out.getContext("2d").drawImage(r.domElement, 0, 0, size, size);
  // restore the interactive view
  r.toneMappingExposure = expo;
  V3.markers.visible = markersVisible;
  sc.left = keep.l; sc.right = keep.rr; sc.top = keep.t; sc.bottom = keep.b; sc.updateProjectionMatrix();
  r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); r.setSize(old.w, old.h, false);
  resize3D(); V3.dirty = true;
  return out;
}
// explored region: blobs around settlements plus corridors along the roads, with ragged edges
function gmFogMask(W, size) {
  const m = document.createElement("canvas"), k = size / 4; m.width = m.height = k;
  const ctx = m.getContext("2d");
  const cam = GM.cam, plans = W.spec.settlements.map(s => cityPlan(W, s));
  const at = (cx, cy, h) => { const [x, z] = cellToWorld(Math.floor(cx), Math.floor(cy)); const p = gmProject(cam, x, h || 0, z, k); return p; };
  const nz = makePerlin(W.P.seed + 4242), rnd = rng(W.P.seed * 13 + 5);
  ctx.fillStyle = "#fff";
  const blob = (cx, cy, rCells, wob) => {
    const [px, py] = at(cx, cy, 0);
    const rpx = rCells / N * k * GM.zoom;
    ctx.beginPath();
    for (let a = 0; a <= 64; a++) {
      const th = a / 64 * Math.PI * 2;
      const rr = rpx * (1 + wob * nz(Math.cos(th) * 1.6 + cx * 0.05, Math.sin(th) * 1.6 + cy * 0.05));
      const x = px + Math.cos(th) * rr, y = py + Math.sin(th) * rr * 0.92;
      a ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath(); ctx.fill();
  };
  for (const P of plans) blob(P.CX, P.CY, P.R * 4.3, 0.3);
  // road corridors
  ctx.strokeStyle = "#fff"; ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const rd of buildRoads(W)) {
    ctx.lineWidth = (rd.major ? 30 : 20) / N * k * GM.zoom;
    ctx.beginPath();
    rd.pts.forEach(([x, y], i) => { const [px, py] = at(x, y, 0); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
    ctx.stroke();
    for (let i = 0; i < rd.pts.length; i += 6) {
      const [x, y] = rd.pts[i]; blob(x, y, 11 + rnd() * 14, 0.45);
    }
  }
  // a few outlying scouted pockets, so the edge is not just circles
  for (let i = 0; i < 26; i++) {
    const P = plans[Math.floor(rnd() * plans.length)]; if (!P) break;
    const a = rnd() * Math.PI * 2, d = P.R * (3.4 + rnd() * 2.2);
    blob(P.CX + Math.cos(a) * d, P.CY + Math.sin(a) * d, 8 + rnd() * 16, 0.5);
  }
  // feather
  const f = document.createElement("canvas"); f.width = f.height = k;
  const fx = f.getContext("2d");
  fx.filter = "blur(" + (k / 110).toFixed(1) + "px)";
  fx.drawImage(m, 0, 0);
  GM.mask = { data: fx.getImageData(0, 0, k, k).data, k, size };
  return f;
}
function gmCollectIcons(W, size) {
  const cam = GM.cam, out = [];
  const push = (kind, label, cx, cy, h, sid, sub) => {
    const [x, z] = cellToWorld(Math.floor(cx), Math.floor(cy));
    const [px, py] = gmProject(cam, x, h, z, size);
    out.push({ kind, label, px, py, sid, sub });
  };
  const plateau = sid => (V3.plateau && V3.plateau[sid] != null ? V3.plateau[sid] : 2);
  const detail = GM.zoom >= 2.5;
  for (const s of W.spec.settlements) {
    const P = cityPlan(W, s), base = plateau(s.id);
    push("waypoint", s.name, P.CX, P.CY, base + (detail ? 14 : 6), s.id);
    if (detail && (!GM.focus || GM.focus === s.id)) {
      const pri = ["plaza", "cathedral", "keep", "cityhall", "hospital", "market", "station", "church", "lighthouse", "library", "school", "clinic", "factory", "chapel"];
      const ls = P.landmarks.filter(L => GM_ICON[L.kind]).sort((a, b) => pri.indexOf(a.kind) - pri.indexOf(b.kind)).slice(0, 14);
      for (const L of ls) push(GM_ICON[L.kind].kind, LANDMARK[L.kind].zh, P.CX + L.u, P.CY + L.v, base + 2, s.id, true);
    }
  }
  if (!detail) for (const hm of hamlets(W)) push("hamlet", hm.name, hm.x, hm.y, sampleD(V3.D, hm.x, hm.y) + 2);
  if (!detail) for (const m of W.spec.mountains) {
    const pk = mountainPeaks(W).find(q => q.m.id === m.id); if (!pk) continue;
    push("terrain", m.name, pk.cell[0], pk.cell[1], sampleD(V3.D, pk.cell[0], pk.cell[1]) + 4);
  }
  if (!detail) for (const l of W.hy.lakes.slice(0, 4)) push("terrain", l.name, l.cx, l.cy, 0.5);
  if (!detail) for (const { r, i } of riverLabelCells(W).slice(0, 6)) push("terrain", r.name, i % N, Math.floor(i / N), 0.5);
  return out;
}
function gmDrawIcon(ctx, ic, hot) {
  const { px, py, kind } = ic, g = GM.gold;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.85)"; ctx.shadowBlur = 6;
  ctx.strokeStyle = g; ctx.fillStyle = g; ctx.lineWidth = hot ? 2.6 : 1.8;
  const R = kind === "waypoint" ? 15 : 10;
  if (kind === "waypoint") {                       // fast-travel style starburst
    ctx.beginPath();
    for (let a = 0; a < 8; a++) { const th = a * Math.PI / 4; ctx.moveTo(px + Math.cos(th) * R * 0.34, py + Math.sin(th) * R * 0.34); ctx.lineTo(px + Math.cos(th) * R, py + Math.sin(th) * R); }
    ctx.stroke();
    ctx.beginPath(); ctx.arc(px, py, R * 0.32, 0, 7); ctx.fillStyle = "#f6e4bb"; ctx.fill();
    ctx.beginPath(); ctx.arc(px, py, R * 0.72, 0, 7); ctx.stroke();
  } else if (kind === "quest") {
    ctx.beginPath(); ctx.moveTo(px, py - R); ctx.lineTo(px + R * 0.8, py); ctx.lineTo(px, py + R); ctx.lineTo(px - R * 0.8, py); ctx.closePath();
    ctx.fillStyle = "rgba(20,16,10,0.75)"; ctx.fill(); ctx.stroke();
  } else if (kind === "trade") {
    ctx.beginPath(); ctx.arc(px, py, R * 0.85, 0, 7); ctx.fillStyle = "rgba(20,16,10,0.75)"; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(px - R * 0.4, py + R * 0.3); ctx.lineTo(px, py - R * 0.45); ctx.lineTo(px + R * 0.4, py + R * 0.3); ctx.stroke();
  } else if (kind === "poi") {
    ctx.beginPath(); ctx.arc(px, py, R * 0.7, 0, 7); ctx.fillStyle = "rgba(20,16,10,0.72)"; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(px, py, R * 0.22, 0, 7); ctx.fillStyle = g; ctx.fill();
  }
  ctx.restore();
}
function gmDrawLabel(ctx, text, px, py, font, color) {
  ctx.font = font; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.9)"; ctx.shadowBlur = 8;
  ctx.lineWidth = 4.5; ctx.strokeStyle = "rgba(12,10,7,0.88)"; ctx.lineJoin = "round";
  ctx.strokeText(text, px, py); ctx.shadowBlur = 0;
  ctx.fillStyle = color; ctx.fillText(text, px, py);
  ctx.restore();
}
function gmFocus(sid) {
  const sn = curSnap(); if (!sn) return;
  if (!sid) { GM.focus = null; GM.zoom = 1; GM.center = null; }
  else {
    const p = sn.W.P.pos[sid]; if (!p) return;
    const st = sn.W.spec.settlements.find(q => q.id === sid);
    const [x, z] = cellToWorld(p[0], p[1]);
    GM.focus = sid; GM.center = { x, z };
    GM.zoom = clamp(1.04 * N / ((PLAN_R[st ? st.type : "town"] || 8) * 3.2), 3, 18);
  }
  renderGameMap(true);
}
function renderGameMap(force) {
  if (!(V3 && (V3.ok || init3D()))) return;
  const sn = curSnap(); if (!sn) return;
  const W = sn.W;
  const cv = gmCanvas(), size = GM.size;
  cv.width = cv.height = size;
  const ctx = cv.getContext("2d");
  update3D();                                        // make sure terrain, cities and texture match this snapshot
  const ready = plansReady(W);
  if (!ready) schedulePlans(W);
  const key = [S.snaps.indexOf(sn), S.layers.base, ready, GM.fog, V3.exag, S.city, GM.zoom, GM.focus, S.snapGen].join();
  if (!force && GM.key === key && GM.cache) { gmCompose(ctx, W, size, GM.cache, ready); return; }
  const shot = gmRenderScene(size);
  GM.cache = shot; GM.key = key;
  gmCompose(ctx, W, size, shot, ready);
}
function gmCompose(ctx, W, size, shot, ready) {
  const t = document.createElement("canvas"); t.width = t.height = size;
  const tx = t.getContext("2d");
  tx.drawImage(shot, 0, 0);
  // parchment-ish grid over the render
  tx.strokeStyle = "rgba(255,250,235,0.055)"; tx.lineWidth = 1;
  tx.beginPath();
  for (let g = 0; g <= 40; g++) { const p = g / 40 * size; tx.moveTo(p, 0); tx.lineTo(p, size); tx.moveTo(0, p); tx.lineTo(size, p); }
  tx.stroke();
  // fog of war
  if (GM.fog && ready) {
    const mask = gmFogMask(W, size);
    tx.globalCompositeOperation = "destination-in";
    tx.drawImage(mask, 0, 0, size, size);
    tx.globalCompositeOperation = "source-over";
  }
  ctx.fillStyle = "#0b0a08"; ctx.fillRect(0, 0, size, size);
  ctx.drawImage(t, 0, 0);
  ctx.save();                                   // warm, slightly darkened grade, like an in-game map screen
  ctx.globalCompositeOperation = "multiply"; ctx.fillStyle = "#e6e0d2"; ctx.fillRect(0, 0, size, size);
  ctx.restore();
  // vignette
  const gr = ctx.createRadialGradient(size / 2, size / 2, size * 0.3, size / 2, size / 2, size * 0.72);
  gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(1, "rgba(6,5,4,0.8)");
  ctx.fillStyle = gr; ctx.fillRect(0, 0, size, size);
  // icons and labels
  GM.icons = (ready ? gmCollectIcons(W, size) : []).filter(ic => gmExplored(ic.px, ic.py));
  const placed = [];
  const fits = (x, y, w, h) => !placed.some(p => Math.abs(p.x - x) < (p.w + w) / 2 + 8 && Math.abs(p.y - y) < h);
  // terrain names first, then landmarks of the selected town, then the town names on top
  for (const ic of GM.icons) if (ic.kind === "terrain") {
    const font = `italic 500 26px ${SERIF}`;
    ctx.font = font; const w = ctx.measureText(ic.label).width;
    if (!fits(ic.px, ic.py, w, 20)) continue;
    placed.push({ x: ic.px, y: ic.py, w });
    gmDrawLabel(ctx, ic.label, ic.px, ic.py, font, "rgba(226,212,184,0.6)");
  }
  for (const ic of GM.icons) {
    if (ic.kind === "terrain" || !ic.sub) continue;
    gmDrawIcon(ctx, ic, GM.hover === ic);
    const font = `500 24px ${SERIF}`;
    ctx.font = font; const w = ctx.measureText(ic.label).width;
    let y = ic.py - 22, ok = false;
    for (let k = 0; k < 3 && !(ok = fits(ic.px, y, w, 20)); k++) y -= 21;
    if (!ok) continue;                                  // crowded: keep the icon, drop the name
    placed.push({ x: ic.px, y, w });
    gmDrawLabel(ctx, ic.label, ic.px, y, font, GM.dim);
  }
  for (const ic of GM.icons) {                          // hamlets: a dot, and a name only where there is room
    if (ic.kind !== "hamlet") continue;
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,0.85)"; ctx.shadowBlur = 4; ctx.fillStyle = GM.gold;
    ctx.beginPath(); ctx.arc(ic.px, ic.py, 4, 0, 7); ctx.fill(); ctx.restore();
    const font = `500 20px ${SERIF}`;
    ctx.font = font; const w = ctx.measureText(ic.label).width;
    if (!fits(ic.px, ic.py - 16, w, 18)) continue;
    placed.push({ x: ic.px, y: ic.py - 16, w });
    gmDrawLabel(ctx, ic.label, ic.px, ic.py - 16, font, GM.dim);
  }
  for (const ic of GM.icons) {
    if (ic.kind !== "waypoint") continue;
    gmDrawIcon(ctx, ic, GM.hover === ic);
    const font = `600 34px ${SERIF}`;
    ctx.font = font; const w = ctx.measureText(ic.label).width;
    let y = ic.py - 32;
    for (let k = 0; k < 8 && !fits(ic.px, y, w, 24); k++) y -= 24;
    placed.push({ x: ic.px, y, w });
    gmDrawLabel(ctx, ic.label, ic.px, y, font, GM.ink);
  }
  // frame and caption
  ctx.strokeStyle = "rgba(196,164,104,0.55)"; ctx.lineWidth = 3; ctx.strokeRect(14, 14, size - 28, size - 28);
  ctx.strokeStyle = "rgba(196,164,104,0.3)"; ctx.lineWidth = 1; ctx.strokeRect(22, 22, size - 44, size - 44);
  const cap = GM.focus ? `${W.spec.name} · ${nameOf(W, GM.focus)}` : W.spec.name;
  gmDrawLabel(ctx, cap, size / 2, 50, `600 30px ${SERIF}`, GM.gold);
  if (!ready) gmDrawLabel(ctx, "正在生成城镇…", size / 2, size / 2, `500 26px ${SERIF}`, GM.dim);
}
function gmExplored(px, py) {
  if (!GM.fog || !GM.mask) return true;
  const { data, k, size } = GM.mask;
  const x = Math.round(px / size * k), y = Math.round(py / size * k);
  if (x < 0 || y < 0 || x >= k || y >= k) return false;
  return data[(y * k + x) * 4 + 3] > 70;
}
function gmPick(e) {
  const cv = gmCanvas(), r = cv.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width * GM.size, y = (e.clientY - r.top) / r.height * GM.size;
  let best = null, bd = 44;
  for (const ic of GM.icons) { if (!ic.sid || ic.sub) continue; const d = Math.hypot(ic.px - x, ic.py - y); if (d < bd) { bd = d; best = ic; } }
  return best;
}
