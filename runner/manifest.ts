import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

export type RequiredOS = "darwin" | "linux" | "win32";

export interface RequiresDecl {
  os?: RequiredOS[];
  binaries?: { name: string; install?: string }[];
  apps?: { name: string; install?: string }[];
}

export interface Manifest {
  schema: string;
  name: string;
  version: string;
  display_name: string;
  description: string;
  icon?: string;
  requires?: RequiresDecl;
  surfaces: {
    view?: { source: string; out?: string };
    chat?: { mode: "direct" | "none"; greeting?: string };
    channels?: { name: string; source: string; entry: string; icon?: string }[];
  };
  harness?: {
    variants?: HarnessVariant[];
    workdir?: string;
  };
  hooks?: { deny?: string[] };
  agents?: { name: string; persona: string; skills?: string; commands?: string; dispatch?: string[]; scripts?: string[] }[];
  scripts?: { source: string };
  services?: ServiceDecl[];
  triggers?: TriggerDecl[];
  missions?: { name: string; description?: string }[];
  edges?: { provider: string; tools?: string[]; mission?: string }[];
  org?: unknown;
}

export interface HarnessVariant {
  name: string;
  source: string;
  entry: string;
  dockerfile?: string;
  /** 어댑터 도구 아이콘 (패키지 상대경로 이미지) */
  icon?: string;
  llm?: { provider: string; auth?: AuthDecl; /** provider(모델) 아이콘 */ icon?: string };
}

export type ServiceDecl =
  | { name: string; source: string; dockerfile?: string; entry?: string; disk?: string; resources?: { memory?: string; cpu?: number }; port?: number }
  | { name: string; url: string; tools?: string[]; auth?: AuthDecl }
  | { name: string; dir: string };

export interface AuthDecl {
  kind: "none" | "token" | "oauth";
  env?: string;
  help?: { url?: string; note?: string };
  verify?: { url: string; headers?: Record<string, string> };
  client?: string;
  oauth_client?: unknown;
}

export interface TriggerDecl {
  id: string;
  when: { cron?: string; tz?: string; event?: string; filter?: Record<string, unknown>; debounce_ms?: number };
  then: { agent?: string; prompt?: string; route?: string; delivery?: string; script?: string };
}

const NAME = /^@[a-z0-9-]+\/[a-z0-9][a-z0-9-]{1,39}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const PROVIDER = /^@[a-z0-9-]+\/[a-z0-9][a-z0-9-]{1,39}(@[^\s@]+)?$/;

export class ManifestError extends Error {
  issues: string[];
  constructor(issues: string[]) {
    super(issues.join("\n"));
    this.issues = issues;
  }
}

export function shortName(pkg: string): string {
  return pkg.split("/").pop() ?? pkg;
}

const badPath = (p: string, allowTilde = false) =>
  (!allowTilde && (p.startsWith("/") || p.startsWith("~"))) ||
  (allowTilde && p.startsWith("/")) ||
  p.split("/").includes("..");

export function loadManifest(pkgPath: string): Manifest {
  const file = path.join(pkgPath, "relay.yaml");
  if (!fs.existsSync(file)) throw new ManifestError([`relay.yaml 없음: ${pkgPath}`]);
  const m = parseYaml(fs.readFileSync(file, "utf8")) as Manifest;
  judge(m, pkgPath);
  return m;
}

