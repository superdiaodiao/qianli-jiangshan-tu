/* 小程序不支持动态 require，这里静态登记所有画作的几何数据 */
module.exports = {
  'qljst-geo': require('./qljst-geo.js'),
  'luohua-geo': require('./luohua-geo.js'),
};
