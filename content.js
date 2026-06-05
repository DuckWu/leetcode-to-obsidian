// content.js — ISOLATED world
console.log('[LC→Obsidian] ✅ content.js loaded (ISOLATED world)');

// 职责：监听 inject.js 的 postMessage → 提取元数据 → 调 service worker → 弹 toast

const DEBOUNCE_MS = 5000;
let lastSubmitTime = 0;

// ── 解析 URL ──────────────────────────────────────────────────
function parseUrl(url) {
  const m = url.match(/leetcode\.(com|cn)\/problems\/([^/?#]+)/);
  if (!m) return null;
  return {
    domain: m[1],
    slug: m[2],
    baseUrl: m[1] === 'cn' ? 'https://leetcode.cn' : 'https://leetcode.com',
  };
}

// ── CSRF token ────────────────────────────────────────────────
function getCsrfToken() {
  const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return m ? m[1] : '';
}

// ── GraphQL 拉题目元数据 ──────────────────────────────────────
async function fetchProblemMeta(baseUrl, slug) {
  const query = {
    query: `query q($slug: String!) {
      question(titleSlug: $slug) {
        questionFrontendId questionId title translatedTitle
        titleSlug difficulty categoryTitle
        topicTags { name slug translatedName }
        content translatedContent
        similarQuestions
      }
    }`,
    variables: { slug },
  };
  const headers = {
    'Content-Type': 'application/json',
    Referer: `${baseUrl}/problems/${slug}/`,
    Origin: baseUrl,
  };
  const csrf = getCsrfToken();
  if (csrf) headers['x-csrftoken'] = csrf;

  try {
    const resp = await fetch(`${baseUrl}/graphql/`, { method: 'POST', headers, body: JSON.stringify(query) });
    const json = await resp.json();
    const q = json?.data?.question;
    if (!q) return null;
    const title = q.translatedTitle || q.title || slug;
    let desc = '';
    const html = q.translatedContent || q.content || '';
    if (html) {
      const div = document.createElement('div');
      div.innerHTML = html;
      desc = (div.textContent || '').trim().slice(0, 800);
    }
    // 解析 similarQuestions（LeetCode 返回 JSON 字符串）
    let similarQuestions = [];
    try {
      if (typeof q.similarQuestions === 'string') {
        similarQuestions = JSON.parse(q.similarQuestions);
      } else if (Array.isArray(q.similarQuestions)) {
        similarQuestions = q.similarQuestions;
      }
    } catch (e) {}

    return {
      number: q.questionFrontendId || String(q.questionId) || '',
      title,
      difficulty: q.difficulty || '',
      tags: (q.topicTags || []).map((t) => t.translatedName || t.name),
      description: desc,
      similarQuestions: similarQuestions.map((sq) => ({
        number: sq.questionFrontendId || '',
        title: sq.translatedTitle || sq.title || '',
        difficulty: sq.difficulty || '',
      })),
    };
  } catch (e) {
    console.warn('[LC→Obsidian] GraphQL 失败:', e.message);
    return null;
  }
}

// ── Toast ─────────────────────────────────────────────────────
function showToast(msg, isError) {
  const el = document.createElement('div');
  el.textContent = msg;
  Object.assign(el.style, {
    position: 'fixed', bottom: '24px', right: '24px', zIndex: '99999',
    padding: '12px 20px', borderRadius: '8px', fontSize: '14px', fontWeight: '600',
    color: '#fff', background: isError ? '#ef4444' : '#10b981',
    boxShadow: '0 4px 12px rgba(0,0,0,0.25)', transition: 'opacity 0.3s', opacity: '1',
    pointerEvents: 'none',
  });
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 4000);
}

// ── 主流程 ────────────────────────────────────────────────────
window.addEventListener('message', async (event) => {
  if (event.data?.source !== 'leetcode-to-obsidian' || event.data?.type !== 'SUBMIT_ACCEPTED') return;

  const now = Date.now();
  if (now - lastSubmitTime < DEBOUNCE_MS) return;
  lastSubmitTime = now;

  const { url, code, language, runtime, memory } = event.data.data;
  console.log('[LC→Obsidian] Accepted detected:', url);

  const parsed = parseUrl(url);
  if (!parsed) { showToast('无法解析题目 URL', true); return; }

  console.log('[LC→Obsidian] step1: fetching meta...');
  const meta = await fetchProblemMeta(parsed.baseUrl, parsed.slug);
  console.log('[LC→Obsidian] step2: meta done, sending to SW...');

  showToast('⏳ 正在归档...');

  try {
    const result = await chrome.runtime.sendMessage({
      type: 'ARCHIVE_SUBMISSION',
      payload: {
        url, slug: parsed.slug, domain: parsed.domain,
        number: meta?.number || '', title: meta?.title || parsed.slug,
        difficulty: meta?.difficulty || 'Unknown',
        tags: meta?.tags || [], description: meta?.description || '',
        similarQuestions: meta?.similarQuestions || [],
        code, language, runtime, memory,
      },
    });
    console.log('[LC→Obsidian] step4: SW responded:', JSON.stringify(result));
    if (result?.success) {
      showToast(`✅ 已归档 → [[${result.typeName}]]${result.isNewType ? ' (新题型)' : ''}`);
    } else {
      showToast('❌ ' + (result?.error || '归档失败'), true);
    }
  } catch (e) {
    console.error('[LC→Obsidian] step4 FAILED:', e.message, e);
    showToast('❌ 通信失败，确认 Obsidian 已开且 HTTP 已开启', true);
  }
});

console.log('[LC→Obsidian] 已加载，等待 Accepted...');
