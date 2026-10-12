// ===================== 3D VIEW (three.js diorama) =====================
const V3 = { ok: false, SEG: 384, decals: [], cityObjs: [], SIZE: 1000, BASE: -80, exag: 1.6, dirty: true, labels: [], snapRef: null, exagRef: null, texKey: null };
const MS = 2.5; // marker scale (diorama buildings are drawn larger than life)
// at larger map scales the same relief spans more km per pixel, so it is drawn flatter
function hScale() { const sn = typeof curSnap === "function" && curSnap(); const fq = sn ? (SCALES[sn.W.spec.scale] || SCALES.region).fq : 1; return 190 * V3.exag / Math.sqrt(fq); }

function init3D() {
  if (!window.THREE) return false;
  try {
    const canvas = $("#map3d");
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.outputEncoding = THREE.sRGBEncoding;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xcfdbe0, 2600, 6000);
    const cam = new THREE.PerspectiveCamera(36, 1, 1.5, 9000);
    scene.add(new THREE.HemisphereLight(0xeaf2f4, 0x5a5144, 0.62));
    const sun = new THREE.DirectionalLight(0xfff0d8, 1.25);
    sun.position.set(-640, 780, -460); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -760, right: 760, top: 760, bottom: -760, near: 100, far: 3000 });
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.8;
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xc6d8ea, 0.28); fill.position.set(500, 300, 600); scene.add(fill);

    // terrain
    const geo = new THREE.PlaneGeometry(V3.SIZE, V3.SIZE, V3.SEG, V3.SEG); geo.rotateX(-Math.PI / 2);
    const texCanvas = document.createElement("canvas"); texCanvas.width = texCanvas.height = 2048;
    const tex = new THREE.CanvasTexture(texCanvas); tex.encoding = THREE.sRGBEncoding; tex.anisotropy = r.capabilities.getMaxAnisotropy();
    const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.93, metalness: 0 }));
    terrain.castShadow = terrain.receiveShadow = true; scene.add(terrain);

    // earth skirt around the tile
    const S1 = V3.SEG + 1, skPos = new Float32Array(4 * S1 * 2 * 3), skCol = new Float32Array(4 * S1 * 2 * 3), idx = [];
    for (let side = 0; side < 4; side++) for (let k = 0; k < S1; k++) {
      const base = (side * S1 + k) * 2;
      const t = [0.56, 0.47, 0.36], b = [0.25, 0.21, 0.17];
      skCol.set(t, base * 3); skCol.set(b, (base + 1) * 3);
      if (k < S1 - 1) idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
    const skGeo = new THREE.BufferGeometry();
    skGeo.setAttribute("position", new THREE.BufferAttribute(skPos, 3));
    skGeo.setAttribute("color", new THREE.BufferAttribute(skCol, 3));
    skGeo.setIndex(idx);
    const skirt = new THREE.Mesh(skGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }));
    skirt.receiveShadow = true; scene.add(skirt);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(V3.SIZE + 24, 10, V3.SIZE + 24), new THREE.MeshStandardMaterial({ color: 0x2e2a26, roughness: 0.8 }));
    slab.position.y = V3.BASE - 5; slab.receiveShadow = true; scene.add(slab);

    // sea as a translucent block, so the coast reads as a cross-section
    const water = new THREE.Mesh(new THREE.BoxGeometry(V3.SIZE - 1.5, -V3.BASE, V3.SIZE - 1.5),
      new THREE.MeshStandardMaterial({ color: 0x3b7d9a, transparent: true, opacity: 0.62, roughness: 0.18, metalness: 0.1, depthWrite: false }));
    water.position.y = V3.BASE / 2; water.renderOrder = 2; scene.add(water);

    const markers = new THREE.Group(); scene.add(markers);
    Object.assign(V3, { ok: true, r, scene, cam, sun, geo, tex, texCanvas, terrain, skirt, skPos, water, markers,
      mats: {
        wall: new THREE.MeshStandardMaterial({ color: 0xece4d2, roughness: 0.85 }),
        roof: new THREE.MeshStandardMaterial({ color: 0x7b3a2c, roughness: 0.8 }),
        stone: new THREE.MeshStandardMaterial({ color: 0x9a948a, roughness: 0.95 }),
        dark: new THREE.MeshStandardMaterial({ color: 0x3b3834, roughness: 0.9 }),
        wood: new THREE.MeshStandardMaterial({ color: 0x6d5236, roughness: 0.9 }),
        plaza: new THREE.MeshStandardMaterial({ color: 0xd8cfb9, roughness: 1 }),
        flag: new THREE.MeshBasicMaterial({ color: 0xb4235f, depthTest: false, transparent: true }),
        flagFocus: new THREE.MeshBasicMaterial({ color: 0xe0346f, depthTest: false, transparent: true }),
        declared: new THREE.MeshBasicMaterial({ color: 0x56666a, depthTest: false, transparent: true, opacity: 0.8 }),
        gold: new THREE.MeshBasicMaterial({ color: 0xd49a22, depthTest: false, transparent: true }),
        white: new THREE.MeshStandardMaterial({ color: 0xf6f6f2, roughness: 0.7 }),
        red: new THREE.MeshStandardMaterial({ color: 0xc8322f, roughness: 0.6 }),
        churchStone: new THREE.MeshStandardMaterial({ color: 0xc9c0cf, roughness: 0.85 }),
        slate: new THREE.MeshStandardMaterial({ color: 0x4e4a5c, roughness: 0.8 }),
        civic: new THREE.MeshStandardMaterial({ color: 0xe3dccd, roughness: 0.8 }),
        yellow: new THREE.MeshStandardMaterial({ color: 0xe0bd55, roughness: 0.85 }),
        orange: new THREE.MeshStandardMaterial({ color: 0xd98c45, roughness: 0.85 }),
        brick: new THREE.MeshStandardMaterial({ color: 0x8e6a58, roughness: 0.9 }),
        water: new THREE.MeshStandardMaterial({ color: 0x5f9fbf, roughness: 0.2 }),
        tree: new THREE.MeshStandardMaterial({ color: 0x4f7a45, roughness: 0.95 }),
        bld: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82 }),
      },
      geos: { box: new THREE.BoxGeometry(1, 1, 1), roof: new THREE.ConeGeometry(0.75, 1, 4), cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 12), cone: new THREE.ConeGeometry(0.6, 1, 12) },
      ctl: { theta: -0.28, phi: 0.86, radius: 1950, target: new THREE.Vector3(0, -10, 30) },
    });
    setupControls();
    new ResizeObserver(resize3D).observe($("#view3d"));
    resize3D(); setView("oblique");
    const loop = () => { if (V3.dirty && S.view === "3d") { V3.dirty = false; place3D(); V3.r.render(V3.scene, V3.cam); updateLabels(); } requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    return true;
  } catch (e) {
    console.warn("3D init failed", e);
    return false;
  }
}
function resize3D() {
  if (!V3.ok) return;
  const box = $("#view3d"), w = box.clientWidth, h = box.clientHeight;
  if (!w || !h) return;
  V3.r.setSize(w, h, false); V3.cam.aspect = w / h; V3.cam.updateProjectionMatrix(); V3.dirty = true;
}
function place3D() {
  if (V3.fly) {
    const f = V3.fly, t = Math.min(1, (performance.now() - f.t0) / 900), e = t * t * (3 - 2 * t), c = V3.ctl;
    c.target.lerpVectors(f.from.target, f.to.target, e);
    c.radius = f.from.radius + (f.to.radius - f.from.radius) * e;
    c.phi = f.from.phi + (f.to.phi - f.from.phi) * e;
    c.theta = f.from.theta + (f.to.theta - f.from.theta) * e;
    if (t < 1) V3.dirty = true; else V3.fly = null;
  }
  const c = V3.ctl, s = Math.sin(c.phi);
  // keep the shadow map focused on what the camera is looking at
  const ext = clamp(c.radius * 0.8, 70, 760);
  const sc = V3.sun.shadow.camera;
  if (sc.right !== ext) { sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.updateProjectionMatrix(); }
  V3.sun.position.set(c.target.x - 640, 780, c.target.z - 460);
  V3.sun.target.position.copy(c.target); V3.sun.target.updateMatrixWorld();
  V3.cam.position.set(c.target.x + c.radius * s * Math.sin(c.theta), c.target.y + c.radius * Math.cos(c.phi), c.target.z + c.radius * s * Math.cos(c.theta));
  V3.cam.lookAt(c.target);
}
function flyTo(sid) {
  const sn = curSnap(); if (!sn || !V3.ok) return;
  const W = sn.W, p = W.P.pos[sid]; if (!p) return;
  const [x, z] = cellToWorld(p[0], p[1]);
  const y = V3.plateau && V3.plateau[sid] != null ? V3.plateau[sid] : Math.max(0, worldY(p[0], p[1]));
  const s0 = W.spec.settlements.find(q => q.id === sid);
  const R = (PLAN_R[s0 ? s0.type : "town"] || 8) * V3.SIZE / N;
  const c = V3.ctl;
  V3.fly = { t0: performance.now(), from: { target: c.target.clone(), radius: c.radius, phi: c.phi, theta: c.theta },
    to: { target: new THREE.Vector3(x, y, z), radius: Math.max(80, R * 4.2), phi: 0.78, theta: c.theta } };
  V3.dirty = true;
}
function setView(preset) {
  const c = V3.ctl; V3.fly = null;
  // frame the diorama to the canvas: a wide canvas is limited by its height, so the camera can come closer
  const a = V3.cam.aspect || 1, fit = clamp(1.12 / a, 0.58, 0.95);
  if (preset === "top") Object.assign(c, { theta: 0, phi: 0.02, radius: 1900 * Math.max(fit, 0.9) });
  else Object.assign(c, { theta: -0.28, phi: 0.86, radius: 1950 * fit });
  c.target.set(0, preset === "top" ? 0 : -10, preset === "top" ? 0 : 30);
  V3.dirty = true;
}
function setupControls() {
  const el = $("#map3d"), ptrs = new Map();
  let mode = null, lastDist = 0;
  el.addEventListener("contextmenu", e => e.preventDefault());
  el.addEventListener("pointerdown", e => {
    el.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    mode = ptrs.size === 2 ? "pinch" : (e.button === 2 || e.shiftKey) ? "pan" : "rotate";
    if (mode === "pinch") { const [a, b] = [...ptrs.values()]; lastDist = Math.hypot(a.x - b.x, a.y - b.y); }
  });
  const end = e => { ptrs.delete(e.pointerId); mode = ptrs.size === 1 ? "rotate" : null; };
  el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end);
  el.addEventListener("pointermove", e => {
    const p = ptrs.get(e.pointerId);
    if (!p) { hover3D(e); return; }
    const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
    const c = V3.ctl;
    if (mode === "rotate") { c.theta -= dx * 0.005; c.phi = clamp(c.phi - dy * 0.004, 0.02, 1.42); }
    else if (mode === "pan") {
      const k = c.radius / 900, ct = Math.cos(c.theta), st = Math.sin(c.theta);
      c.target.x = clamp(c.target.x - (dx * ct - dy * st) * k, -600, 600);
      c.target.z = clamp(c.target.z - (-dx * st - dy * ct) * k, -600, 600);
    } else if (mode === "pinch" && ptrs.size === 2) {
      const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (lastDist) c.radius = clamp(c.radius * lastDist / d, 70, 3200); lastDist = d;
    }
    V3.dirty = true;
  });
  el.addEventListener("wheel", e => { e.preventDefault(); V3.ctl.radius = clamp(V3.ctl.radius * Math.exp(e.deltaY * 0.0012), 70, 3200); V3.dirty = true; }, { passive: false });
  el.addEventListener("keydown", e => {
    const c = V3.ctl, step = 0.08;
    const map = { ArrowLeft: () => c.theta += step, ArrowRight: () => c.theta -= step, ArrowUp: () => c.phi = clamp(c.phi - step, 0.02, 1.42), ArrowDown: () => c.phi = clamp(c.phi + step, 0.02, 1.42), "+": () => c.radius = clamp(c.radius * 0.9, 70, 3200), "=": () => c.radius = clamp(c.radius * 0.9, 70, 3200), "-": () => c.radius = clamp(c.radius * 1.1, 70, 3200) };
    if (map[e.key]) { e.preventDefault(); map[e.key](); V3.dirty = true; }
  });
}

