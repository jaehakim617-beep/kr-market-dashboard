import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const PORT = Number(process.env.PORT || 4173);
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

createServer((request, response) => {
  const url = new URL(request.url, `http://localhost:${PORT}`);
  const safePath = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "public/index.html";
  const filePath = path.normalize(path.join(ROOT, safePath.startsWith("public/") || safePath.startsWith("data/") ? safePath : `public/${safePath}`));

  if (!filePath.startsWith(ROOT) || !existsSync(filePath)) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, { "content-type": MIME[path.extname(filePath)] || "application/octet-stream" });
  createReadStream(filePath).pipe(response);
}).listen(PORT, () => {
  console.log(`대시보드: http://localhost:${PORT}`);
});
