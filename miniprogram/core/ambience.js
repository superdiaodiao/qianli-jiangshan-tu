/* 合成环境音 —— 雨滴瞬态烘焙进循环缓冲，非滤波噪声（那听着像电视雪花）。
   三条循环（细雨/大雨/风）按天候混音；DSP 在 rain-dsp.js，node 可离线试听。
   机型不支持 wx.createWebAudioContext 时静默降级。 */
const { makeAmbienceLoops } = require('./rain-dsp.js');

function smooth01(v, a, b) { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); }

class Ambience {
  static isSupported() { return typeof wx.createWebAudioContext === 'function'; }

  constructor() {
    this.ok = false;
    try {
      const ctx = this.ctx = wx.createWebAudioContext();
      const sr = ctx.sampleRate || 44100;
      const loops = makeAmbienceLoops(sr, 6);

      const mk = (arr) => {
        const buf = ctx.createBuffer(1, arr.length, sr);
        const ch = buf.getChannelData(0);
        ch.set ? ch.set(arr) : arr.forEach((v, i) => { ch[i] = v; });
        const src = ctx.createBufferSource();
        src.buffer = buf; src.loop = true;
        const gain = ctx.createGain(); gain.gain.value = 0;
        src.connect(gain); gain.connect(ctx.destination);
        src.start(0);
        return { src, gain };
      };
      this.drizzle = mk(loops.drizzle);
      this.heavy = mk(loops.heavy);
      this.wind = mk(loops.wind);
      this.t = 0;
      this.ok = true;
    } catch (e) { this.ok = false; }
  }

  /* 每 ~0.3s 由页面喂一次当前天候 */
  update(wx_, snowy, windNow) {
    if (!this.ok) return;
    this.t += 0.3;
    try {
      const now = this.ctx.currentTime;
      const pr = wx_.precip;
      // 细雨为主体，雨大后大滴层渐入、细雨层稍退
      const heavyMix = smooth01(pr, 0.42, 1);
      const g1 = snowy ? 0 : Math.pow(pr, 0.8) * 0.40 * (1 - heavyMix * 0.35);
      const g2 = snowy ? 0 : Math.pow(heavyMix, 1.2) * 0.5;
      this.drizzle.gain.gain.setTargetAtTime(g1, now, 0.4);
      this.heavy.gain.gain.setTargetAtTime(g2, now, 0.5);
      const breathe = 0.75 + 0.25 * Math.sin(this.t * 0.35);
      const gw = (0.06 + Math.abs(windNow) * 0.10 + (snowy ? pr * 0.16 : 0) + wx_.storm * 0.10) * breathe;
      this.wind.gain.gain.setTargetAtTime(gw, now, 0.6);
    } catch (e) { /* 个别机型 param 接口缺失时保持当前音量 */ }
  }

  destroy() {
    if (!this.ok) return;
    try {
      this.drizzle.src.stop(); this.heavy.src.stop(); this.wind.src.stop();
      this.ctx.close();
    } catch (e) {}
    this.ok = false;
  }
}

module.exports = { Ambience };
