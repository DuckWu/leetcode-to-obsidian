// ============================================================
// service-worker.js — 后台 Service Worker
console.log('[LC→Obsidian] ✅ service-worker.js started');

// 职责：收消息 → 调 DeepSeek 分类 → 读写 Obsidian → 回传结果
//
// 索引方案：不再维护 MOC 列表文件。
//   - 查重：用 Obsidian Local REST API 的 Dataview DQL search 端点，
//     按 frontmatter 的 problems 数组里是否含本题号来定位已有笔记。
//   - 展示：单独的 _题型索引.md（Dataview 视图，FROM 文件夹自动聚合），
//     由 Obsidian 端渲染，本代码完全不碰它。
//   前提：每篇笔记 frontmatter 的 problems 必须是纯整数数组，如 [394, 224]。
// ============================================================

const DEFAULT_VAULT_DIR = '';  // 默认为 vault 根目录
const DEFAULT_MODEL = 'deepseek-chat';  // ← 跑前请去 DeepSeek 官方文档核对可用 model 名

// 推理模型（不支持 JSON mode / 输出更长）需特殊处理
const REASONING_MODELS = ['deepseek-reasoner'];
const DEFAULT_OBSIDIAN_API = 'http://127.0.0.1:27123';

// ── 路径编码工具（逐段 encode，保留 /） ────────────────────────
function encodePath(filePath) {
  return filePath
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/');
}

