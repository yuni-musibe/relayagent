import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { saveLedger, expandHome, workspacePath, RELAY_HOME, type Grant, type Ledger, type PkgOrigin } from "./state.ts";
import { loadManifest, judge, activeHarness, disclosure, ManifestError, type Disclosure, type Manifest, type HarnessVariant } from "./manifest.ts";
import { buildView, type BuildResult } from "./build.ts";
import { conformHarness } from "./conform.ts";
import { spawnEntrySync } from "./entry.ts";
import { vaultGet, vaultSet } from "./vault.ts";
import { sha256File, unpackArtifact } from "./pack.ts";
import { parse as parseYaml } from "yaml";

export interface InstallOpts {
  name?: string;
  ring0?: boolean;
  /** 폴더 결재 — 세션 cwd. 미지정 = 기본 ~/Relay/<이름>. 이 지정이 GUI 폴더 선택의 CLI 형태다 */
  workspace?: string;
}

export interface InstallResult {
  name: string;
  manifest: Manifest;
  /** 후보들의 setup 점검 결과. ok = 쓸 수 있는 하네스를 하나라도 골랐다 */
  setup?: { ok: boolean; out: string };
  build?: BuildResult;
}

/** requires 실체 판정. 기판은 안내(install)만 전하고 대신 설치하지 않는다 */
export function judgeRequires(m: Manifest): void {
  const r = m.requires;
  if (!r) return;
  const issues: string[] = [];
  if (r.os?.length && !(r.os as string[]).includes(process.platform)) {
    issues.push(`requires os: ${process.platform} 미지원 (요구: ${r.os.join(", ")})`);
  }
  for (const b of r.binaries ?? []) {
    const probe = spawnSync(process.platform === "win32" ? "where" : "which", [b.name], { encoding: "utf8" });
    if (probe.status !== 0) issues.push(`requires binary 없음: ${b.name}${b.install ? ` (설치: ${b.install})` : ""}`);
  }
  const appRoots = ["/Applications", path.join(os.homedir(), "Applications"), "/System/Applications"];
  for (const a of r.apps ?? []) {
    if (!appRoots.some((root) => fs.existsSync(path.join(root, a.name + ".app")))) {
      issues.push(`requires app 없음: ${a.name}.app${a.install ? ` (설치: ${a.install})` : ""}`);
    }
  }
  if (issues.length) throw new ManifestError(issues);
}

/** 하네스 계약 검사 — 어댑터 동사를 실제 실행한다. 위반이면 fail-loud (장부 기록 전에 불러야 한다) */
function judgeConform(pkgPath: string, m: Manifest): void {
  const broken = (m.harness?.variants ?? [])
    .map((v) => conformHarness(pkgPath, v))
    .filter((r) => !r.ok)
    .map((r) => `${r.variant}: ` + r.checks.filter((c) => !c.ok).map((c) => `${c.verb} — ${c.note}`).join(" / "));
  if (broken.length) {
    throw new ManifestError(["하네스 계약 위반 (relay harness-check 로 재현):", ...broken]);
  }
}

/** variant 전수 setup 을 돌려 쓸 수 있는 하네스를 선출한다 — installPkg 과 activatePrepared 공용 */
function electHarness(pkgPath: string, m: Manifest): { picked: string | null; out: string } | null {
  const variants = m.harness?.variants ?? [];
  if (!variants.length) return null;
  const reports: string[] = [];
  let picked: string | null = null;
  for (const v of variants) {
    // Windows 에서는 엔트리 확장자 해석이 필요하다 — 이 레포의 어댑터 실행 규약(spawnEntrySync)을 따른다
    const r = spawnEntrySync(path.join(pkgPath, v.source, v.entry), ["setup"], { encoding: "utf8" });
    const out = ((r.stdout ?? "") + (r.stderr ?? "")).trim();
    reports.push(`${v.name}: ${r.status === 0 ? "준비됨" : "불가"} — ${out}`);
    if (r.status === 0 && !picked) picked = v.name;
  }
  return { picked, out: reports.join("\n") };
}

