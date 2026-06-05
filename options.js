// ============================================================
// options.js — 配置页逻辑
// ============================================================

const $ = (id) => document.getElementById(id);

// 加载已有配置
async function load() {
  const cfg = await chrome.storage.sync.get([
    'deepseekApiKey',
    'deepseekModel',
    'obsidianApiKey',
    'obsidianApiUrl',
    'vaultDir',
  ]);
  if (cfg.deepseekApiKey) $('deepseekKey').value = cfg.deepseekApiKey;
  if (cfg.deepseekModel) $('deepseekModel').value = cfg.deepseekModel;
  if (cfg.obsidianApiKey) $('obsidianKey').value = cfg.obsidianApiKey;
  if (cfg.obsidianApiUrl) $('obsidianUrl').value = cfg.obsidianApiUrl;
  if (cfg.vaultDir) $('vaultDir').value = cfg.vaultDir;
}

// 显示状态
function showStatus(msg, ok) {
  const el = $('status');
  el.textContent = msg;
  el.className = 'status show ' + (ok ? 'ok' : 'err');
  setTimeout(() => el.classList.remove('show'), 4000);
}

// 保存
$('saveBtn').addEventListener('click', async () => {
  await chrome.storage.sync.set({
    deepseekApiKey: $('deepseekKey').value.trim(),
    deepseekModel: $('deepseekModel').value,
    obsidianApiKey: $('obsidianKey').value.trim(),
    obsidianApiUrl: ($('obsidianUrl').value.trim() || 'http://127.0.0.1:27123').replace(/\/+$/, ''),
    vaultDir: $('vaultDir').value.trim(),
  });
  showStatus('✅ 已保存', true);
});

// 测试连接
$('testBtn').addEventListener('click', async () => {
  const obsidianKey = $('obsidianKey').value.trim();
  const obsidianUrl = $('obsidianUrl').value.trim() || 'http://127.0.0.1:27123';
  const deepseekKey = $('deepseekKey').value.trim();

  // 1. 测 Obsidian
  try {
    const base = obsidianUrl.replace(/\/+$/, '');
    const resp = await fetch(`${base}/`, {
      headers: { Authorization: `Bearer ${obsidianKey}` },
    });
    if (resp.ok) {
      showStatus('✅ Obsidian 连接成功', true);
    } else {
      showStatus('❌ Obsidian API Key 无效 (HTTP ' + resp.status + ')', false);
      return;
    }
  } catch (e) {
    showStatus('❌ 无法连接 Obsidian REST API。确认插件已安装并启动？', false);
    return;
  }

  // 2. 测 DeepSeek（发一个极小的请求）
  if (!deepseekKey) {
    showStatus('⚠️ 未填写 DeepSeek Key（跳过测试）', false);
    return;
  }
  try {
    const resp = await fetch('https://api.deepseek.com/v1/models', {
      headers: { Authorization: `Bearer ${deepseekKey}` },
    });
    if (resp.ok) {
      showStatus('✅ 全部连接正常', true);
    } else {
      showStatus('❌ DeepSeek API Key 无效 (HTTP ' + resp.status + ')', false);
    }
  } catch (e) {
    showStatus('❌ 无法连接 DeepSeek API: ' + e.message, false);
  }
});

load();
