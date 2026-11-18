# Edge 上架全流程

从零到审核通过的逐步操作。全程**免费**，不需要信用卡。

> 官方依据：[Publish a Microsoft Edge extension](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension)
> 预计操作时间：25–35 分钟（账号注册 + 填表）
> 审核时间：通常 1–2 个工作日

---

## 准备清单（都已备好）

| 材料 | 位置 | 规格核对 |
| --- | --- | --- |
| 扩展包 | `dist/muyu-widget-2.0.0.zip` | 63.1 KB，manifest 在根目录 ✓ |
| 商店 logo | `tools/shots/store/logo-300.png` | 300×300，Edge 推荐尺寸 ✓ |
| 截图 ×5 | `tools/shots/store/01-hero.png` … `05-fish.png` | 1280×800，Edge 要求 1280×800 或 640×480 ✓ |
| 商品文案 | `STORE-LISTING.md` | 简介 / 详细描述 / 单用途 / 权限理由 ✓ |
| 隐私政策 | `privacy.html` | **需要你先托管到公开 URL**，见第 2 步 |

---

## 第 1 步：确认包是最新的

```bash
cd muyu-widget
node tools/pack.js
```

看到「已打包 → dist/muyu-widget-2.0.0.zip」即可。

> 如果之前改过代码，这一步会把改动带进包。包里**不应**包含 `tools/`、`.git`；
> 脚本已自动剔除，且会先校验图标尺寸与文件完整性。

---

## 第 2 步：托管隐私政策（唯一需要你动手准备的）

Edge 明确要求：**只要扩展访问、传输或收集任何个人信息，就必须提供隐私政策 URL**。
本扩展会写 `chrome.storage.sync`（跨设备同步计数），属于必须提供的情形。

最省事的方式 —— GitHub Pages：

1. 在仓库里新建 `docs/` 目录，把 `privacy.html` 复制进去并改名为 `index.html`
2. 推送：

   ```bash
   mkdir -p docs
   cp privacy.html docs/index.html
   git add docs/index.html
   git commit -m "add privacy policy for store"
   git push
   ```

3. 打开仓库 **Settings → Pages**，Source 选 `main` 分支、`/docs` 目录，保存
4. 等 1–2 分钟，得到 `https://<你的用户名>.github.io/muyu-widget/`

**完成标志**：浏览器能打开这个地址，看到你的隐私政策正文。

> 没有 GitHub Pages 也可以：任何能公开访问的 URL 都行（Gitee Pages、Vercel、
> 自己的服务器、甚至一个公开的 Notion 页面）。

---

## 第 3 步：注册 Partner Center

1. 打开 https://partner.microsoft.com/dashboard/microsoftedge
2. 用 **Microsoft 账号**登录（没有就现场注册一个，免费）
3. 首次进入会让你填**发布者信息**：
   - 账号类型选「个人」（Individual）
   - 填真实姓名、国家/地区、联系方式
4. 同意开发者协议

**完成标志**：能看到「Microsoft Edge 附加组件」的仪表盘，有「新建扩展」或「Create new extension」按钮。

> 这里**不会**要求付款。Edge 上架零费用，这是它与 Chrome 最大的区别。

---

## 第 4 步：创建新扩展并上传包

1. 点「新建扩展」（Create new extension）
2. 上传 `dist/muyu-widget-2.0.0.zip`
3. 系统解析 manifest，应显示：
   - 名称：木鱼挂件 · Muyu Widget
   - 版本：2.0.0
   - 权限：storage

**如果上传报错**，按提示对照检查：

| 报错 | 原因 | 处理 |
| --- | --- | --- |
| manifest.json not found | zip 里多套了一层文件夹 | 用 `node tools/pack.js` 重打，别手动压缩 |
| Invalid icon size | 图标尺寸与声明不符 | `node tools/icons.js --verify` 检查 |
| Invalid version | 版本号格式错 | 必须是 `2.0.0` 这种纯数字点分格式 |

---

## 第 5 步：填写可用性（Availability）

| 字段 | 填什么 |
| --- | --- |
| **Visibility（可见性）** | 选 **Public**（公开）——这样所有人能在商店搜到 |
| **Markets（市场）** | 全选（默认就是全部），或至少勾选中国、美国 |