export function installPkg(ledger: Ledger, dir: string, opts: InstallOpts = {}): InstallResult {
  const abs = path.resolve(dir);
  const m = loadManifest(abs);
  judgeRequires(m); // 장부에 기록되기 전에 fail-loud

  // 계약 적합성은 설치 게이트다. 도구 미설치(환경 미비)와 계약 위반(어댑터 결함)은 다른 축이라
  // conform 은 setup 실패를 위반으로 세지 않는다 — 여기서 막히는 것은 잘못 만든 어댑터뿐이다.
  // 장부 기록 전에 던져야 거부된 패키지가 등재된 채 남지 않는다(judgeRequires 와 같은 자리)
  judgeConform(abs, m);
  const name = opts.name ?? path.basename(abs);

  // 재설치는 결재·설정(ring, workspace, model, effort, harness, dirBindings)을 보존한다.
  // 레코드를 통째로 갈면 ring-0 이 조용히 증발한다 — draft.ts 의 publishDraft 와 같은 계약
  const prev = ledger.packages[name];
  ledger.packages[name] = {
    ...(prev ?? {}),
    path: abs,
    ...(opts.workspace ? { workspace: path.resolve(expandHome(opts.workspace)) } : {}),
    ...(opts.ring0 ? { ring: 0 as const } : {}),
  };
  saveLedger(ledger);
  let setup: { ok: boolean; out: string } | undefined;
  const variants = m.harness?.variants ?? [];
  const current = ledger.packages[name].harness;
  // 활성 하네스가 새 선언에 살아 있으면 사용자의 선택을 존중하고, 없으면 선출한다
  if (variants.length && (!current || !variants.some((v) => v.name === current))) {
    const elected = electHarness(abs, m)!;
    ledger.packages[name].harness = elected.picked ?? variants[0].name;
    saveLedger(ledger);
    setup = { ok: elected.picked != null, out: `활성 하네스: ${ledger.packages[name].harness}\n` + elected.out };
  }
  const build = buildView(name, abs, m);
  return { name, manifest: m, setup, build };
}

// ── 아티팩트 설치: 준비(정적)와 활성(실행)의 분리 ────────────────────────────
// 마켓에서 오는 패키지는 모르는 사람의 코드다. 동의 전에는 한 줄도 실행하지 않는다 —
// prepare 는 봉인 검증·전개·판정·고지서 계산까지(전부 정적), activate 가 그 선을 넘는다
// (conform·setup·빌드·장부). 장부 기록이 activate 에 있는 것이 계약이다: 동의하지 않은
// 패키지는 장부에 남지 않는다.

function lineageOf(rec: { path: string }): string | null {
  try {
    return loadManifest(rec.path).name;
  } catch {
    return null;
  }
}

/** 두 트리의 내용 동일성 (.relay-digest 표식은 제외). 릴리스는 KB 급이라 전량 대조가 싸다 */
function sameTree(a: string, b: string): boolean {
  const list = (root: string, rel = ""): string[] => {
    const out: string[] = [];
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const r = rel ? rel + "/" + e.name : e.name;
      if (r === ".relay-digest") continue;
      if (e.isDirectory()) out.push(...list(root, r));
      else if (e.isFile()) out.push(r);
    }
    return out.sort();
  };
  const la = list(a);
  const lb = list(b);
  if (la.length !== lb.length || la.some((p, i) => p !== lb[i])) return false;
  return la.every((p) => {
    const fa = fs.readFileSync(path.join(a, p));
    const fb = fs.readFileSync(path.join(b, p));
    return fa.equals(fb);
  });
}

/**
 * 설치 이름 결정. 장부 키는 로컬 사정(디렉토리 이름)이라 @alice/todo 와 @bob/todo 가 같은
 * "todo" 를 두고 부딪칠 수 있다 — 그 충돌을 여기서 해소한다. 같은 ref 의 기존 설치는 충돌이
 * 아니라 업데이트다.
 */
