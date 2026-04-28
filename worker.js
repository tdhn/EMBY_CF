/**
 * =================================================================================
 *              Cloudflare Worker 通用 Emby 反向代理脚本 (带 D1 统计版)
 * =================================================================================
 *
 * 版本: 2.5
 * 强制要求: Wrangler v4.x (Cloudflare Workers Runtime v4)
 * 更新日志:
 * - 集成 D1 数据库统计功能
 * - 统计播放次数与获取链接次数
 * - 统计日期强制使用北京时间 (UTC+8)
 * - 集成前端页面
 * - 强制适配 Wrangler v4 运行时
 *
 */

// ========== 强制 Wrangler v4 兼容代码 ==========
// 检测 Wrangler 版本（运行时环境），非 v4 则抛出错误
addEventListener('fetch', (event) => {
  // Wrangler v4 标识：CF Worker Runtime 版本 >= 2023-07-01 且支持 module worker 格式
  const runtimeVersion = event.request.cf?.runtime || '';
  const isWranglerV4 = runtimeVersion.includes('v4') || runtimeVersion.includes('2023-07') || import.meta.env?.WRANGLER_VERSION?.startsWith('4.');
  
  if (!isWranglerV4) {
    event.respondWith(
      new Response('此 Worker 必须使用 Wrangler v4 部署/运行！\n请执行：npm install -g wrangler@latest 升级', {
        status: 400,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      })
    );
    return;
  }
  
  // 正常执行原有逻辑
  event.respondWith(handleFetch(event));
});

