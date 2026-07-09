/**
 * OpenPAYME — 多链 USDT/USDC 支付网关
 * © 2026 OpenPAYME · 开源地址: https://github.com/constlee0839-ops/OpenPAYME/
 */
/**
 * 管理后台公共模块
 * - API 请求封装
 * - 认证管理
 * - 工具函数
 */
(function () {
  'use strict';

  var API_BASE = 'https://k00ytcrlnb.execute-api.ap-east-1.amazonaws.com';

  // 动态预连接 API 域名（加速首次 API 调用）
  var pre = document.createElement('link');
  pre.rel = 'preconnect'; pre.href = API_BASE;
  document.head.appendChild(pre);
  var dns = document.createElement('link');
  dns.rel = 'dns-prefetch'; dns.href = API_BASE;
  document.head.appendChild(dns);

  function getToken() {
    return localStorage.getItem('admin_token') || '';
  }

  function setToken(token) {
    localStorage.setItem('admin_token', token);
  }

  function clearToken() {
    localStorage.removeItem('admin_token');
  }

  function isLoggedIn() {
    return !!getToken();
  }

  // API 响应缓存（减少重复请求）
  var apiCache = {};
  var CACHE_TTL = 30 * 1000; // 30秒缓存

  function getCached(path) {
    var item = apiCache[path];
    if (item && Date.now() - item.ts < CACHE_TTL) return item.data;
    return null;
  }

  function setCache(path, data) {
    apiCache[path] = { data: data, ts: Date.now() };
  }

  function clearCache() {
    apiCache = {};
  }

  /**
   * 发起 API 请求（带loading指示 + 缓存）
   */
  function request(path, data, method) {
    method = method || 'POST';
    var url = API_BASE + path;
    var headers = { 'Content-Type': 'application/json' };
    var token = getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;

    // GET请求或列表查询走缓存
    var cacheKey = method + ':' + path + ':' + JSON.stringify(data || {});
    if (method === 'GET') {
      var cached = getCached(cacheKey);
      if (cached) return Promise.resolve(cached);
    }

    var opts = { method: method, headers: headers };
    if (method !== 'GET' && data) {
      opts.body = JSON.stringify(data);
    }

    showLoading();

    return fetch(url, opts)
      .then(function (r) { return r.json(); })
      .then(function (res) {
        hideLoading();
        if (res.status_code === 401) {
          clearToken();
          window.location.href = 'login.html';
          return Promise.reject(new Error('未登录'));
        }
        if (method === 'GET' && res.status_code === 200) {
          setCache(cacheKey, res);
        }
        return res;
      })
      .catch(function(err) {
        hideLoading();
        return Promise.reject(err);
      });
  }

  /**
   * 显示全局 loading 指示器
   */
  function showLoading() {
    var el = document.getElementById('globalLoading');
    if (!el) {
      el = document.createElement('div');
      el.id = 'globalLoading';
      el.style.cssText = 'position:fixed;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,#3b82f6,#8b5cf6,#3b82f6);background-size:200%;animation:loadingBar 1.5s linear infinite;z-index:99999;transition:opacity .3s;';
      document.body.appendChild(el);
      // 注入动画样式
      if (!document.getElementById('loadingStyle')) {
        var style = document.createElement('style');
        style.id = 'loadingStyle';
        style.textContent = '@keyframes loadingBar{0%{background-position:200% 0}100%{background-position:-200% 0}}';
        document.head.appendChild(style);
      }
    }
    el.style.opacity = '1';
    el._hideTimeout = setTimeout(function() { hideLoading(); }, 15000); // 15秒自动隐藏
  }

  function hideLoading() {
    var el = document.getElementById('globalLoading');
    if (el) {
      el.style.opacity = '0';
      clearTimeout(el._hideTimeout);
    }
  }

  /**
   * 检查登录状态，未登录则跳转
   */
  function requireAuth() {
    if (!isLoggedIn()) {
      window.location.href = 'login.html';
      return false;
    }
    return true;
  }

  /**
   * 显示提示消息（统一走 shared/notify.js 的 Notify 组件；加载失败则降级为内联提示）
   */
  function showToast(msg, type) {
    if (window.Notify) { window.Notify.show(msg, type); return; }
    // 兜底：notify.js 未加载时的简易实现
    var el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(10px);padding:12px 24px;border-radius:8px;color:#fff;font-size:14px;z-index:9999;pointer-events:none;transition:all .3s;opacity:0;box-shadow:0 6px 20px rgba(0,0,0,.18);';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.background = type === 'error' ? '#ef4444' : type === 'success' ? '#10b981' : '#3b82f6';
    el.style.opacity = '1';
    el.style.transform = 'translateX(-50%) translateY(0)';
    clearTimeout(el._t);
    el._t = setTimeout(function () {
      el.style.opacity = '0';
      el.style.transform = 'translateX(-50%) translateY(10px)';
    }, 3000);
  }

  /**
   * 格式化日期
   */
  function formatDate(str) {
    if (!str) return '--';
    var d;
    // 数据库 created_at/updated_at 存的是 UTC（如 2026-07-08 19:16:54，无时区标记）。
    // 浏览器会把这种"空格分隔"的字符串当成本地时区，导致凭空多 8 小时（凌晨显示成晚7点）。
    // 明确按 UTC 解析：补 'T' 和 'Z'，再交给浏览器按用户本地时区显示。
    if (typeof str === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(str)) {
      d = new Date(str.replace(' ', 'T') + 'Z');
    } else {
      d = new Date(str);
    }
    if (isNaN(d.getTime())) return str;
    var pad = function (n) { return n < 10 ? '0' + n : n; };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  /**
   * 订单状态文字
   */
  function statusText(s) {
    var map = { 1: '待支付', 2: '已支付', 3: '已过期', 4: '已取消', 5: '确认中' };
    return map[s] || '未知';
  }

  /**
   * 订单状态颜色
   */
  function statusColor(s) {
    var map = { 1: '#f59e0b', 2: '#10b981', 3: '#6b7280', 4: '#ef4444', 5: '#3b82f6' };
    return map[s] || '#6b7280';
  }

  /**
   * 回调状态文字
   * notify_status=1 成功；=0 时：待支付/确认中订单显示"待支付"，已支付/过期订单按 notify_count 区分"通知失败/未通知"
   */
  function notifyText(o) {
    o = o || {};
    var ns = o.notify_status;
    var cnt = o.notify_count || 0;
    var st = o.status;
    if (ns === 1) return '已通知';
    if (st === 1 || st === 5) return '待支付';
    if (cnt > 0) return '通知失败';
    return '未通知';
  }

  /**
   * 回调状态颜色
   */
  function notifyColor(o) {
    o = o || {};
    var ns = o.notify_status;
    var cnt = o.notify_count || 0;
    var st = o.status;
    if (ns === 1) return '#10b981';            // 绿：已通知
    if (st === 1 || st === 5) return '#9ca3af'; // 灰：待支付，尚不需通知
    if (cnt > 0) return '#ef4444';             // 红：通知失败（会重试）
    return '#f59e0b';                          // 橙：未通知（已支付但回调还没成功）
  }

  // 导出
  window.Admin = {
    API_BASE: API_BASE,
    getToken: getToken,
    setToken: setToken,
    clearToken: clearToken,
    isLoggedIn: isLoggedIn,
    request: request,
    requireAuth: requireAuth,
    showToast: showToast,
    formatDate: formatDate,
    statusText: statusText,
    statusColor: statusColor,
    notifyText: notifyText,
    notifyColor: notifyColor,
    clearCache: clearCache,
  };

  // 前端保活：每4分钟ping一次API，防止Lambda冷启动
  if (isLoggedIn()) {
    setInterval(function() {
      fetch(API_BASE + '/health', { method: 'GET' }).catch(function() {});
    }, 4 * 60 * 1000);
  }

  // ===== 移动端侧边栏抽屉（汉堡菜单）=====
  // 统一注入到所有后台页面：左上角汉堡按钮 + 遮罩层 + 滑入式抽屉
  (function initMobileNav() {
    function injectStyle() {
      if (document.getElementById('mobileNavStyle')) return;
      var css = [
        '.menu-toggle{display:none;}',
        '.sidebar-overlay{display:none;}',
        '@media (max-width:768px){',
        '  .menu-toggle{display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border:none;background:#0d0d0d;color:#fff;border-radius:8px;font-size:20px;line-height:1;cursor:pointer;margin-right:12px;flex-shrink:0;}',
        '  .sidebar{position:fixed;top:0;left:0;height:100vh;width:260px;max-width:82vw;transform:translateX(-100%);transition:transform .25s ease;z-index:1000;flex-direction:column;}',
        '  .sidebar.open{transform:translateX(0);}',
        '  .sidebar-brand{padding:20px;border-bottom:1px solid rgba(255,255,255,.1);border-right:none;}',
        '  .sidebar-nav{flex-direction:column;padding:12px 0;overflow-y:auto;}',
        '  .nav-item{padding:12px 20px;white-space:normal;}',
        '  .sidebar-footer{padding:16px 20px;border-top:1px solid rgba(255,255,255,.1);border-left:none;}',
        '  .sidebar-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:999;}',
        '  .sidebar-overlay.show{display:block;}',
        '  .main{margin-left:0;padding:16px;}',
        '  .page-header{flex-wrap:wrap;}',
        '}'
      ].join('\n');
      var s = document.createElement('style');
      s.id = 'mobileNavStyle';
      s.textContent = css;
      document.head.appendChild(s);
    }

    function init() {
      injectStyle();
      if (document.getElementById('menuToggle')) return; // 已注入则跳过

      var toggle = document.createElement('button');
      toggle.id = 'menuToggle';
      toggle.className = 'menu-toggle';
      toggle.type = 'button';
      toggle.setAttribute('aria-label', '打开菜单');
      toggle.textContent = '☰'; // ☰

      var header = document.querySelector('.page-header') || document.querySelector('.main');
      if (header) header.insertBefore(toggle, header.firstChild);

      var overlay = document.createElement('div');
      overlay.id = 'sidebarOverlay';
      overlay.className = 'sidebar-overlay';
      document.body.appendChild(overlay);

      function toggleNav(e) {
        if (e) e.preventDefault();
        var sb = document.querySelector('.sidebar');
        if (sb) sb.classList.toggle('open');
        overlay.classList.toggle('show');
      }

      toggle.addEventListener('click', toggleNav);
      overlay.addEventListener('click', toggleNav);

      // 点击菜单项后自动关闭抽屉
      document.querySelectorAll('.sidebar-nav .nav-item').forEach(function (link) {
        link.addEventListener('click', function () {
          var sb = document.querySelector('.sidebar');
          if (sb) sb.classList.remove('open');
          overlay.classList.remove('show');
        });
      });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  })();

  // ===== 版权声明页脚（醒目，统一注入所有后台页面）=====
  (function injectCopyrightFooter() {
    var REPO = 'https://github.com/constlee0839-ops/OpenPAYME/';
    function build() {
      if (document.getElementById('copyrightFooter')) return;
      var css = [
        '.page-footer{margin-top:32px;padding:14px 16px;text-align:center;font-size:13px;color:#6b7280;background:#fafafa;border-top:1px solid #e5e7eb;}',
        '.page-footer a{color:#2563eb;text-decoration:none;font-weight:600;}',
        '.page-footer a:hover{text-decoration:underline;}',
        '.page-footer .pf-name{font-weight:700;color:#111827;}'
      ].join('\n');
      var style = document.createElement('style');
      style.textContent = css;
      document.head.appendChild(style);

      var footer = document.createElement('div');
      footer.id = 'copyrightFooter';
      footer.className = 'page-footer';
      footer.innerHTML = 'Powered by <a href="' + REPO + '" target="_blank" rel="noopener">OpenPayMe</a>';

      // 放到内容区末尾：优先 .main，其次登录卡片，最后兜底 body
      var container = document.querySelector('.main') || document.querySelector('.login-card') || document.body;
      container.appendChild(footer);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
    else build();
  })();
})();
