/* 资源域名统一在这里换。
   全部素材（千里江山贴图、落花诗意图、环境音）都在 GitHub Pages 仓库根目录；
   将来迁腾讯云 COS + CDN（国内更快）只改这一行，
   并在小程序后台把域名加进 downloadFile 合法域名。 */
const ASSET_BASE = 'https://superdiaodiao.github.io/qianli-jiangshan-tu/';
/* 环境音先走 COS：真机上 InnerAudioContext 播网络音频要求域名在
   小程序后台「downloadFile 合法域名」里，github.io 不在，COS 域名已配。
   贴图不受域名校验限制，等 yule/ 传上桶后整体切过去。 */
const COS_BASE = 'https://woyou-1318514885.cos.ap-shanghai.myqcloud.com/';
module.exports = {
  ASSET_BASE,
  AUDIO_BASE: COS_BASE + 'audio/',
};