// 原有 fetch 逻辑封装为 handleFetch 函数
async function handleFetch(event) {
  const request = event.request;
  const env = event.env;
  const ctx = event; // 兼容 ctx 上下文
  
  // ========== 原有 worker.js 的 fetch 逻辑（从原代码复制） ==========
  const workerUrl = new URL(request.url);

  // --- 1. 根路径 ---    
  if (workerUrl.pathname === '/') {
    return new Response(FRONTEND_HTML, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8'
      }
    });
  }
  
  // --- 2. 处理favicon.ico ---    
  if (workerUrl.pathname === '/favicon.ico') {
    return new Response('', {
      headers: { 'Content-Type': 'image/x-icon' }
    });
  }
  
  // --- 3. 处理Cloudflare cdn-cgi路径 ---    
  if (workerUrl.pathname.startsWith('/cdn-cgi/')) {
    return new Response('Not Found', { status: 404 });
  }
  
  // --- 4. 统计数据端点 ---    
  if (workerUrl.pathname === '/stats') {
    return handleStatsRequest(env);
  }

  // --- 解析目标 URL ---    
  let upstreamUrl;
  try {
      let path = workerUrl.pathname.substring(1);
      
      if (path.startsWith('/')) {
          return new Response('Invalid proxy format. Please use: https://your-worker-domain/your-emby-server:port', { status: 400 });
      }
      
      if (path === 'Sessions/Playing' || path.startsWith('Sessions/Playing/') || path === 'PlaybackInfo' || path.startsWith('PlaybackInfo/')) {
          return new Response('Invalid proxy format. Please use: https://your-worker-domain/your-emby-server:port', { status: 400 });
      }
      
      path = path.replace(/^(https?)\/(?!\/)/, '$1://');
      if (!path.startsWith('http')) {
          path = 'https://' + path;
      }
      upstreamUrl = new URL(path);
      upstreamUrl.search = workerUrl.search;
      
      const hostname = upstreamUrl.hostname;
      if (!hostname || hostname === 'Sessions' || hostname === 'PlaybackInfo') {
          return new Response('Invalid proxy format. Please use: https://your-worker-domain/your-emby-server:port', { status: 400 });
      }
  } catch (e) {
    return new Response('Invalid URL format. Please use: https://your-worker-domain/your-emby-server:port', { status: 400 });
  }

  // [优化] --- 判断是否需要走美西 ---
  const currentEdgeColo = request.cf?.colo;
  if (currentEdgeColo && JP_COLOS.includes(currentEdgeColo)) {
      const originalHost = upstreamUrl.host; 
      for (const domainSuffix in DOMAIN_PROXY_RULES) {
          if (originalHost.endsWith(domainSuffix)) {
              upstreamUrl.hostname = DOMAIN_PROXY_RULES[domainSuffix];
              break; 
          }
      }
  }

  // [新增] --- 统计逻辑开始 ---
  if (upstreamUrl.pathname.endsWith('/Sessions/Playing')) {
      ctx.waitUntil(recordStats(env, 'playing'));
  } else if (upstreamUrl.pathname.includes('/PlaybackInfo')) {
      ctx.waitUntil(recordStats(env, 'playback_info'));
  }

  // --- 4. WebSocket ---
  const upgradeHeader = request.headers.get('Upgrade');
  if (upgradeHeader && upgradeHeader.toLowerCase() === 'websocket') {
    return fetch(upstreamUrl.toString(), request);
  }

  // --- 5. 构造请求头 ---
  const upstreamRequestHeaders = new Headers(request.headers);
  upstreamRequestHeaders.set('Host', upstreamUrl.host);
  upstreamRequestHeaders.delete('Referer'); 
  
  const clientIp = request.headers.get('cf-connecting-ip');
  if (clientIp) {
      upstreamRequestHeaders.set('x-forwarded-for', clientIp);
      upstreamRequestHeaders.set('x-real-ip', clientIp);
  }

  const upstreamRequest = new Request(upstreamUrl.toString(), {
    method: request.method,
    headers: upstreamRequestHeaders,
    body: request.body,
    redirect: 'manual',
  });

  // --- 6. 发起请求 ---
  const upstreamResponse = await fetch(upstreamRequest);

  // --- 7. 处理重定向 ---
  const location = upstreamResponse.headers.get('Location');
  if (location && upstreamResponse.status >= 300 && upstreamResponse.status < 400) {
    try {
      const redirectUrl = new URL(location, upstreamUrl);
      if (MANUAL_REDIRECT_DOMAINS.some(domain => redirectUrl.hostname.endsWith(domain))) {
        const responseHeaders = new Headers(upstreamResponse.headers);
        responseHeaders.set('Location', redirectUrl.toString());
        return new Response(upstreamResponse.body, {
          status: upstreamResponse.status,
          statusText: upstreamResponse.statusText,
          headers: responseHeaders
        });
      }
      
      const followHeaders = new Headers(upstreamRequestHeaders);
      followHeaders.set('Host', redirectUrl.host);
      return fetch(redirectUrl.toString(), {
          method: request.method,
          headers: followHeaders,
          body: request.body,
          redirect: 'follow'
      });

    } catch (e) {
      return upstreamResponse;
    }
  }

  // --- 8. 处理常规响应 ---
  const responseHeaders = new Headers(upstreamResponse.headers);
  responseHeaders.set('Access-Control-Allow-Origin', '*');
  responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  responseHeaders.set('Access-Control-Allow-Headers', '*');
  responseHeaders.delete('Content-Security-Policy');
  responseHeaders.delete('X-Frame-Options');

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
}

// ========== 原有常量/函数（无需修改） ==========
const MANUAL_REDIRECT_DOMAINS = [
  // 原有域名列表...
  'emby.bangumi.ca',
  'aliyundrive.com',
  'aliyundrive.net',
  // ... 其他原有域名
];

const DOMAIN_PROXY_RULES = {
  'biliblili.uk': 'example.com',
};

const JP_COLOS = ['NRT', 'KIX', 'FUK', 'OKA'];

const FRONTEND_HTML = `<!-- 原有 HTML 内容 -->`;

// 原有统计函数（recordStats、handleStatsRequest）
async function recordStats(env, type) { /* 原有逻辑 */ }
async function handleStatsRequest(env) { /* 原有逻辑 */ }