// ---------- height field ----------
function displayHeights(W, plans) {
  const D = new Float32Array(NN), H = hScale(), sea = W.P.sea, floor = V3.BASE + 8;
  for (let i = 0; i < NN; i++) {
    if (W.ocean[i]) D[i] = Math.max(floor, (W.h[i] - sea) * H * 0.75);
    else if (W.hy.lake[i]) D[i] = (W.hy.surf[i] - sea) * H - 0.4;
    else D[i] = (W.h[i] - sea) * H;
  }
  V3.plateau = {};
  for (const P of plans || []) {
    const vals = [];
    const x0 = Math.max(0, Math.floor(P.CX - P.R * 1.7)), x1 = Math.min(N - 1, Math.ceil(P.CX + P.R * 1.7));
    const y0 = Math.max(0, Math.floor(P.CY - P.R * 1.7)), y1 = Math.min(N - 1, Math.ceil(P.CY + P.R * 1.7));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = y * N + x; if (!W.ocean[i] && !W.hy.lake[i] && Math.hypot(x + 0.5 - P.CX, y + 0.5 - P.CY) < P.R * 0.5) vals.push(D[i]); }
    vals.sort((a, b) => a - b);
    const plat = Math.max(0.9, vals.length ? vals[Math.floor(vals.length / 2)] : 1);
    V3.plateau[P.id] = plat;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * N + x; if (W.ocean[i] || W.hy.lake[i]) continue;
      const w = 1 - smooth(P.R * 1.1, P.R * 1.7, Math.hypot(x + 0.5 - P.CX, y + 0.5 - P.CY));
      if (w > 0) D[i] = D[i] * (1 - w) + plat * w;
    }
  }
  return D;
}
function sampleD(D, fx, fy) {
  fx = clamp(fx, 0, N - 1.001); fy = clamp(fy, 0, N - 1.001);
  const x = Math.floor(fx), y = Math.floor(fy), tx = fx - x, ty = fy - y, i = y * N + x;
  return (D[i] * (1 - tx) + D[i + 1] * tx) * (1 - ty) + (D[i + N] * (1 - tx) + D[i + N + 1] * tx) * ty;
}
const cellToWorld = (cx, cy) => [((cx + 0.5) / N - 0.5) * V3.SIZE, ((cy + 0.5) / N - 0.5) * V3.SIZE];
function worldY(cx, cy) { return sampleD(V3.D, cx, cy); }

