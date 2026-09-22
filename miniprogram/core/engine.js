/* 长卷引擎 —— 网页版 index.html 的 Canvas 2D 移植。
   与网页版的差异：
   - DOM 贴图层 / mix-blend-mode 调色层全部并进一张 canvas，按帧重画；
   - saturate() 滤镜小程序 canvas 不支持，亮度改用灰色 multiply 罩层近似，饱和度省略；
   - 控制台 / 释文卡 / 卷首题签是 WXML，引擎通过回调通知页面。
   数据驱动：new 时传入 geo（几何数据）与 assetBase（资源域名），引擎本身不含任何画作特有内容。 */

function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function lerp(a, b, k) { return a + (b - a) * k; }
function lerpC(a, b, k) {
  return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k),
    a.length > 3 ? lerp(a[3], b[3], k) : 1];
}
const rgba = c => 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + (c[3] !== undefined ? c[3].toFixed(3) : 1) + ')';
const fmod = (v, m) => ((v % m) + m) % m;
function smooth01(v, a, b) { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); }

function offCanvas(w, h) {
  return wx.createOffscreenCanvas({ type: '2d', width: w, height: h });
}
function sprite(w, h, paint) {
  const c = offCanvas(w, h);
  paint(c.getContext('2d'), w, h);
  return c;
}

class Engine {
  constructor(opts) {
    this.canvas = opts.canvas;
    this.ctx = this.canvas.getContext('2d');
    this.geo = opts.geo;
    this.assetBase = opts.assetBase;
    this.dpr = Math.min(opts.dpr || 1, 2);
    this.onUI = opts.onUI || (() => {});         // 时辰名 / 天候名 / 按钮态变化
    this.onMap = opts.onMap || (() => {});       // 缩略图取景框
    this.onPoi = opts.onPoi || (() => {});       // 点开名胜 i；传 -1 为关闭
    this.onProgress = opts.onProgress || (() => {});
    this.onFirstTouch = opts.onFirstTouch || (() => {}); // 首次交互（页面收卷首题签用）

    const g = this.geo;
    this.AU = g.AU; this.AV = g.AV; this.NT = g.NT;
    this.ART_W = g.ART_W; this.ART_H = g.ART_H;
    this.VERT = !!g.VERTICAL;   // 竖轴：宽度贴合、上下展卷、贴图按行切

    this.S = { x: 0, y: 0, zoom: 1, tod: opts.tod !== undefined ? opts.tod : 0.30,
      todAuto: false, tour: false, t: 0,
      vx: 0, drag: false, mode: 0, wet: 0, zoomTo: 1 };
    this.stageW = 1; this.stageH = 1; this.DW = 0; this.DH = 0;
    this.maxX = 0; this.maxY = 0; this.offY = 0;
    this.windNow = 0.4; this.WIND_DIR = 1;
    this.activePoi = -1;
    this.destroyed = false;
    this.last = 0;
    this.lastSig = '';
    this.gradMul = null; this.gradScr = null; this.briFill = 0;
    this.loadedT = 0;
    this.mapSent = '';

    this.initGeoDerived();
    this.initSprites();
    this.initParticles();
    this.initImages();

    this.SN = this.seasonNow(); this.WX = this.weather(); this.G = this.grade();
    this.layout();   // resize() 到来前先给个合法版面，免得首帧除以 0

    const loop = (now) => {
      if (this.destroyed) return;
      if (!this.last) this.last = now;
      let dt = (now - this.last) / 1000; this.last = now;
      dt = Math.max(0, Math.min(0.05, dt));
      this.step(dt);
      this.canvas.requestAnimationFrame(loop);
    };
    this.canvas.requestAnimationFrame(loop);
  }

  destroy() { this.destroyed = true; }

  resize(w, h) {
    this.stageW = Math.max(1, w); this.stageH = Math.max(1, h);
    this.canvas.width = Math.round(this.stageW * this.dpr);
    this.canvas.height = Math.round(this.stageH * this.dpr);
    this.layout();
  }

