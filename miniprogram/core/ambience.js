/* 环境音 —— freesound CC0 实录循环（合成方案被用户耳朵否决："电流声"）。
   三条循环：疏雨（郊外场录）、大雨、风；按天候实时调音量交叉混合。
   assets/audio/LICENSES.md 记录来源。

   真机教训：三条 InnerAudioContext 建一次、整页复用；开/关只是 play/pause。
   之前每次关都 destroy、再开重建，iOS 上第二次起 autoplay 常常不出声。
   loop 在部分 iOS 版本不生效，onEnded 里 seek(0)+play 兜底。 */

function smooth01(v, a, b) { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); }

class Ambience {
  static isSupported() { return typeof wx.createInnerAudioContext === 'function'; }

  constructor(base) {
    this.ok = false;
    this.playing = false;
    try {
      // 静音键下也出声（用户主动点了聆音），并允许与他人音乐混播
      if (wx.setInnerAudioOption) wx.setInnerAudioOption({ obeyMuteSwitch: false, mixWithOther: true });
      const mk = f => {
        const a = wx.createInnerAudioContext();
        const ent = { a, src: base + f, err: 0 };
        a.loop = true; a.volume = 0;
        a.onCanplay(() => { if (this.playing) this._play(ent); });
        a.onEnded(() => { if (this.playing) { try { a.seek(0); a.play(); } catch (e) {} } });
        a.onError(() => {
          // 网络抖一下就重设 src 再来，最多两次
          if (ent.err++ < 2 && this.playing) setTimeout(() => { try { a.src = ent.src; a.play(); } catch (e) {} }, 800);
        });
        a.src = ent.src;
        return ent;
      };
      this.rainL = mk('rain-light.m4a');
      this.rainH = mk('rain-heavy.m4a');
      this.wind = mk('wind.m4a');
      this.all = [this.rainL, this.rainH, this.wind];
      this.v = { l: 0, h: 0, w: 0 };   // 当前音量（自己做平滑，volume 赋值是跳变的）
      this.t = 0;
      this.ok = true;
    } catch (e) { this.ok = false; }
  }

  _play(ent) { try { ent.a.play(); } catch (e) {} }

  start() {
    if (!this.ok) return;
    this.playing = true;
    this.v = { l: 0, h: 0, w: 0 };   // 从静音淡入
    this.all.forEach(ent => { ent.err = 0; this._play(ent); });
  }
  stop() {
    if (!this.ok) return;
    this.playing = false;
    this.all.forEach(ent => { try { ent.a.pause(); } catch (e) {} });
  }

  /* 每 ~0.3s 由页面喂一次当前天候 */
  update(wx_, snowy, windNow) {
    if (!this.ok || !this.playing) return;
    this.t += 0.3;
    const pr = wx_.precip;
    const heavyMix = smooth01(pr, 0.45, 1);
    const tl = snowy ? 0 : Math.pow(pr, 0.7) * 0.85 * (1 - heavyMix * 0.45);
    const th = snowy ? 0 : Math.pow(heavyMix, 1.1);
    const breathe = 0.8 + 0.2 * Math.sin(this.t * 0.3);
    // 晴天也要听得见风：手机外放下 0.1 几乎无声
    const tw = Math.min(1, (0.22 + Math.abs(windNow) * 0.22 + (snowy ? 0.18 + pr * 0.5 : 0) + wx_.storm * 0.25)) * breathe;
    // 向目标各走一步（约 1.5s 到位），避免音量跳变
    const step = (cur, tgt) => cur + (tgt - cur) * 0.22;
    this.v.l = step(this.v.l, tl); this.v.h = step(this.v.h, th); this.v.w = step(this.v.w, tw);
    try {
      this.rainL.a.volume = Math.min(1, this.v.l);
      this.rainH.a.volume = Math.min(1, this.v.h);
      this.wind.a.volume = Math.min(1, this.v.w);
    } catch (e) {}
  }

  destroy() {
    if (!this.ok) return;
    this.stop();
    this.all.forEach(ent => { try { ent.a.destroy(); } catch (e) {} });
    this.ok = false;
  }
}

module.exports = { Ambience };