// ── 文件名清洗（去掉文件系统/Obsidian 非法字符） ───────────────
function sanitizeFileName(name) {
  return name
    .replace(/[/\\:*?"<>|]/g, '_')   // 非法字符
    .replace(/\s+/g, ' ')            // 折叠空白
    .trim()
    .slice(0, 100);                  // 防止过长文件名
}

// ── 构建 System Prompt ─────────────────────────────────────────
function buildSystemPrompt(existingNoteContent) {
  const existingSection = existingNoteContent
    ? `\n【已存在的同范式笔记】以下是该范式已有的笔记内容，请在其「收录题目」下追加本题，不要改框架，不要重写已有题目：\n---\n${existingNoteContent}\n---`
    : '（无已存在笔记，请新建）';

  return `你是算法刷题归档助手。你的核心原则：把"具体题目"上升为"题型范式"，而不是讲单题解法。

具体来说，你和普通题解的区别在于这三点，必须做到：

1.【归类先于解题】拿到一道题，第一件事不是想怎么解，而是判断它属于哪一类问题。
  一类问题 = 一种数据结构/算法 + 一种问题形态，例如：
  - "用栈解决嵌套结构解析"
  - "用滑动窗口解决子串/子数组的最优区间"
  - "用回溯解决排列组合子集的枚举"
  - "用二分搜索在单调条件上找边界"
  命名永远是"用X解决Y类问题"，绝不能是题目名字。

2.【抽象出可复用框架】给出的代码骨架要能套用到这一整类题，而不是只能解这一道。
  做法：把本题专属的东西（具体符号、变量名、边界值）替换成占位概念。
  反例(错)：if (c == '[') 压栈
  正例(对)：遇到"进入更深层级的信号"时，把当前层状态压栈
  一句话检验：把这个框架给另一道同类但不同细节的题，能不能直接套？能，才合格。

3.【建立题目间的联系】每道题都要指出它的"兄弟题"，说明它们共享同一个框架、
  只是在框架的哪个位置填了不同的东西。让我看到"这些题其实是一道题"。

记住：我要的是一套能举一反三的题型地图，不是一本按题号排列的答案册。

${existingSection}

【输出格式】严格如下，只输出 Markdown 本体，无任何前后缀说明：

---
paradigm: 范式名（格式"用X解决Y类问题"，基于 topicTags 抽象，严禁用题目名）
tags: [算法范式, 从topicTags映射的标签如Stack/DP/SlidingWindow]
updated: {今天日期 YYYY-MM-DD}
problems: [394, 224]
---

# {paradigm}

## 识别信号
- 抽象的题目特征，看到就条件反射想到此范式。严禁写本题专属符号

## 通用框架
\`\`\`
适用于整类题的伪代码骨架，不含任何本题专属字面量
\`\`\`
逐步说明每步在做什么、为什么。

## 思维模板（自问清单）
- 下次遇到类似题，问自己哪3~4个问题就能确认套用此范式

## 收录题目
### [题号] 标题 (难度)
- **本题映射**：本题的关键元素如何对应通用框架的占位
- **AC 代码**：
\`\`\`
{我的代码}
\`\`\`
- **易错点**：
- **兄弟题**：从 similarQuestions 选，标注如何套同一框架

【关键约束】
- tags 的第一个标签必须固定为「算法范式」，后面再跟 topicTags 映射标签（索引可能依赖它聚合）
- frontmatter 的 problems 必须是纯题号整数数组，如 [394, 224]，绝不能写成 "394 Decode String" 这种字符串
- 若已存在笔记：在其「收录题目」下追加本题，更新 frontmatter 的 problems（把新题号加进数组）和 updated，绝不重写已有题目的内容；框架不要改，除非新题暴露了框架的不完备
- 若无已存在笔记：新建完整笔记
- 自检：通用框架里若出现本题专属字面量，视为失败，必须重写为占位符`;
}

// ── 构建 User Message ──────────────────────────────────────────
function buildUserMessage(payload) {
  const parts = [
    '【输入】我已 AC 这道 LeetCode 题，请归档：',
    '',
    '## 题目标题',
    `${payload.number || '?'}. ${payload.title}`,
    '',
    '## 难度',
    payload.difficulty || 'Unknown',
    '',
    '## 官方 topicTags',
    (payload.tags || []).join(', ') || '无',
    '',
    '## 题目描述',
    (payload.description || '').slice(0, 1500),
    '',
    '## 相似题目 (similarQuestions)',
    (payload.similarQuestions || []).map(q => `${q.number}. ${q.title} (${q.difficulty})`).join('\n') || '无',
    '',
    '## 我的 AC 代码',
    '```' + (payload.language || 'java'),
    (payload.code || '').slice(0, 2500),
    '```',
  ];
  return parts.join('\n');
}

// ── 调 DeepSeek API ────────────────────────────────────────────
async function callDeepSeek(apiKey, model, systemPrompt, userMessage) {
  const isReasoning = REASONING_MODELS.includes(model);

  const body = {
    model: model || DEFAULT_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    temperature: 0.1,
    max_tokens: isReasoning ? 8000 : 4000,
  };

  const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`DeepSeek API (${resp.status}): ${err.slice(0, 200)}`);
  }

  const json = await resp.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content) throw new Error('DeepSeek 返回空内容');

  // 清理可能的代码块包裹，返回纯 Markdown
  const cleaned = content
    .replace(/^```markdown\s*\n?/i, '')
    .replace(/^```\s*\n?/, '')
    .replace(/\n?\s*```$/, '')
    .trim();
  return cleaned;
}

// ── Obsidian REST API 操作 ─────────────────────────────────────
async function readObsidianFile(baseUrl, apiKey, filePath) {
  try {
    const resp = await fetch(
      `${baseUrl}/vault/${encodePath(filePath)}`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );
    if (resp.ok) return await resp.text();
    // 404 = 文件不存在，属正常情况，不噪声打印
    if (resp.status !== 404) {
      console.warn('[LC→Obsidian] read fail:', filePath, resp.status, await resp.text().catch(() => ''));
    }
  } catch (e) { /* API 不可达 */ }
  return null;
}

async function writeObsidianFile(baseUrl, apiKey, filePath, content) {
  const url = `${baseUrl}/vault/${encodePath(filePath)}`;
  console.log('[LC→Obsidian] write:', url, 'len=', content.length);
  const resp = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'text/markdown; charset=utf-8',
    },
    body: content,
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    console.error('[LC→Obsidian] write FAIL:', resp.status, body);
  }
  return resp.ok;
}

// ── 解析范式名（从 Markdown frontmatter） ───────────────────────
function parseParadigm(markdown) {
  const fmMatch = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;
  const fm = fmMatch[1];
  const nameMatch = fm.match(/paradigm:\s*(.+)/);
  return nameMatch ? nameMatch[1].trim().replace(/^["']|["']$/g, '') : null;
}

// ── 查重：用 Dataview DQL 按题号搜已有笔记 ──────────────────────
// 依赖 Obsidian Local REST API + Dataview 插件。
// 笔记 frontmatter 的 problems 必须是整数数组（如 [394, 224]）。
async function findExistingNote(baseUrl, apiKey, vaultPrefix, problemNumber) {
  const target = parseInt(problemNumber, 10);
  if (isNaN(target)) return null;

  const folder = vaultPrefix.replace(/\/$/, '') || '/';
  const dql = `TABLE problems\nFROM "${folder}"\nWHERE econtains(problems, ${target})`;

  let path = null;
  try {
    const resp = await fetch(`${baseUrl}/search/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/vnd.olrapi.dataview.dql+txt',
      },
      body: dql,
    });
    if (!resp.ok) {
      console.warn('[LC→Obsidian] DQL search HTTP', resp.status, await resp.text().catch(() => ''));
      return null;
    }
    const results = await resp.json();
    if (!Array.isArray(results) || results.length === 0) return null;
    path = results[0].filename;  // 形如 "LeetCode范式/用栈解决嵌套结构解析问题.md"
  } catch (e) {
    console.warn('[LC→Obsidian] DQL search failed:', e.message);
    return null;
  }

  if (!path) return null;
  const content = await readObsidianFile(baseUrl, apiKey, path);
  if (!content) return null;
  const name = path.replace(/^.*\//, '').replace(/\.md$/, '');
  return { paradigmName: name, path, content };
}

