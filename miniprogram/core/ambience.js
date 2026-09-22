/* 环境音 —— freesound CC0 实录循环（合成方案被用户耳朵否决："电流声"）。
   三条循环：疏雨（郊外场录）、大雨、风；按天候实时调音量交叉混合。
   assets/audio/LICENSES.md 记录来源。 */

function smooth01(v, a, b) { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); }

class Ambience {
  static isSupported() { return typeof wx.createInnerAudioContext === 'function'; }

  constructor(base) {
    base = base || '/assets/audio/';
    this.ok = false;
    try {
      // 静音键下也出声（用户主动点了聆音），并允许与他人音乐混播
      if (wx.setInnerAudioOption) wx.setInnerAudioOption({ obeyMuteSwitch: false, mixWithOther: true });
      const mk = f => {
        const a = wx.createInnerAudioContext();
        a.src = base + f; a.loop = true; a.volume = 0; a.autoplay = true;
        return a;
      };
      this.rainL = mk('rain-light.m4a');
      this.rainH = mk('rain-heavy.m4a');
      this.wind = mk('wind.m4a');
      this.v = { l: 0, h: 0, w: 0 };   // 当前音量（自己做平滑，volume 赋值是跳变的）
      this.t = 0;
      this.ok = true;
    } catch (e) { this.ok = false; }
  }

  /* 每 ~0.3s 由页面喂一次当前天候 */
  update(wx_, snowy, windNow) {
    if (!this.ok) return;
    this.t += 0.3;
    const pr = wx_.precip;
    const heavyMix = smooth01(pr, 0.45, 1);
    const tl = snowy ? 0 : Math.pow(pr, 0.7) * 0.85 * (1 - heavyMix * 0.45);
    const th = snowy ? 0 : Math.pow(heavyMix, 1.1);
    const breathe = 0.8 + 0.2 * Math.sin(this.t * 0.3);
    const tw = Math.min(1, (0.10 + Math.abs(windNow) * 0.22 + (snowy ? 0.18 + pr * 0.5 : 0) + wx_.storm * 0.25)) * breathe;
    // 向目标各走一步（约 1.5s 到位），避免音量跳变
    const step = (cur, tgt) => cur + (tgt - cur) * 0.22;
    this.v.l = step(this.v.l, tl); this.v.h = step(this.v.h, th); this.v.w = step(this.v.w, tw);
    try {
      this.rainL.volume = Math.min(1, this.v.l);
      this.rainH.volume = Math.min(1, this.v.h);
      this.wind.volume = Math.min(1, this.v.w);
    } catch (e) {}
  }

  destroy() {
    if (!this.ok) return;
    try { this.rainL.destroy(); this.rainH.destroy(); this.wind.destroy(); } catch (e) {}
    this.ok = false;
  }
}

module.exports = { Ambience };