export function resolveInstallName(ledger: Ledger, ref: string, explicit?: string): { name: string; fresh: boolean } {
  if (explicit) {
    const rec = ledger.packages[explicit];
    if (!rec) return { name: explicit, fresh: true };
    const cur = rec.origin?.ref ?? lineageOf(rec);
    if (cur !== ref) throw new Error(`이미 있는 설치 이름: ${explicit} (${cur ?? "출처 불명"}) — 다른 --name 을 지정하세요`);
    return { name: explicit, fresh: false };
  }
  for (const [name, rec] of Object.entries(ledger.packages)) {
    if (rec.origin?.ref === ref) return { name, fresh: false };
  }
  const short = ref.split("/")[1] ?? ref.replace(/^@/, "");
  const shortRec = ledger.packages[short];
  if (!shortRec) return { name: short, fresh: true };
  if (lineageOf(shortRec) === ref) return { name: short, fresh: false }; // 같은 혈통의 로컬 설치 — 그 자리를 잇는다
  const scoped = ref.replace(/^@/, "").replace(/\//g, "-");
  const scopedRec = ledger.packages[scoped];
  if (!scopedRec) return { name: scoped, fresh: true };
  if (lineageOf(scopedRec) === ref) return { name: scoped, fresh: false };
  throw new Error(`설치 이름 충돌: ${short} 와 ${scoped} 가 모두 다른 패키지입니다 — --name 으로 지정하세요`);
}

export interface Prepared {
  /** API 왕복용 토큰. CLI 는 쓰지 않는다 */
  id: string;
  name: string;
  fresh: boolean;
  ref: string;
  version: string;
  digest: string;
  size: number;
  /** 릴리스 자리(~/.relay/releases/<이름>/<버전>)에 이미 전개된 경로 */
  dir: string;
  registry: string | null;
  manifest: Manifest;
  disclosure: Disclosure;
}

/**
 * 아티팩트 준비. 봉인 검증 -> 임시 전개 -> 매니페스트 판정 -> requires 실체 판정 ->
 * 이름 결정 -> 릴리스 자리로 이동 -> 고지서 계산. 패키지 코드는 실행되지 않는다.
 * 릴리스는 불변이라 같은 버전 자리에 다른 내용이 오면 거부한다 (.relay-digest 로 대조).
 */
export function prepareArtifact(
  ledger: Ledger,
  file: string,
  opts: { name?: string; digest?: string; registry?: string | null } = {},
): Prepared {
  const abs = path.resolve(expandHome(file));
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new Error(`없는 아티팩트: ${file}`);
  const digest = sha256File(abs);
  if (opts.digest && opts.digest !== digest) {
    throw new Error(`봉인 불일치: 기대 ${opts.digest}\n  실제 ${digest} — 아티팩트를 다시 받으세요`);
  }
  const staging = fs.mkdtempSync(path.join(RELAY_HOME, "run", "prepare-"));
  try {
    unpackArtifact(abs, staging);
    const m = loadManifest(staging); // 판정 실패는 여기서 fail-loud
    judgeRequires(m);
    const { name, fresh } = resolveInstallName(ledger, m.name, opts.name);
    const dest = path.join(RELAY_HOME, "releases", name, m.version);
    const digestFile = path.join(dest, ".relay-digest");
    if (fs.existsSync(dest)) {
      const prev = fs.existsSync(digestFile) ? fs.readFileSync(digestFile, "utf8").trim() : null;
      if (prev === digest) {
        fs.rmSync(staging, { recursive: true, force: true }); // 같은 봉인 — 기존 스냅샷 재사용
      } else if (prev === null && sameTree(staging, dest)) {
        // 봉인 기록이 없는 릴리스 = 아티팩트 이전 시대의 로컬 발행본. 저자 컴퓨터에서
        // 자기 발행본과 스토어 설치가 같은 자리를 두고 만나는 흔한 경우다 — 내용이
        // 같음이 증명되면 그 자리를 입양한다. 불변 원칙은 지켜진다: 바뀌는 건 표식뿐이다
        fs.writeFileSync(digestFile, digest + "\n");
        fs.rmSync(staging, { recursive: true, force: true });
      } else {
        throw new Error(
          `이미 있는 릴리스: ${name}@${m.version} — 릴리스는 불변입니다. ` +
          `같은 버전에 다른 내용이 왔습니다 (기존: ${prev ?? "봉인 기록 없는 로컬 발행본"}). 버전을 올려 다시 구우세요`,
        );
      }
    } else {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.renameSync(staging, dest);
      fs.writeFileSync(digestFile, digest + "\n");
    }
    return {
      id: crypto.randomBytes(12).toString("hex"),
      name,
      fresh,
      ref: m.name,
      version: m.version,
      digest,
      size: fs.statSync(abs).size,
      dir: dest,
      registry: opts.registry ?? null,
      manifest: m,
      disclosure: disclosure(m),
    };
  } catch (e) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw e;
  }
}