> 如果想先自己试用，可以先选 **Hidden**（隐藏），拿到安装链接自己装；
> 确认没问题后再改成 Public。但改可见性会触发一次重新审核。

---

## 第 6 步：填写属性（Properties）

| 字段 | 填什么 |
| --- | --- |
| **Category（类别）** | 选 **Fun**（趣味）或 **Entertainment**（娱乐） |

---

## 第 7 步：隐私信息（Privacy）—— 最容易卡住的一步

这一页有五块，逐块填：

### 7.1 扩展用途（State the extension's purpose）

复制 `STORE-LISTING.md` 第二节的第一段：

```
在用户浏览任意网页时，提供一只由用户主动选择显示的装饰性木鱼挂件，用于点击敲击取乐并记录本地计数。
```

### 7.2 权限理由（Justify any permissions）

**storage** 权限 —— 复制 `STORE-LISTING.md` 第三节「storage」段：

```
用于在本地保存：挂件在视口内的位置、收起状态、声音开关、自动敲击开关与节奏、当前形象组合、每日目标、用户自定义的功德卡文案，以及功德计数（今日/累计/连续天数）。

数据仅存储在本机 chrome.storage.local，并通过 chrome.storage.sync 在同一账号的不同设备间合并。计数器采用 G-Counter 语义（各标签页/设备维护独立分量，合并时取各分量最大值再求和），因此多标签页与跨设备的并发敲击都不会丢失。不发送到任何第三方服务器。
```

**主机权限 `<all_urls>`** —— 复制第三节「主机权限」段：

```
扩展的唯一用途是在用户浏览的任意网页上显示一只可交互的木鱼挂件，因此需要在 manifest <all_urls> 声明的所有受支持协议页面注入一个受 Shadow DOM 隔离的 UI 元素。

不读取页面内容，不修改宿主页面的 DOM（只追加一个自封闭的自定义元素），不注入任何脚本到页面上下文。
```

### 7.3 远程代码（Remote code）

选 **「No, I am not using remote code」**。

如果要求说明，填：

```
本扩展不加载、不执行任何远程代码。所有 JavaScript、CSS、SVG 图形均打包在安装包内。
外部资源引用：无（无 CDN、无字体、无图片外链）。
```

### 7.4 数据使用认证（Certify data usage）

按 `STORE-LISTING.md` 第四节，**所有数据类别都选「不收集」**：
个人身份、健康、财务、认证信息、通讯、位置、浏览历史、用户活动、网站内容。

同时勾选合规承诺（不转售数据、不用于无关用途、遵守 Edge 数据政策）。

### 7.5 隐私政策 URL（Set a privacy policy）

填第 2 步拿到的地址，例如：

```
https://<你的用户名>.github.io/muyu-widget/
```

**这一栏填了之后要去点一次「验证」或保存，确认没有报 404。**

---

## 第 8 步：商品详情（Store listing）

选择语言 **中文（简体）**，逐项填：

| 字段 | 必填？ | 填什么 |
| --- | --- | --- |
| **Display name** | 必填 | 木鱼挂件 · Muyu Widget（自动从 manifest 带出，可能需确认） |
| **Short description** | 必填 | 从 manifest 的 description 自动带出。**要改只能改 manifest 再重传包** |
| **Description** | 必填 | 复制 `STORE-LISTING.md` 第一节「详细描述」全文 |
| **Extension logo** | 必填 | `tools/shots/store/logo-300.png` |
| **Screenshots** | 选填但强烈建议 | 上传 5 张：`01-hero` `03-panel` `04-card` `05-fish` `02-knock` |
| **Small promotional tile** | 选填 | 跳过（440×280，要另做） |
| **Search terms** | 选填 | `木鱼` `功德` `muyu` `专注` `敲击` `挂件` |

> 截图顺序建议：主视觉 → 设置面板 → 功德卡 → 锦鲤 → 敲击动效。
> 上传第一张后会出现「Duplicate」按钮，可一键复制到其他语言。

---

## 第 9 步：认证测试说明并提交

