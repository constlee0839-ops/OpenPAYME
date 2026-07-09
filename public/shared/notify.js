/**
 * OpenPAYME 统一通知组件 (Notify)
 * 全站统一的"系统提示弹窗"：顶部居中、带图标、可堆叠、自动消失、pointer-events:none 永不遮挡操作。
 * 用法：
 *   Notify.success('添加成功');  Notify.error('删除失败');  Notify.info('已复制');  Notify.warn('注意');
 *   或兼容旧调用： showToast('消息', 'success'|'error'|'info'|'warn')
 */
(function () {
  if (window.Notify) return; // 防重复注入

  var TYPES = {
    success: { bg: '#10b981', icon: '✓' },
    error:   { bg: '#ef4444', icon: '✕' },
    info:    { bg: '#3b82f6', icon: 'ℹ' },
    warn:    { bg: '#f59e0b', icon: '!' }
  };

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  function ensureHost() {
    var host = document.getElementById('notify-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'notify-host';
      host.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:10000;' +
        'display:flex;flex-direction:column;align-items:center;gap:10px;pointer-events:none;width:max-content;max-width:90vw;';
      document.body.appendChild(host);
    }
    return host;
  }

  function show(msg, type) {
    var conf = TYPES[type] || TYPES.info;
    var host = ensureHost();
    var el = document.createElement('div');
    el.style.cssText = 'display:flex;align-items:center;gap:10px;padding:12px 18px;border-radius:10px;' +
      'color:#fff;font-size:14px;font-weight:500;line-height:1.4;box-shadow:0 8px 24px rgba(0,0,0,.18);' +
      'background:' + conf.bg + ';opacity:0;transform:translateY(-12px);transition:opacity .3s,transform .3s;' +
      'max-width:90vw;pointer-events:none;';
    el.innerHTML = '<span style="font-weight:700;font-size:15px;line-height:1;">' + conf.icon + '</span>' +
      '<span>' + escapeHtml(msg) + '</span>';
    host.appendChild(el);
    // 触发进入动画
    requestAnimationFrame(function () {
      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';
    });
    // 自动消失
    setTimeout(function () {
      el.style.opacity = '0';
      el.style.transform = 'translateY(-12px)';
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 320);
    }, 2800);
  }

  window.Notify = {
    success: function (m) { show(m, 'success'); },
    error:   function (m) { show(m, 'error'); },
    info:    function (m) { show(m, 'info'); },
    warn:    function (m) { show(m, 'warn'); },
    show: show
  };

  // 兼容旧代码中的全局 showToast(msg, type) 调用
  window.showToast = function (msg, type) { show(msg, type); };
})();