export function judge(m: Manifest, pkgPath?: string): void {
  const issues: string[] = [];
  const at = (p: string) => (pkgPath ? path.join(pkgPath, p) : null);
  const mustExist = (p: string, label: string) => {
    const full = at(p);
    if (full && !fs.existsSync(full)) issues.push(`${label}: 실체 없음: ${p}`);
  };

  if (m.schema !== "relay/v1") issues.push(`schema: relay/v1 필요`);
  for (const f of ["name", "version", "display_name", "description"] as const) {
    if (typeof m[f] !== "string" || m[f].trim() === "") issues.push(`${f}: 필수`);
  }
  if (m.name && !NAME.test(m.name)) issues.push(`name 형식 위반: ${m.name}`);
  if (!m.surfaces || typeof m.surfaces !== "object") issues.push("surfaces: 필수");

  if (m.icon) mustExist(m.icon, "icon");

  // requires 의 형태 판정. 실체(호스트에 실제로 있는가)는 설치가 판정한다
  const req = m.requires;
  if (req) {
    if (req.os && req.os.length === 0) issues.push("requires.os: 빈 목록 불가");
    for (const o of req.os ?? []) {
      if (!["darwin", "linux", "win32"].includes(o)) issues.push(`requires.os 닫힌집합 위반: ${o}`);
    }
    if (req.binaries && req.binaries.length === 0) issues.push("requires.binaries: 빈 목록 불가");
    const BIN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
    for (const b of req.binaries ?? []) {
      if (typeof b !== "object" || b == null || !BIN.test(b.name ?? "")) {
        issues.push(`requires.binaries 형식 위반({name, install?}): ${JSON.stringify(b)}`);
      }
    }
    if (req.apps && req.apps.length === 0) issues.push("requires.apps: 빈 목록 불가");
    const APP = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/;
    for (const a of req.apps ?? []) {
      if (typeof a !== "object" || a == null || !APP.test(a.name ?? "") || /\.app$/i.test(a.name ?? "")) {
        issues.push(`requires.apps 형식 위반(.app 을 뺀 번들 이름의 {name, install?}): ${JSON.stringify(a)}`);
      }
    }
    if ((req.apps ?? []).length > 0 && ((req.os ?? []).length === 0 || (req.os ?? []).some((o) => o !== "darwin"))) {
      issues.push("requires.apps 는 darwin 전용: requires.os 를 [darwin] 으로 선언");
    }
  }

  const view = m.surfaces?.view;
  if (view) {
    if (!view.source || badPath(view.source)) issues.push("surfaces.view.source: 상대경로 필수");
    else mustExist(view.source, "surfaces.view.source");
  }
  for (const c of m.surfaces?.channels ?? []) {
    if (!SLUG.test(c.name ?? "")) issues.push(`channels 이름 형식 위반: ${c.name}`);
    if (!c.source || !c.entry) issues.push(`channels[${c.name}]: source + entry 필수`);
    else mustExist(path.join(c.source, c.entry), `channels[${c.name}].entry`);
    if (c.icon) mustExist(c.icon, `channels[${c.name}].icon`);
  }

  const h = m.harness;
  const variants = h?.variants ?? [];
  const vNames = new Set<string>();
  for (const v of variants) {
    if (!SLUG.test(v.name ?? "")) issues.push(`harness.variants 이름 형식 위반: ${v.name}`);
    if (vNames.has(v.name)) issues.push(`harness.variants 이름 중복: ${v.name}`);
    vNames.add(v.name);
    if (!v.source || !v.entry) issues.push(`harness.variants[${v.name}]: source + entry 필수`);
    else mustExist(path.join(v.source, v.entry), `harness.variants[${v.name}].entry`);
    if (v.icon) mustExist(v.icon, `harness.variants[${v.name}].icon`);
    if (v.llm) {
      if (!SLUG.test(v.llm.provider ?? "")) issues.push(`harness.variants[${v.name}].llm.provider 형식 위반: ${v.llm.provider}`);
      if (v.llm.auth?.kind && !["none", "token", "oauth"].includes(v.llm.auth.kind)) issues.push(`harness.variants[${v.name}].llm.auth.kind 닫힌집합 위반: ${v.llm.auth.kind}`);
      if (v.llm.icon) mustExist(v.llm.icon, `harness.variants[${v.name}].llm.icon`);
    }
  }
  if ((m.agents ?? []).length > 0 && variants.length === 0) {
    issues.push("에이전트 패키지는 하네스를 동봉해야 합니다: harness.variants [{name, source, entry}]");
  }
  if (h?.workdir && badPath(h.workdir)) issues.push(`harness.workdir: workspace 하위 상대경로만: ${h.workdir}`);

  // hooks.deny 는 호스트 경로다 — ~ 또는 절대경로. 기판은 ~/.relay 를 선언과 무관하게 항상 병합한다
  if (m.hooks) {
    if (m.hooks.deny && m.hooks.deny.length === 0) issues.push("hooks.deny: 빈 목록 불가");
    for (const d of m.hooks.deny ?? []) {
      if (typeof d !== "string" || !/^(~($|\/)|\/)/.test(d) || d.split("/").includes("..")) {
        issues.push(`hooks.deny 는 ~ 또는 절대경로만(.. 금지): ${d}`);
      }
    }
  }

  const agents = m.agents ?? [];
  const agentNames = new Set<string>();
  const scriptNames = pkgPath && m.scripts?.source ? listScripts(pkgPath, m) : null;
  for (const a of agents) {
    if (!SLUG.test(a.name ?? "")) issues.push(`agent 이름 형식 위반: ${a.name}`);
    if (agentNames.has(a.name)) issues.push(`agent 이름 중복: ${a.name}`);
    agentNames.add(a.name);
    if (!a.persona) issues.push(`agents[${a.name}].persona: 필수`);
    else mustExist(a.persona, `agents[${a.name}].persona`);
    if (a.skills) mustExist(a.skills, `agents[${a.name}].skills`);
    if (a.commands) mustExist(a.commands, `agents[${a.name}].commands`);
    for (const d of a.dispatch ?? []) {
      if (!agentNames.has(d) && !agents.some((x) => x.name === d)) issues.push(`agents[${a.name}].dispatch 미선언 대상: ${d}`);
    }
    // scope 는 실재하는 동사만 가리켜야 한다. 없는 동사를 가리키면 설치 후 도구가 조용히 비어버린다
    for (const s of a.scripts ?? []) {
      if (!/^[a-z0-9][a-z0-9-]*\*?$/.test(s)) {
        issues.push(`agents[${a.name}].scripts 형식 위반: ${s}`);
        continue;
      }
      if (!m.scripts?.source) {
        issues.push(`agents[${a.name}].scripts 선언에 scripts.source 없음: ${s}`);
        continue;
      }
      if (!scriptNames) continue;
      const hit = s.endsWith("*") ? scriptNames.some((n) => n.startsWith(s.slice(0, -1))) : scriptNames.includes(s);
      if (!hit) issues.push(`agents[${a.name}].scripts 실체 없음: ${s}`);
    }
  }

  if (m.scripts) {
    if (!m.scripts.source || badPath(m.scripts.source)) issues.push("scripts.source: 상대경로 필수");
    else mustExist(m.scripts.source, "scripts.source");
  }

  const svcNames = new Set<string>();
  for (const s of m.services ?? []) {
    if (!SLUG.test(s.name ?? "")) issues.push(`service 이름 형식 위반: ${(s as { name?: string }).name}`);
    if (svcNames.has(s.name)) issues.push(`service 이름 중복: ${s.name}`);
    svcNames.add(s.name);
    const forms = ["source", "url", "dir"].filter((k) => (s as Record<string, unknown>)[k] != null);
    if (forms.length !== 1) {
      issues.push(`services[${s.name}]: source | url | dir 중 정확히 하나`);
      continue;
    }
    if ("source" in s && s.source != null) {
      if (!s.dockerfile && !s.entry) issues.push(`services[${s.name}]: dockerfile(컨테이너 형) 또는 entry(프로세스 형) 필수`);
      if (s.dockerfile) mustExist(path.join(s.source, s.dockerfile), `services[${s.name}].dockerfile`);
      if (s.entry) mustExist(path.join(s.source, s.entry), `services[${s.name}].entry`);
    }
    if ("dir" in s && s.dir != null && badPath(s.dir, true)) issues.push(`services[${s.name}].dir: 상대경로 또는 ~ 경로만`);
  }

  for (const t of m.triggers ?? []) {
    if (!SLUG.test(t.id ?? "")) issues.push(`trigger id 형식 위반: ${t.id}`);
    const whenForms = [t.when?.cron, t.when?.event].filter((x) => x != null).length;
    if (whenForms !== 1) issues.push(`triggers[${t.id}].when: cron | event 중 하나`);
    const thenForms = [t.then?.agent, t.then?.script].filter((x) => x != null).length;
    if (thenForms !== 1) issues.push(`triggers[${t.id}].then: agent | script 중 하나`);
    if (t.then?.agent && !agentNames.has(t.then.agent)) issues.push(`triggers[${t.id}].then.agent 미선언: ${t.then.agent}`);
    if (t.then?.agent && !t.then?.prompt) issues.push(`triggers[${t.id}].then.prompt: agent 형이면 필수`);
  }

  for (const e of m.edges ?? []) {
    if (!PROVIDER.test(e.provider ?? "")) issues.push(`edge provider 형식 위반: ${e.provider}`);
    if (e.tools != null && e.mission != null) issues.push(`edges[${e.provider}]: tools 와 mission 동시 선언 불가`);
  }

  if (issues.length) throw new ManifestError(issues);
}

