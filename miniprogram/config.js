/* 资源域名统一在这里换。
   全部素材（千里江山贴图、落花诗意图、环境音）都在 GitHub Pages 仓库根目录；
   将来迁腾讯云 COS + CDN（国内更快）只改这一行，
   并在小程序后台把域名加进 downloadFile 合法域名。 */
const ASSET_BASE = 'https://superdiaodiao.github.io/qianli-jiangshan-tu/';
module.exports = {
  ASSET_BASE,
  AUDIO_BASE: ASSET_BASE + 'audio/',
};
