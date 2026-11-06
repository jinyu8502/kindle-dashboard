# Kindle 看板 · 工具包

配合《Kindle 改造成天气 / 日程 / 待办看板》教程使用。

## 目录说明

```
kit/
├─ dashboard/           ← 渲染程序（跑在电脑或 GitHub 上，不在 Kindle 上）
│  ├─ render.mjs        主程序，不用改
│  ├─ config.json       ★ 要改：城市、经纬度、日历链接
│  └─ todo.txt          ★ 要改：你的待办
├─ out/
│  └─ dashboard.png     生成出来的图片（自动产生）
├─ kindle/kindle-dash/  ← 整个文件夹拷到 Kindle 的 extensions/ 里
│  ├─ menu.json         KUAL 菜单
│  └─ bin/
│     ├─ start.sh       启动脚本（★ 要改里面的图片地址）
│     └─ stop.sh        停止脚本
└─ .github/workflows/
   └─ render.yml        每 30 分钟自动出图
```

## 三个必须改的地方

| 文件 | 改什么 |
|---|---|
| `dashboard/config.json` | `city`（城市名）、`latitude` / `longitude`（经纬度）、`calendarIcsUrl`（可留空） |
| `dashboard/todo.txt` | 你的待办，一行一条 |
| `kindle/kindle-dash/bin/start.sh` | 第 10 行的 `URL=`，换成你自己的图片地址 |

## 本地先试一次

```bash
npm install
npx playwright install chromium
node dashboard/render.mjs
```

成功后会生成 `out/dashboard.png`，同时有一个 `out/preview.html` 可以直接用浏览器打开看效果。

只想改排版、不想装浏览器的话，可以先生成 HTML 慢慢调：

```bash
node dashboard/render.mjs --html-only
```

## 这套版式已经验证过

`out/dashboard.png` 是按杭州真实天气跑出来的样张，1072×1448（适配 Kindle Paperwhite 4/5、Kindle 10/11 代的屏幕）。其他尺寸改 `config.json` 里的 `width` / `height` 即可。

## 经纬度怎么查

打开 [openstreetmap.org](https://www.openstreetmap.org)，搜索你的城市，右键点地图上的位置 → "显示地址"，页面底部或 URL 里会出现 `#map=12/30.2741/120.1551`，斜杠后面两个数字就是纬度、经度。