export function activeHarness(m: Manifest, selected?: string): HarnessVariant | null {
  const vs = m.harness?.variants ?? [];
  return vs.find((v) => v.name === selected) ?? vs[0] ?? null;
}

export function landingAgentName(m: Manifest): string | null {
  const short = shortName(m.name);
  return (m.agents ?? []).some((a) => a.name === short) ? short : null;
}

export function agentScriptScope(m: Manifest, agent: string): ((s: string) => boolean) | null {
  const decl = (m.agents ?? []).find((a) => a.name === agent);
  const list = decl?.scripts ?? [];
  if (!list.length) return null;
  const exact = new Set(list.filter((s) => !s.endsWith("*")));
  const prefixes = list.filter((s) => s.endsWith("*")).map((s) => s.slice(0, -1));
  return (key) => exact.has(key) || prefixes.some((p) => key.startsWith(p));
}

export function listScripts(pkgPath: string, m: Manifest): string[] {
  if (!m.scripts) return [];
  const dir = path.join(pkgPath, m.scripts.source);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".ts")).map((f) => f.replace(/\.ts$/, ""));
}

// ── 마켓플레이스 지반: 선언 경로 목록과 권한 고지서 ──────────────────────────

export interface DeclaredPath {
  path: string;
  kind: "file" | "dir";
}