function buildTerrain3D(W, plans) {
  const D = V3.D = displayHeights(W, plans);
  const pos = V3.geo.attributes.position, S1 = V3.SEG + 1, f = (N - 1) / V3.SEG;
  for (let j = 0; j < S1; j++) for (let i = 0; i < S1; i++) pos.setY(j * S1 + i, sampleD(D, i * f, j * f));
  pos.needsUpdate = true; V3.geo.computeVertexNormals(); V3.geo.computeBoundingSphere();
  // skirt: north, south, west, east
  const P = V3.skPos, half = V3.SIZE / 2;
  for (let side = 0; side < 4; side++) for (let k = 0; k < S1; k++) {
    let x, z, cx, cy;
    const t = -half + k * V3.SIZE / V3.SEG;
    if (side === 0) { x = t; z = -half; cx = k * f; cy = 0; }
    else if (side === 1) { x = t; z = half; cx = k * f; cy = N - 1; }
    else if (side === 2) { x = -half; z = t; cx = 0; cy = k * f; }
    else { x = half; z = t; cx = N - 1; cy = k * f; }
    const o = (side * S1 + k) * 2 * 3;
    P[o] = x; P[o + 1] = sampleD(D, cx, cy); P[o + 2] = z;
    P[o + 3] = x; P[o + 4] = V3.BASE; P[o + 5] = z;
  }
  V3.skirt.geometry.attributes.position.needsUpdate = true;
  V3.skirt.geometry.computeVertexNormals(); V3.skirt.geometry.computeBoundingSphere();
  V3.water.visible = W.ocean.some(v => v);
}
function buildTexture3D(sn) {
  const W = sn.W, ctx = V3.texCanvas.getContext("2d"), SZ = V3.texCanvas.width;
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  ctx.drawImage(baseImage(sn, "tex"), 0, 0, SZ, SZ);
  if (S.layers.rivers) drawRivers(ctx, W, SZ / N, 1.6);
  if (S.layers.settle && plansReady(W)) drawRegionalOverlay(ctx, W, SZ / N, { widthScale: 1.1 });
  if (S.layers.grid) {
    ctx.save(); ctx.strokeStyle = "rgba(255,255,255,0.55)"; ctx.setLineDash([22, 16]); ctx.lineWidth = 3;
    for (const t of [1, 2]) { ctx.beginPath(); ctx.moveTo(t * SZ / 3, 0); ctx.lineTo(t * SZ / 3, SZ); ctx.moveTo(0, t * SZ / 3); ctx.lineTo(SZ, t * SZ / 3); ctx.stroke(); }
    ctx.restore();
  }
  V3.tex.needsUpdate = true;
}

