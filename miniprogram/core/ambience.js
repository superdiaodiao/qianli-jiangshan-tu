/* 环境音 —— freesound CC0 实录循环（合成方案被用户耳朵否决："电流声"）。
   三条循环：疏雨（郊外场录）、大雨、风；按天候实时调音量交叉混合。
   assets/audio/LICENSES.md 记录来源。

   真机教训：
   - 音频上下文整页只建一次，开/关只是 play/pause；每次 destroy 再重建，iOS 第二次起不出声
   - 循环只有 14~24 秒，靠 loop 属性接缝在 iOS 上有可闻的断口（AAC 首尾静音帧）。
     每条循环用两个上下文轮替：一个快播完时另一个从头起、一秒交叉淡入淡出，缝就听不见了 */

function smooth01(v, a, b) { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); }

const XF = 1.2;          // 交叉淡化时长（秒）
const TICK = 0.3;        // 页面喂 update 的周期（秒）

class Voice {
  constructor(src, owner) {
    this.src = src; this.owner = owner;
    this.ctx = [this._mk(), this._mk()];
    this.cur = 0;            // 正在主奏的上下文
    this.xf = -1;            // >=0 表示正在交叉淡化，值为已进行的秒数
    this.vol = 0;            // 当前目标音量（由 Ambience 平滑后给）
    this.dur = 0;
  }
  _mk() {
    const a = wx.createInnerAudioContext();
    a.src = this.src; a.loop = false; a.volume = 0;
    a.onCanplay(() => { if (!this.dur && a.duration > 0) this.dur = a.duration; });
    a.onEnded(() => {
      // 正常情况下交叉淡化会在结束前接手；万一没接上（掉帧/后台），立刻从另一路起
      if (!this.owner.playing) return;
      if (this.ctx[this.cur] === a && this.xf < 0) this._begin();
    });
    a.onError(() => {
      if (!this.owner.playing) return;
      setTimeout(() => { try { a.src = this.src; if (this.ctx[this.cur] === a) a.play(); } catch (e) {} }, 800);
    });
    return a;
  }
  _begin() {
    // 另一路从头起，开始交叉淡化
    const nx = this.ctx[1 - this.cur];
    try { nx.seek(0); nx.play(); } catch (e) {}
    this.xf = 0;
  }
  start() {
    this.xf = -1;
    const c = this.ctx[this.cur];
    try { c.seek(0); c.play(); } catch (e) {}
  }
  stop() {
    this.xf = -1;
    this.ctx.forEach(c => { try { c.pause(); } catch (e) {} });
  }
  tick(dt) {
    const c = this.ctx[this.cur], n = this.ctx[1 - this.cur];
    if (!this.dur && c.duration > 0) this.dur = c.duration;
    if (this.xf < 0) {
      // 距结束不到一次淡化时长 + 一个周期，就该起另一路了
      const t = c.currentTime || 0;
      if (this.dur > 0 && t > 0 && this.dur - t <= XF + TICK) this._begin();
      try { c.volume = this.vol; } catch (e) {}
      return;
    }
    this.xf += dt;
    const k = Math.min(1, this.xf / XF);
    try { c.volume = this.vol * (1 - k); n.volume = this.vol * k; } catch (e) {}
    if (k >= 1) {
      try { c.pause(); c.seek(0); } catch (e) {}
      this.cur = 1 - this.cur; this.xf = -1;
    }
  }
  destroy() { this.ctx.forEach(c => { try { c.destroy(); } catch (e) {} }); }
}

class Ambience {
  static isSupported() { return typeof wx.createInnerAudioContext === 'function'; }

  constructor(base) {
    this.ok = false;
    this.playing = false;
    try {
      // 静音键下也出声（用户主动点了聆音），并允许与他人音乐混播
      if (wx.setInnerAudioOption) wx.setInnerAudioOption({ obeyMuteSwitch: false, mixWithOther: true });
      this.rainL = new Voice(base + 'rain-light.m4a', this);
      this.rainH = new Voice(base + 'rain-heavy.m4a', this);
      this.wind = new Voice(base + 'wind.m4a', this);
      this.all = [this.rainL, this.rainH, this.wind];
      this.v = { l: 0, h: 0, w: 0 };   // 当前音量（自己做平滑，volume 赋值是跳变的）
      this.t = 0;
      this.ok = true;
    } catch (e) { this.ok = false; }
  }

  start() {
    if (!this.ok) return;
    this.playing = true;
    this.v = { l: 0, h: 0, w: 0 };   // 从静音淡入
    this.all.forEach(vc => vc.start());
  }
  stop() {
    if (!this.ok) return;
    this.playing = false;
    this.all.forEach(vc => vc.stop());
  }

  /* 每 ~0.3s 由页面喂一次当前天候 */
  update(wx_, snowy, windNow) {
    if (!this.ok || !this.playing) return;
    this.t += TICK;
    const pr = wx_.precip;
    // 「盛」(pr≈.66) 时用户嫌小：大雨层提前从 .35 开始进，疏雨层不再压那么多
    const heavyMix = smooth01(pr, 0.35, 1);
    const tl = snowy ? 0 : Math.pow(pr, 0.6) * (1 - heavyMix * 0.35);
    const th = snowy ? 0 : heavyMix;
    const breathe = 0.8 + 0.2 * Math.sin(this.t * 0.3);
    // 晴天也要听得见风：手机外放下 0.1 几乎无声
    const tw = Math.min(1, (0.22 + Math.abs(windNow) * 0.22 + (snowy ? 0.18 + pr * 0.5 : 0) + wx_.storm * 0.25)) * breathe;
    // 向目标各走一步（约 1.5s 到位），避免音量跳变
    const step = (cur, tgt) => cur + (tgt - cur) * 0.22;
    this.v.l = step(this.v.l, tl); this.v.h = step(this.v.h, th); this.v.w = step(this.v.w, tw);
    this.rainL.vol = Math.min(1, this.v.l);
    this.rainH.vol = Math.min(1, this.v.h);
    this.wind.vol = Math.min(1, this.v.w);
    this.all.forEach(vc => vc.tick(TICK));
  }

  destroy() {
    if (!this.ok) return;
    this.stop();
    this.all.forEach(vc => vc.destroy());
    this.ok = false;
  }
}

module.exports = { Ambience };