/**
 * 매니페스트가 선언한 패키지 내부 경로 전부. judge() 의 mustExist 순회와 형제다.
 * 차이 하나: judge 는 entry 파일 하나를 보지만 여기서는 source 디렉토리를 통째로 잡는다 —
 * 어댑터·서비스·화면이 헬퍼 파일을 나눠 쓰므로 봉투는 디렉토리 단위여야 실행이 깨지지 않는다.
 * 봉투(pack)와 발행 화면의 파일 목록이 이 함수 하나를 본다. 선언 밖 파일은 봉투에 없다.
 */
export function declaredPaths(m: Manifest): DeclaredPath[] {
  const out: DeclaredPath[] = [{ path: "relay.yaml", kind: "file" }];
  const file = (p?: string | null) => { if (p) out.push({ path: p, kind: "file" }); };
  const dir = (p?: string | null) => { if (p) out.push({ path: p, kind: "dir" }); };

  file(m.icon);
  dir(m.surfaces?.view?.source); // out(빌드 산출물)은 pack 이 뺀다
  for (const c of m.surfaces?.channels ?? []) { dir(c.source); file(c.icon); }
  for (const v of m.harness?.variants ?? []) { dir(v.source); file(v.icon); file(v.llm?.icon); }
  for (const a of m.agents ?? []) { file(a.persona); dir(a.skills); dir(a.commands); }
  dir(m.scripts?.source);
  for (const s of m.services ?? []) if ("source" in s && s.source != null) dir(s.source);
  // services[].dir 은 사용자 홈의 폴더 요청이지 패키지 경로가 아니다 — 봉투에 담을 것이 없다
  return out;
}