  /* ===== 几何派生 ===== */
  initGeoDerived() {
    const g = this.geo;
    this.lanes = g.LANES.map(pts => {
      const seg = []; let total = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const dx = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1];
        const L = Math.hypot(dx, dy * 3);
        seg.push({ x: pts[i][0], y: pts[i][1], dx, dy, L, acc: total }); total += L;
      }
      return { pts, seg, total };
    });
    const resample = (pts) => {
      if (pts.length < 3) return pts.map(q => [q[0], q[1]]);
      const P = i => pts[Math.max(0, Math.min(pts.length - 1, i))], out = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = P(i - 1), b = P(i), c = P(i + 1), d = P(i + 2);
        for (let j = 0; j < 5; j++) {
          const t = j / 5, t2 = t * t, t3 = t2 * t;
          out.push([
            0.5 * (2 * b[0] + (-a[0] + c[0]) * t + (2 * a[0] - 5 * b[0] + 4 * c[0] - d[0]) * t2 + (-a[0] + 3 * b[0] - 3 * c[0] + d[0]) * t3),
            0.5 * (2 * b[1] + (-a[1] + c[1]) * t + (2 * a[1] - 5 * b[1] + 4 * c[1] - d[1]) * t2 + (-a[1] + 3 * b[1] - 3 * c[1] + d[1]) * t3)]);
        }
      }
      out.push([pts[pts.length - 1][0], pts[pts.length - 1][1]]);
      return out;
    };
    this.walks = g.WALKS.map((pts, wi) => {
      const P = resample(pts), seg = []; let total = 0;
      for (let i = 0; i < P.length - 1; i++) {
        const dx = P[i + 1][0] - P[i][0], dy = P[i + 1][1] - P[i][1];
        const L = Math.hypot(dx, dy * 3);
        seg.push({ x: P[i][0], y: P[i][1], dx, dy, L, acc: total }); total += L;
      }
      return { pts: P, seg, total, bridge: wi < g.NBRIDGE };
    }).filter(w => w.total > 2);
  }

  interpAt(arr, u) {
    if (u <= arr[0][0]) return arr[0][1];
    const n = arr.length; if (u >= arr[n - 1][0]) return arr[n - 1][1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (arr[m][0] <= u) lo = m; else hi = m; }
    const a = arr[lo], b = arr[hi], k = (u - a[0]) / (b[0] - a[0]);
    return a[1] + (b[1] - a[1]) * k;
  }
  horizonAt(u) { return this.interpAt(this.geo.HORIZON, u); }
  laneAt(ln, d) {
    d = ((d % ln.total) + ln.total) % ln.total;
    const s = ln.seg; let i = 0;
    while (i < s.length - 1 && s[i].acc + s[i].L < d) i++;
    const k = (d - s[i].acc) / s[i].L;
    return { u: s[i].x + s[i].dx * k, v: s[i].y + s[i].dy * k, du: s[i].dx };
  }

  /* ===== 精灵 ===== */
  initSprites() {
    this.SP_GLINT = sprite(96, 10, (c, w, h) => {
      const g = c.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.42, 'rgba(255,255,255,.85)');
      g.addColorStop(0.58, 'rgba(255,255,255,.85)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      const v = c.createLinearGradient(0, 0, 0, h);
      v.addColorStop(0, 'rgba(255,255,255,0)'); v.addColorStop(0.5, 'rgba(255,255,255,1)'); v.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(0, 0, w, h); c.globalCompositeOperation = 'destination-in';
      c.fillStyle = v; c.fillRect(0, 0, w, h);
    });
    this.SP_PUFF = sprite(128, 128, (c, w) => {
      const g = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(0.45, 'rgba(255,255,255,.42)');
      g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, w, w);
    });
    this.SP_FALL = sprite(16, 128, (c, w, h) => {
      c.clearRect(0, 0, w, h);
      for (let i = 0; i < 26; i++) {
        const x = Math.random() * w, y = Math.random() * h, L = 6 + Math.random() * 26;
        const g = c.createLinearGradient(0, y, 0, y + L);
        g.addColorStop(0, 'rgba(255,255,255,0)');
        g.addColorStop(0.5, 'rgba(255,255,255,' + (0.35 + Math.random() * 0.5) + ')');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g; c.fillRect(x, y, 1.1, L);
      }
    });
    this.SP_FLAKE = sprite(24, 24, (c, w) => {
      const g = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, w, w);
    });
    this._lamp = null; this._tintC = null; this._tintKey = '';
    this._flakeC = null; this._flakeKey = '';
  }
  lampSprite() {
    if (this._lamp) return this._lamp;
    this._lamp = sprite(96, 96, (c, w) => {
      const g = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      g.addColorStop(0, 'rgba(255,226,158,1)'); g.addColorStop(0.25, 'rgba(255,188,96,.55)');
      g.addColorStop(1, 'rgba(255,160,60,0)'); c.fillStyle = g; c.fillRect(0, 0, w, w);
    });
    return this._lamp;
  }
  tintedFlake(col) {
    const q = v => Math.round(v / 8) * 8;
    const key = q(col[0]) + ',' + q(col[1]) + ',' + q(col[2]);
    if (key === this._flakeKey) return this._flakeC;
    this._flakeKey = key;
    const SP = this.SP_FLAKE;
    this._flakeC = sprite(24, 24, (c, w) => {
      c.drawImage(SP, 0, 0); c.globalCompositeOperation = 'source-in';
      c.fillStyle = 'rgb(' + key + ')'; c.fillRect(0, 0, w, w);
    });
    return this._flakeC;
  }
  tintedGlint(col) {
    const q = v => Math.round(v / 8) * 8;
    const key = q(col[0]) + ',' + q(col[1]) + ',' + q(col[2]);
    if (key === this._tintKey) return this._tintC;
    this._tintKey = key;
    const SP = this.SP_GLINT;
    this._tintC = sprite(96, 10, (c, w, h) => {
      c.drawImage(SP, 0, 0); c.globalCompositeOperation = 'source-in';
      c.fillStyle = 'rgb(' + key + ')'; c.fillRect(0, 0, w, h);
    });
    return this._tintC;
  }

  /* ===== 粒子池 ===== */
  initParticles() {
    const g = this.geo;
    this.glints = []; for (let i = 0; i < 230; i++) this.glints.push({ u: 0, v: 0, len: 0, ph: Math.random(), sp: 0.3 + Math.random() * 0.5, live: false });
    this.boats = [];
    this.lanes.forEach((ln, li) => {
      const n = Math.max(3, Math.round(ln.total / 210));
      for (let i = 0; i < n; i++) this.boats.push({ ln: li, d: ln.total * (i / n) + Math.random() * 60, sp: (2.6 + Math.random() * 3.4) * (Math.random() < 0.5 ? 1 : -1), kind: Math.random() < 0.45 ? 0 : 1, wob: Math.random() * 6.28 });
    });
    this.smoke = g.CHIMNEYS.map(ch => ({ u: ch[0], v: ch[1], lamp: ch[2], ps: [] }));
    this.flocks = []; this.birdTimer = 2;
    this.puffs = [];
    // 云气分三层：远雾贴山脊、中霭、近岚（大而淡、飘得快），各自的尺寸疏密不同
    // 雾团铺满全卷、以"屏内十几团"为密度基准：手机竖屏只看到长卷一小段，
    // 按画幅宽度稀疏配置的话（旧值 AU/140）屏内平均只剩 1 团，等于没雾
    const puffN = Math.max(36, Math.round(this.AU / 16));
    for (let i = 0; i < puffN; i++) {
      const band = i % 3, r = Math.random();
      this.puffs.push({ u: Math.random() * this.AU, band,
        // 全部压在脊线下方：飘上天的雾在平坦纸面上会成一粒粒亮团
        dv: band === 0 ? -2 + r * 24 : band === 1 ? 12 + r * 40 : 34 + r * 42,
        sc: band === 0 ? 1.0 + r * 1.2 : band === 1 ? 1.6 + r * 1.3 : 2.6 + r * 1.6,
        sp: (0.25 + Math.random() * 0.85) * (band === 2 ? 1.5 : band === 1 ? 1 : 0.7),
        a: (0.55 + Math.random() * 0.6) * (band === 0 ? 0.9 : band === 1 ? 0.8 : 0.5) });
    }
    this.petals = []; this.petalCarry = 0;
    this.fish = []; this.fishInit = false;
    this.snowAcc = 0; this.initSnowDots();
    this.initClouds();
    this.rings = []; this.splashes = []; this.splashCarry = 0;
    this.drops = [];
    this.walkers = [];
    this.walks.forEach((w, wi) => {
      const n = w.bridge ? 3 : (w.total > 80 ? 2 : 1);
      for (let i = 0; i < n; i++) this.walkers.push({ w: wi, d: w.total * ((i + 0.3) / n), sp: 1.8 + Math.random() * 2.2, dir: Math.random() < 0.5 ? 1 : -1, ph: Math.random() * 6.28 });
    });
    this.flashTimer = 6; this.flashSeq = null; this.flashT = 0; this.flashA = 0;
    this.LAY = [
      { a: 0, n: 760, p: 0.50, sz: 0.55, spd: 0.68, dim: 0.52 },
      { a: 760, n: 560, p: 1.0, sz: 1.0, spd: 1.0, dim: 0.85 },
      { a: 1320, n: 330, p: 1.85, sz: 1.85, spd: 1.55, dim: 1.0 },
    ];
    this.POOL = 1650;
  }
  ensureDrops() {
    if (this.drops.length) return;
    for (let i = 0; i < this.POOL; i++) this.drops.push({ x: Math.random(), y: Math.random(), r: Math.random(), s: Math.random() });
  }

  /* ===== 贴图与掩膜 ===== */
  initImages() {
    const B = this.assetBase;
    this.baseIm = this.canvas.createImage();
    this.baseOK = false;
    this.baseIm.onload = () => { this.baseOK = true; };
    this.baseIm.src = B + 'base.jpg';

    this.tiles = []; this.hi = [];
    for (let i = 0; i < this.NT; i++) {
      const id = String(i).padStart(2, '0');
      this.tiles.push({ im: null, src: B + 't' + id + '.jpg', set: false, ok: false });
      this.hi.push({ im: null, src: B + 'h' + id + '.jpg', set: false, ok: false });
    }
    this.maskOK = false; this.m2OK = false;
    this.A_LAND = null;
    this.masksStarted = false;
    setTimeout(() => this.startMasks(), 4000);
  }
  loadMask(name, cb) {
    const img = this.canvas.createImage();
    img.onload = () => {
      try {
        const w = img.width, h = img.height;
        const cv = offCanvas(w, h);
        const c2 = cv.getContext('2d');
        c2.drawImage(img, 0, 0, w, h);
        cb(c2.getImageData(0, 0, w, h).data, w, h);
      } catch (e) { /* 掩膜取不到时波光等效果静默降级 */ }
    };
    img.src = this.assetBase + name;
  }
  startMasks() {
    if (this.masksStarted) return; this.masksStarted = true;
    this.loadMask('mask.png', (d, w, h) => {
      this.maskData = d; this.maskW = w; this.maskH = h; this.maskOK = true;
      // 绿色通道 = 山陆，抠出来给“远景雨落山后”用
      const cv = offCanvas(w, h), c = cv.getContext('2d');
      const id = c.createImageData(w, h), dd = id.data;
      for (let i = 0, n = w * h; i < n; i++) { const o = i * 4; dd[o] = 255; dd[o + 1] = 255; dd[o + 2] = 255; dd[o + 3] = d[o + 1]; }
      c.putImageData(id, 0, 0);
      this.A_LAND = cv;
    });
    this.loadMask('mask2.png', (d, w, h) => { this.m2Data = d; this.m2W = w; this.m2H = h; this.m2OK = true; });
  }
  waterAt(u, v) {
    if (!this.maskOK) return 0;
    const x = (u / this.AU * this.maskW) | 0, y = (v / this.AV * this.maskH) | 0;
    if (x < 0 || y < 0 || x >= this.maskW || y >= this.maskH) return 0;
    return this.maskData[(y * this.maskW + x) * 4] / 255;
  }
  vegAt(u, v) {
    if (!this.m2OK) return 0;
    const x = (u / this.AU * this.m2W) | 0, y = (v / this.AV * this.m2H) | 0;
    if (x < 0 || y < 0 || x >= this.m2W || y >= this.m2H) return 0;
    return this.m2Data[(y * this.m2W + x) * 4 + 1] / 255;
  }
  ensureTiles() {
    const span = this.VERT ? this.DH : this.DW;
    const pos = this.VERT ? this.S.y : this.S.x;
    const view = this.VERT ? this.stageH : this.stageW;
    const tw = span / this.NT, m = view * 1.2;
    for (let i = 0; i < this.NT; i++) {
      const t = this.tiles[i], l = i * tw;
      if (!t.set && l + tw > pos - m && l < pos + view + m) {
        t.set = true;
        const im = this.canvas.createImage();
        im.onload = () => { t.ok = true; this.loadedT++; this.updateBar(); this.startMasks(); };
        im.src = t.src; t.im = im;
      }
    }
  }
  ensureHi() {
    if (this.geo.HAS_HI === false) return;   // 短卷合成图没有更高清的一档
    const want = this.S.zoomTo > 1 || this.S.zoom > 1.02, tw = this.DW / this.NT, m = this.stageW * 0.4;
    for (let i = 0; i < this.NT; i++) {
      const l = i * tw, h = this.hi[i];
      const near = l + tw > this.S.x - m && l < this.S.x + this.stageW + m;
      if (want && near) {
        if (!h.set) {
          h.set = true;
          const im = this.canvas.createImage();
          im.onload = () => { h.ok = true; };
          im.src = h.src; h.im = im;
        }
      } else if (h.set && (!want || l + tw < this.S.x - this.stageW * 3 || l > this.S.x + this.stageW * 4)) {
        h.set = false; h.ok = false; h.im = null;   // 走远即卸，手机内存扛不住整卷高清
      }
    }
  }
  updateBar() {
    const need = this.tiles.filter(t => t.set).length || 1;
    this.onProgress(Math.min(1, this.loadedT / need));
  }

  /* ===== 版面 ===== */
  layout() {
    this.scale = (this.VERT ? this.stageW / this.ART_W : this.stageH / this.ART_H) * this.S.zoom;
    this.DW = this.ART_W * this.scale; this.DH = this.ART_H * this.scale;
    this.maxX = Math.max(0, this.DW - this.stageW);
    this.maxY = Math.max(0, this.DH - this.stageH);
    this.offX = this.DW < this.stageW ? (this.stageW - this.DW) / 2 : 0;
    this.offY = this.DH < this.stageH ? (this.stageH - this.DH) / 2 : 0;
    this.clampXY(); this.ensureTiles(); this.ensureHi();
  }
  clampXY() {
    this.S.x = Math.max(0, Math.min(this.maxX, this.S.x));
    this.S.y = Math.max(0, Math.min(this.maxY, this.S.y));
  }
  SX(u) { return u / this.AU * this.DW - this.S.x + (this.offX || 0); }
  SY(v) { return v / this.AV * this.DH - this.S.y + this.offY; }
  PX(k) { return k / this.AV * this.DH; }

  /* ===== 时辰 / 天候 ===== */
  grade() {
    const TOD = this.geo.TOD, t = this.S.tod; let i = 0;
    while (i < TOD.length - 2 && TOD[i + 1].at <= t) i++;
    const a = TOD[i], b = TOD[i + 1], k = (t - a.at) / (b.at - a.at);
    return { name: (k < 0.5 ? a.name : b.name),
      mulT: lerpC(a.mulT, b.mulT, k), mulB: lerpC(a.mulB, b.mulB, k),
      scrT: lerpC(a.scrT, b.scrT, k), scrB: lerpC(a.scrB, b.scrB, k),
      sat: lerp(a.sat, b.sat, k), bri: lerp(a.bri, b.bri, k), mist: lerp(a.mist, b.mist, k),
      glint: lerp(a.glint, b.glint, k), gcol: lerpC(a.gcol, b.gcol, k), smoke: lerp(a.smoke, b.smoke, k),
      lamp: lerp(a.lamp, b.lamp, k), ink: lerpC(a.ink, b.ink, k), sail: lerpC(a.sail, b.sail, k), birds: lerp(a.birds, b.birds, k) };
  }
  seasonNow() {
    const B = this.geo.BASE;
    return { snowy: this.S.mode === 2 ? 1 : 0, mist: B.mist, sat: B.sat,
      boatFrac: B.boatFrac, birdN: B.birdN, birdSp: B.birdSp };
  }
  weather() {
    const w = this.S.wet;
    return { overcast: smooth01(w, 0, 0.38), precip: smooth01(w, 0.30, 1), storm: smooth01(w, 0.74, 1) };
  }
  wetLabel() {
    const w = this.S.wet;
    if (this.S.mode === 0) return w < 0.3 ? '晴' : '阴';
    const sn = this.S.mode === 2;
    if (w < 0.06) return '将雨';
    if (w < 0.30) return sn ? '疏雪' : '疏雨';
    if (w < 0.56) return sn ? '小雪' : '小雨';
    if (w < 0.78) return sn ? '大雪' : '大雨';
    return sn ? '风雪' : '骤雨';
  }
  applyGrade() {
    const sig = this.S.tod.toFixed(3) + '|' + this.S.mode + '|' + this.S.wet.toFixed(3) + '|' + this.stageH;
    if (sig === this.lastSig) return; this.lastSig = sig;
    const G = this.G, ov = this.WX.overcast, pr = this.WX.precip, c = this.ctx;
    const mulT = lerpC(G.mulT, [84, 94, 110, 0.56], ov * 0.78), mulB = lerpC(G.mulB, [66, 76, 92, 0.50], ov * 0.78);
    const scrT = [G.scrT[0], G.scrT[1], G.scrT[2], G.scrT[3] * (1 - ov * 0.72)];
    const scrB = [G.scrB[0], G.scrB[1], G.scrB[2], G.scrB[3] * (1 - ov * 0.72)];
    this.gradMul = c.createLinearGradient(0, 0, 0, this.stageH);
    this.gradMul.addColorStop(0, rgba(mulT)); this.gradMul.addColorStop(1, rgba(mulB));
    this.gradScr = c.createLinearGradient(0, 0, 0, this.stageH);
    this.gradScr.addColorStop(0, rgba(scrT)); this.gradScr.addColorStop(1, rgba(scrB));
    const bri = G.bri * (1 - 0.26 * ov - 0.10 * pr);
    this.briFill = bri < 0.995 ? Math.round(255 * bri) : 0;
    this.onUI({ todName: G.name, wetName: this.wetLabel(),
      todVal: Math.round(this.S.tod * 1000), wetVal: Math.round(this.S.wet * 1000), mode: this.S.mode });
  }

  /* ===== 画贴图与调色 ===== */
  drawPlate(c) {
    c.fillStyle = this.geo.BG || '#8d7d55'; c.fillRect(0, 0, this.stageW, this.stageH);
    const tx = (this.offX || 0) - this.S.x, ty = this.offY - this.S.y;
    if (this.baseOK) c.drawImage(this.baseIm, tx, ty, this.DW, this.DH);
    if (this.VERT) {
      const th = this.DH / this.NT;
      for (let i = 0; i < this.NT; i++) {
        const y = i * th + ty;
        if (y > this.stageH + 2 || y + th < -2) continue;
        const t = this.tiles[i];
        if (t.ok) c.drawImage(t.im, tx, y, this.DW, th + 1);
      }
    } else {
      const tw = this.DW / this.NT;
      for (let i = 0; i < this.NT; i++) {
        const x = i * tw - this.S.x;
        if (x > this.stageW + 2 || x + tw < -2) continue;
        const t = this.tiles[i];
        if (t.ok) c.drawImage(t.im, x, ty, tw + 1, this.DH);
        const h = this.hi[i];
        if (h.ok) c.drawImage(h.im, x, ty, tw + 1, this.DH);
      }
    }
    // 调色：multiply 压暗定调，screen 提亮，再用灰罩近似 brightness
    if (this.gradMul) {
      c.globalCompositeOperation = 'multiply';
      c.fillStyle = this.gradMul; c.fillRect(0, 0, this.stageW, this.stageH);
      c.globalCompositeOperation = 'screen';
      c.fillStyle = this.gradScr; c.fillRect(0, 0, this.stageW, this.stageH);
      if (this.briFill) {
        c.globalCompositeOperation = 'multiply';
        const k = this.briFill;
        c.fillStyle = 'rgb(' + k + ',' + k + ',' + k + ')';
        c.fillRect(0, 0, this.stageW, this.stageH);
      }
      c.globalCompositeOperation = 'source-over';
    }
  }
  drawMaskLayer(c, cv, alpha) {
    if (!cv || alpha <= 0.004) return;
    const dx = -this.S.x, dy = this.offY - this.S.y;
    const a = Math.max(0, (0 - dx) / this.DW), b = Math.min(1, (this.stageW - dx) / this.DW);
    const e = Math.max(0, (0 - dy) / this.DH), f = Math.min(1, (this.stageH - dy) / this.DH);
    if (b <= a || f <= e) return;
    c.globalAlpha = alpha;
    c.drawImage(cv, a * cv.width, e * cv.height, (b - a) * cv.width, (f - e) * cv.height,
      dx + a * this.DW, dy + e * this.DH, (b - a) * this.DW, (f - e) * this.DH);
    c.globalAlpha = 1;
  }

  /* ===== 特效（与网页版同构） ===== */
  seedGlint(g) {
    for (let i = 0; i < 20; i++) {
      const u = ((this.S.x - this.DW * 0.06) + Math.random() * (this.stageW + this.DW * 0.12)) / this.DW * this.AU;
      const v = Math.random() * this.AV;
      if (u >= 0 && u <= this.AU && this.waterAt(u, v) > 0.82) {
        // 波光不能比所在水面宽：山涧细流上的长亮条会漫到两岸坡上
        let len = 5 + Math.random() * 30;
        while (len > 3.5 && (this.waterAt(u - len / 2, v) < 0.5 || this.waterAt(u + len / 2, v) < 0.5)) len *= 0.5;
        if (this.waterAt(u - len / 2, v) < 0.5 || this.waterAt(u + len / 2, v) < 0.5) continue;
        g.u = u; g.v = v; g.len = len; g.ph = 0; g.sp = 0.28 + Math.random() * 0.55; g.live = true; return;
      }
    }
    g.live = false;
  }
  drawGlints(c, dt) {
    if (!this.maskOK) return;
    // 屏内水面很小时（如短卷的一线溪流），波光数量要跟着水面占比封顶，
    // 否则整池波光挤进一小块水域，亮成一片抓痕
    this._wfT = (this._wfT || 0) - dt;
    if (this._wfT <= 0) {
      this._wfT = 2;
      let hit = 0;
      for (let i = 0; i < 60; i++) {
        const u = (this.S.x + Math.random() * this.stageW) / this.DW * this.AU;
        const v = Math.random() * this.AV;
        if (this.waterAt(u, v) > 0.82) hit++;
      }
      this._glintMax = Math.round(12 + (hit / 60) * 420);
    }
    let live = 0;
    for (const g of this.glints) if (g.live) live++;
    c.globalCompositeOperation = 'lighter';
    const col = this.G.gcol, base = this.G.glint;
    for (const g of this.glints) {
      if (!g.live) {
        if (live < (this._glintMax || 230) && Math.random() < 0.4) { this.seedGlint(g); if (g.live) live++; }
        continue;
      }
      g.ph += dt * g.sp; g.u += dt * 2.4 * this.windNow;
      if (g.ph >= 1) { g.live = false; continue; }
      const x = this.SX(g.u), y = this.SY(g.v);
      if (x < -80 || x > this.stageW + 80 || y < -30 || y > this.stageH + 30) continue;
      const w = this.PX(g.len), h = Math.max(1.1, this.PX(1.05));
      c.globalAlpha = Math.sin(g.ph * Math.PI) * 0.30 * base;
      c.drawImage(this.tintedGlint(col), x - w / 2, y - h / 2, w, h);
    }
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
  }
  drawFalls(c) {
    c.globalCompositeOperation = 'lighter';
    for (const f of this.geo.FALLS) {
      const x = this.SX(f[0]), y = this.SY(f[1]), h = this.PX(f[2]), w = Math.max(1.4, this.PX(1.5));
      if (x < -40 || x > this.stageW + 40) continue;
      const a = 0.30 * (0.35 + this.G.glint * 0.65);
      c.save(); c.beginPath(); c.rect(x - w / 2, y, w, h); c.clip();
      for (let k = 0; k < 2; k++) {
        const off = (this.S.t * this.PX(f[2]) * (0.55 + k * 0.4)) % h;
        c.globalAlpha = a * (k ? 0.55 : 1);
        c.drawImage(this.SP_FALL, x - w / 2, y + off - h, w, h);
        c.drawImage(this.SP_FALL, x - w / 2, y + off, w, h);
      }
      c.restore();
      c.globalAlpha = a * 0.7;
      const r = this.PX(2.6);
      c.drawImage(this.SP_PUFF, x - r, y + h - r * 0.7, r * 2, r * 1.4);
    }
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
  }
  drawBoats(c, dt) {
    const G = this.G;
    const inkC = rgba([G.ink[0], G.ink[1], G.ink[2], 0.86]);
    const inkL = rgba([G.ink[0], G.ink[1], G.ink[2], 0.62]);
    const sailC = rgba([G.sail[0], G.sail[1], G.sail[2], 0.72]);
    const shownB = Math.ceil(this.boats.length * this.SN.boatFrac);
    for (let bi = 0; bi < this.boats.length; bi++) {
      const b = this.boats[bi]; if (bi >= shownB) continue;
      b.d += b.sp * dt; b.wob += dt * 1.5;
      const p = this.laneAt(this.lanes[b.ln], b.d);
      const x = this.SX(p.u), y = this.SY(p.v);
      if (x < -60 || x > this.stageW + 60 || y < -40 || y > this.stageH + 40) continue;
      const depth = clamp01((p.v - 120) / 190);
      const s = this.PX(0.62) * (0.60 + depth * 0.90);
      if (s < 0.25) continue;
      const dir = b.sp >= 0 ? 1 : -1;
      const bob = Math.sin(b.wob) * s * 0.22;
      c.strokeStyle = rgba([255, 255, 255, 0.10 + G.glint * 0.10]); c.lineWidth = Math.max(0.5, s * 0.14);
      c.beginPath(); c.moveTo(x - dir * s * 5, y + bob + s * 1.2); c.lineTo(x - dir * s * 16, y + bob + s * 2.6);
      c.moveTo(x - dir * s * 5, y + bob + s * 1.2); c.lineTo(x - dir * s * 15, y + bob - s * 0.2); c.stroke();
      c.save(); c.translate(x, y + bob); c.scale(dir * s, s);
      c.beginPath(); c.moveTo(-6, 0); c.quadraticCurveTo(0, 3.5, 6.2, -0.2); c.quadraticCurveTo(0, 1.2, -6, 0);
      c.fillStyle = inkC; c.fill();
      if (b.kind === 0) {
        c.beginPath(); c.moveTo(0.2, -0.6); c.lineTo(0.2, -8.4); c.lineWidth = 0.62; c.strokeStyle = inkL; c.stroke();
        c.beginPath(); c.moveTo(0.9, -8); c.quadraticCurveTo(5.2, -4.6, 1.2, -1.4); c.closePath();
        c.fillStyle = sailC; c.fill();
      } else {
        c.beginPath(); c.moveTo(-3.2, -0.3); c.quadraticCurveTo(0, -4, 3.2, -0.3); c.closePath(); c.fillStyle = inkC; c.fill();
        c.beginPath(); c.moveTo(4.8, -0.5); c.lineTo(4.6, -3.2); c.lineWidth = 0.6; c.strokeStyle = inkL; c.stroke();
      }
      c.restore();
      if (G.lamp > 0.02) {
        c.globalCompositeOperation = 'lighter'; c.globalAlpha = G.lamp * 0.85;
        const r = s * 4.2;
        c.drawImage(this.lampSprite(), x - dir * s * 2 - r, y + bob - s * 1.4 - r, r * 2, r * 2);
        c.globalAlpha = G.lamp * 0.28;
        c.drawImage(this.lampSprite(), x - dir * s * 2 - r * 0.6, y + bob + s * 1.6, r * 1.2, r * 2.6);
        c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
      }
    }
  }
  drawSmoke(c, dt) {
    const amt = this.G.smoke, G = this.G;
    for (const s of this.smoke) {
      const x0 = this.SX(s.u);
      if (x0 < -140 || x0 > this.stageW + 140) { s.ps.length = 0; continue; }
      if (s.ps.length < 7 && Math.random() < dt * 5.4) s.ps.push({ t: 0, life: 3.4 + Math.random() * 2.8, sd: Math.random() * 6.28, w: 0.7 + Math.random() * 0.7 });
      const y0 = this.SY(s.v);
      for (let i = s.ps.length - 1; i >= 0; i--) {
        const p = s.ps[i]; p.t += dt;
        if (p.t > p.life) { s.ps.splice(i, 1); continue; }
        const k = p.t / p.life;
        const x = x0 + this.PX(9) * this.windNow * p.t * p.w + Math.sin(p.t * 1.25 + p.sd) * this.PX(1.3);
        const y = y0 - this.PX(30) * k * p.w;
        const r = this.PX(1.1 + k * 3.4) * p.w;
        c.globalAlpha = Math.min(1, p.t * 3.2) * (1 - k) * (1 - k) * 0.44 * amt;
        c.drawImage(this.SP_PUFF, x - r, y - r, r * 2, r * 2);
      }
      if (G.lamp > 0.02 && s.lamp) {
        c.globalCompositeOperation = 'lighter'; c.globalAlpha = G.lamp * 0.55;
        const r = this.PX(3.4); c.drawImage(this.lampSprite(), x0 - r, y0 - r * 0.6, r * 2, r * 2);
        c.globalCompositeOperation = 'source-over';
      }
    }
    c.globalAlpha = 1;
  }
  drawBirds(c, dt) {
    const G = this.G, SN = this.SN;
    this.birdTimer -= dt;
    if (this.birdTimer <= 0 && this.flocks.length < 6 && G.birds > 0.3) {
      this.birdTimer = 3.2 + Math.random() * 6;
      const u = (this.S.x + Math.random() * this.stageW) / this.DW * this.AU;
      const dir = Math.random() < 0.5 ? 1 : -1;
      const nn = Math.max(2, Math.round(SN.birdN * (0.7 + Math.random() * 0.7)));
      this.flocks.push({ u: u - dir * (this.stageW / this.DW * this.AU) * 0.6,
        v: 30 + Math.random() * (Math.max(46, this.horizonAt(u) - 48)),
        n: nn, dir, sp: SN.birdSp * (0.8 + Math.random() * 0.5), ph: 0, age: 0, rise: 0 });
    }
    const col = rgba([G.ink[0] + 16, G.ink[1] + 16, G.ink[2] + 20, 0.55 * G.birds]);
    for (let i = this.flocks.length - 1; i >= 0; i--) {
      const f = this.flocks[i];
      f.u += f.dir * f.sp * dt; f.ph += dt * 7; f.age += dt;
      if (f.rise) { f.v -= dt * 11 * f.rise; f.rise *= Math.pow(0.72, dt); f.sp *= Math.pow(0.86, dt); }
      if (f.age > 80 || f.u < -200 || f.u > this.AU + 200) { this.flocks.splice(i, 1); continue; }
      const bx = this.SX(f.u);
      if (bx < -200 || bx > this.stageW + 200) continue;
      c.strokeStyle = col; c.lineWidth = Math.max(0.55, this.PX(0.2)); c.lineCap = 'round';
      for (let k = 0; k < f.n; k++) {
        const off = k - (f.n - 1) / 2;
        const x = bx - f.dir * Math.abs(off) * this.PX(3.4),
          y = this.SY(f.v + Math.abs(off) * 1.5 + Math.sin(f.ph * 0.35 + k) * 0.7);
        const w = this.PX(1.7), fl = Math.sin(f.ph + k * 0.7) * 0.55;
        c.beginPath();
        c.moveTo(x - w, y + w * fl); c.quadraticCurveTo(x, y - w * 0.42, x + w, y + w * fl * 0.9);
        c.stroke();
      }
    }
  }
  drawMist(c, dt) {
    // MIST_BOOST：空濛气质的画（如落花诗意图）整体抬雾量。
    // 晓暮夜与雨天的氛围淡雾，克制为上——大团的天象交给云朵系统
    const amt = this.G.mist * this.SN.mist * (1 + this.WX.precip * 0.85 + this.WX.overcast * 0.35)
      * (this.geo.MIST_BOOST || 1);
    if (amt < 0.03) return;
    // 只用软雾团，不铺连续雾带：横条底幔在浅色画面上会成烟熏条纹
    // （它本为已下线的岚天候而生），晓暮的氛围感由雾团的疏密自然给出
    c.globalCompositeOperation = 'lighter';
    for (const p of this.puffs) {
      p.u += dt * p.sp * 7 * this.windNow;
      if (p.u > this.AU + 120) p.u = -120; if (p.u < -160) p.u = this.AU + 120;
      const x = this.SX(p.u);
      if (x < -260 || x > this.stageW + 260) continue;
      const bob = Math.sin(this.S.t * 0.25 + p.u * 0.05) * this.PX(2) * (p.band === 2 ? 1.5 : 1);
      const y = this.SY(this.horizonAt(p.u) + p.dv) + bob;
      const w = this.PX(46 * p.sc), h = this.PX(8 * p.sc) * (p.band === 2 ? 0.75 : 1);
      c.globalAlpha = Math.min(0.10, amt * p.a * 0.07);
      c.drawImage(this.SP_PUFF, x - w / 2, y - h / 2, w, h);
    }
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
  }
  addRing(u, v, st) { if (this.rings.length < 240) this.rings.push({ u, v, t: 0, life: 1.0 + Math.random() * 0.6, st }); }
  drawRings(c, dt) {
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]; r.t += dt;
      if (r.t > r.life) { this.rings.splice(i, 1); continue; }
      const k = r.t / r.life, x = this.SX(r.u), y = this.SY(r.v);
      if (x < -60 || x > this.stageW + 60) continue;
      const rad = this.PX(1.1 + k * (5 + r.st * 13)), a = (1 - k) * (1 - k) * 0.52 * r.st * (0.42 + this.G.glint * 0.58);
      c.strokeStyle = 'rgba(255,255,255,' + a.toFixed(3) + ')';
      c.lineWidth = Math.max(0.6, this.PX(0.32) * (1 - k));
      c.beginPath(); c.ellipse(x, y, rad, rad * 0.34, 0, 0, 6.2832); c.stroke();
    }
  }
  spawnSplash(dt, pr) {
    if (!this.maskOK) return;
    this.splashCarry += dt * pr * pr * 230;
    let tries = 0;
    while (this.splashCarry >= 1 && this.splashes.length < 300 && tries < 90) {
      this.splashCarry -= 1;
      for (let k = 0; k < 5; k++) {
        tries++;
        const sx = Math.random() * this.stageW, sy = Math.random() * this.stageH;
        const u = (this.S.x + sx) / this.DW * this.AU, v = (this.S.y - this.offY + sy) / this.DH * this.AV;
        if (u < 0 || u > this.AU || v < 0 || v > this.AV) continue;
        if (this.waterAt(u, v) > 0.75) {
          this.splashes.push({ u, v, t: 0, life: 0.34 + Math.random() * 0.30,
            s: (0.45 + (v / this.AV) * 1.25) * (0.8 + Math.random() * 0.5) });
          break;
        }
      }
    }
  }
  drawSplashes(c, dt) {
    if (!this.splashes.length) return;
    const col = this.G.gcol, cr = (col[0] | 0) + ',' + (col[1] | 0) + ',' + (col[2] | 0);
    for (let i = this.splashes.length - 1; i >= 0; i--) {
      const p = this.splashes[i]; p.t += dt;
      if (p.t > p.life) { this.splashes.splice(i, 1); continue; }
      const k = p.t / p.life, x = this.SX(p.u), y = this.SY(p.v);
      if (x < -14 || x > this.stageW + 14 || y < -14 || y > this.stageH + 14) continue;
      const rad = this.PX((0.35 + k * 2.5) * p.s);
      c.strokeStyle = 'rgba(' + cr + ',' + ((1 - k) * (1 - k) * 0.90).toFixed(3) + ')';
      c.lineWidth = Math.max(0.5, this.PX(0.20) * (1 - k * 0.55));
      c.beginPath(); c.ellipse(x, y, rad, rad * 0.34, 0, 0, 6.2832); c.stroke();
      if (k < 0.40) {
        const q = 1 - k / 0.40, hh = this.PX(1.05 * p.s) * q, w = Math.max(0.7, this.PX(0.16));
        c.fillStyle = 'rgba(' + cr + ',' + (q * 0.78).toFixed(3) + ')';
        c.fillRect(x - w / 2, y - hh, w, hh);
      }
    }
  }
  drawLayerP(c, dt, L, pr, snowy) {
    const dens = Math.max(0.42, Math.min(1.08, (this.stageW * this.stageH) / 1595520));
    const cnt = Math.floor(L.n * pr * dens); if (cnt < 1) return;
    const col = this.G.gcol, cr = (col[0] | 0) + ',' + (col[1] | 0) + ',' + (col[2] | 0);
    const spanX = this.stageW * 1.3, spanY = this.stageH * 1.25;
    const slant = this.windNow * (snowy ? 1.5 : 1.25) + this.WIND_DIR * (snowy ? 0.10 : 0.35);
    const ox = -this.S.x * L.p, oy = -(this.S.y - this.offY) * L.p * 0.45;
    if (snowy) {
      // 雪片用软径向渐变精灵，不是硬边正圆
      const fl = this.tintedFlake(col);
      const aBase = 0.86 * L.dim * (0.40 + pr * 0.60);
      for (let i = L.a; i < L.a + cnt; i++) {
        const d = this.drops[i];
        d.y += dt * (0.040 + d.s * 0.050) * L.spd;
        d.x += dt * (slant * 0.030 + Math.sin(this.S.t * 0.8 + d.r * 9) * 0.007) * L.spd;
        if (d.y > 1) d.y -= 1; if (d.x > 1) d.x -= 1; if (d.x < 0) d.x += 1;
        const x = fmod(d.x * spanX + ox, spanX) - spanX * 0.115, y = fmod(d.y * spanY + oy, spanY) - spanY * 0.10;
        const rr = (0.85 + d.r * 2.0) * L.sz * (0.72 + pr * 0.55) * 1.35;
        c.globalAlpha = aBase * (0.7 + d.r * 0.3);
        c.drawImage(fl, x - rr, y - rr, rr * 2, rr * 2);
      }
      c.globalAlpha = 1;
    } else {
      c.strokeStyle = 'rgba(' + cr + ',' + (0.34 * L.dim * (0.42 + pr * 0.58)).toFixed(3) + ')';
      c.lineWidth = Math.max(0.6, this.stageH * 0.0013 * L.sz);
      c.beginPath();
      for (let i = L.a; i < L.a + cnt; i++) {
        const d = this.drops[i];
        d.y += dt * (0.70 + d.s * 0.85) * (0.55 + pr * 0.75) * L.spd;
        d.x += dt * slant * 0.30 * L.spd;
        if (d.y > 1) d.y -= 1; if (d.x > 1) d.x -= 1; if (d.x < 0) d.x += 1;
        const x = fmod(d.x * spanX + ox, spanX) - spanX * 0.115, y = fmod(d.y * spanY + oy, spanY) - spanY * 0.10;
        const len = this.stageH * (0.020 + d.s * 0.034) * (0.5 + pr * 0.8) * L.sz;
        c.moveTo(x, y); c.lineTo(x + slant * len * 0.85, y + len);
      }
      c.stroke();
    }
  }
  drawPrecipFar(c, dt) {
    const pr = this.WX.precip; if (pr < 0.02) return;
    this.ensureDrops();
    /* 远景雨要被山体擦掉（真的落在山后）。网页版特效在独立透明层上，
       destination-out 只擦特效；单 canvas 里直接擦会把画连底擦穿，
       所以先画到离屏层，擦完再贴回来。 */
    const w = Math.round(this.stageW * this.dpr), h = Math.round(this.stageH * this.dpr);
    if (!this.fxFar) this.fxFar = offCanvas(w, h);
    if (this.fxFar.width !== w || this.fxFar.height !== h) { this.fxFar.width = w; this.fxFar.height = h; }
    const fc = this.fxFar.getContext('2d');
    fc.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    fc.clearRect(0, 0, this.stageW, this.stageH);
    this.drawLayerP(fc, dt, this.LAY[0], pr, this.SN.snowy > 0.5);
    if (this.A_LAND) {
      fc.globalCompositeOperation = 'destination-out';
      this.drawMaskLayer(fc, this.A_LAND, 1);
      fc.globalCompositeOperation = 'source-over';
    }
    c.drawImage(this.fxFar, 0, 0, w, h, 0, 0, this.stageW, this.stageH);
  }
  drawPrecipNear(c, dt) {
    const pr = this.WX.precip; if (pr < 0.02) return;
    this.ensureDrops();
    const snowy = this.SN.snowy > 0.5;
    this.drawLayerP(c, dt, this.LAY[1], pr, snowy);
    this.drawLayerP(c, dt, this.LAY[2], pr, snowy);
    if (!snowy) this.spawnSplash(dt, pr);
  }
  updateFlash(dt) {
    if (this.flashSeq) {
      this.flashT += dt; let a = 0, acc = 0, done = true;
      for (const st of this.flashSeq) { if (this.flashT < acc + st[0]) { a = st[1]; done = false; break; } acc += st[0]; }
      this.flashA = done ? 0 : a; if (done) this.flashSeq = null; return;
    }
    if (this.WX.storm > 0.03) {
      this.flashTimer -= dt * (0.4 + this.WX.storm * 1.7);
      if (this.flashTimer <= 0) {
        this.flashTimer = 3.2 + Math.random() * 8; this.flashT = 0;
        const pk = 0.20 + this.WX.storm * 0.30;
        this.flashSeq = [[0.05, pk], [0.06, 0], [0.09, pk * 0.6], [0.10, 0]];
      }
    } else this.flashA = 0;
  }
  /* ===== 云朵 =====
     留白云气式的扁底软云：预生成几款圆簇压平底的云形，
     飘在山脊线之上的天空带里，随风缓移，晨昏随时辰染色。 */
  initClouds() {
    // 云是往画上"添笔"，不是配天气——默认不开，
    // 只有画作 geo 明确声明 CLOUDS: true 才启用
    this.clouds = null;
    if (this.geo.CLOUDS !== true) return;
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    this.cloudSprites = [];
    for (let k = 0; k < 3; k++) {
      this.cloudSprites.push(sprite(220, 120, (c, w, h) => {
        const base = h * 0.74;
        for (let i = 0; i < 11; i++) {
          const cx = w * 0.5 + (rnd() - 0.5) * w * 0.64;
          const shrink = 1 - Math.abs(cx - w / 2) / (w / 2) * 0.55;
          const r = h * (0.14 + rnd() * 0.20) * shrink + 6;
          const cy = base - r * (0.5 + rnd() * 0.55);
          const g = c.createRadialGradient(cx, cy, 0, cx, cy, r);
          g.addColorStop(0, 'rgba(255,255,255,.9)');
          g.addColorStop(0.55, 'rgba(255,255,255,.45)');
          g.addColorStop(1, 'rgba(255,255,255,0)');
          c.fillStyle = g; c.fillRect(cx - r, cy - r, r * 2, r * 2);
        }
        // 压平云底
        c.globalCompositeOperation = 'destination-out';
        const lg = c.createLinearGradient(0, base - 8, 0, base + 14);
        lg.addColorStop(0, 'rgba(0,0,0,0)'); lg.addColorStop(1, 'rgba(0,0,0,1)');
        c.fillStyle = lg; c.fillRect(0, base - 8, w, h - base + 8);
        c.globalCompositeOperation = 'source-over';
      }));
    }
    this._cloudTintC = null; this._cloudTintKey = -1;
    this.clouds = [];
    const n = Math.max(3, Math.round(this.AU / 300));
    for (let i = 0; i < n; i++) {
      this.clouds.push({ u: rnd() * this.AU, vf: rnd(), sc: 0.7 + rnd() * 0.9,
        sp: 0.5 + rnd() * 0.8, k: i % 3, a: 0.7 + rnd() * 0.3 });
    }
  }
  tintedCloud(k, col) {
    const q = v => Math.round(v / 10) * 10;
    const key = k + ':' + q(col[0]) + ',' + q(col[1]) + ',' + q(col[2]);
    if (key === this._cloudTintKey) return this._cloudTintC;
    this._cloudTintKey = key;
    const SP = this.cloudSprites[k];
    this._cloudTintC = sprite(220, 120, (c, w, h) => {
      c.drawImage(SP, 0, 0); c.globalCompositeOperation = 'source-in';
      // 云体以白为主，向当日光色略偏
      c.fillStyle = 'rgb(' + Math.round(lerp(255, col[0], 0.35)) + ',' +
        Math.round(lerp(255, col[1], 0.35)) + ',' + Math.round(lerp(255, col[2], 0.35)) + ')';
      c.fillRect(0, 0, w, h);
    });
    return this._cloudTintC;
  }
  drawClouds(c, dt) {
    if (!this.clouds) return;
    const dim = (0.30 + this.G.bri * 0.55) * (1 + this.WX.overcast * 0.4);
    for (const cl of this.clouds) {
      cl.u += dt * cl.sp * 2.4 * this.windNow;
      if (cl.u > this.AU + 90) cl.u = -90; if (cl.u < -120) cl.u = this.AU + 90;
      const x = this.SX(cl.u);
      if (x < -280 || x > this.stageW + 280) continue;
      const skyMax = this.horizonAt(Math.max(0, Math.min(this.AU, cl.u))) - 46;
      if (skyMax < 24) continue;
      const v = 12 + cl.vf * (skyMax - 12);
      const y = this.SY(v);
      const w = this.PX(60 * cl.sc), h = w * 0.42;
      c.globalAlpha = 0.40 * dim * cl.a;
      c.drawImage(this.tintedCloud(cl.k, this.G.gcol), x - w / 2, y - h / 2, w, h);
    }
    c.globalAlpha = 1;
  }

  /* ===== 游鱼（geo.FISH 配置才启用）=====
     墨色鱼影贴水缓游，掩膜约束在水面内，偶尔近水面荡开一圈涟漪 */
  drawFish(c, dt) {
    const F = this.geo.FISH; if (!F || !this.maskOK) return;
    if (!this.fishInit) {
      this.fishInit = true;
      const n = F.n || 4;
      for (let i = 0; i < n * 220 && this.fish.length < n; i++) {
        const u = Math.random() * this.AU, v = Math.random() * this.AV;
        if (this.waterAt(u, v) > 0.75) this.fish.push({ u, v,
          ang: Math.random() * 6.28, sp: 2.6 + Math.random() * 2.6,
          ph: Math.random() * 6.28, turnT: 2 + Math.random() * 3,
          ringT: 4 + Math.random() * 9 });
      }
    }
    const ink = this.G.ink;
    for (const f of this.fish) {
      f.ph += dt * (3 + f.sp); f.turnT -= dt; f.ringT -= dt;
      if (f.turnT <= 0) { f.ang += (Math.random() - 0.5) * 1.3; f.turnT = 2 + Math.random() * 4; }
      const nu = f.u + Math.cos(f.ang) * f.sp * dt, nv = f.v + Math.sin(f.ang) * f.sp * dt * 0.45;
      if (this.waterAt(nu, nv) > 0.5) { f.u = nu; f.v = nv; }
      else f.ang += Math.PI * (0.7 + Math.random() * 0.6);
      const x = this.SX(f.u), y = this.SY(f.v);
      if (x < -30 || x > this.stageW + 30 || y < -30 || y > this.stageH + 30) continue;
      if (f.ringT <= 0) { f.ringT = 5 + Math.random() * 10; this.addRing(f.u, f.v, 0.3); }
      const depth = Math.max(0, Math.min(1, (f.v - 120) / 190));
      const s = this.PX(0.85) * (0.65 + depth * 0.55);
      const a = 0.34;
      c.save(); c.translate(x, y);
      c.rotate(Math.atan2(Math.sin(f.ang) * 0.45, Math.cos(f.ang)));
      c.fillStyle = 'rgba(' + (ink[0] | 0) + ',' + (ink[1] | 0) + ',' + (ink[2] | 0) + ',' + a + ')';
      c.beginPath(); c.ellipse(0, 0, s * 2.1, s * 0.75, 0, 0, 6.2832); c.fill();
      const tw = Math.sin(f.ph) * s * 0.9;   // 尾鳍摆动
      c.beginPath(); c.moveTo(-s * 1.8, 0);
      c.quadraticCurveTo(-s * 2.9, tw * 0.4, -s * 3.4, tw);
      c.quadraticCurveTo(-s * 2.8, tw * 0.6, -s * 1.8, 0);
      c.fill();
      c.restore();
    }
  }

  /* ===== 积雪（geo.SNOWLINES 配置才启用）=====
     不用掩膜罩染（放大有假边），而是沿"受雪面"折线撒确定性的软白点：
     树冠顶、坡沿、桥面。下雪时随 snowAcc 渐渐积起，雪停后缓慢消融。 */
  initSnowDots() {
    const lines = this.geo.SNOWLINES;
    this.snowDots = null; this.snowFiltered = false;
    if (!lines || !lines.length) return;
    const dots = [];
    const hash = i => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
    lines.forEach((ln, li) => {
      const u0 = ln[0][0], u1 = ln[ln.length - 1][0];
      let idx = 0;
      for (let u = u0; u <= u1; u += 1.8, idx++) {
        const h1 = hash(idx * 7 + li * 131), h2 = hash(idx * 13 + li * 197), h3 = hash(idx * 29 + li * 89);
        dots.push({ u: u + (h1 - 0.5) * 1.6, v: this.interpAt(ln, u) + (h2 - 0.5) * 2.0,
          r: 0.4 + h3 * 0.7, a: 0.45 + h1 * 0.55 });
      }
    });
    this.snowDots = dots;
  }
  landAt(u, v) {
    if (!this.maskOK) return 0;
    const x = (u / this.AU * this.maskW) | 0, y = (v / this.AV * this.maskH) | 0;
    if (x < 0 || y < 0 || x >= this.maskW || y >= this.maskH) return 0;
    return this.maskData[(y * this.maskW + x) * 4 + 1] / 255;
  }
  drawSnowCover(c) {
    if (!this.snowDots || this.snowAcc < 0.02) return;
    // 不做掩膜过滤：山陆掩膜把雾霭当实体、把浅色坡顶当空白，两头都会错。
    // 受雪线本身按逐段受雪面手工标注，准确性由数据保证。
    const acc = this.snowAcc;
    for (const d of this.snowDots) {
      const x = this.SX(d.u);
      if (x < -20 || x > this.stageW + 20) continue;
      const y = this.SY(d.v), r = this.PX(d.r) * (0.6 + acc * 0.4);
      c.globalAlpha = acc * d.a * 0.42;
      c.drawImage(this.SP_PUFF, x - r, y - r, r * 2, r * 2);
    }
    c.globalAlpha = 1;
  }

  /* ===== 落花瓣（geo.PETALS 配置才启用）=====
     spawn:[u0,v0,w,h] 生瓣区（树冠带），rate 每秒颗数，col 花瓣色；
     落到 GROUND 折线下方即着地淡出，落进水面起一圈涟漪。 */
  groundAt(u) { return this.geo.GROUND ? this.interpAt(this.geo.GROUND, u) : this.AV + 10; }
  spawnPetal(u, v, burst) {
    if (this.petals.length >= 70) return;
    this.petals.push({ u, v,
      vy: (1.4 + Math.random() * 1.6) * (burst ? 1.6 : 1),
      vu: burst ? (Math.random() - 0.5) * 10 : 0,
      ph: Math.random() * 6.28, sp: 2 + Math.random() * 2.4,
      sz: 0.75 + Math.random() * 0.65, st: 0, t: 0 });
  }
  drawPetals(c, dt) {
    const P = this.geo.PETALS; if (!P) return;
    // 只在可视范围附近生瓣，短卷全屏可见时等同全画幅
    // 雪天不生新瓣（花谢尽了），已有的自然落完
    this.petalCarry += dt * (P.rate || 2) * (this.S.mode === 2 ? 0 : 1);
    while (this.petalCarry >= 1) {
      this.petalCarry -= 1;
      // 在生瓣带与可视范围的交集里取样，屏内密度不随取景位置变化；
      // 有树冠顶线（P.top）时沿线取样，花只从冠内飘出，不高过树
      const u0 = P.top ? P.top[0][0] : P.spawn[0];
      const u1 = P.top ? P.top[P.top.length - 1][0] : P.spawn[0] + P.spawn[2];
      const lo = Math.max(u0, (this.S.x - 60) / this.DW * this.AU);
      const hi = Math.min(u1, (this.S.x + this.stageW + 60) / this.DW * this.AU);
      if (hi > lo) {
        const uu = lo + Math.random() * (hi - lo);
        const vv = P.top ? this.interpAt(P.top, uu) + 2 + Math.random() * (P.depth || 42)
          : P.spawn[1] + Math.random() * P.spawn[3];
        this.spawnPetal(uu, vv, false);
      }
    }
    const col = P.col || [233, 160, 170];
    const dim = 0.35 + this.G.bri * 0.65;
    for (let i = this.petals.length - 1; i >= 0; i--) {
      const p = this.petals[i]; p.t += dt; p.ph += dt * p.sp;
      if (p.st === 0) {
        p.v += p.vy * dt * 2.2;
        p.u += (this.windNow * 2.0 + Math.sin(p.ph) * 1.1 + p.vu) * dt;
        p.vu *= Math.pow(0.5, dt * 2);
        if (p.v >= this.groundAt(p.u)) {
          if (this.waterAt(p.u, p.v) > 0.5) { this.addRing(p.u, p.v, 0.45); p.st = 2; }
          else p.st = 1;
          p.t = 0;
        }
        if (p.v > this.AV + 12) { this.petals.splice(i, 1); continue; }
      } else if (p.st === 1) {
        if (p.t > 2.6) { this.petals.splice(i, 1); continue; }
      } else {
        p.v += p.vy * dt * 0.6;
        if (p.t > 0.7) { this.petals.splice(i, 1); continue; }
      }
      const x = this.SX(p.u), y = this.SY(p.v);
      if (x < -20 || x > this.stageW + 20 || y < -20 || y > this.stageH + 20) continue;
      let a = 0.78 * dim;
      if (p.st === 1) a *= Math.max(0, 1 - p.t / 2.6);
      if (p.st === 2) a *= Math.max(0, 1 - p.t / 0.7);
      const r = this.PX(p.sz);
      c.fillStyle = 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',' + a.toFixed(3) + ')';
      c.save(); c.translate(x, y);
      c.rotate(p.ph * 0.6);
      c.scale(1, 0.55 + Math.abs(Math.sin(p.ph)) * 0.4);   // 翻飞时薄厚变化
      c.beginPath(); c.arc(0, 0, r, 0, 6.2832); c.fill();
      c.restore();
    }
  }

  startle(u, v) {
    if (this.flocks.length > 9) return;
    this.flocks.push({ u, v: Math.max(20, v - 3), n: 3 + ((Math.random() * 4) | 0), dir: Math.random() < 0.5 ? 1 : -1,
      sp: 24 + Math.random() * 14, ph: 0, age: 0, rise: 1 });
  }
  drawFigure(c, x, y, h, ph, dir, ink, robe) {
    if (h < 2.6) { c.fillStyle = ink; c.fillRect(x - 0.5, y - h, 1.1, h); return; }
    const hr = h * 0.115, hy = y - h + hr, sh = y - h + hr * 2.15;
    if (h < 7.5) {
      c.strokeStyle = ink; c.lineWidth = Math.max(0.7, h * 0.16); c.lineCap = 'round';
      c.beginPath(); c.moveTo(x, y); c.lineTo(x, sh); c.stroke();
      c.fillStyle = ink; c.beginPath(); c.arc(x, hy, Math.max(0.55, hr * 0.92), 0, 6.2832); c.fill();
      return;
    }
    const hem = y - h * 0.21, sw = h * 0.082, hw = h * 0.152, swing = Math.sin(ph);
    c.beginPath();
    c.moveTo(x - sw, sh);
    c.quadraticCurveTo(x - sw * 1.15, (sh + hem) / 2, x - hw, hem);
    c.lineTo(x + hw, hem);
    c.quadraticCurveTo(x + sw * 1.15, (sh + hem) / 2, x + sw, sh);
    c.closePath();
    c.fillStyle = robe; c.fill();
    c.strokeStyle = ink; c.lineWidth = Math.max(0.45, h * 0.032); c.stroke();
    c.lineCap = 'round';
    c.lineWidth = Math.max(0.55, h * 0.044);
    c.beginPath();
    c.moveTo(x - h * 0.022, hem); c.lineTo(x - h * 0.022 + swing * h * 0.082, y);
    c.moveTo(x + h * 0.022, hem); c.lineTo(x + h * 0.022 - swing * h * 0.082, y);
    c.stroke();
    c.lineWidth = Math.max(0.45, h * 0.036);
    c.beginPath();
    c.moveTo(x + dir * sw * 0.85, sh + h * 0.04);
    c.lineTo(x + dir * sw * 0.85 + dir * Math.cos(ph) * h * 0.075, sh + h * 0.24);
    c.stroke();
    c.fillStyle = ink; c.beginPath(); c.arc(x, hy, hr, 0, 6.2832); c.fill();
  }
  drawWalkers(c, dt) {
    const G = this.G;
    const inkA = [G.ink[0], G.ink[1], G.ink[2]];
    const robeA = [G.sail[0], G.sail[1], G.sail[2]];
    for (const k of this.walkers) {
      const W = this.walks[k.w];
      k.d += k.sp * dt;
      if (k.d >= W.total) k.d -= W.total;
      const dd = k.dir > 0 ? k.d : (W.total - k.d);
      const p = this.laneAt(W, Math.max(0, Math.min(W.total - 0.001, dd)));
      const x = this.SX(p.u), y = this.SY(p.v);
      if (x < -26 || x > this.stageW + 26 || y < -26 || y > this.stageH + 26) continue;
      const margin = Math.min(W.total * 0.34, 10);
      const fade = clamp01(Math.min(k.d, W.total - k.d) / margin);
      if (fade <= 0.02) continue;
      const depth = clamp01((p.v - 120) / 190);
      const h = this.PX(2.3) * (0.72 + depth * 0.52);
      if (h < 1.1) continue;
      k.ph += dt * (4.6 + k.sp * 0.5);
      const a = (0.86 * fade).toFixed(3);
      this.drawFigure(c, x, y + Math.sin(k.ph * 2) * h * 0.035, h, k.ph, k.dir,
        'rgba(' + (inkA[0] | 0) + ',' + (inkA[1] | 0) + ',' + (inkA[2] | 0) + ',' + a + ')',
        'rgba(' + (robeA[0] | 0) + ',' + (robeA[1] | 0) + ',' + (robeA[2] | 0) + ',' + (0.80 * fade).toFixed(3) + ')');
    }
  }
  drawPois(c) {
    const POIS = this.geo.POIS;
    for (let i = 0; i < POIS.length; i++) {
      const x = this.SX(POIS[i].u), y = this.SY(POIS[i].v);
      if (x < -40 || x > this.stageW + 40 || y < -40 || y > this.stageH + 40) continue;
      const act = i === this.activePoi;
      c.save();
      c.shadowColor = 'rgba(187,64,50,.6)'; c.shadowBlur = 10;
      c.fillStyle = '#bb4032';
      c.beginPath(); c.arc(x, y, act ? 6.2 : 4.4, 0, 6.2832); c.fill();
      c.restore();
      c.strokeStyle = 'rgba(255,235,200,.55)'; c.lineWidth = 1;
      c.beginPath(); c.arc(x, y, act ? 6.2 : 4.4, 0, 6.2832); c.stroke();
      if (act) {
        c.strokeStyle = 'rgba(187,64,50,.55)';
        c.beginPath(); c.arc(x, y, 12, 0, 6.2832); c.stroke();
      }
    }
  }

  /* ===== 主循环 ===== */
  step(dt) {
    const S = this.S;
    S.t += dt;
    this.windNow = this.WIND_DIR * (0.34 + Math.sin(S.t * 0.12) * 0.2 + Math.sin(S.t * 0.047 + 1.7) * 0.16);
    this.windNow *= 1 + this.WX.precip * 0.9;

    this.SN = this.seasonNow(); this.WX = this.weather();
    // 积雪：下雪时渐积（约半分钟成型），雪停缓融
    const snowing = S.mode === 2 ? this.WX.precip : 0;
    this.snowAcc = clamp01(this.snowAcc + (snowing > 0.05 ? dt / 28 * snowing : -dt / 40));

    if (S.todAuto) S.tod = (S.tod + dt / 150) % 1;
    if (S.tour && !S.drag) {
      if (this.VERT) {
        S.y += dt * this.stageH * 0.085;
        if (S.y >= this.maxY) { S.y = this.maxY; this.setTour(false); }
      } else {
        S.x += dt * this.stageW * 0.085;
        if (S.x >= this.maxX) { S.x = this.maxX; this.setTour(false); }
      }
    }
    if (!S.drag && Math.abs(S.vx) > 0.05) {
      S.x -= S.vx; S.vx *= Math.pow(0.94, dt * 60);
      if (S.x < 0 || S.x > this.maxX) S.vx = 0;
    }
    if (this.panT !== undefined && this.panT !== null) {         // 导览平滑跳转
      this.panT += dt;
      const k = Math.min(1, this.panT / this.panDur);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      S.x = this.panX0 + (this.panX1 - this.panX0) * e;
      S.y = this.panY0 + (this.panY1 - this.panY0) * e;
      if (k >= 1) this.panT = null;
    }
    if (Math.abs(S.zoom - S.zoomTo) > 1e-4) {
      const cx = (S.x + this.stageW / 2) / this.DW, cy = (S.y + this.stageH / 2) / this.DH;
      S.zoom += (S.zoomTo - S.zoom) * Math.min(1, dt * 6.5);
      if (Math.abs(S.zoom - S.zoomTo) <= 1e-4) S.zoom = S.zoomTo;
      this.layout();
      S.x = cx * this.DW - this.stageW / 2; S.y = cy * this.DH - this.stageH / 2;
    }
    this.clampXY(); this.ensureTiles(); this.ensureHi();
    this.G = this.grade(); this.applyGrade();

    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawPlate(c);
    this.drawClouds(c, dt);
    this.drawPrecipFar(c, dt);
    this.drawGlints(c, dt);
    this.drawFish(c, dt);
    this.drawRings(c, dt);
    this.drawSplashes(c, dt);
    this.drawFalls(c);
    this.drawBoats(c, dt);
    this.drawSmoke(c, dt);
    this.drawWalkers(c, dt);
    this.drawSnowCover(c);
    this.drawBirds(c, dt);
    this.drawMist(c, dt);
    this.drawPetals(c, dt);
    this.drawPrecipNear(c, dt);
    this.updateFlash(dt);
    if (this.flashA > 0.003) {
      c.globalCompositeOperation = 'screen';
      c.fillStyle = 'rgba(255,255,255,' + this.flashA.toFixed(3) + ')';
      c.fillRect(0, 0, this.stageW, this.stageH);
      c.globalCompositeOperation = 'source-over';
    }
    this.drawPois(c);

    // 缩略图取景框（有变化才通知页面，免得 setData 刷屏）；竖轴按纵向进度
    const left = this.VERT ? (S.y / this.DH * 100) : (S.x / this.DW * 100);
    const w = Math.max(1.2, (this.VERT ? this.stageH / this.DH : this.stageW / this.DW) * 100);
    const sig = left.toFixed(1) + '|' + w.toFixed(1);
    if (sig !== this.mapSent) { this.mapSent = sig; this.onMap(left, w); }
  }

  /* ===== 交互（页面把 touch 事件喂进来） ===== */
  touchStart(touches) {
    this.onFirstTouch();
    if (touches.length >= 2) {
      this.pinch0 = Math.hypot(touches[0].x - touches[1].x, touches[0].y - touches[1].y);
      this.pinchZ0 = this.S.zoomTo;
      this.S.drag = false;
      return;
    }
    this.S.drag = true; this.moved = false; this.S.vx = 0;
    this.setTour(false); this.panT = null;
    this.px0 = touches[0].x; this.py0 = touches[0].y;
    this.tapX = touches[0].x; this.tapY = touches[0].y;
    this.lastMove = Date.now();
  }
  touchMove(touches) {
    if (touches.length >= 2 && this.pinch0) {
      const d = Math.hypot(touches[0].x - touches[1].x, touches[0].y - touches[1].y);
      this.S.zoomTo = Math.max(1, Math.min(3.8, this.pinchZ0 * (d / this.pinch0)));
      this.moved = true;
      return;
    }
    if (!this.S.drag) return;
    const dx = touches[0].x - this.px0, dy = touches[0].y - this.py0;
    if (Math.abs(dx) + Math.abs(dy) > 4) this.moved = true;
    this.S.x -= dx; this.S.y -= dy; this.clampXY();
    const now = Date.now(), dt = Math.max(8, now - this.lastMove);
    this.S.vx = dx / dt * 16; this.lastMove = now;
    this.px0 = touches[0].x; this.py0 = touches[0].y;
  }
  touchEnd() {
    this.pinch0 = 0;
    if (!this.S.drag) return;
    this.S.drag = false;
    if (!this.moved) {
      const lx = this.tapX, ly = this.tapY;
      // 先看是否点中名胜
      const POIS = this.geo.POIS;
      for (let i = 0; i < POIS.length; i++) {
        const x = this.SX(POIS[i].u), y = this.SY(POIS[i].v);
        if (Math.hypot(x - lx, y - ly) < 24) { this.openPoi(i); return; }
      }
      const u = (this.S.x + lx) / this.DW * this.AU, v = (this.S.y - this.offY + ly) / this.DH * this.AV;
      if (u >= 0 && u <= this.AU && v >= 0 && v <= this.AV) {
        if (this.waterAt(u, v) > 0.5) {
          this.addRing(u, v, 1);
          for (let k = 0; k < 2; k++) this.addRing(u + (Math.random() - 0.5) * 7, v + (Math.random() - 0.5) * 2.2, 0.7);
        } else if (this.vegAt(u, v) > 0.30) {
          this.startle(u, v);
          if (this.geo.PETALS) for (let k = 0; k < 9; k++)
            this.spawnPetal(u + (Math.random() - 0.5) * 6, v + (Math.random() - 0.5) * 4, true);
        }
      }
      if (this.activePoi >= 0) this.closePoi();
    }
  }

  /* ===== 页面调用的控制面 ===== */
  openPoi(i) {
    this.activePoi = i;
    this.onPoi(i);
  }
  closePoi() { this.activePoi = -1; this.onPoi(-1); }
  panToPoi(i) {
    const p = this.geo.POIS[i];
    this.setTour(false);
    const tx = Math.max(0, Math.min(this.maxX, p.u / this.AU * this.DW - this.stageW / 2));
    const ty = Math.max(0, Math.min(this.maxY, p.v / this.AV * this.DH - this.stageH / 2));
    this.panX0 = this.S.x; this.panY0 = this.S.y; this.panX1 = tx; this.panY1 = ty;
    this.panDur = Math.min(1.5, 0.42 + Math.abs(tx - this.S.x) * 0.00035); this.panT = 0;
    this.openPoi(i);
  }
  jumpFrac(k) {
    if (this.VERT) this.S.y = Math.max(0, Math.min(this.maxY, k * this.DH - this.stageH / 2));
    else this.S.x = Math.max(0, Math.min(this.maxX, k * this.DW - this.stageW / 2));
    this.S.vx = 0; this.setTour(false); this.panT = null;
  }
  setTod(v) { this.S.tod = v; this.setAuto(false); }
  setAuto(v) { if (this.S.todAuto === v) return; this.S.todAuto = v; this.onUI({ autoOn: v }); }
  setTour(v) { if (this.S.tour === v) return; this.S.tour = v; this.onUI({ tourOn: v }); }
  startTour() {
    if (this.VERT) { if (!this.S.tour && this.S.y >= this.maxY - 1) this.S.y = 0; }
    else if (!this.S.tour && this.S.x >= this.maxX - 1) this.S.x = 0;
    this.setTour(!this.S.tour);
  }
  cycleZoom() {
    const ZOOMS = this.geo.ZOOMS || [1, 2.2, 3.8];
    let zi = 0;
    for (let i = 0; i < ZOOMS.length; i++) if (Math.abs(this.S.zoomTo - ZOOMS[i]) < 0.01) zi = i;
    this.S.zoomTo = ZOOMS[(zi + 1) % ZOOMS.length];
    this.panT = null;
    this.onUI({ zoomLabel: this.S.zoomTo === 1 ? '放大' : (this.S.zoomTo === ZOOMS[ZOOMS.length - 1] ? '复原' : '再放大'), zoomOn: this.S.zoomTo > 1 });
  }
  setMode(m) {
    this.S.mode = m;
    if (m === 0) this.S.wet = 0;
    else if (this.S.wet < 0.32) this.S.wet = 0.60;
  }
  setWet(v) {
    this.S.wet = v;
    if (this.S.mode === 0 && this.S.wet > 0.30) this.S.mode = 1;
  }
}

module.exports = { Engine };
