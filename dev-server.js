// 로컬 실행: public 폴더 + /api 함수를 한 주소로 띄운다.
// 실행: node --env-file=.env dev-server.js
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 3000);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      const name = url.pathname.slice(5).replace(/[^a-z0-9-]/gi, '');
      const file = path.join(ROOT, 'api', `${name}.js`);
      if (!name || name.startsWith('_') || !fs.existsSync(file)) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ error: '없는 API입니다.' }));
      }
      req.query = Object.fromEntries(url.searchParams);
      const mod = await import(pathToFileURL(file).href);
      return await mod.default(req, res);
    }
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const target = path.join(PUBLIC, rel);
    if (!target.startsWith(PUBLIC) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('찾을 수 없습니다.');
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(target).pipe(res);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '서버 오류가 발생했습니다.' }));
    console.error('서버 오류:', e?.message);
  }
});

server.listen(PORT, () => console.log(`http://localhost:${PORT}`));
