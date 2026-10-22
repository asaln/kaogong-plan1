# 考公备考计划表（2026.10.15 - 2027.11.27 国考前）

多端自动同步的在线打卡网站。部署方法、云同步设置（GitHub Gist）见 **同步说明.md**。

## 文件结构

- `index.html` 页面骨架
- `404.html`   刷新兜底（与 index.html 相同）
- `css/style.css` 样式
- `js/app.js`  业务逻辑（渲染 / 编辑 / 打卡 / 导入导出）
- `js/sync.js` 云同步适配层（封装 GitHub Gist 读写）
- `js/data.js`  计划数据（409 天每日任务 + 58 周计划 + 关键节点）
- `data/plan-data.json` 结构化数据副本（GitHub Actions 自动构建用，可保留也可删除）

## 本地预览

直接双击 `index.html` 用浏览器打开即可（打卡存在浏览器本地）。
多端同步需按「同步说明.md」配置 GitHub Gist。
