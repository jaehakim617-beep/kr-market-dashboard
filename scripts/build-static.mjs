import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const DIST = path.join(ROOT, "dist");

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });

await cp(path.join(ROOT, "public"), DIST, { recursive: true });
await cp(path.join(ROOT, "data"), path.join(DIST, "data"), { recursive: true });

console.log(`배포용 폴더 생성 완료: ${DIST}`);
console.log("이 dist 폴더를 Netlify, Vercel, GitHub Pages 등에 업로드하면 됩니다.");