// ---------- markers ----------
function mesh(geo, mat, x, y, z, sx, sy, sz, ry = 0) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.y = ry;
  m.castShadow = true; m.receiveShadow = true; return m;
}
function house(g, x, z, w, d, h, ry) {
  const { box, roof } = V3.geos, M = V3.mats;
  g.add(mesh(box, M.wall, x, h / 2, z, w, h, d, ry));
  const rm = mesh(roof, M.roof, x, h + h * 0.3, z, w * 1.05, h * 0.6, d * 1.05, ry + Math.PI / 4); g.add(rm);
}
function seaDirection(W, px, py) {
  let best = null, bd = 1e9;
  for (let dy = -14; dy <= 14; dy++) for (let dx = -14; dx <= 14; dx++) {
    const x = px + dx, y = py + dy; if (x < 0 || y < 0 || x >= N || y >= N) continue;
    if (W.ocean[y * N + x]) { const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = [dx, dy]; } }
  }
  return best ? Math.atan2(best[0], best[1]) : null;
}
function buildSettlement(W, s) {
  const g = new THREE.Group(), r = rng(hashStr(s.id + s.name)), M = V3.mats, { box, cyl, cone } = V3.geos;
  const [px, py] = W.P.pos[s.id];
  const ring = (n, rad, sz, hmin, hmax) => {
    for (let k = 0; k < n; k++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * rad;
      const w = sz * (0.7 + r() * 0.6);
      house(g, Math.cos(a) * d, Math.sin(a) * d, w, w * (0.8 + r() * 0.5), hmin + r() * (hmax - hmin), r() * Math.PI);
    }
  };
  if (s.type === "city") {
    g.add(mesh(cyl, M.plaza, 0, 0.3, 0, 30, 0.6, 30));
    ring(11, 12, 3.4, 3, 7);
    g.add(mesh(cyl, M.stone, 0, 9, 0, 3.6, 18, 3.6));
    g.add(mesh(cone, M.roof, 0, 20.5, 0, 4.4, 5, 4.4));
  } else if (s.type === "town") {
    g.add(mesh(cyl, M.plaza, 0, 0.3, 0, 20, 0.6, 20));
    ring(6, 7, 3.2, 2.6, 5);
  } else if (s.type === "village") {
    ring(3, 4.5, 2.8, 2.2, 3.4);
  } else if (s.type === "fortress") {
    const L = 14, T = 1.8, Hh = 5;
    for (const [x, z, w, d] of [[0, -L / 2, L, T], [0, L / 2, L, T], [-L / 2, 0, T, L], [L / 2, 0, T, L]]) g.add(mesh(box, M.stone, x, Hh / 2, z, w, Hh, d));
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { g.add(mesh(cyl, M.stone, x * L / 2, 4, z * L / 2, 3.4, 8, 3.4)); g.add(mesh(cone, M.dark, x * L / 2, 9.5, z * L / 2, 3.8, 3, 3.8)); }
    g.add(mesh(box, M.stone, 0, 7, 0, 5.5, 14, 5.5));
    g.add(mesh(cone, M.dark, 0, 16, 0, 5.4, 4, 5.4));
  } else if (s.type === "port") {
    ring(8, 7, 3.2, 2.6, 6);
    const dir = seaDirection(W, px, py);
    if (dir != null) {
      const gy = Math.max(worldY(px, py), 0.2) - 0.4, seaLocal = (0.6 - gy) / MS; // pier and lighthouse stand at sea level
      const L = 20, pier = mesh(box, M.wood, Math.sin(dir) * (L / 2 + 4), seaLocal, Math.cos(dir) * (L / 2 + 4), 2.2, 1, L, dir);
      g.add(pier);
      g.add(mesh(cyl, M.wall, Math.sin(dir) * (L + 3), seaLocal + 3.5, Math.cos(dir) * (L + 3), 1.8, 7, 1.8));
      g.add(mesh(cone, M.roof, Math.sin(dir) * (L + 3), seaLocal + 8, Math.cos(dir) * (L + 3), 2.2, 2, 2.2));
    }
  }
  const [wx, wz] = cellToWorld(px, py);
  g.position.set(wx, Math.max(worldY(px, py), 0.2) - 0.4, wz);
  g.scale.setScalar(MS);
  return g;
}
// ---------- towns in 3D ----------
const F3 = () => V3.SIZE / N;
function clearCities() {
  for (const o of V3.cityObjs) {
    V3.scene.remove(o);
    o.traverse(m => { if (m.geometry && !Object.values(V3.geos).includes(m.geometry)) m.geometry.dispose(); if (m.material && m.material.map && m.material.userData.own) { m.material.map.dispose(); m.material.dispose(); } });
    if (o.isInstancedMesh) o.dispose();
  }
  V3.cityObjs = [];
}
function hexCol(h, lift) { const c = new THREE.Color(h); return c.lerp(new THREE.Color(0xffffff), lift); }
function landmark3D(L, F) {
  const g = new THREE.Group(), M = V3.mats, { box, cyl, cone, roof } = V3.geos;
  const w = L.w * F, d = L.h * F;
  const add = (geo, mat, x, y, z, sx, sy, sz) => { const m = mesh(geo, mat, x, y, z, sx, sy, sz); g.add(m); return m; };
  switch (L.kind) {
    case "plaza":
      add(cyl, M.stone, 0, 0.15, 0, w * 0.26, 0.3, w * 0.26);
      add(cyl, M.water, 0, 0.32, 0, w * 0.2, 0.06, w * 0.2);
      add(cyl, M.stone, 0, 0.8, 0, 0.18, 1.3, 0.18);
      break;
    case "cityhall":
      add(box, M.civic, 0, 0.9, 0, w, 1.8, d);
      add(box, M.civic, -w * 0.3, 2.4, 0, w * 0.18, 4.8, w * 0.18);
      add(cone, M.slate, -w * 0.3, 5.4, 0, w * 0.2, 1.3, w * 0.2);
      break;
    case "library": add(box, M.civic, 0, 0.8, 0, w, 1.6, d); add(box, M.slate, 0, 1.75, 0, w * 1.02, 0.3, d * 1.02); break;
    case "cathedral": case "church": case "chapel": {
      const big = L.kind === "cathedral", hh = big ? 2.4 : L.kind === "church" ? 1.6 : 1.1;
      add(box, M.churchStone, 0, hh / 2, 0, w, hh, d * 0.56);
      add(roof, M.slate, 0, hh + hh * 0.25, 0, w * 0.72, hh * 0.5, d * 0.4).rotation.y = Math.PI / 4;
      add(box, M.churchStone, w * 0.08 + d * 0.25, hh / 2, 0, d * 0.5, hh, d);
      const towers = big ? [-d * 0.2, d * 0.2] : [0];
      for (const tz of towers) {
        const th = hh * (big ? 2.5 : 2.2);
        add(box, M.churchStone, -w / 2 + d * 0.2, th / 2, tz, d * 0.34, th, d * 0.34);
        add(cone, M.slate, -w / 2 + d * 0.2, th + th * 0.35, tz, d * 0.36, th * 0.7, d * 0.36);
      }
      break;
    }
    case "hospital": case "clinic": {
      const hh = L.kind === "hospital" ? 1.9 : 1.2;
      add(box, M.white, -w / 2 + w * 0.14, hh / 2, 0, w * 0.28, hh, d);
      add(box, M.white, w / 2 - w * 0.14, hh / 2, 0, w * 0.28, hh, d);
      add(box, M.white, 0, hh / 2, 0, w, hh * 0.9, d * 0.3);
      const cs = Math.min(w, d) * 0.3;
      add(box, M.red, 0, hh * 0.9 + 0.05, 0, cs, 0.08, cs * 0.3);
      add(box, M.red, 0, hh * 0.9 + 0.05, 0, cs * 0.3, 0.08, cs);
      break;
    }
    case "market": add(box, M.wall, 0, 0.35, 0, w, 0.7, d); add(box, M.orange, 0, 0.8, 0, w * 1.05, 0.2, d * 1.05); break;
    case "school":
      add(box, M.yellow, 0, 0.55, -d / 2 + d * 0.175, w, 1.1, d * 0.35);
      add(box, M.yellow, -w / 2 + w * 0.15, 0.55, 0, w * 0.3, 1.1, d);
      break;
    case "station":
      add(box, M.brick, 0, 0.6, 0, w, 1.2, d);
      add(box, M.slate, 0, 1.3, 0, w * 1.02, 0.2, d * 1.4);
      add(box, M.brick, 0, 1.6, 0, w * 0.18, 2.2, d * 0.8);
      break;
    case "factory":
      add(box, M.stone, 0, 0.8, 0, w, 1.6, d);
      add(box, M.dark, w * 0.25, 1.1, d * 0.1, w * 0.3, 2.2, d * 0.45);
      add(cyl, M.brick, -w * 0.3, 2.6, -d * 0.25, 0.3, 5.2, 0.3);
      break;
    case "lighthouse":
      add(cyl, M.white, 0, 2, 0, 0.55, 4, 0.55);
      add(cyl, M.red, 0, 2.6, 0, 0.58, 0.5, 0.58);
      add(cone, M.red, 0, 4.5, 0, 0.8, 1, 0.8);
      break;
    case "keep":
      add(box, M.stone, 0, 1.8, 0, w, 3.6, d);
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { add(cyl, M.stone, x * w / 2, 2.3, z * d / 2, w * 0.28, 4.6, w * 0.28); add(cone, M.dark, x * w / 2, 5.2, z * d / 2, w * 0.3, 1.3, w * 0.3); }
      break;
  }
  const [u, v] = [L.u * F, L.v * F];
  g.position.set(u, 0, v); g.rotation.y = -L.rot;
  return g;
}
function buildCities3D(sn, plans) {
  clearCities();
  const W = sn.W, F = F3();
  let nB = 0, nT = 0;
  for (const P of plans) { nB += P.buildings.length + P.piers.length; nT += P.trees.length; }
  const inst = new THREE.InstancedMesh(V3.geos.box, V3.mats.bld, Math.max(1, nB));
  const trees = new THREE.InstancedMesh(V3.geos.cone, V3.mats.tree, Math.max(1, nT));
  inst.castShadow = inst.receiveShadow = trees.castShadow = trees.receiveShadow = true;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const pierCol = new THREE.Color(0x7a5e40);
  let bi = 0, ti = 0;
  for (const P of plans) {
    const zc = {}; for (const [k, z] of Object.entries(ZONES)) if (z.bld) zc[k] = hexCol(zoneBld(P.style, k), 0.1);   // era tint, per plan
    const [ox, oz] = [(P.CX / N - 0.5) * V3.SIZE, (P.CY / N - 0.5) * V3.SIZE];
    const base = V3.plateau[P.id] ?? 1;
    // high-resolution plan decal
    const size = P.type === "city" || P.type === "port" ? 1024 : 512;
    const cv = document.createElement("canvas"); cv.width = cv.height = size;
    const cx = cv.getContext("2d"), pxc = size / (2 * P.EXT);
    cx.setTransform(pxc, 0, 0, pxc, size / 2, size / 2);
    drawPlan(cx, W, P, { unitPx: pxc });
    const tex = new THREE.CanvasTexture(cv); tex.encoding = THREE.sRGBEncoding; tex.anisotropy = V3.r.capabilities.getMaxAnisotropy();
    const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.35, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    mat.userData.own = true;
    const dec = new THREE.Mesh(new THREE.PlaneGeometry(2 * P.EXT * F, 2 * P.EXT * F), mat);
    dec.rotation.x = -Math.PI / 2; dec.position.set(ox, base + 0.06, oz); dec.receiveShadow = true;
    V3.scene.add(dec); V3.cityObjs.push(dec);
    for (const b of P.buildings) {
      const hgt = b.h * 0.55;
      pos.set(ox + b.u * F, base + hgt / 2, oz + b.v * F); q.setFromAxisAngle(up, -b.rot); scl.set(b.w * F, hgt, b.d * F);
      m4.compose(pos, q, scl); inst.setMatrixAt(bi, m4); inst.setColorAt(bi, zc[b.zone] || zc.res); bi++;
    }
    for (const p of P.piers) {
      pos.set(ox + p.u * F, 0.35, oz + p.v * F); q.setFromAxisAngle(up, -p.rot); scl.set(p.w * F, 0.35, Math.max(0.25, p.d * F));
      m4.compose(pos, q, scl); inst.setMatrixAt(bi, m4); inst.setColorAt(bi, pierCol); bi++;
    }
    for (const [u, v, r] of P.trees) {
      const hh = r * F * 2.6;
      pos.set(ox + u * F, base + hh / 2, oz + v * F); q.identity(); scl.set(r * F * 1.5, hh, r * F * 1.5);
      m4.compose(pos, q, scl); trees.setMatrixAt(ti++, m4);
    }
    const g = new THREE.Group(); g.position.set(ox, base, oz);
    for (const L of P.landmarks) {
      const lg = landmark3D(L, F);
      if (L.kind === "lighthouse") lg.position.y = 0.3 - base;
      g.add(lg);
    }
    // walls with towers
    for (const w of P.walls) {
      for (let k = 1; k < w.pts.length; k++) {
        const [au, av] = w.pts[k - 1], [bu, bv] = w.pts[k];
        const mu = (au + bu) / 2, mv = (av + bv) / 2, th = Math.atan2(mv, mu);
        if (w.gates.some(gt => Math.abs(Math.atan2(Math.sin(th - gt), Math.cos(th - gt))) < 0.07)) continue;
        const len = Math.hypot(bu - au, bv - av) * F;
        const seg = mesh(V3.geos.box, V3.mats.stone, mu * F, 0.55, mv * F, len, 1.1, 0.22);
        seg.rotation.y = -Math.atan2(bv - av, bu - au); g.add(seg);
        if (k % 5 === 0) g.add(mesh(V3.geos.cyl, V3.mats.stone, au * F, 0.8, av * F, 0.55, 1.6, 0.55));
      }
    }
    V3.scene.add(g); V3.cityObjs.push(g);
  }
  inst.count = bi; trees.count = ti;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  V3.scene.add(inst); V3.scene.add(trees); V3.cityObjs.push(inst, trees);
}
function clearMarkers() {
  const g = V3.markers;
  while (g.children.length) {
    const c = g.children.pop();
    c.traverse(o => { if (o.geometry && !Object.values(V3.geos).includes(o.geometry)) o.geometry.dispose(); });
  }
}
function ringMesh(x, y, z, rad, mat) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(rad, rad * 0.11, 8, 48), mat);
  m.rotation.x = Math.PI / 2; m.position.set(x, y, z); m.renderOrder = 10; return m;
}
function pinMesh(x, y0, y1, z, mat) {
  const g = new THREE.CylinderGeometry(1.3, 1.3, y1 - y0, 8);
  const m = new THREE.Mesh(g, mat); m.position.set(x, (y0 + y1) / 2, z); m.renderOrder = 10; return m;
}
function mountainPeaks(W) {
  if (W._peaks) return W._peaks;
  W._peaks = W.spec.mountains.map(m => {
    const [cx, cy] = regionCenter(m.region); let best = 0, bh = -1;
    for (let y = Math.floor(cy - N / 6); y < cy + N / 6; y++) for (let x = Math.floor(cx - N / 6); x < cx + N / 6; x++) { const i = y * N + x; if (W.h[i] > bh) { bh = W.h[i]; best = i; } }
    return { m, cell: cellXY(best) };
  });
  return W._peaks;
}
function addLabel(cls, html, x, y, z, sid) {
  const el = document.createElement("div"); el.className = "l3 " + cls; el.innerHTML = html;
  if (sid) { el.dataset.sid = sid; el.title = "点击查看城市详图"; el.onclick = () => { selectCity(sid); flyTo(sid); }; }
  $("#labels3d").appendChild(el);
  V3.labels.push({ el, v: new THREE.Vector3(x, y, z) });
}
function buildMarkers3D(sn) {
  clearMarkers();
  $("#labels3d").innerHTML = ""; V3.labels = [];
  const W = sn.W, M = V3.mats;
  if (S.layers.grid) REGIONS.forEach((r, j) => {
    const cx = (j % 3) * N / 3 + 10, cy = Math.floor(j / 3) * N / 3 + 10; const [x, z] = cellToWorld(cx, cy);
    addLabel("region", REGION_ZH[r], x, Math.max(0, worldY(cx, cy)) + 2, z);
  });
  for (const { m, cell } of mountainPeaks(W)) {
    const [x, z] = cellToWorld(...cell); const y = worldY(...cell);
    addLabel("mtn" + (S.highlight === m.id ? " hl" : ""), esc(m.name), x, y + 16, z);
    if (S.highlight === m.id) V3.markers.add(ringMesh(x, y + 2, z, 26, M.gold));
  }
  if (S.layers.rivers) {
    for (const { r, i } of riverLabelCells(W)) { const [cx, cy] = cellXY(i); const [x, z] = cellToWorld(cx, cy); addLabel("river" + (S.highlight === r.id ? " hl" : ""), esc(r.name), x, worldY(cx, cy) + 3, z); }
    for (const l of W.hy.lakes.slice(0, 5)) { const [x, z] = cellToWorld(l.cx, l.cy); addLabel("river", esc(l.name), x, worldY(l.cx, l.cy) + 3, z); }
  }
  const ready = plansReady(W);
  if (S.layers.settle) for (const hm of hamlets(W)) { const [x, z] = cellToWorld(hm.x, hm.y); addLabel("hamlet", "<i>·</i><span class=\"nm\"> " + esc(hm.name) + "</span>", x, Math.max(0, worldY(hm.x, hm.y)) + 3, z); }
  if (S.layers.settle) for (const s of W.spec.settlements) {
    const [x, z] = cellToWorld(...W.P.pos[s.id]);
    let y;
    if (!ready) { const g = buildSettlement(W, s); V3.markers.add(g); y = g.position.y; }
    else y = V3.plateau[s.id] ?? 1;
    const hl = S.highlight === s.id;
    const R = PLAN_R[s.type] * V3.SIZE / N;
    addLabel("town t-" + s.type + (hl ? " hl" : "") + (S.city === s.id ? " sel" : ""), esc(s.name), x, y + (ready ? 9 : (s.type === "city" || s.type === "fortress" ? 42 : 26)), z, s.id);
    if (hl) V3.markers.add(ringMesh(x, y + 2, z, ready ? R * 1.1 : 30, M.gold));
  }
  if (S.layers.marks) {
    const rep = reportOf(sn);
    const draw = (c, n, declared) => {
      for (const p of c.at || []) {
        const [x, z] = cellToWorld(p[0], p[1]); const y = Math.max(0, worldY(p[0], p[1]));
        const focus = S.focus === c.id, mat = declared ? M.declared : focus ? M.flagFocus : M.flag;
        V3.markers.add(ringMesh(x, y + 3, z, focus ? 30 : 18, mat));
        V3.markers.add(pinMesh(x, y + 3, y + 58, z, mat));
        addLabel("badge" + (declared ? " dec" : "") + (focus ? " focus" : ""), String(n), x, y + 62, z);
      }
    };
    rep.checks.filter(c => c.status === "declared").forEach(c => draw(c, "×", true));
    rep.fails.forEach((c, j) => draw(c, j + 1, false));
  }
}
function updateLabels() {
  const box = $("#view3d"), w = box.clientWidth, h = box.clientHeight, v = new THREE.Vector3();
  $("#labels3d").classList.toggle("far", V3.ctl.radius > 760);      // hamlet names only once the camera is close
  for (const L of V3.labels) {
    v.copy(L.v).project(V3.cam);
    if (v.z > 1 || v.x < -1.2 || v.x > 1.2 || v.y < -1.2 || v.y > 1.2) { L.el.style.display = "none"; continue; }
    L.el.style.display = "";
    L.el.style.transform = `translate(${((v.x + 1) / 2 * w).toFixed(1)}px, ${((1 - v.y) / 2 * h).toFixed(1)}px) translate(-50%, -50%)`;
  }
}
function update3D() {
  const sn = curSnap();
  V3.terrain.visible = V3.skirt.visible = !!sn;
  if (!sn) { V3.water.visible = false; clearMarkers(); clearCities(); $("#labels3d").innerHTML = ""; V3.labels = []; V3.dirty = true; return; }
  const ready = plansReady(sn.W), plans = ready ? sn.W.spec.settlements.map(s => cityPlan(sn.W, s)) : null;
  const useCities = ready && S.layers.settle;
  if (V3.snapRef !== sn || V3.exagRef !== V3.exag || V3.readyRef !== useCities) {
    buildTerrain3D(sn.W, useCities ? plans : null); V3.snapRef = sn; V3.exagRef = V3.exag; V3.readyRef = useCities; V3.texKey = null; V3.cityKey = null;
  }
  const tk = [S.layers.base, S.layers.rivers, S.layers.grid, S.layers.settle, ready].join();
  if (V3.texKey !== tk || V3.texSnap !== sn) { buildTexture3D(sn); V3.texKey = tk; V3.texSnap = sn; }
  const ck = useCities ? [S.snaps.indexOf(sn), V3.exag, S.snapGen].join() : "none";
  if (V3.cityKey !== ck || V3.citySnap !== sn) { if (useCities) buildCities3D(sn, plans); else clearCities(); V3.cityKey = ck; V3.citySnap = sn; }
  buildMarkers3D(sn);
  V3.dirty = true;
}

