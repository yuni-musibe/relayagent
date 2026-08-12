import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { artifactsDir, logLine } from "./state.ts";
import { loadManifest, declaredPaths, disclosure, type Disclosure, type Manifest } from "./manifest.ts";

// 봉투(.relay) = 릴리스 스냅샷의 이동형. tar+gzip 하나에 매니페스트가 선언한 경로만 담고
// sha256 다이제스트가 신원이 된다. tar 를 외부 명령으로 부르지 않고 직접 쓰는 이유는
// 결정성이다 — BSD/GNU tar 는 엔트리 순서·mtime·uid 를 다르게 넣어 같은 트리에서 다른
// 다이제스트가 나온다. 여기서는 경로 오름차순 + mtime/uid/gid 0 + mode 두 값(0644/0755)으로
// 고정해, 같은 트리는 같은 봉투가 되게 한다.

// 봉투에서 항상 빼는 것 — draft.ts 의 COPY_SKIP 과 같은 이유 (설치·빌드가 재생성한다)
const PACK_SKIP = new Set([".git", "node_modules", ".next"]);
const BLOCK = 512;
/** 엔트리 하나의 상한 — 패키지 실측이 300KB 급이라 100MB 면 사고 신호다 */
const MAX_ENTRY = 100 * 1024 * 1024;
/** 전개 후 전체 상한 (압축 폭탄 방어) */
const MAX_TOTAL = 512 * 1024 * 1024;

// ── ustar 쓰기 ───────────────────────────────────────────────────────────────

function octal(n: number, len: number): Buffer {
  const b = Buffer.alloc(len, 0);
  b.write(n.toString(8).padStart(len - 1, "0") + "\0", 0, "ascii");
  return b;
}

function header(rel: string, size: number, mode: number): Buffer {
  // ustar name 100 + prefix 155. 경로가 100을 넘으면 마지막 / 에서 갈라 prefix 로 넘긴다
  let name = rel;
  let prefix = "";
  if (Buffer.byteLength(name) > 100) {
    const cut = rel.lastIndexOf("/", 100);
    if (cut <= 0 || Buffer.byteLength(rel.slice(cut + 1)) > 100 || Buffer.byteLength(rel.slice(0, cut)) > 155) {
      throw new Error(`경로가 ustar 한도를 넘습니다 (255): ${rel}`);
    }
    prefix = rel.slice(0, cut);
    name = rel.slice(cut + 1);
  }
  const h = Buffer.alloc(BLOCK, 0);
  h.write(name, 0, "utf8");
  octal(mode, 8).copy(h, 100);
  octal(0, 8).copy(h, 108); // uid
  octal(0, 8).copy(h, 116); // gid
  octal(size, 12).copy(h, 124);
  octal(0, 12).copy(h, 136); // mtime — 굽는 시각이 다이제스트를 흔들지 않게 0
  h.fill(" ", 148, 156); // checksum 자리는 공백으로 두고 합산
  h.write("0", 156, "ascii"); // typeflag: 일반 파일
  h.write("ustar\0", 257, "ascii");
  h.write("00", 263, "ascii");
  h.write(prefix, 345, "utf8");
  let sum = 0;
  for (const byte of h) sum += byte;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
  return h;
}

// ── 파일 수집 ────────────────────────────────────────────────────────────────

function walk(root: string, rel: string, skipAbs: string[], out: string[]): void {
  const abs = path.join(root, rel);
  for (const e of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (PACK_SKIP.has(e.name)) continue;
    const r = rel ? rel + "/" + e.name : e.name;
    const a = path.join(root, r);
    if (skipAbs.some((s) => a === s || a.startsWith(s + path.sep))) continue;
    if (e.isSymbolicLink()) throw new Error(`심볼릭 링크는 봉투에 담지 않습니다: ${r} — 실제 파일로 바꾸세요`);
    if (e.isDirectory()) walk(root, r, skipAbs, out);
    else if (e.isFile()) out.push(r);
  }
}

export interface PackResult {
  file: string;
  ref: string;
  version: string;
  digest: string;
  size: number;
  included: { path: string; size: number }[];
  /** 패키지 트리에 있으나 선언 밖이라 봉투에서 뺀 파일 (발행 화면이 사람에게 보여준다) */
  excluded: string[];
  manifest: Manifest;
  disclosure: Disclosure;
}

export function artifactFileName(ref: string, version: string): string {
  return `${ref.replace(/^@/, "").replace(/\//g, "-")}-${version}.relay`;
}

/**
 * 봉투 굽기. 매니페스트가 BOM 이면 봉투도 BOM 대로 — declaredPaths 가 가리키는 것만 담는다.
 * 선언 밖 파일은 excluded 로 보고만 하고 담지 않는다 (.env, 메모, 구버전 사본이 실려 나가는
 * 사고의 방어선). outFile 미지정이면 로컬 마켓 선반(~/.relay/artifacts)에 앉는다.
 */