// ── 主流程 ─────────────────────────────────────────────────────
async function processSubmission(payload) {
  const { deepseekApiKey, deepseekModel, obsidianApiKey, vaultDir, obsidianApiUrl } =
    await chrome.storage.sync.get(['deepseekApiKey', 'deepseekModel', 'obsidianApiKey', 'vaultDir', 'obsidianApiUrl']);

  if (!deepseekApiKey) throw new Error('请先配置 DeepSeek API Key（右键扩展 → 选项）');
  if (!obsidianApiKey) throw new Error('请先配置 Obsidian REST API Key（Obsidian 插件设置 → Local REST API）');

  const vault = vaultDir !== undefined ? vaultDir : DEFAULT_VAULT_DIR;
  const baseUrl = (obsidianApiUrl || DEFAULT_OBSIDIAN_API).replace(/\/+$/, '');
  const vaultPrefix = vault ? `${vault}/` : '';
  console.log('[LC→Obsidian] config loaded:', { baseUrl, vaultDir, keyLen: obsidianApiKey.length });

  // 查重：按题号搜已有笔记
  const existing = await findExistingNote(baseUrl, obsidianApiKey, vaultPrefix, payload.number);
  const isNewParadigm = !existing;

  // 构建 Prompt → 调 DeepSeek
  const systemPrompt = buildSystemPrompt(existing?.content || '');
  const userMessage = buildUserMessage(payload);
  console.log('[LC→Obsidian] === SYSTEM PROMPT (head 500) ===\n', systemPrompt.slice(0, 500));
  console.log('[LC→Obsidian] === USER MESSAGE ===\n', userMessage);

  const noteContent = await callDeepSeek(deepseekApiKey, deepseekModel, systemPrompt, userMessage);

  // 解析范式名 → 决定写到哪个文件
  const paradigmName = parseParadigm(noteContent);
  if (!paradigmName) throw new Error('DeepSeek 输出缺少 paradigm 字段');

  // 若是追加到已有笔记，沿用已有文件路径，避免因范式名细微差异产生重复文件
  const safeName = sanitizeFileName(paradigmName);
  const filePath = existing?.path || `${vaultPrefix}${safeName}.md`;

  const ok = await writeObsidianFile(baseUrl, obsidianApiKey, filePath, noteContent);
  if (!ok) throw new Error('写入 Obsidian 失败');

  console.log('[LC→Obsidian] 归档完成:', paradigmName, isNewParadigm ? '(新范式)' : '(已有范式)', '→', filePath);

  return {
    typeName: paradigmName,
    isNewType: isNewParadigm,
  };
}

// ── 消息监听 ───────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'ARCHIVE_SUBMISSION') return false;
  console.log('[LC→Obsidian] SW received message, processing...');

  processSubmission(message.payload)
    .then((result) => {
      console.log('[LC→Obsidian] SW done, sending response:', result);
      sendResponse({ success: true, ...result });
    })
    .catch((err) => {
      console.error('[LC→Obsidian] SW FAILED:', err.message, err);
      sendResponse({ success: false, error: err.message });
    });

  return true;
});

// ── 首次安装自动打开选项页 ─────────────────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  const { deepseekApiKey } = await chrome.storage.sync.get('deepseekApiKey');
  if (!deepseekApiKey) {
    chrome.runtime.openOptionsPage();
  }
});