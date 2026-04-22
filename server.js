const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const https = require('https');

const PORT = 3003;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/**
 * 強震モニタ(kmoni.bosai.go.jp)へのプロキシリクエスト
 */
function proxyKmoni(targetUrl, res) {
  const parsedUrl = url.parse(targetUrl);
  let responded = false;

  const options = {
    hostname: parsedUrl.hostname,
    port: 80,
    path: parsedUrl.path,
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'http://www.kmoni.bosai.go.jp/',
    },
    timeout: 8000,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    if (responded) return;
    responded = true;
    const contentType = proxyRes.headers['content-type'] || 'application/octet-stream';
    res.writeHead(proxyRes.statusCode, {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
    });
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    if (responded) return;
    responded = true;
    console.error('[Proxy Error]', err.message);
    try {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Proxy error', message: err.message }));
    } catch (e) { /* ignore */ }
  });

  proxyReq.on('timeout', () => {
    if (responded) return;
    responded = true;
    proxyReq.destroy();
    try {
      res.writeHead(504, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Proxy timeout' }));
    } catch (e) { /* ignore */ }
  });

  proxyReq.end();
}

/**
 * HTTPS プロキシリクエスト (Wolfx用)
 */
function proxyHttps(targetUrl, res) {
  const parsedUrl = url.parse(targetUrl);
  let responded = false;

  const options = {
    hostname: parsedUrl.hostname,
    port: 443,
    path: parsedUrl.path,
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (MapLibreApp)',
    },
    timeout: 10000,
  };

  const proxyReq = https.request(options, (proxyRes) => {
    if (responded) return;
    responded = true;
    res.writeHead(proxyRes.statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    });
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    if (responded) return;
    responded = true;
    res.writeHead(502);
    res.end(JSON.stringify({ error: 'Proxy error', message: err.message }));
  });

  proxyReq.end();
}

/**
 * 静的ファイル配信
 */
function serveStatic(pathname, res) {
  if (pathname === '/') pathname = '/index.html';

  const filePath = path.join(__dirname, pathname);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  // ディレクトリトラバーサル防止
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(__dirname))) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
        res.end('Not Found');
      } else {
        res.writeHead(500);
        res.end('Internal Server Error');
      }
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

/**
 * メインリクエストハンドラ
 */
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = decodeURIComponent(parsedUrl.pathname);

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // --- 強震モニタ プロキシAPI ---
  if (pathname === '/api/kmoni/latest') {
    // 最新時刻取得
    proxyKmoni('http://www.kmoni.bosai.go.jp/webservice/server/pros/latest.json', res);
    return;
  }

  if (pathname.startsWith('/api/kmoni/realtime/')) {
    // リアルタイム震度画像 (jma_s)
    // timestamp format: YYYYMMDDHHmmss
    const ts = pathname.split('/').pop();
    const date = ts.substring(0, 8);
    proxyKmoni(
      `http://www.kmoni.bosai.go.jp/data/map_img/RealTimeImg/jma_s/${date}/${ts}.jma_s.gif`,
      res
    );
    return;
  }

  if (pathname.startsWith('/api/kmoni/ps/')) {
    // P波/S波画像
    const ts = pathname.split('/').pop();
    const date = ts.substring(0, 8);
    proxyKmoni(
      `http://www.kmoni.bosai.go.jp/data/map_img/PSWaveImg/nied/${date}/${ts}.nied.gif`,
      res
    );
    return;
  }

  if (pathname.startsWith('/api/kmoni/eew/')) {
    // EEW情報JSON
    const ts = pathname.split('/').pop();
    proxyKmoni(
      `http://www.kmoni.bosai.go.jp/webservice/hypo/eew/${ts}.json`,
      res
    );
    return;
  }

  // --- Wolfx API プロキシ ---
  if (pathname === '/api/wolfx/eqlist') {
    proxyHttps('https://api.wolfx.jp/jma_eqlist.json', res);
    return;
  }
  if (pathname === '/api/wolfx/eew') {
    proxyHttps('https://api.wolfx.jp/jma_eew.json', res);
    return;
  }

  // --- P2P地震情報 プロキシ ---
  if (pathname === '/api/p2p/history') {
    proxyHttps('https://api.p2pquake.net/v2/history?codes=551&limit=50', res);
    return;
  }

  // --- 気象庁公式 プロキシ ---
  if (pathname === '/api/jma/list') {
    proxyHttps('https://www.jma.go.jp/bosai/quake/data/list.json', res);
    return;
  }

  // --- 静的ファイル ---
  serveStatic(pathname, res);
});

server.listen(PORT, () => {
  console.log(`\n🌍 地震モニタサーバー起動`);
  console.log(`   http://localhost:${PORT}\n`);
  console.log(`   強震モニタプロキシ: /api/kmoni/*`);
  console.log(`   静的ファイル配信: /\n`);
});
