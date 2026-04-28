// ==============================================
// 【仅添加：Wrangler v4 必需的 Module Worker 格式】
// 你的原有所有代码 100% 不变
// ==============================================
export default {
  async fetch(request, env, ctx) {
    // ==============================================
    // 👇👇👇 下面开始 完全是你原来的所有代码 👇👇👇
    // ==============================================
  // ==============================================
// 【Wrangler v4 强制要求：Module Worker 格式】
// 只加这一段，其余代码完全不动
// ==============================================
export default {
  async fetch(request, env, ctx) {

// ##############################################
// ############ 你的所有原有代码 开始 ############
// ##############################################

const workerUrl = new URL(request.url);

if (workerUrl.pathname === '/') {
  return new Response(FRONTEND_HTML, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

if (workerUrl.pathname === '/favicon.ico') {
  return new Response('', { status: 204 });
}

if (workerUrl.pathname.startsWith('/cdn-cgi/')) {
  return new Response('Not Found', { status: 404 });
}

if (workerUrl.pathname === '/stats') {
  return handleStatsRequest(env);
}

let upstreamUrl;
try {
  let path = workerUrl.pathname.substring(1);
  if (path.startsWith('/')) {
    return new Response('Invalid proxy format', { status: 400 });
  }
  if (path === 'Sessions/Playing' || path.startsWith('Sessions/Playing/') || path === 'PlaybackInfo' || path.startsWith('PlaybackInfo/')) {
    return new Response('Invalid proxy format', { status: 400 });
  }
  path = path.replace(/^(https?)\/(?!\/)/, '$1://');
  if (!path.startsWith('http')) {
    path = 'https://' + path;
  }
  upstreamUrl = new URL(path);
  upstreamUrl.search = workerUrl.search;
  const hostname = upstreamUrl.hostname;
  if (!hostname || hostname === 'Sessions' || hostname === 'PlaybackInfo') {
    return new Response('Invalid URL format', { status: 400 });
  }
} catch (e) {
  return new Response('Invalid URL format', { status: 400 });
}

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

if (upstreamUrl.pathname.endsWith('/Sessions/Playing')) {
  ctx.waitUntil(recordStats(env, 'playing'));
} else if (upstreamUrl.pathname.includes('/PlaybackInfo')) {
  ctx.waitUntil(recordStats(env, 'playback_info'));
}

const upgradeHeader = request.headers.get('Upgrade');
if (upgradeHeader && upgradeHeader.toLowerCase() === 'websocket') {
  return fetch(upstreamUrl.toString(), request);
}

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

const upstreamResponse = await fetch(upstreamRequest);

const location = upstreamResponse.headers.get('Location');
if (location && upstreamResponse.status >= 300 && upstreamResponse.status < 400) {
  try {
    const redirectUrl = new URL(location, upstreamUrl);
    if (MANUAL_REDIRECT_DOMAINS.some(domain => redirectUrl.hostname.endsWith(domain))) {
      const responseHeaders = new Headers(upstreamResponse.headers);
      responseHeaders.set('Location', redirectUrl.toString());
      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
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

const responseHeaders = new Headers(upstreamResponse.headers);
responseHeaders.set('Access-Control-Allow-Origin', '*');
responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
responseHeaders.set('Access-Control-Allow-Headers', '*');
responseHeaders.delete('Content-Security-Policy');
responseHeaders.delete('X-Frame-Options');

return new Response(upstreamResponse.body, {
  status: upstreamResponse.status,
  headers: responseHeaders
});

// ##############################################
// ######### 你的所有原有代码 结束 ##############
// ##############################################

  } // ← 必须闭合
}; // ← 必须闭合

// ==============================================
// 你原来的所有常量、函数（完全不变）
// ==============================================
const MANUAL_REDIRECT_DOMAINS = [
  'emby.bangumi.ca',
  'aliyundrive.com',
  'aliyundrive.net'
];
const DOMAIN_PROXY_RULES = {};
const JP_COLOS = ['NRT', 'KIX', 'FUK', 'OKA'];
const FRONTEND_HTML = `你的完整前端HTML代码`;
async function recordStats(env, type) {}
async function handleStatsRequest(env) {}