/**
 * 준비된 패키지의 활성. 여기서 처음 패키지 코드가 실행된다(conform·setup·빌드).
 * 순서가 계약이다: conform -> 빌드 -> 장부. 빌드 실패는 설치 실패다 — 깨진 화면으로
 * "설치 성공" 을 만들지 않는다. 장부 반영은 전부 통과한 뒤 한 번이라 실패해도 장부는 무결하다.
 * 업데이트는 rec.path 만 갈아 끼운다 — ring·workspace·model·harness 는 결재·설정이라 보존
 * (publishDraft 와 같은 계약).
 */
export function activatePrepared(ledger: Ledger, p: Prepared, opts: InstallOpts = {}): InstallResult {
  const m = p.manifest;
  judgeConform(p.dir, m);
  const build = buildView(p.name, p.dir, m);
  if (build && !build.ok) {
    throw new Error(`view 빌드 실패 — 설치를 중단합니다 (릴리스는 ${p.dir} 에 남아 있습니다):\n${build.out}`);
  }

  const origin: PkgOrigin = {
    registry: p.registry,
    ref: p.ref,
    version: p.version,
    digest: p.digest,
    installedAt: new Date().toISOString(),
  };
  const existing = ledger.packages[p.name];
  if (existing) {
    existing.path = p.dir;
    existing.origin = origin;
    if (opts.workspace) existing.workspace = path.resolve(expandHome(opts.workspace));
  } else {
    ledger.packages[p.name] = {
      path: p.dir,
      origin,
      ...(opts.workspace ? { workspace: path.resolve(expandHome(opts.workspace)) } : {}),
      ...(opts.ring0 ? { ring: 0 as const } : {}),
    };
  }
  // 활성 하네스가 새 선언에 살아 있으면 사용자의 선택을 존중하고, 없으면 재선출한다
  let setup: { ok: boolean; out: string } | undefined;
  const variants = m.harness?.variants ?? [];
  const current = ledger.packages[p.name].harness;
  if (variants.length && (!current || !variants.some((v) => v.name === current))) {
    const elected = electHarness(p.dir, m)!;
    ledger.packages[p.name].harness = elected.picked ?? variants[0].name;
    setup = { ok: elected.picked != null, out: `활성 하네스: ${ledger.packages[p.name].harness}\n` + elected.out };
  }
  saveLedger(ledger);
  return { name: p.name, manifest: m, setup, build: build ?? undefined };
}

export function buildPkg(ledger: Ledger, name: string): BuildResult {
  const rec = ledger.packages[name];
  if (!rec) throw new Error(`미설치 패키지: ${name}`);
  const m = loadManifest(rec.path);
  return buildView(name, rec.path, m) ?? { ok: true, out: "surfaces.view.out 미선언 — 빌드 없이 source 를 그대로 서빙합니다" };
}

// token 자격형은 자격이 기판 손(vault)에 있다 — 동사 실행에도 세션과 같은 주입을 해줘야
// setup 이 "연결 후에도 미준비" 로 거짓말하지 않는다
function llmEnv(v: HarnessVariant): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (v.llm?.auth?.kind === "token" && v.llm.auth.env) {
    const cred = vaultGet(`llm/${v.llm.provider}`);
    if (cred) env[v.llm.auth.env] = cred;
  }
  return env;
}

export function harnessVerb(ledger: Ledger, name: string, verb: "models" | "info" | "setup" | "commands"): { ok: boolean; out: string } {
  const rec = ledger.packages[name];
  if (!rec) throw new Error(`미설치 패키지: ${name}`);
  const m = loadManifest(rec.path);
  const v = activeHarness(m, rec.harness);
  if (!v) throw new Error(`하네스 미동봉 패키지: ${name}`);
  const r = spawnEntrySync(path.join(rec.path, v.source, v.entry), [verb], { encoding: "utf8", env: llmEnv(v) });
  // models·info·commands 는 stdout 이 JSON 계약이다. stderr(강등 사유 등)를 섞으면
  // JSON 해석이 깨져 화면의 모델 목록이 통째로 사라진다 — 진단문은 setup 에만 합친다
  const jsonVerb = verb === "models" || verb === "info" || verb === "commands";
  const out = jsonVerb ? (r.stdout ?? "") : (r.stdout ?? "") + (r.stderr ?? "");
  return { ok: r.status === 0, out: out.trim() };
}

