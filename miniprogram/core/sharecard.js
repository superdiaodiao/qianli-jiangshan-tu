/* 时刻画卡：把"此刻的画面"合成一张竖版卡片（1080×1620）。
   画面是实时天光+天气的截屏，每张卡都独一份——这正是值得发出去的理由。
   小程序码从 CDN 加载；加载失败时退化为文字署名，卡片照常生成。 */

const W = 1080, H = 1620;
const PAD = 44;                  // 版心留白
const IMG_Y = PAD, IMG_H = 1120; // 画面区
const QR = 172;                  // 小程序码边长

function loadImage(canvas, src) {
  return new Promise((resolve) => {
    const img = canvas.createImage();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* 底部题字的时辰天气一笔："暮雨时分"/"夜色如洗" */
function momentText(todName, mode) {
  if (mode === 1) return todName + '雨时分';
  if (mode === 2) return todName + '雪时分';
  return { 晓: '晓色初透', 午: '日正当午', 暮: '暮色四合', 夜: '夜色如洗' }[todName] || '';
}

/**
 * @param canvas  隐藏的 type=2d canvas 节点（cardCv）
 * @param opts { snapPath, title, artist, era, verse, todName, mode, qrUrl }
 * @returns Promise<tempFilePath>
 */
function buildCard(canvas, opts) {
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  return Promise.all([
    loadImage(canvas, opts.snapPath),
    opts.qrUrl ? loadImage(canvas, opts.qrUrl) : Promise.resolve(null),
  ]).then(([snap, qr]) => {
    if (!snap) throw new Error('snapshot load failed');

    // 米白卡底
    ctx.fillStyle = '#f4eee1';
    ctx.fillRect(0, 0, W, H);

    // 画面区：圆角裁切 + cover 裁剪（截屏是整屏竖图，取中）
    const iw = W - PAD * 2;
    ctx.save();
    roundRect(ctx, PAD, IMG_Y, iw, IMG_H, 14);
    ctx.clip();
    const scale = Math.max(iw / snap.width, IMG_H / snap.height);
    const dw = snap.width * scale, dh = snap.height * scale;
    ctx.drawImage(snap, PAD + (iw - dw) / 2, IMG_Y + (IMG_H - dh) / 2, dw, dh);
    ctx.restore();
    // 画面描一条极细的边，像装裱的绫
    roundRect(ctx, PAD, IMG_Y, iw, IMG_H, 14);
    ctx.strokeStyle = 'rgba(60,52,40,.18)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 底部题字区
    const ty = IMG_Y + IMG_H;
    const serif = '"Songti SC","Noto Serif SC",serif';

    ctx.fillStyle = '#3a352c';
    ctx.font = '600 58px ' + serif;
    ctx.fillText('《' + opts.title + '》', PAD, ty + 106);
    const tw = ctx.measureText('《' + opts.title + '》').width;
    ctx.fillStyle = '#8d8678';
    ctx.font = '34px ' + serif;
    ctx.fillText(opts.era + ' · ' + opts.artist, PAD + tw + 18, ty + 104);

    ctx.fillStyle = '#6f6a5e';
    ctx.font = '40px ' + serif;
    ctx.fillText(opts.verse || '', PAD, ty + 186);

    const d = new Date();
    const dateLine = d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 · '
      + momentText(opts.todName, opts.mode);
    ctx.fillStyle = '#a29b8b';
    ctx.font = '32px ' + serif;
    ctx.fillText(dateLine, PAD, ty + 258);

    // 落款独立成行，如题跋
    if (opts.sign) {
      ctx.fillStyle = '#5d5749';
      ctx.font = '34px ' + serif;
      ctx.fillText(opts.sign + ' 同游', PAD, ty + 336);
    }

    // 朱红小印，收住整张卡
    ctx.fillStyle = '#bb4032';
    ctx.font = '600 30px ' + serif;
    ctx.fillText('卧游观画', PAD, H - 64);

    // 小程序码：右下；没有码就只留署名
    if (qr) {
      const qx = W - PAD - QR, qy = ty + 92;
      ctx.save();
      ctx.beginPath();
      ctx.arc(qx + QR / 2, qy + QR / 2, QR / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(qr, qx, qy, QR, QR);
      ctx.restore();
      ctx.fillStyle = '#a29b8b';
      ctx.font = '26px ' + serif;
      const cap = '长按识别 · 入画';
      ctx.fillText(cap, qx + QR / 2 - ctx.measureText(cap).width / 2, qy + QR + 46);
    }

    return new Promise((resolve, reject) => {
      wx.canvasToTempFilePath({
        canvas,
        fileType: 'jpg',
        quality: 0.92,
        success: r => resolve(r.tempFilePath),
        fail: reject,
      });
    });
  });
}

module.exports = { buildCard };