// ---------- hover picking ----------
let hoverPending = null;
function hover3D(e) {
  if (hoverPending) { hoverPending = e; return; }
  hoverPending = e;
  requestAnimationFrame(() => {
    const ev = hoverPending; hoverPending = null;
    const sn = curSnap(); if (!sn || !V3.D) return;
    const rect = $("#map3d").getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera({ x: (ev.clientX - rect.left) / rect.width * 2 - 1, y: -((ev.clientY - rect.top) / rect.height * 2 - 1) }, V3.cam);
    const o = ray.ray.origin, d = ray.ray.direction, half = V3.SIZE / 2;
    const toCell = (x, z) => [(x / V3.SIZE + 0.5) * N - 0.5, (z / V3.SIZE + 0.5) * N - 0.5];
    const surf = (x, z) => { const [cx, cy] = toCell(x, z); const hh = sampleD(V3.D, cx, cy); return V3.water.visible ? Math.max(hh, 0) : hh; };
    let hit = null, prev = 0;
    for (let t = 0; t < 7000; t += 5) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (Math.abs(x) > half || Math.abs(z) > half) { prev = t; continue; }
      if (y <= surf(x, z)) {
        let a = prev, b = t;
        for (let k = 0; k < 12; k++) { const m = (a + b) / 2; if (o.y + d.y * m <= surf(o.x + d.x * m, o.z + d.z * m)) b = m; else a = m; }
        hit = [o.x + d.x * b, o.z + d.z * b]; break;
      }
      prev = t;
    }
    if (!hit) { $("#readout").textContent = READOUT_HINT; return; }
    const [cx, cy] = toCell(...hit).map(Math.round);
    showCell(sn.W, clamp(cx, 0, N - 1), clamp(cy, 0, N - 1));
  });
}