**Certification testing notes（测试说明）** —— 审核员会看这段，写清楚怎么验证：

```
这是内容脚本类扩展，无需登录或特殊配置。

测试步骤：
1. 安装后打开任意普通网页（如 https://example.com）
2. 页面右下角出现一只木鱼挂件
3. 点击木鱼，会听到木质敲击声并看到「功德 +1」飘字
4. 悬停木鱼，左上角出现设置（⚙）和收起按钮
5. 点设置可切换形象、改目标、导出功德卡

权限说明：
- 仅使用 storage 权限保存位置偏好与计数，不读写网页内容
- 不发起任何网络请求，不加载远程代码
- 数据仅存于本机与浏览器账号同步存储，不上传服务器

如需确认，可在扩展管理页检查其权限仅含 storage。
```

然后点 **Publish / 提交**。

**完成标志**：状态变为「In review」（审核中）。

---

## 审核期间与结果

**状态在哪看**：Partner Center → Microsoft Edge 附加组件 → 你的扩展 → 状态列

| 状态 | 含义 |
| --- | --- |
| In review | 审核中，等 1–2 个工作日 |
| Published | 已上架，几小时内可搜到 |
| Failed review | 被拒，看下面的处理 |

### 被拒怎么办

Edge 的拒绝邮件会给具体条款。最常见三种：

**1. 权限过宽 / 需说明为何访问所有网站**

> 用第 7.2 节那段主机权限说明，并在回复里强调：不读取页面内容、不修改 DOM、不注入脚本到页面上下文。

**2. 缺少或无效隐私政策**

> 检查 URL 是否能打开、内容是否说明「收集什么、怎么用、怎么披露」。本项目的 `privacy.html` 已覆盖这三点。

**3. 描述与实际功能不符**

> 逐句核对。注意：本项目的商店文案已修正过三处事实错误（不存在的「扩展图标收起」、`http/https` 应为 `<all_urls>`、`body` 应为 `documentElement`），别改回去。

**修订后必须提升版本号**（改 `manifest.json` 的 `version` 为 `2.0.1`），
重新 `node tools/pack.js`，再上传新包。不能重复提交同一个版本号。

---

## 提交前最终自查

- [ ] `node tools/pack.js --check` 通过
- [ ] 隐私政策 URL 能打开，不是 404
- [ ] logo 用的是 300×300 那张（不是 128 拉伸）
- [ ] 截图是 1280×800（Edge 只接受 1280×800 或 640×480）
- [ ] 隐私页五个区块都填了，数据类别全选「不收集」
- [ ] 测试说明填了（能显著降低被拒概率）
- [ ] 在真实 Edge 里装一次：`edge://extensions` → 开发者模式 → 加载解压的扩展程序 → 选 `muyu-widget` 目录

---

## 上架之后

### 更新版本

1. 改代码
2. 改 `manifest.json` 的 `version`（如 `2.0.1`，只能递增）
3. `node tools/pack.js`
4. Partner Center → 该扩展 → 「更新」→ 上传新包
5. 重新审核（更新通常比首次快）

### 拿到安装链接

上架后地址形如：

```
https://microsoftedge.microsoft.com/addons/detail/<扩展ID>
```

可以贴到 README 或分享给别人。

### 数据看板

Partner Center 里能看到安装量、周活跃、评分等基础数据（比 Chrome 简单）。

---

## 常见疑问

**Q：真的完全免费吗？**
是。Edge 不走 Chrome 那种 $5 开发者注册费，上传、审核、发布都不收费。

**Q：可以用 Chrome 的包吗？**
可以，同一个 zip 直接上传。本项目已适配（`use_dynamic_url` 需 Edge 105+，manifest 已声明最低 105）。

**Q：审核会检查代码吗？**
会做自动化扫描 + 必要时人工。内容脚本类扩展通常按「测试说明」走一遍验证流程。

**Q：多久能搜到？**
Published 后几小时内出现在商店，搜索索引可能再延迟一天。

**Q：能同时上 Chrome 吗？**
可以，同一个包。Chrome 需要 $5 一次性注册费，建议先在这边验证审核通过后再去 Chrome。