export interface VariantProbe {
  name: string;
  provider: string | null;
  ready: boolean;
  /** 미준비의 축 — 화면이 처방을 고르는 기준 */
  reason: "ok" | "no-tool" | "no-auth";
  note: string;
  account: unknown;
  protocol: number;
  capabilities: string[];
  login: boolean;
  auth: string | null;
}

/** variant 전수 점검 — 다이얼로그의 행별 준비 상태·계정 표시가 이걸 그린다. 활성만 보던 구멍의 답 */
export function probeHarness(ledger: Ledger, name: string): VariantProbe[] {
  const rec = ledger.packages[name];
  if (!rec) throw new Error(`미설치 패키지: ${name}`);
  const m = loadManifest(rec.path);
  return (m.harness?.variants ?? []).map((v) => {
    const entry = path.join(rec.path, v.source, v.entry);
    const env = llmEnv(v);
    const info = spawnEntrySync(entry, ["info"], { encoding: "utf8", timeout: 15_000, env });
    let j: { account?: unknown; protocol?: unknown; capabilities?: unknown; verbs?: unknown } = {};
    try {
      j = JSON.parse(info.stdout || "{}");
    } catch { /* info 비 JSON — conform 이 잡을 결함, 여기선 기본값으로 */ }
    const setup = spawnEntrySync(entry, ["setup"], { encoding: "utf8", timeout: 15_000, env });
    // setup 종료코드가 미준비의 축을 가른다: 3 = 도구 없음(설치), 그 외 비0 = 자격 없음(로그인/토큰).
    // 화면은 이 축으로 처방을 고른다 — 도구가 없는데 토큰 입력창을 띄우면 사용자를 헛돌린다
    const reason = setup.status === 0 ? "ok" : setup.status === 3 ? "no-tool" : "no-auth";
    return {
      name: v.name,
      provider: v.llm?.provider ?? null,
      ready: setup.status === 0,
      reason,
      note: ((setup.stdout ?? "") + (setup.stderr ?? "")).trim().split("\n")[0] ?? "",
      account: j.account ?? null,
      protocol: Number.isInteger(j.protocol) ? (j.protocol as number) : 1,
      capabilities: Array.isArray(j.capabilities) ? j.capabilities.filter((c): c is string => typeof c === "string") : [],
      login: Array.isArray(j.verbs) && (j.verbs as unknown[]).includes("login"),
      auth: v.llm?.auth?.kind ?? null,
    };
  });
}

/** token 자격형 하네스의 자격 연결 — vault 에 provider 소속으로 앉힌다 (relay connect llm 의 웹 등가) */
export function connectHarnessToken(ledger: Ledger, name: string, tokenValue: string): { ok: boolean; out: string } {
  const rec = ledger.packages[name];
  if (!rec) throw new Error(`미설치 패키지: ${name}`);
  const m = loadManifest(rec.path);
  const v = activeHarness(m, rec.harness);
  if (!v) throw new Error(`하네스 미동봉 패키지: ${name}`);
  if (v.llm?.auth?.kind !== "token" || !v.llm.provider) {
    throw new Error(`token 자격형 하네스가 아닙니다: ${v.name} — 대화형 로그인은 터미널에서 relay login ${name}`);
  }
  const val = tokenValue.trim();
  if (!val) throw new Error("빈 토큰");
  vaultSet(`llm/${v.llm.provider}`, val);
  return harnessVerb(ledger, name, "setup");
}

/** login 은 대화형(TTY 상속)이라 출력을 삼키지 않는다. HTTP 로는 열지 않는다 — 사용자의 터미널 행위 */
export function harnessLogin(ledger: Ledger, name: string, args: string[] = []): number {
  const rec = ledger.packages[name];
  if (!rec) throw new Error(`미설치 패키지: ${name}`);
  const m = loadManifest(rec.path);
  const v = activeHarness(m, rec.harness);
  if (!v) throw new Error(`하네스 미동봉 패키지: ${name}`);
  const entry = path.join(rec.path, v.source, v.entry);
  const info = spawnEntrySync(entry, ["info"], { encoding: "utf8" });
  let verbs: string[] = [];
  try {
    verbs = JSON.parse(info.stdout || "{}").verbs ?? [];
  } catch { /* info 미구현 어댑터 — 아래에서 거부 */ }
  if (!verbs.includes("login")) {
    throw new Error(`이 하네스(${v.name})는 login 동사를 제공하지 않습니다 — 자격 연결은 relay connect llm ${v.llm?.provider ?? "<provider>"} 로 하세요`);
  }
  const r = spawnEntrySync(entry, ["login", ...args], { stdio: "inherit" });
  return r.status ?? 1;
}

