/* 全部素材走腾讯云 COS（上海，公有读；桶内目录结构与仓库根目录一致）。
   国内真机比 GitHub Pages 快得多；且 InnerAudioContext 播网络音频要求域名在
   小程序后台「downloadFile 合法域名」里，COS 域名已配、github.io 没配。
   网页版母本仍在 https://superdiaodiao.github.io/qianli-jiangshan-tu/ */
const ASSET_BASE = 'https://woyou-1318514885.cos.ap-shanghai.myqcloud.com/';
module.exports = {
  ASSET_BASE,
  AUDIO_BASE: ASSET_BASE + 'audio/',
};
