# LeetCode → Obsidian 题型归档 (Chrome 插件)

LeetCode 提交 Accepted 后，自动调 DeepSeek 归类题型、生成通用解法模板，写入 Obsidian 知识库。

## 架构

```
┌─────────────────────────────────────────┐
│              Chrome 插件                 │
│                                         │
│  content.js (ISOLATED)                  │
│  ├─ 注入拦截脚本到 MAIN world            │
│  ├─ 监听 postMessage                    │
│  ├─ 拉取 LeetCode GraphQL 元数据         │
│  └─ 发送到 service worker               │
│                                         │
│  service-worker.js                      │
│  ├─ 调 DeepSeek API 分类题型             │
│  ├─ 读写 Obsidian REST API               │
│  └─ 更新 MOC 索引                       │
└──────────────┬──────────────────────────┘
               │
               ▼
┌──────────────────────┐    ┌─────────────────────┐
│   DeepSeek API       │    │  Obsidian           │
│   api.deepseek.com   │    │  Local REST API     │
│   分类 + 生成笔记     │    │  localhost:27124    │
└──────────────────────┘    └─────────────────────┘
```

## 前置条件

1. **DeepSeek API Key**：从 [platform.deepseek.com](https://platform.deepseek.com/api_keys) 获取
2. **Obsidian Local REST API with MCP 插件**：在 Obsidian 社区插件市场安装，**开启 HTTP 服务器**（插件设置里勾选 "Enable HTTP server"）
3. **Chrome 浏览器**

## 安装

1. 打开 Chrome，地址栏输入 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `leetcode-to-obsidian/` 文件夹
5. 扩展安装后会自动弹出配置页

## 配置

右键扩展图标 → 选项，填写：

| 配置项 | 说明 |
|--------|------|
| DeepSeek API Key | `sk-...`，从 DeepSeek 控制台获取 |
| Obsidian REST API Key | 在 Obsidian 插件设置里复制 |
| Obsidian API 地址 | 默认 `http://localhost:27123`（HTTP 端口） |
| 题型目录 | Vault 内相对路径，默认 `算法题型` |

> ⚠️ **重要**：Obsidian 插件默认只开 HTTPS 27124（自签证书，Chrome 拒绝）。必须在插件设置里 **开启 HTTP 服务器**，默认端口 27123。
>
> 新注册 DeepSeek 送 **500 万 token 免费额度**，刷 1000 道题约消耗 0.8M token（约 ¥1）。

## 使用

1. 打开 Obsidian，确认 Local REST API 插件已启动
2. 在 LeetCode 刷题，点 **Submit**
3. 看到 **Accepted** → 右下角弹 toast
4. 去 Obsidian 查看 `算法题型/` 下的笔记

不需要任何额外操作。每一道 Accepted 的题目自动归档。

## 文件结构

```
leetcode-to-obsidian/
├── manifest.json        # Chrome 扩展清单
├── content.js           # 内容脚本（检测提交 + 提取数据）
├── service-worker.js    # 后台处理（DeepSeek + Obsidian）
├── options.html         # 配置页面
├── options.js           # 配置逻辑
└── icons/               # 扩展图标
```

## Obsidian 笔记结构

```
算法题型/
├── _模板.md             # 新题型模板
├── _题型索引.md          # MOC 总索引
├── 单调栈.md
├── 滑动窗口.md
├── 回溯算法.md
└── ...
```

每个题型笔记包含：解决什么问题、识别特征、最优解（复杂度）、代码模板、易错点、例题表、相关题型链接。
