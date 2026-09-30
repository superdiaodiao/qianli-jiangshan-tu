const paintings = require('../../data/paintings.js');
const geoIndex = require('../../data/geo-index.js');
const { Engine } = require('../../core/engine.js');
const { Ambience } = require('../../core/ambience.js');
const { buildCard } = require('../../core/sharecard.js');
const shareVerse = require('../../data/sharemeta.js');
const { AUDIO_BASE, ASSET_BASE } = require('../../config.js');

/* 分享标题的时辰/天气前缀："暮色里的《千里江山图》""雪中的《关山积雪图》" */
function sharePrefix(todName, mode) {
  if (mode === 1) return '雨中的';
  if (mode === 2) return '雪中的';
  return { 晓: '晨光里的', 午: '午后的', 暮: '暮色里的', 夜: '夜色里的' }[todName] || '';
}

/* 四时随真实时间：打开画就是此刻的光线。
   5 点=晓(0)，12 点=午(.30)，18 点=暮(.60)，22 点=夜(.84)，次日 5 点回晓 */
function todFromClock() {
  const d = new Date();
  let h = d.getHours() + d.getMinutes() / 60;
  if (h < 5) h += 24;
  const pts = [[5, 0], [12, 0.30], [18, 0.60], [22, 0.84], [29, 1]];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (h >= a[0] && h <= b[0]) return a[1] + (b[1] - a[1]) * (h - a[0]) / (b[0] - a[0]);
  }
  return 0.30;
}

