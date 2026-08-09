const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
http.createServer((req, res) => {
  const rel = req.url === '/' ? '/media-ad-skip.user.js' : req.url;
  const file = path.join(root, rel.replace(/\?.*$/, ''));
  try {
    const body = fs.readFileSync(file);
    res.writeHead(200, {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(body);
  } catch (e) {
    res.writeHead(404);
    res.end(String(e));
  }
}).listen(8765, '127.0.0.1', () => console.log('serve http://127.0.0.1:8765'));