/**
 * GUI 발화 로그인. 대화형 인증은 TTY 소유라 브라우저가 대신할 수 없지만, 띄우는 것은 할 수 있다 —
 * 기판이 터미널 창을 열어 login 동사를 그 안에서 돌린다. 자격을 만드는 행위는 여전히 사용자의 것이고
 * 기판은 문만 열어 준다. 창을 못 여는 환경에서는 명령을 돌려줘 사용자가 직접 실행한다
 */
export function launchHarnessLogin(ledger: Ledger, name: string, opts: { switch?: boolean } = {}): { launched: boolean; command: string; note: string } {
  const rec = ledger.packages[name];
  if (!rec) throw new Error(`미설치 패키지: ${name}`);
  const m = loadManifest(rec.path);
  const v = activeHarness(m, rec.harness);
  if (!v) throw new Error(`하네스 미동봉 패키지: ${name}`);
  const entry = path.join(rec.path, v.source, v.entry);
  const info = spawnEntrySync(entry, ["info"], { encoding: "utf8" });
  let verbs: string[] = [];
  try {
    verbs = JSON.parse(info.stdout || "{}").verbs ?? [];
  } catch { /* info 미구현 어댑터 — 아래에서 거부 */ }
  if (!verbs.includes("login")) {
    throw new Error(`이 하네스(${v.name})는 login 동사를 제공하지 않습니다 — 자격 연결은 토큰 입력으로 하세요`);
  }
  const args = opts.switch ? ["login", "--switch"] : ["login"];
  const command = `relay login ${name}${opts.switch ? " --switch" : ""}`;
  if (process.platform !== "darwin") {
    return { launched: false, command, note: "이 환경에서는 터미널 창을 열 수 없습니다 — 아래 명령을 직접 실행하세요" };
  }
  const script = path.join(RELAY_HOME, "run", `login-${name.replace(/[^a-zA-Z0-9._-]/g, "_")}.command`);
  fs.writeFileSync(
    script,
    `#!/bin/bash\ncd ${JSON.stringify(path.dirname(entry))}\necho "relay: ${v.name} 로그인 — 끝나면 이 창을 닫고 GUI 에서 '다시 점검'"\n${JSON.stringify(entry)} ${args.map((a) => JSON.stringify(a)).join(" ")}\n`,
    { mode: 0o700 },
  );
  const r = spawnSync("open", ["-a", "Terminal", script], { encoding: "utf8" });
  if (r.status !== 0) return { launched: false, command, note: (r.stderr ?? "터미널을 열지 못했습니다").trim() };
  return { launched: true, command, note: "터미널 창에서 로그인을 마친 뒤 다시 점검을 누르세요" };
}

export function setHarness(ledger: Ledger, name: string, variant: string): { active: string; setup: { ok: boolean; out: string } } {
  const rec = ledger.packages[name];
  if (!rec) throw new Error(`미설치 패키지: ${name}`);
  const m = loadManifest(rec.path);
  const v = (m.harness?.variants ?? []).find((x) => x.name === variant);
  if (!v) throw new Error(`미선언 하네스: ${variant} (선언: ${(m.harness?.variants ?? []).map((x) => x.name).join(", ")})`);
  rec.harness = variant;
  // 모델 어휘는 하네스 소속이다. 이전 하네스의 모델명이 새 어댑터로 넘어가면 무의미한 --model 이 된다
  delete rec.model;
  saveLedger(ledger);
  const r = spawnEntrySync(path.join(rec.path, v.source, v.entry), ["setup"], { encoding: "utf8" });
  return { active: variant, setup: { ok: r.status === 0, out: ((r.stdout ?? "") + (r.stderr ?? "")).trim() } };
}

