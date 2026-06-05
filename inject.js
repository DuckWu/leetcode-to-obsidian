// inject.js — MAIN world
console.log('[LC→Obsidian] ✅ inject.js loaded (MAIN world)');

// 拦截 fetch/XHR，检测 Accepted，通知 ISOLATED world

let lastCheckTime = 0;

function isAccepted(data) {
  return data.state === 'SUCCESS' && data.status_msg === 'Accepted';
}

function getCodeFromMonaco() {
  try {
    if (window.monaco && window.monaco.editor) {
      const editors = window.monaco.editor.getEditors
        ? window.monaco.editor.getEditors()
        : [];
      if (editors.length > 0) return editors[0].getValue();
      const models = window.monaco.editor.getModels
        ? window.monaco.editor.getModels()
        : [];
      if (models.length > 0) return models[0].getValue();
    }
  } catch (e) {}
  return '';
}

function notify(data) {
  const now = Date.now();
  if (now - lastCheckTime < 3000) return;
  lastCheckTime = now;

  window.postMessage(
    {
      source: 'leetcode-to-obsidian',
      type: 'SUBMIT_ACCEPTED',
      data: {
        url: window.location.href,
        code: getCodeFromMonaco(),
        language: data.lang || '',
        runtime: data.status_runtime || '',
        memory: data.status_memory || '',
      },
    },
    '*'
  );
}

// — 拦截 fetch —
const origFetch = window.fetch;
window.fetch = async function (...args) {
  const response = await origFetch.apply(this, args);
  try {
    const urlStr = typeof args[0] === 'string' ? args[0] : args[0]?.url || args[0]?.href || '';
    if (urlStr.includes('/check/')) {
      const clone = response.clone();
      const data = await clone.json();
      if (isAccepted(data)) notify(data);
    }
  } catch (e) {}
  return response;
};

// — 拦截 XHR —
const origOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (method, url, ...rest) {
  this.__lcUrl = typeof url === 'string' ? url : url?.toString?.() || '';
  return origOpen.apply(this, [method, url, ...rest]);
};

const origSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.send = function (...args) {
  const xhr = this;
  xhr.addEventListener('readystatechange', function () {
    if (xhr.readyState === 4 && xhr.__lcUrl && xhr.__lcUrl.includes('/check/')) {
      try {
        const data = JSON.parse(xhr.responseText);
        if (isAccepted(data)) notify(data);
      } catch (e) {}
    }
  });
  return origSend.apply(this, args);
};
