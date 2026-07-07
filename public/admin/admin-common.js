/**
 * 管理后台公共模块
 * - API 请求封装
 * - 认证管理
 * - 工具函数
 */
(function () {
  'use strict';

  var API_BASE = 'https://k00ytcrlnb.execute-api.ap-east-1.amazonaws.com';

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
   * 显示提示消息
   */
  function showToast(msg, type) {
    var el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.style.cssText = 'position:fixed;top:20px;right:20px;padding:12px 24px;border-radius:8px;color:#fff;font-size:14px;z-index:9999;transition:all .3s;opacity:0;transform:translateY(-10px);';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.background = type === 'error' ? '#ef4444' : type === 'success' ? '#10b981' : '#3b82f6';
    el.style.opacity = '1';
    el.style.transform = 'translateY(0)';
    clearTimeout(el._t);
    el._t = setTimeout(function () {
      el.style.opacity = '0';
      el.style.transform = 'translateY(-10px)';
    }, 3000);
  }

  /**
   * 格式化日期
   */
  function formatDate(str) {
    if (!str) return '--';
    var d = new Date(str);
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
  };

  // 前端保活：每4分钟ping一次API，防止Lambda冷启动
  if (isLoggedIn()) {
    setInterval(function() {
      fetch(API_BASE + '/health', { method: 'GET' }).catch(function() {});
    }, 4 * 60 * 1000);
  }
})();
