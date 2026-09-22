/* 环境音 DSP —— 纯函数生成，无 wx 依赖（node 里可跑，用于离线试听）。
   逼真的关键不是滤波噪声，是"颗粒"：在底噪上烘焙成千上万个
   随机相位/频率/衰减的雨滴瞬态。三条循环：
   - drizzle 细雨：高频小滴密集，如雨打叶面
   - heavy   大雨：中频大滴 + 更厚的水洗底噪
   - wind    风：低频起伏的闷响（一阶低通预整形） */

function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pinkBase(d, len, rnd, amp) {
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < len; i++) {
    const w = rnd() * 2 - 1;
    b0 = 0.997 * b0 + 0.029 * w;
    b1 = 0.985 * b1 + 0.031 * w;
    b2 = 0.950 * b2 + 0.048 * w;
    d[i] += (b0 + b1 + b2) * amp;
  }
}

function drops(d, len, sr, rnd, count, fLo, fHi, durLo, durHi, ampLo, ampHi, noisy) {
  for (let k = 0; k < count; k++) {
    const pos = Math.floor(rnd() * len);
    const f = fLo + rnd() * (fHi - fLo);
    const dur = Math.floor((durLo + rnd() * (durHi - durLo)) * sr);
    const amp = ampLo + rnd() * (ampHi - ampLo);
    const ph = rnd() * 6.2832;
    const tau = dur * 0.32;
    for (let j = 0; j < dur; j++) {
      const i = (pos + j) % len;              // 环形写入，循环无缝
      const env = Math.exp(-j / tau);
      const tone = Math.sin(6.2832 * f * j / sr + ph);
      const nz = rnd() * 2 - 1;
      d[i] += (tone * (1 - noisy) + nz * noisy) * env * amp;
    }
  }
}

function normalize(d, len, peak) {
  let mx = 0;
  for (let i = 0; i < len; i++) if (Math.abs(d[i]) > mx) mx = Math.abs(d[i]);
  if (mx > 0) { const g = peak / mx; for (let i = 0; i < len; i++) d[i] *= g; }
}

/* 返回 { drizzle, heavy, wind }，各为 Float32Array（seconds 秒循环） */
function makeAmbienceLoops(sr, seconds) {
  const len = Math.floor(sr * seconds);

  const drizzle = new Float32Array(len);
  const r1 = mulberry(1013);
  pinkBase(drizzle, len, r1, 0.05);
  // 细密小滴：高频短嗒，噪声成分高（雨打叶的碎响）
  drops(drizzle, len, sr, r1, Math.floor(1400 * seconds), 2600, 7800, 0.0015, 0.006, 0.10, 0.42, 0.72);
  normalize(drizzle, len, 0.85);

  const heavy = new Float32Array(len);
  const r2 = mulberry(2027);
  pinkBase(heavy, len, r2, 0.16);
  // 大滴：中频"啵"，音成分多一点
  drops(heavy, len, sr, r2, Math.floor(260 * seconds), 500, 1600, 0.004, 0.014, 0.25, 0.7, 0.45);
  // 同时叠一层密集小滴，大雨也有碎响
  drops(heavy, len, sr, r2, Math.floor(2200 * seconds), 2200, 7000, 0.0015, 0.005, 0.08, 0.30, 0.75);
  normalize(heavy, len, 0.9);

  const wind = new Float32Array(len);
  const r3 = mulberry(3041);
  let lp = 0, lp2 = 0;
  for (let i = 0; i < len; i++) {
    const w = r3() * 2 - 1;
    lp += 0.012 * (w - lp);        // ~85Hz 一阶低通
    lp2 += 0.004 * (lp - lp2);     // 再压一道，得到闷响
    // 缓慢起伏烘进循环里（两个不同周期的正弦叠加，循环整数倍无缝）
    const sw = 0.6 + 0.4 * Math.sin(6.2832 * 2 * i / len) * Math.sin(6.2832 * 3 * i / len + 1.3);
    wind[i] = lp2 * 34 * sw;
  }
  normalize(wind, len, 0.8);

  return { drizzle, heavy, wind, sampleRate: sr, seconds };
}

module.exports = { makeAmbienceLoops };
