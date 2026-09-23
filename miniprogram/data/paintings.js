/* 画廊登记表：一幅画 = 一条配置。
   status: 'ready' 已可观 | 'soon' 备展中。
   新增一幅画：素材上 CDN，补一条配置和对应的 geo 数据文件即可，不动引擎。 */
const { ASSET_BASE } = require('../config.js');

module.exports = [
  {
    id: 'qljst',
    title: '千里江山图',
    artist: '王希孟',
    era: '北宋',
    status: 'ready',
    tags: ['青绿山水', '长卷'],
    line: '独步千载的青绿长卷，可展卷、可入夜、可听雨',
    meta: '绢本设色\n纵五一·五厘米\n横一一九一·五厘米\n北宋政和三年\n今藏故宫博物院',
    thumb: ASSET_BASE + 'mini.jpg',
    cover: ASSET_BASE + 'cover.jpg',   // 画廊封面（5:4 局部）；thumb 是导航条
    engine: {
      assetBase: ASSET_BASE,
      geo: 'qljst-geo',
    },
  },
  {
    id: 'xiaoxia',
    hidden: true,   // 用户观感投票：近白描的清淡不入画廊；素材与配置保留，去掉此行即恢复
    title: '消夏图',
    artist: '刘贯道',
    era: '元',
    status: 'ready',
    tags: ['消夏', '重屏', '白描'],
    line: '蕉荫竹影，卧榻执麈 —— 画中有画的一榻清凉',
    meta: '绢本设色\n纵二九·五厘米\n横七一·一厘米\n元\n今藏纳尔逊-阿特金斯艺术博物馆',
    thumb: ASSET_BASE + 'xiaoxia/mini.jpg',
    engine: {
      assetBase: ASSET_BASE + 'xiaoxia/',
      geo: 'xiaoxia-geo',
    },
  },
  {
    id: 'songfeng',
    hidden: true,   // 同上：绢色暗沉不入画廊；去掉此行即恢复
    title: '静听松风图',
    artist: '马麟',
    era: '南宋',
    status: 'ready',
    tags: ['松风', '高士', '竖轴'],
    line: '解衣磐石，侧耳松涛 —— 满卷都是风的形状',
    meta: '绢本设色\n纵二二六·六厘米\n横一一〇·三厘米\n南宋淳祐六年\n今藏台北故宫博物院',
    thumb: ASSET_BASE + 'songfeng/mini.jpg',
    engine: {
      assetBase: ASSET_BASE + 'songfeng/',
      geo: 'songfeng-geo',
    },
  },
  {
    id: 'luohua',
    title: '落花诗意图',
    artist: '沈周',
    era: '明',
    status: 'ready',
    tags: ['落花', '流水', '粗沈'],
    line: '山空无人，水流花谢 —— 飘瓣拂过，点水成漪',
    meta: '纸本设色\n纵三五·九厘米\n横六〇·一厘米\n明正德元年\n今藏南京博物院',
    thumb: ASSET_BASE + 'luohua/mini.jpg',
    cover: ASSET_BASE + 'luohua/cover.jpg',
    engine: {
      assetBase: ASSET_BASE + 'luohua/',
      geo: 'luohua-geo',
    },
  },
  {
    id: 'yule',
    title: '渔乐图',
    artist: '吴伟',
    era: '明',
    status: 'ready',
    tags: ['渔隐', '浙派', '竖轴'],
    line: '一湾浩渺，渔舟点点 —— 山愈险，水愈闲',
    meta: '绢本设色\n纵二七〇厘米\n横一七三·五厘米\n明\n今藏故宫博物院',
    thumb: ASSET_BASE + 'yule/mini.jpg',
    cover: ASSET_BASE + 'yule/cover.jpg',
    engine: {
      assetBase: ASSET_BASE + 'yule/',
      geo: 'yule-geo',
    },
  },
];