export function removePkg(ledger: Ledger, name: string): void {
  delete ledger.packages[name];
  ledger.grants = ledger.grants.filter((g) => g.consumer !== name && g.provider !== name);
  saveLedger(ledger);
}

const bareRef = (ref: string) => ref.replace(/@[^/@]+$/, "");

/** 장부에 들어가는 유일한 문. 스크립트, HTTP, CLI 가 전부 여기를 지난다 */
export function addGrant(ledger: Ledger, g: Grant): void {
  const consumer = ledger.packages[g.consumer];
  const provider = ledger.packages[g.provider];
  if (!consumer) throw new Error(`미설치 consumer: ${g.consumer}`);
  if (!provider) throw new Error(`미설치 provider: ${g.provider}`);
  if (g.tools?.length && g.mission) throw new Error("tools 와 mission 동시 결재 불가");
  if (!g.tools?.length && !g.mission) throw new Error("tools 또는 mission 중 하나는 있어야 합니다");

  // 선언은 신청, 결재는 활성화. 결재는 선언을 넘지 못한다
  const lineage = loadManifest(provider.path).name;
  const declared = (loadManifest(consumer.path).edges ?? []).filter((e) => {
    const ref = String(e.provider ?? "");
    return ref === g.provider || ref === lineage || bareRef(ref) === lineage;
  });
  if (!declared.length) {
    throw new Error(`미선언 edge: ${g.consumer} 의 relay.yaml edges 에 ${lineage} 가 없습니다. 결재는 선언을 넘지 못합니다`);
  }
  if (g.mission && !declared.some((e) => e.mission === g.mission)) {
    const decl = declared.map((e) => e.mission).filter(Boolean).join(", ") || "없음";
    throw new Error(`선언 캡 초과: mission ${g.mission} (선언된 mission: ${decl})`);
  }
  if (g.tools?.length) {
    const allowed = new Set(declared.flatMap((e) => e.tools ?? []));
    const over = g.tools.filter((t) => !allowed.has(t));
    if (over.length) throw new Error(`선언 캡 초과: tools ${over.join(", ")} (선언된 tools: ${[...allowed].join(", ") || "없음"})`);
  }

  const dup = ledger.grants.find(
    (x) => x.consumer === g.consumer && x.provider === g.provider && x.mission === g.mission && JSON.stringify(x.tools) === JSON.stringify(g.tools),
  );
  if (!dup) ledger.grants.push({ consumer: g.consumer, provider: g.provider, tools: g.tools, mission: g.mission });
  saveLedger(ledger);
}

export function removeGrant(ledger: Ledger, g: Grant): void {
  ledger.grants = ledger.grants.filter(
    (x) => !(x.consumer === g.consumer && x.provider === g.provider && x.mission === g.mission),
  );
  saveLedger(ledger);
}

export function resolveProvider(ledger: Ledger, ref: string): string | null {
  if (ledger.packages[ref]) return ref;
  const bare = ref.replace(/@[^/@]+$/, "").replace(/^(@[a-z0-9-]+\/[a-z0-9-]+).*$/, "$1");
  for (const [name, rec] of Object.entries(ledger.packages)) {
    try {
      const m = loadManifest(rec.path);
      if (m.name === bare || m.name === ref) return name;
    } catch {
      continue;
    }
  }
  return null;
}

export function validateDir(dir: string): { ok: boolean; issues: string[] } {
  try {
    const abs = path.resolve(dir);
    const raw = parseYaml(fs.readFileSync(path.join(abs, "relay.yaml"), "utf8")) as Manifest;
    judge(raw, abs);
    return { ok: true, issues: [] };
  } catch (e) {
    if (e instanceof ManifestError) return { ok: false, issues: e.issues };
    return { ok: false, issues: [String(e)] };
  }
}

export function registryData(ledger: Ledger): unknown {
  const packages = Object.entries(ledger.packages).map(([name, rec]) => {
    let manifest: Manifest | null = null;
    let error: string | null = null;
    try {
      manifest = loadManifest(rec.path);
    } catch (e) {
      error = String(e);
    }
    return { name, path: rec.path, workspace: workspacePath(ledger, name), ring: rec.ring ?? null, model: rec.model ?? null, effort: rec.effort ?? null, harness: rec.harness ?? null, origin: rec.origin ?? null, manifest, error };
  });
  return { packages, grants: ledger.grants };
}
