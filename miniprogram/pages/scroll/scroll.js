const paintings = require('../../data/paintings.js');
const geoIndex = require('../../data/geo-index.js');
const { Engine } = require('../../core/engine.js');
const { Ambience } = require('../../core/ambience.js');

Page({
  data: {
    title: '', artist: '', meta: '', thumb: '',
    pois: [], au: 1,
    todName: '午', wetName: '晴', todVal: 300, wetVal: 0, mode: 0,
    autoOn: false, tourOn: false, zoomOn: false, zoomLabel: '放大',
    mapLeft: 0, mapWidth: 10,
    barPct: 0,
    introShow: true, introGone: false, hintGone: false,
    cardOn: false, cardT: '', cardD: '', activePoi: -1,
    panelHidden: false,
    soundOn: false,
  },

  onLoad(q) {
    const id = (q && q.id) || 'qljst';
    this.painting = paintings.find(p => p.id === id && p.status === 'ready') || paintings[0];
    this.geo = geoIndex[this.painting.engine.geo];
    this._uiThrottle = 0;
    this.setData({
      title: this.painting.title,
      artist: this.painting.artist,
      meta: this.painting.meta || '',
      thumb: this.painting.thumb,
      pois: this.geo.POIS.map(p => ({ t: p.t, u: p.u })),
      au: this.geo.AU,
    });
  },

  onReady() {
    wx.createSelectorQuery().in(this)
      .select('#stage').fields({ node: true, size: true })
      .exec(res => {
        if (!res || !res[0]) return;
        const canvas = res[0].node;
        const dpr = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).pixelRatio || 2;
        this.engine = new Engine({
          canvas, dpr,
          geo: this.geo,
          assetBase: this.painting.engine.assetBase,
          onUI: st => this.applyUI(st),
          onMap: (l, w) => this.setData({ mapLeft: l, mapWidth: w }),
          onPoi: i => this.applyPoi(i),
          onProgress: f => this.setData({ barPct: Math.round(f * 100) }),
          onFirstTouch: () => this.hideIntro(),
        });
        this.canvasNode = canvas;
        this.engine.resize(res[0].width, res[0].height);
      });
  },

  onUnload() {
    if (this.engine) this.engine.destroy();
    this.stopSound();
  },
  onHide() { this.stopSound(true); },
  onShow() { if (this._soundWasOn) this.startSound(); },

  applyUI(st) {
    const out = {};
    const now = Date.now();
    for (const k of ['todName', 'wetName', 'autoOn', 'tourOn', 'zoomOn', 'zoomLabel', 'mode']) {
      if (st[k] !== undefined && st[k] !== this.data[k]) out[k] = st[k];
    }
    // 滑杆回写节流：只有时辰自转等程序性变化才需要，拖动中避免和手指打架
    if (now - this._uiThrottle > 200) {
      if (st.todVal !== undefined && Math.abs(st.todVal - this.data.todVal) > 2 && !this._todTouching) out.todVal = st.todVal;
      if (st.wetVal !== undefined && Math.abs(st.wetVal - this.data.wetVal) > 2 && !this._wetTouching) out.wetVal = st.wetVal;
      if (out.todVal !== undefined || out.wetVal !== undefined) this._uiThrottle = now;
    }
    if (Object.keys(out).length) this.setData(out);
  },
  applyPoi(i) {
    if (i < 0) { this.setData({ cardOn: false, activePoi: -1 }); return; }
    const p = this.geo.POIS[i];
    this.setData({ cardOn: true, cardT: p.t, cardD: p.d, activePoi: i });
    this.hideIntro();
  },

  /* ---- 画面触摸 ---- */
  noop() {},
  // viewport 顶在页面原点，clientX/clientY 即画面坐标
  tp(e) { return (e.touches || []).map(t => ({ x: t.clientX !== undefined ? t.clientX : t.x, y: t.clientY !== undefined ? t.clientY : t.y })); },
  onTouchStart(e) { if (this.engine) this.engine.touchStart(this.tp(e)); },
  onTouchMove(e) { if (this.engine) this.engine.touchMove(this.tp(e)); },
  onTouchEnd() { if (this.engine) this.engine.touchEnd(); },

  /* ---- 卷首 ---- */
  hideIntro() {
    if (this._introHidden) return; this._introHidden = true;
    this.setData({ introGone: true });
    setTimeout(() => this.setData({ introShow: false }), 950);
    setTimeout(() => this.setData({ hintGone: true }), 7000);
  },
  onOpen() { this.hideIntro(); if (this.engine) this.engine.startTour(); },

  /* ---- 控制台 ---- */
  onTod(e) {
    this._todTouching = true;
    if (this.engine) this.engine.setTod(e.detail.value / 1000);
    clearTimeout(this._todT); this._todT = setTimeout(() => { this._todTouching = false; }, 300);
  },
  onWet(e) {
    this._wetTouching = true;
    if (this.engine) this.engine.setWet(e.detail.value / 1000);
    clearTimeout(this._wetT); this._wetT = setTimeout(() => { this._wetTouching = false; }, 300);
  },
  onAuto() { if (this.engine) this.engine.setAuto(!this.engine.S.todAuto); },
  onTour() { if (this.engine) { this.engine.startTour(); this.hideIntro(); } },
  onZoom() { if (this.engine) this.engine.cycleZoom(); },

  /* ---- 聆音：合成环境音，强度跟随天候 ---- */
  startSound() {
    if (this.ambience) return;
    if (!Ambience.isSupported()) {
      wx.showToast({ title: '此机型暂不支持', icon: 'none' });
      return;
    }
    const a = new Ambience();
    if (!a.ok) { wx.showToast({ title: '音频启动失败', icon: 'none' }); return; }
    this.ambience = a;
    this._soundTimer = setInterval(() => {
      if (this.engine && this.ambience)
        this.ambience.update(this.engine.WX, this.engine.S.mode === 2, this.engine.windNow);
    }, 300);
    this.setData({ soundOn: true });
  },
  stopSound(keepIntent) {
    this._soundWasOn = keepIntent ? this.data.soundOn : false;
    if (this._soundTimer) { clearInterval(this._soundTimer); this._soundTimer = null; }
    if (this.ambience) { this.ambience.destroy(); this.ambience = null; }
    if (!keepIntent) this.setData({ soundOn: false });
  },
  onSound() {
    if (this.data.soundOn) this.stopSound();
    else this.startSound();
  },

  /* ---- 存图：当前画面（无控制台）存入相册 ---- */
  onSnapshot() {
    if (!this.canvasNode) return;
    wx.canvasToTempFilePath({
      canvas: this.canvasNode,
      success: res => {
        wx.saveImageToPhotosAlbum({
          filePath: res.tempFilePath,
          success: () => wx.showToast({ title: '已存入相册', icon: 'success' }),
          fail: err => {
            if (err.errMsg && err.errMsg.indexOf('auth') >= 0) {
              wx.showModal({
                title: '需要相册权限',
                content: '请在设置中允许保存到相册',
                confirmText: '去设置',
                success: r => { if (r.confirm) wx.openSetting(); },
              });
            } else if (!(err.errMsg && err.errMsg.indexOf('cancel') >= 0)) {
              wx.showToast({ title: '保存失败', icon: 'none' });
            }
          },
        });
      },
      fail: () => wx.showToast({ title: '截取失败', icon: 'none' }),
    });
  },
  onMode(e) {
    const m = +e.currentTarget.dataset.m;
    if (this.engine) { this.engine.setMode(m); this.hideIntro(); }
    this.setData({ mode: m });
  },
  onChip(e) {
    const i = +e.currentTarget.dataset.i;
    if (this.engine) this.engine.panToPoi(i);
    this.hideIntro();
  },
  onCloseCard() { if (this.engine) this.engine.closePoi(); },

  onMapTouch(e) {
    const t = e.touches && e.touches[0]; if (!t || !this.engine) return;
    const go = rect => {
      const k = Math.max(0, Math.min(1, (t.clientX - rect.left) / rect.width));
      this.engine.jumpFrac(k);
      this.hideIntro();
    };
    if (this._mapRect) { go(this._mapRect); return; }
    wx.createSelectorQuery().in(this).select('.mapWrap').boundingClientRect(r => {
      if (r) { this._mapRect = r; go(r); }
    }).exec();
  },

  onPanel() {
    this.setData({ panelHidden: !this.data.panelHidden }, () => {
      this._mapRect = null;
      wx.createSelectorQuery().in(this).select('#stage').fields({ size: true }).exec(res => {
        if (res && res[0] && this.engine) this.engine.resize(res[0].width, res[0].height);
      });
    });
  },

  goBack() {
    if (this._leaving) return;          // touchend 与 tap 可能双触发，防抖
    this._leaving = true;
    setTimeout(() => { this._leaving = false; }, 600);
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/gallery/gallery' }) });
    } else {
      wx.reLaunch({ url: '/pages/gallery/gallery' });
    }
  },

  onShareAppMessage() {
    return { title: this.painting.title + ' · ' + this.painting.artist, path: '/pages/scroll/scroll?id=' + this.painting.id };
  },
  onShareTimeline() {
    return { title: this.painting.title + ' · 卧游' };
  },
});
