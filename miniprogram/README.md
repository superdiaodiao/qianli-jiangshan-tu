# 卧游 —— 治愈系古画画廊（微信小程序）

网页版《千里江山图》可交互长卷的小程序化，并扩展为多画作画廊。
名字取宗炳「澄怀观道，卧以游之」，可自行改。

## 跑起来

1. 装[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)，导入本目录（`miniprogram/`）。
2. AppID：先用「测试号」即可预览；正式发布需注册小程序主体（个人主体即可，本项目不用 web-view，不受个人主体限制）。
3. 图片资源走远程加载，现指向 GitHub Pages 上已部署的资源（见 `config.js`）。
   开发者工具里 `project.config.json` 已关掉域名校验（`urlCheck: false`）；
   **真机预览**需在「详情 → 本地设置」勾选「不校验合法域名」。

## 正式发布前要做的事

- [ ] 资源迁到腾讯云 COS/CDN（GitHub Pages 国内访问慢且不稳），改 `config.js` 一处即可
- [ ] 小程序后台把资源域名加入 **downloadFile 合法域名**
- [ ] 换正式 AppID，起正式名字、做 logo
- [ ] 真机性能过一遍：低端安卓机若掉帧，可把 `core/engine.js` 里粒子池数量减半

## 结构

```
config.js            资源域名（换 CDN 只改这里）
data/paintings.js    画廊登记表：一幅画 = 一条配置
data/qljst-geo.js    《千里江山图》几何数据（由网页版 index.html 程序化抽取）
data/geo-index.js    geo 数据静态登记（小程序不支持动态 require）
core/engine.js       长卷引擎：Canvas 2D，数据驱动，不含画作特有逻辑
pages/gallery/       画廊首页
pages/scroll/        观画页（canvas + 控制台 + 释文卡）
```

## 加一幅新画的流程

1. 找到高清公有领域扫描件，按网页版的做法切片（base 低清底图 + tNN 常规片 + hNN 高清片 + mask 掩膜 + mini 缩略图），传 CDN。
2. 做一份 `data/<id>-geo.js`：HORIZON（山脊线）、LANES（航道）、CHIMNEYS（炊烟点）、WALKS（山径）、FALLS（瀑布）、POIS（释文）、TOD（四时调色）。静态小画可以只给 TOD + POIS，其余传空数组，引擎自动跳过对应效果。
3. `data/geo-index.js` 登记，`data/paintings.js` 加一条 `status: 'ready'` 的配置。

## 与网页版的已知差异

- 小程序 canvas 不支持 `filter: saturate()`，饱和度随时辰的变化省略了；亮度用灰色 multiply 罩层近似，夜景观感基本一致。
- 没有滚轮/键盘，改为：单指拖动、双指缩放、点按交互。
- 「演示/电影模式」（`?film=1`）未移植。

## 后续互动性方向（治愈系，克制地加）

- 环境音：雨声 / 松风 / 古琴，与天候联动（`wx.createInnerAudioContext`，需要音频素材）
- 四时随真实时间：打开时按本地时刻定 `S.tod` 初值
- 呼吸引导模式：画面亮度随呼吸节奏缓慢起伏
- 每日一画 + 订阅消息
```
