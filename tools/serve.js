const http = require('http');
const fs = require('fs');
const p = require('path');
const root = process.cwd();
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' };
http.createServer((q, s) => {
  let f = p.join(root, decodeURIComponent(q.url.split('?')[0]));
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = p.join(f, 'index.html');
  fs.readFile(f, (e, d) => {
    if (e) { s.writeHead(404); return s.end('not found'); }
    s.writeHead(200, { 'content-type': types[p.extname(f)] || 'application/octet-stream' });
    s.end(d);
  });
}).listen(8899, '127.0.0.1', () => console.log('ready http://127.0.0.1:8899/tools/preview.html'));