export function packDir(pkgDir: string, outFile?: string): PackResult {
  const root = path.resolve(pkgDir);
  const m = loadManifest(root); // 판정 실패는 여기서 fail-loud
  const viewOut = m.surfaces?.view?.out
    ? [path.normalize(path.join(root, m.surfaces.view.source, m.surfaces.view.out))]
    : [];

  const files = new Set<string>();
  for (const d of declaredPaths(m)) {
    const abs = path.join(root, d.path);
    if (!fs.existsSync(abs)) continue; // 실체는 judge 가 이미 판정 — 선택 선언만 여기 온다
    if (d.kind === "file" || fs.statSync(abs).isFile()) files.add(d.path);
    else {
      const collected: string[] = [];
      walk(root, d.path, viewOut, collected);
      for (const f of collected) files.add(f);
    }
  }
  const sorted = [...files].sort(); // 경로 오름차순 — 결정성의 축

  const chunks: Buffer[] = [];
  const included: PackResult["included"] = [];
  for (const rel of sorted) {
    const abs = path.join(root, rel);
    const st = fs.statSync(abs);
    if (st.size > MAX_ENTRY) throw new Error(`봉투 엔트리 상한 초과 (${MAX_ENTRY}): ${rel}`);
    const mode = st.mode & 0o111 ? 0o755 : 0o644; // 실행 비트만 보존
    const content = fs.readFileSync(abs);
    chunks.push(header(rel, content.length, mode), content);
    const pad = content.length % BLOCK;
    if (pad) chunks.push(Buffer.alloc(BLOCK - pad));
    included.push({ path: rel, size: st.size });
  }
  chunks.push(Buffer.alloc(BLOCK * 2)); // 종료 표지
  const gz = zlib.gzipSync(Buffer.concat(chunks), { level: 9 });
  const digest = "sha256:" + crypto.createHash("sha256").update(gz).digest("hex");

  const file = outFile
    ? path.resolve(outFile)
    : path.join(artifactsDir(), artifactFileName(m.name, m.version));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, gz);

  // 선언 밖 보고 — 트리 전수에서 담은 것을 뺀 나머지
  const all: string[] = [];
  walk(root, "", viewOut, all);
  const excluded = all.filter((f) => !files.has(f));

  logLine("pack", { ref: m.name, version: m.version, digest, size: gz.length, files: included.length });
  return { file, ref: m.name, version: m.version, digest, size: gz.length, included, excluded, manifest: m, disclosure: disclosure(m) };
}

// ── 봉인 검증과 해체 ─────────────────────────────────────────────────────────

export function sha256File(file: string): string {
  return "sha256:" + crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** 다이제스트 대조. 불일치는 즉시 fail-loud — 검증 전의 바이트는 신뢰하지 않는다 */
export function verifyArtifact(file: string, expected: string): void {
  const actual = sha256File(file);
  if (actual !== expected) {
    throw new Error(`봉인 불일치: ${path.basename(file)}\n  기대 ${expected}\n  실제 ${actual}`);
  }
}

function parseOctal(b: Buffer, off: number, len: number): number {
  const s = b.subarray(off, off + len).toString("ascii").replace(/\0.*$/, "").trim();
  return s ? parseInt(s, 8) : 0;
}

function parseStr(b: Buffer, off: number, len: number): string {
  const end = b.indexOf(0, off);
  return b.subarray(off, end >= 0 && end < off + len ? end : off + len).toString("utf8");
}

/**
 * 봉투 해체. tar 는 심볼릭 링크·절대경로·상위 탈출을 담을 수 있는 형식이라 푸는 쪽이 봉인을
 * 진다: 일반 파일 외 전부 거부, 경로는 목적지 아래로만, 크기 상한. 반환은 쓴 파일 목록.
 * 다이제스트 검증(verifyArtifact)은 호출부가 이 함수보다 먼저 지나야 한다.
 */
export function unpackArtifact(file: string, destDir: string): string[] {
  const gz = fs.readFileSync(file);
  const tar = zlib.gunzipSync(gz, { maxOutputLength: MAX_TOTAL });
  const dest = path.resolve(destDir);
  fs.mkdirSync(dest, { recursive: true });
  const written: string[] = [];
  let off = 0;
  let total = 0;
  while (off + BLOCK <= tar.length) {
    const h = tar.subarray(off, off + BLOCK);
    if (h.every((b) => b === 0)) break; // 종료 표지
    const stored = parseOctal(h, 148, 8);
    const scratch = Buffer.from(h);
    scratch.fill(" ".charCodeAt(0), 148, 156);
    let sum = 0;
    for (const byte of scratch) sum += byte;
    if (sum !== stored) throw new Error(`손상된 봉투: 헤더 체크섬 불일치 (offset ${off})`);

    const type = String.fromCharCode(h[156]);
    const name = parseStr(h, 0, 100);
    const prefix = parseStr(h, 345, 155);
    const rel = prefix ? prefix + "/" + name : name;
    const size = parseOctal(h, 124, 12);
    const mode = parseOctal(h, 100, 8);
    off += BLOCK;

    if (type === "5") continue; // 디렉토리 — 파일 쓰기가 mkdir 로 대신한다
    if (type !== "0" && type !== "\0") {
      throw new Error(`봉투에 일반 파일이 아닌 엔트리가 있습니다 (type ${JSON.stringify(type)}): ${rel} — 링크·디바이스는 받지 않습니다`);
    }
    if (!rel || rel.startsWith("/") || rel.split("/").includes("..")) throw new Error(`경로 탈출: ${rel}`);
    const target = path.normalize(path.join(dest, rel));
    if (target !== dest && !target.startsWith(dest + path.sep)) throw new Error(`경로 탈출: ${rel}`);
    if (size > MAX_ENTRY) throw new Error(`봉투 엔트리 상한 초과: ${rel}`);
    total += size;
    if (total > MAX_TOTAL) throw new Error(`봉투 전체 상한 초과 (${MAX_TOTAL})`);

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, tar.subarray(off, off + size), { mode: mode & 0o111 ? 0o755 : 0o644 });
    written.push(rel);
    off += Math.ceil(size / BLOCK) * BLOCK;
  }
  if (!written.length) throw new Error(`빈 봉투: ${file}`);
  return written;
}

