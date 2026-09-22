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
    engine: {
      assetBase: ASSET_BASE,
      geo: 'qljst-geo',
    },
  },
  {
    id: 'gaoge',
    title: '高阁消夏图',
    artist: '佚名',
    era: '宋',
    status: 'soon',
    tags: ['界画', '避暑'],
    line: '水殿风来，备展中 —— 拟作荷风、波光与檐铃',
    thumb: '',
  },
  {
    id: 'songfeng',
    title: '松风亭图',
    artist: '佚名',
    era: '宋',
    status: 'soon',
    tags: ['松风', '幽亭'],
    line: '万壑松风，备展中 —— 拟作松涛摇动与山岚',
    thumb: '',
  },
  {
    id: 'luohua',
    title: '落花诗意图',
    artist: '佚名',
    era: '明',
    status: 'soon',
    tags: ['落花', '流水'],
    line: '花落水流红，备展中 —— 拟作飘瓣与点水成漪',
    thumb: '',
  },
];