export interface Disclosure {
  /** services[].dir — 사용자 컴퓨터에서 만들고 읽고 쓰는 폴더 */
  folders: { name: string; path: string }[];
  /** services[].url — 밖으로 나가는 접점과 자격의 형태 */
  network: { name: string; url: string; auth: string }[];
  /** triggers — 사용자가 없어도 스스로 깨어나는 시점 */
  wakeups: { id: string; when: string }[];
  /** harness.variants[].llm — 사용자의 어느 계정으로 도는가 */
  llm: { provider: string; auth: string }[];
  /** requires — 호스트에 미리 있어야 하는 것 */
  host: string[];
  /** hooks.deny — 닿지 않겠다고 스스로 선언한 경로 */
  denied: string[];
  /** edges — 다른 패키지에서 빌리겠다고 신청한 능력 */
  borrows: string[];
  /** services[].source — 패키지가 띄우는 프로세스·컨테이너 */
  spawns: string[];
  /** channels — 외부 대화 문 */
  channels: string[];
  /** 요구 범위. 위험이 아니라 넓이 — 화면 미터가 이 값을 그린다 */
  risk: "low" | "medium" | "high";
}

/**
 * 권한 고지서 — 매니페스트 선언에서 기계로 뽑는 사실 목록. 설치 동의 화면과 마켓 상세가
 * 이걸 그린다. 홍보 문구가 아니라 선언이므로 판매자가 과장할 수 없고, 버전 간 diff 도
 * 이 구조의 비교로 나온다.
 */
export function disclosure(m: Manifest): Disclosure {
  const folders: Disclosure["folders"] = [];
  const network: Disclosure["network"] = [];
  const spawns: string[] = [];
  for (const s of m.services ?? []) {
    if ("dir" in s && s.dir != null) folders.push({ name: s.name, path: s.dir });
    else if ("url" in s && s.url != null) network.push({ name: s.name, url: s.url, auth: s.auth?.kind ?? "none" });
    else if ("source" in s && s.source != null) spawns.push(`${s.name} (${s.dockerfile ? "컨테이너" : "프로세스"})`);
  }
  const wakeups = (m.triggers ?? []).map((t) => ({
    id: t.id,
    when: t.when.cron ? `cron ${t.when.cron}${t.when.tz ? ` (${t.when.tz})` : ""}` : `event ${t.when.event}`,
  }));
  const llm = (m.harness?.variants ?? [])
    .filter((v) => v.llm)
    .map((v) => ({ provider: v.llm!.provider, auth: v.llm!.auth?.kind ?? "none" }));
  const host: string[] = [];
  if (m.requires?.os?.length) host.push(`OS: ${m.requires.os.join(", ")}`);
  for (const b of m.requires?.binaries ?? []) host.push(b.name);
  for (const a of m.requires?.apps ?? []) host.push(`${a.name}.app`);
  const borrows = (m.edges ?? []).map((e) =>
    `${e.provider}${e.mission ? ` (mission ${e.mission})` : e.tools?.length ? ` (tools ${e.tools.join(", ")})` : ""}`,
  );
  const channels = (m.surfaces?.channels ?? []).map((c) => c.name);

  // 요구 범위 판정. high = 사용자 시야 밖에서 움직일 수 있는 선언(자동 실행, 외부 접점,
  // 자기 프로세스, 타 패키지 차용). medium = 호스트나 대화 표면을 넓게 쓰는 선언. 나머지 low
  const risk: Disclosure["risk"] =
    wakeups.length || network.length || spawns.length || borrows.length
      ? "high"
      : host.length || channels.length || (m.hooks?.deny?.length ?? 0)
        ? "medium"
        : "low";

  return { folders, network, wakeups, llm, host, denied: m.hooks?.deny ?? [], borrows, spawns, channels, risk };
}
