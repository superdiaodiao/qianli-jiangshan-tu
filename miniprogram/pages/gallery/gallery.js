const paintings = require('../../data/paintings.js');

Page({
  data: { paintings },
  onOpen(e) {
    const { id, status } = e.currentTarget.dataset;
    if (status !== 'ready') {
      wx.showToast({ title: '备展中，敬请期待', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/scroll/scroll?id=' + id });
  },
  onShareAppMessage() {
    return { title: '卧游 · 治愈系古画画廊', path: '/pages/gallery/gallery' };
  },
  onShareTimeline() {
    return { title: '卧游 · 治愈系古画画廊' };
  },
});