// ── 로컬 마켓 선반 (index.json) ──────────────────────────────────────────────

export interface MarketEntry {
  ref: string;
  /** 발행 주체 scope (예: "@yuni"). C2C 호환 규율 4 — 지금은 전부 퍼스트파티지만 칸은 첫날부터 */
  seller: string;
  version: string;
  /** artifacts 디렉토리 안의 파일 이름 (원격 인덱스는 url 을 쓴다 — registry.ts 참조) */
  file: string;
  size: number;
  digest: string;
  display_name: string;
  description: string;
  /** artifacts 디렉토리 안의 아이콘 사본 이름 (없으면 null) */
  icon: string | null;
  files: number;
  disclosure: Disclosure;
  packedAt: string;
}

export function sellerOf(ref: string): string {
  return ref.split("/")[0] ?? ref;
}

function indexFile(): string {
  return path.join(artifactsDir(), "index.json");
}

export function readMarketIndex(): MarketEntry[] {
  const f = indexFile();
  if (!fs.existsSync(f)) return [];
  try {
    const j = JSON.parse(fs.readFileSync(f, "utf8"));
    const entries: MarketEntry[] = Array.isArray(j.entries) ? j.entries : [];
    // seller 필드 도입 전에 등재된 항목 — ref 에서 파생해 채운다
    return entries.map((e) => ({ ...e, seller: e.seller ?? sellerOf(e.ref) }));
  } catch {
    return []; // 손상된 index — pack 이 다시 쓰면 복구된다
  }
}

/**
 * 로컬 마켓 등재. ref 당 한 줄 — 새 판이 이전 판을 대체한다 (아티팩트 파일은 버전별로 남는다).
 * 아이콘은 봉투 밖 사본으로 선반에 놓아 화면이 압축을 풀지 않고도 그리게 한다.
 */
export function updateMarketIndex(pkgDir: string, r: PackResult): string {
  const dir = artifactsDir();
  let icon: string | null = null;
  if (r.manifest.icon) {
    const src = path.join(pkgDir, r.manifest.icon);
    if (fs.existsSync(src)) {
      icon = `${r.ref.replace(/^@/, "").replace(/\//g, "-")}-icon${path.extname(r.manifest.icon)}`;
      fs.copyFileSync(src, path.join(dir, icon));
    }
  }
  const entry: MarketEntry = {
    ref: r.ref,
    seller: sellerOf(r.ref),
    version: r.version,
    file: path.basename(r.file),
    size: r.size,
    digest: r.digest,
    display_name: r.manifest.display_name,
    description: r.manifest.description,
    icon,
    files: r.included.length,
    disclosure: r.disclosure,
    packedAt: new Date().toISOString(),
  };
  const entries = readMarketIndex().filter((e) => e.ref !== r.ref);
  entries.push(entry);
  entries.sort((a, b) => a.ref.localeCompare(b.ref));
  fs.writeFileSync(indexFile(), JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), entries }, null, 2));
  return indexFile();
}
