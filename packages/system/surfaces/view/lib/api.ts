import type { EdgeView, Grant, Registry } from "./types";

// 화면은 /pkg/<이름>/view/ 아래에 있지만 기판 API 는 루트에 있다. 같은 오리진이라 절대경로로 부른다
async function post(path: string, body: unknown): Promise<any> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  // 에러 응답의 본문(need_key 등)을 버리지 않는다 — 호출부가 처방을 고르는 근거다
  if (!res.ok) throw Object.assign(new Error(data?.error ?? `${res.status} ${path}`), { data, status: res.status });
  return data;
}

export async function fetchRegistry(): Promise<Registry> {
  const res = await fetch("/registry", { cache: "no-store" });
  if (!res.ok) throw new Error(`registry ${res.status}`);
  return res.json();
}

export function short(lineage?: string | null): string {
  return (lineage ?? "").split("/").pop() ?? "";
}

export function resolveProvider(reg: Registry, ref: string): string | null {
  const bare = (ref || "").replace(/@[^/@]+$/, "");
  const hit = reg.packages.find((p) => p.name === ref || p.manifest?.name === ref || p.manifest?.name === bare);
  return hit?.name ?? null;
}

export function edgesData(reg: Registry): EdgeView[] {
  const out: EdgeView[] = [];
  for (const p of reg.packages) {
    for (const e of p.manifest?.edges ?? []) {
      const provider = resolveProvider(reg, e.provider);
      const granted = reg.grants.some(
        (g) => g.consumer === p.name && g.provider === provider && (e.mission ? g.mission === e.mission : true),
      );
      out.push({ consumer: p.name, provider, ref: e.provider, tools: e.tools, mission: e.mission, granted });
    }
  }
  return out;
}

/** 결재는 선언 캡 안에서만 통과한다. 거절 사유를 그대로 올려보낸다 */
export function approveGrant(g: Grant): Promise<{ ok: boolean }> {
  return post("/grants", g);
}

export function sendChat(pkg: string, message: string, slot = "console"): Promise<{ reply?: string; error?: string }> {
  return post(`/pkg/${encodeURIComponent(pkg)}/chat`, { message, slot });
}

export function resetSession(pkg: string, slot = "console"): Promise<{ ok: boolean }> {
  return post(`/pkg/${encodeURIComponent(pkg)}/session/reset`, { slot });
}

export async function callScript<T = any>(name: string, input: unknown): Promise<T> {
  const data = await post(`/pkg/system/script/${name}`, { input });
  return (data.result ?? data) as T;
}

async function getJson<T = any>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `${res.status} ${path}`);
  return data as T;
}

// 하네스 설정 표면 — 채팅 위젯 설정 시트와 같은 기판 API 를 그래프에서도 쓴다
export interface HarnessVariantView {
  name: string;
  provider: string | null;
  icon: string | null;
  llm_icon: string | null;
  /** probe=1 일 때만 실린다 — 어댑터를 실제 실행한 결과 */
  ready?: boolean;
  /** 미준비의 축: no-tool = 도구 없음(설치가 처방), no-auth = 자격 없음(로그인·토큰이 처방) */
  reason?: "ok" | "no-tool" | "no-auth";
  note?: string;
  account?: { email?: string | null; plan?: string | null; method?: string | null } | null;
  protocol?: number;
  capabilities?: string[];
  login?: boolean;
  auth?: string | null;
}

export function getHarness(pkg: string, probe = false): Promise<{ active: string | null; variants: HarnessVariantView[] }> {
  return getJson(`/pkg/${encodeURIComponent(pkg)}/harness${probe ? "?probe=1" : ""}`);
}

export function setHarnessActive(pkg: string, name: string): Promise<{ active: string; setup: { ok: boolean; out: string } }> {
  return post(`/pkg/${encodeURIComponent(pkg)}/harness`, { name });
}

/** token 자격형만 웹에서 연결된다. 대화형 로그인은 터미널 처방(relay login)이 정답 */
export function connectHarness(pkg: string, token: string): Promise<{ ok: boolean; setup: { ok: boolean; out: string } }> {
  return post(`/pkg/${encodeURIComponent(pkg)}/harness/connect`, { token });
}

export function harnessModels(pkg: string): Promise<{ ok: boolean; value: string[] }> {
  return getJson(`/pkg/${encodeURIComponent(pkg)}/harness/models`);
}

export function setModel(pkg: string, model: string | null): Promise<{ ok: boolean; model: string | null; known: boolean | null }> {
  return post(`/pkg/${encodeURIComponent(pkg)}/model`, { model: model ?? "" });
}

/** 대화형 로그인 발화 — 기판이 터미널 창을 연다 (인증은 그 창이 소유) */
export function loginHarness(pkg: string, sw = false): Promise<{ launched: boolean; command: string; note: string }> {
  return post(`/pkg/${encodeURIComponent(pkg)}/harness/login`, { switch: sw });
}

// 마켓 화면은 OSS 콘솔에서 걷어냈다 (스토어 UI 는 데스크탑 앱의 몫).
// 설치 2단 관문의 데몬 API(/install/prepare · /install/activate)는 프로토콜로 살아 있다.