Page({
  data: {
    title: '', artist: '', meta: '', thumb: '',
    pois: [], au: 1,
    todName: '午', wetName: '晴', todVal: 300, wetVal: 0, mode: 0,
    autoOn: false, tourOn: false, zoomOn: false, zoomLabel: '放大',
    mapLeft: 0, mapWidth: 10,
    barPct: 0,
    introShow: true, introGone: false, guideShow: false, guideTaps: [],
    cardOn: false, cardT: '', cardD: '', activePoi: -1,
    panelHidden: false,
    soundOn: false,
    uiTop: 60, fabTop: 100,   // onLoad 按胶囊实测覆盖
  },

  onLoad(q) {
    // 悬浮按钮定位以微信胶囊实测矩形为基准：返回键与胶囊同排，音/存在胶囊正下方
    try {
      const mb = wx.getMenuButtonBoundingClientRect();
      if (mb && mb.top > 0 && mb.top < 200) this.setData({ uiTop: mb.top, fabTop: mb.bottom + 10 });
    } catch (e) { /* 取不到就用默认值 */ }
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
      vertical: !!this.geo.VERTICAL,   // 竖轴：隐藏横向缩略导航，改用右侧竖向缩略图
      vmapW: 64, vmapH: Math.round(64 * this.geo.AV / this.geo.AU),
      noRain: !!(this.geo.MODES && this.geo.MODES.indexOf(1) < 0),   // 雪景画不下雨
      hintTap: this.geo.HINT_TAP || '点水面起涟漪 · 点林木惊飞鸟',
      hasBell: !!this.geo.BELL,
      hintNote: this.geo.HINT_NOTE || '',   // 例：说明鸟兽是后添的、比例略放大
      guideTaps: (this.geo.HINT_TAP || '点水面起涟漪 · 点林木惊飞鸟').split(' · '),
      bellOn: (() => { try { return wx.getStorageSync('bellOff') !== true; } catch (e) { return true; } })(),
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
          tod: todFromClock(),
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
    if (this.ambience) { this.ambience.destroy(); this.ambience = null; }
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
    // 一打开就在下雪的画：展卷即起环境音（总由手势触发）；用户手动关过的不打扰
    if (this.geo.DEFAULT_WX && !this.data.soundOn && !this._soundUserOff) this.startSound();
    this.setData({ introGone: true });
    setTimeout(() => this.setData({ introShow: false }), 950);
    // 每幅画第一次展卷：卷首淡出后弹出玩法卡片（真机反馈：原来右上角的小字提示根本没注意到）
    let seen = false;
    try { seen = wx.getStorageSync('guide_' + this.painting.id) === true; } catch (e) {}
    if (!seen) setTimeout(() => this.setData({ guideShow: true }), 1000);
  },
  onGuide() { this.setData({ guideShow: true }); },
  onGuideOk() {
    if (this._guideLock && Date.now() - this._guideLock < 500) return;
    this._guideLock = Date.now();
    this.setData({ guideShow: false });
    try { wx.setStorageSync('guide_' + this.painting.id, true); } catch (e) {}
    if (this.engine) this.engine.showTapHints();   // 画上直接圈出能点的地方
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

  /* ---- 聆音：实录环境音，强度跟随天候。音频上下文整页只建一次，开关只 play/pause ---- */
  startSound() {
    if (!this.ambience) {
      if (!Ambience.isSupported()) {
        wx.showToast({ title: '此机型暂不支持', icon: 'none' });
        return;
      }
      const a = new Ambience(AUDIO_BASE, { bell: !!this.geo.BELL });
      a.setBell(this.data.bellOn);
      if (!a.ok) { wx.showToast({ title: '音频启动失败', icon: 'none' }); return; }
      this.ambience = a;
    }
    this.ambience.start();
    if (!this._soundTimer) {
      this._soundTimer = setInterval(() => {
        if (this.engine && this.ambience)
          this.ambience.update(this.engine.WX, this.engine.S.mode === 2, this.engine.windNow, this.engine.G.lamp);
      }, 300);
    }
    this.setData({ soundOn: true });
  },
  stopSound(keepIntent) {
    this._soundWasOn = keepIntent ? this.data.soundOn : false;
    if (this._soundTimer) { clearInterval(this._soundTimer); this._soundTimer = null; }
    if (this.ambience) this.ambience.stop();
    if (!keepIntent) this.setData({ soundOn: false });
  },
  onSound() {
    if (this.data.soundOn) { this.stopSound(); this._soundUserOff = true; }   // 手动关过就不再自动开
    else this.startSound();
  },
  // touchend 与 tap 可能双触发，各自防抖
  onSoundTap() {
    if (this._sndLock && Date.now() - this._sndLock < 500) return;
    this._sndLock = Date.now();
    this.onSound();
  },
  // 钟声开关：有的人不喜欢钟声；选择记在本地
  onBellTap() {
    if (this._bellLock && Date.now() - this._bellLock < 500) return;
    this._bellLock = Date.now();
    const on = !this.data.bellOn;
    this.setData({ bellOn: on });
    try { wx.setStorageSync('bellOff', !on); } catch (e) {}
    // 钟声挂在环境音上：聆音关着时点开钟声，顺手把聆音打开，否则开了也听不见
    if (on && !this.data.soundOn) this.startSound();
    if (this.ambience) this.ambience.setBell(on, true);
    wx.showToast({ title: on ? '钟声已开' : '钟声已关', icon: 'none', duration: 1000 });
  },
  onSnapTap() {
    if (this._snapLock && Date.now() - this._snapLock < 800) return;
    this._snapLock = Date.now();
    this.onSnapshot();
  },

  /* ---- 存图：点按直接生成时刻画卡，浮层里预览、发朋友、存相册 ---- */
  onSnapshot() {
    if (!this.canvasNode) return;
    this.makeCard();
  },
  // 截取当前画布（实时天光+天气，控制台不入画；朱点、玩法圈也先隐去一帧再截）
  snapStage() {
    const eng = this.engine;
    const shot = () => new Promise((resolve, reject) => {
      wx.canvasToTempFilePath({
        canvas: this.canvasNode,
        success: res => resolve(res.tempFilePath),
        fail: reject,
      });
    });
    if (!eng) return shot();
    return eng.hideMarks(true).then(shot).then(
      p => { eng.hideMarks(false); return p; },
      e => { eng.hideMarks(false); throw e; });
  },
  makeCard() {
    wx.showLoading({ title: '题款钤印…', mask: true });
    let sign = '';
    try { sign = wx.getStorageSync('signName') || ''; } catch (e) {}
    this.snapStage()
      .then(snapPath => {
        this._lastSnap = snapPath;
        return new Promise((resolve, reject) => {
          wx.createSelectorQuery().in(this)
            .select('#cardCv').fields({ node: true })
            .exec(res => {
              if (!res || !res[0] || !res[0].node) { reject(new Error('no card canvas')); return; }
              this._cardNode = res[0].node;
              buildCard(this._cardNode, {
                snapPath,
                title: this.painting.title,
                artist: this.painting.artist,
                era: this.painting.era || '',
                verse: shareVerse[this.painting.id] || '',
                todName: this.data.todName,
                mode: this.data.mode,
                sign,
                qrUrl: ASSET_BASE + 'wxacode.jpg',
              }).then(resolve, reject);
            });
        });
      })
      .then(cardPath => {
        wx.hideLoading();
        this.setData({ cardImg: cardPath, cardShow: true, signName: sign });
      })
      .catch(() => { wx.hideLoading(); wx.showToast({ title: '生成失败', icon: 'none' }); });
  },
  onCardClose() { this.setData({ cardShow: false }); },
  // 落款：input type=nickname，键盘会推荐微信昵称；填过记住，改一次即重新题款
  onSignChange(e) {
    const name = (e.detail.value || '').trim().slice(0, 12);
    if (name === (this.data.signName || '')) return;
    try { wx.setStorageSync('signName', name); } catch (err) {}
    this.setData({ signName: name });
    if (this._lastSnap && this._cardNode) {
      buildCard(this._cardNode, {
        snapPath: this._lastSnap,
        title: this.painting.title,
        artist: this.painting.artist,
        era: this.painting.era || '',
        verse: shareVerse[this.painting.id] || '',
        todName: this.data.todName,
        mode: this.data.mode,
        sign: name,
        qrUrl: ASSET_BASE + 'wxacode.jpg',
      }).then(p => this.setData({ cardImg: p })).catch(() => {});
    }
  },
  onCardShare() {
    if (!this.data.cardImg) return;
    if (wx.showShareImageMenu) {
      wx.showShareImageMenu({ path: this.data.cardImg });
    } else {
      this.saveToAlbum(this.data.cardImg);
      wx.showToast({ title: '已存相册，可去聊天发送', icon: 'none' });
    }
  },
  onCardSave() { if (this.data.cardImg) this.saveToAlbum(this.data.cardImg); },
  onCardRaw() { if (this._lastSnap) this.saveToAlbum(this._lastSnap); },
  saveToAlbum(filePath) {
    wx.saveImageToPhotosAlbum({
      filePath,
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
  onMode(e) {
    const m = +e.currentTarget.dataset.m;
    if (this.engine) { this.engine.setMode(m); this.hideIntro(); }
    this.setData({ mode: m });
    // 选了雨/雪就顺手把环境音打开；用户主动关过的不打扰
    if (m !== 0 && !this.data.soundOn && !this._soundUserOff) this.startSound();
  },
  onVMapTouch(e) {
    const t = e.touches && e.touches[0]; if (!t || !this.engine) return;
    const go = rect => {
      const k = Math.max(0, Math.min(1, (t.clientY - rect.top) / rect.height));
      this.engine.jumpFrac(k);
      this.hideIntro();
    };
    if (this._vmapRect) { go(this._vmapRect); return; }
    wx.createSelectorQuery().in(this).select('.vmap').boundingClientRect(r => {
      if (r) { this._vmapRect = r; go(r); }
    }).exec();
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
      this._mapRect = null; this._vmapRect = null;
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

  /* 转发卡片带"此刻"：标题按时辰天气措辞，封面抓当前画面截屏。
     imageUrl 异步走 promise 字段（基础库 2.12+，超时自动退回默认封面） */
  onShareAppMessage() {
    const title = sharePrefix(this.data.todName, this.data.mode) + '《' + this.painting.title + '》';
    const path = '/pages/scroll/scroll?id=' + this.painting.id;
    const base = { title, path, imageUrl: this.painting.cover || this.painting.thumb };
    return Object.assign({}, base, {
      promise: this.snapStage()
        .then(p => Object.assign({}, base, { imageUrl: p }))
        .catch(() => base),
    });
  },
  onShareTimeline() {
    return { title: sharePrefix(this.data.todName, this.data.mode) + '《' + this.painting.title + '》 · 卧游观画' };
  },
});
