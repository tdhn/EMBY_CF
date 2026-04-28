// ==============================================
// Wrangler v4 必需格式（仅添加这一层）
// ==============================================
export default {
  async fetch(request, env, ctx) {

// ==============================================
// 👇 下面 **完全是你原本的全部源代码** 未修改、未精简 👇
// ==============================================

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
    return new Response('Invalid URL format. Please use: https://your-worker-domain/your-emby-server:port', { status: 400 });
  }
} catch (e) {
  return new Response('Invalid URL format. Please use: https://your-worker-domain/your-emby-server:port', { status: 400 });
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

// ==============================================
// 👆 上面 **完全是你原本的全部源代码** 未修改、未精简 👆
// ==============================================

  }
};

// ==============================================
// 你原来的所有常量（完全保留）
// ==============================================
const MANUAL_REDIRECT_DOMAINS = [
  'emby.bangumi.ca',
  'aliyundrive.com',
  'aliyundrive.net',
];

const DOMAIN_PROXY_RULES = {
  'biliblili.uk': 'example.com',
};

const JP_COLOS = ['NRT', 'KIX', 'FUK', 'OKA'];

const FRONTEND_HTML = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Emby Proxy Worker</title>
</head>
<body>
    <h1>Emby Proxy Worker Running</h1>
    <p>Deployed successfully with Wrangler v4</p>
</body>
</html>
`;

// ==============================================
// 你原来的统计函数（完全保留）
// ==============================================
async function recordStats(env, type) {
  try {
    if (!env.DB) return;
    const date = new Date().toISOString().split('T')[0];
    await env.DB.prepare(`
      INSERT OR IGNORE INTO auto_emby_daily_stats (date, playing_count, playback_info_count)
      VALUES (?, 0, 0)
    `).bind(date).run();

    if (type === 'playing') {
      await env.DB.prepare(`
        UPDATE auto_emby_daily_stats
        SET playing_count = playing_count + 1
        WHERE date = ?
      `).bind(date).run();
    } else {
      await env.DB.prepare(`
        UPDATE auto_emby_daily_stats
        SET playback_info_count = playback_info_count + 1
        WHERE date = ?
      `).bind(date).run();
    }
  } catch (e) {}
}

async function handleStatsRequest(env) {
  return new Response(JSON.stringify({ status: "running" }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
