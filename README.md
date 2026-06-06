<div align="center">

<img src="public/icons/og-image.jpg" alt="灵魂地图 · Philosophical Soul Cartography" width="720">

# 灵魂地图

**Philosophical Soul Cartography**

*在被算法定义之前，先认识自己。*

[**🌐 打开网站 →**](https://soul-map.wangxingyu-will.workers.dev/)

</div>

---

## 这是什么

一份给中文使用者的哲学人格测试 —— 40 道题穿越 10 个心灵省份（自我观 · 他者与关系 · 社会与正义 · 时间与生死 · 苦难与意义 · 真理与认知 · 善与道德 · 超越与信仰 · 自由与结构 · 行动与存在），画出你灵魂的四条经纬（**S / M / W / A**），落到 16 种原型中的一种。

不像 MBTI 给你贴标签，这份测试想做的事是**让你和苏格拉底、庄子、海德格尔、加缪坐到同一张桌子上**——回到那些最古老也最根本的疑问：我是谁？何为善？什么值得活？

整个体验分三幕：

- **Act I · 测试**：40 道题 → 四条经纬揭示 → 稀有度 → 你的原型。每个原型自带诗意名字（如 `FVSW · 道家顶流 · #松弛通透型`）、对话哲学家、阴影面、对立原型、推荐书目。
- **Act II · 意义之旅**：价值观靶心（修身/齐家/处世/闲居）→ 三盏灯（你的签名优势）→ 可能自我书写 → 个人宣言。
- **Act III · 周练习**：每周一封"来自你原型的对手"的反思信。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | 单文件 SPA · `public/index.html` (~4600 行, 无构建步骤) |
| 后端 | Cloudflare Workers · `src/worker.js` |
| 数据库 | Cloudflare D1 (SQLite) |
| 邮件 | Resend |
| 定时任务 | Cloudflare Cron Triggers (每周一 09:00 Beijing) |
| 部署 | GitHub Actions → `wrangler deploy` (push to main 自动发布) |

刻意选了"没有构建步骤、没有 npm install、没有任何框架"这条路 —— 整个项目就是一份 HTML + 一份 worker.js + 几张 SQL 迁移文件。任何 25 年后的浏览器都该还能跑。

## 本地开发

需要 [Node.js](https://nodejs.org/) (≥ 18) 和一个 Cloudflare 账户。

```bash
git clone https://github.com/wxydayie8888/soul-map.git
cd soul-map

# 登录 Cloudflare（首次）
npx wrangler login

# 本地起开发服务器（带 D1 模拟）
npx wrangler dev

# 部署到生产（一般不需要手动，push to main 会自动跑）
npx wrangler deploy
```

数据库迁移：

```bash
# 应用到远程 D1
npx wrangler d1 execute soul-map-db --remote --file=migration-v6.sql

# 查询
npx wrangler d1 execute soul-map-db --remote --command="SELECT count(*) FROM submissions"
```

## 项目结构

```
public/
  index.html         前端（编辑这一份）
  admin.html         运营后台
  manifest.json      PWA 清单
  icons/             PWA icon + OG share card
src/
  worker.js          Workers 后端 (12 个 /api/* + scheduled cron)
schema.sql           D1 schema 参考
migration-v{3,5,6}.sql  增量迁移
wrangler.toml        Cloudflare 配置（绑定 D1、cron、assets）
.github/workflows/
  deploy.yml         push to main → wrangler deploy
CLAUDE.md            给 Claude Code 看的架构说明
```

根目录还有一份 `index.html` —— 那是过时快照，**请忽略**。

## 关于 16 种原型

| 代号 | 诗意名 | 关键词 |
|---|---|---|
| OREI | 孤勇守灯人 | 原则硬核 |
| ORSI | 黑夜立法者 | 智识贵族 |
| OREW | 红线织网人 | 关系中枢 |
| ORSW | 风暴掌舵者 | 使命战士 |
| FREI | 自我炼丹师 | 孤独朝圣 |
| FRSI | 荒野独行侠 | 体验无界 |
| FREW | 人情策展人 | 人间烟火 |
| FRSW | 他者收藏家 | 灵感拼贴 |
| OVEI | 天道翻译官 | 先知气质 |
| OVSI | 暖手实干派 | 治愈温柔 |
| OVEW | 乡土活化石 | 根系扎地 |
| OVSW | 红尘调味师 | 江湖善意 |
| FVEI | 山林吹笛人 | 玄思孤逸 |
| FVSI | 无为修行者 | 一念清净 |
| FVEW | 街头说书人 | 民间智者 |
| FVSW | 道家顶流 | 松弛通透 |

每个原型都有自己的对手哲学家、内在张力、推荐书目和三个周练习——共约 50,000 字的内容。

## 提反馈 / 报 bug

直接开 [Issue](https://github.com/wxydayie8888/soul-map/issues)，或者用 [@wxydayie8888](https://github.com/wxydayie8888) 联系。

希望你在 16 种原型里找到属于你的那个。
