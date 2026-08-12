import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { artifactCacheDir, logLine } from "./state.ts";
import type { MarketEntry } from "./pack.ts";
import { sellerOf } from "./pack.ts";

// 원격 스토어 클라이언트. 데몬이 아는 것은 이 계약뿐이다 — 인덱스 URL 하나와
// StoreIndexV1 의 모양. 정본이 정적 파일에서 DB API 로 바뀌어도 같은 모양을 돌려주는 한
// 이 파일 아래로는 아무것도 바뀌지 않는다 (C2C 호환 규율 1).
//
// 유료 엔트리는 공개 url 이 없고 price 를 가진다 (규율 3: 유료 봉투는 비공개).
// 다운로드 문은 인덱스가 가리키는 redeem 엔드포인트가 연다: 키를 제시하면 임시 URL 을 준다.
// 결제사(Payple)는 그 키를 자동 발급하는 트리거일 뿐, 이 클라이언트는 키의 출처를 모른다.

/** 원격 인덱스의 엔트리 — 로컬 선반의 file 대신 url 을 가진다. 유료는 url 없이 price */
export interface StoreEntry extends Omit<MarketEntry, "file"> {
  /** 아티팩트 URL. 절대 또는 인덱스 기준 상대. 유료 엔트리에는 없다 */
  url?: string;
  /** 원화 가격. 존재하면 유료 — 다운로드에 키가 필요하다 */
  price?: number;
}

export interface StoreIndex {
  entries: StoreEntry[];
  /** 키 확인 엔드포인트 (절대 또는 인덱스 기준 상대). 유료 엔트리가 있으면 정본이 반드시 준다 */
  redeem: string | null;
  /** 구매 페이지 (절대 또는 인덱스 기준 상대). 화면이 ?ref= 를 붙여 연다 */
  buy: string | null;
}

const FETCH_TIMEOUT = 4_000;
const INDEX_TTL = 5 * 60_000;
/** 다운로드 상한 — 봉투 실측이 KB 급이라 이 선을 넘으면 사고 신호다 */
const MAX_DOWNLOAD = 200 * 1024 * 1024;

// 인덱스 메모리 캐시. 데몬 프로세스 수명 동안만 — 정본은 어디까지나 원격이다
let cached: { url: string; at: number; index: StoreIndex } | null = null;

function assertSafeUrl(u: URL): void {
  // https 만. 개발용 루프백은 예외 — 정본 리허설을 로컬 서버로 돌릴 수 있어야 한다
  const loopback = u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "[::1]";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && loopback)) {
    throw new Error(`스토어 URL 은 https 여야 합니다 (루프백 제외): ${u}`);
  }
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT);
  try {
    return await fetch(url, { ...init, signal: ctl.signal, redirect: "follow" });
  } finally {
    clearTimeout(t);
  }
}

/**
 * 스토어 인덱스 조회. version 계약 위반은 조용히 넘기지 않는다 — 모르는 판의 인덱스를
 * 어림짐작으로 해석하면 봉인 검증 이전 단계가 전부 모래가 된다.
 */
export async function fetchStoreIndex(indexUrl: string, force = false): Promise<StoreIndex> {
  const u = new URL(indexUrl);
  assertSafeUrl(u);
  if (!force && cached && cached.url === indexUrl && Date.now() - cached.at < INDEX_TTL) {
    return cached.index;
  }
  const res = await fetchWithTimeout(indexUrl);
  if (!res.ok) throw new Error(`스토어 인덱스 응답 ${res.status}: ${indexUrl}`);
  const j = (await res.json()) as { version?: unknown; entries?: unknown; redeem?: unknown };
  if (j.version !== 1) {
    throw new Error(`지원하지 않는 스토어 인덱스 판: ${String(j.version)} — 기판을 업데이트하세요`);
  }
  const entries = (Array.isArray(j.entries) ? j.entries : [])
    .filter((e: any): e is StoreEntry => typeof e?.ref === "string" && typeof e?.digest === "string" && typeof e?.version === "string" && (typeof e?.url === "string" || typeof e?.price === "number"))
    .map((e: StoreEntry) => ({ ...e, seller: e.seller ?? sellerOf(e.ref) }));
  const index: StoreIndex = {
    entries,
    redeem: typeof j.redeem === "string" ? j.redeem : null,
    buy: typeof (j as { buy?: unknown }).buy === "string" ? String((j as { buy?: unknown }).buy) : null,
  };
  cached = { url: indexUrl, at: Date.now(), index };
  return index;
}

/** digest 키 캐시 조회 — 있고 봉인이 맞으면 그 경로, 아니면 null (손상은 걷어낸다) */
export function cacheHit(digest: string): string | null {
  const hex = digest.replace(/^sha256:/, "");
  if (!/^[0-9a-f]{64}$/.test(hex)) return null;
  const target = path.join(artifactCacheDir(), `${hex}.relay`);
  if (!fs.existsSync(target)) return null;
  const actual = crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex");
  if (actual === hex) return target;
  fs.rmSync(target, { force: true });
  return null;
}

/** 임의 URL 에서 받아 봉인 대조 후 캐시에 앉힌다. 검증 전 바이트는 신뢰하지 않는다 */
async function fetchVerified(u: URL, entry: StoreEntry): Promise<string> {
  assertSafeUrl(u);
  const hex = entry.digest.replace(/^sha256:/, "");
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error(`인덱스 digest 형식 위반: ${entry.digest}`);
  const res = await fetchWithTimeout(u.toString());
  if (!res.ok) throw new Error(`아티팩트 응답 ${res.status}: ${u}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_DOWNLOAD) throw new Error(`아티팩트 상한 초과 (${MAX_DOWNLOAD}): ${entry.ref}`);
  const actual = crypto.createHash("sha256").update(buf).digest("hex");
  if (actual !== hex) {
    throw new Error(`봉인 불일치: ${entry.ref}@${entry.version}\n  인덱스 ${entry.digest}\n  실제   sha256:${actual} — 스토어가 오염됐거나 전송이 변조됐습니다`);
  }
  const target = path.join(artifactCacheDir(), `${hex}.relay`);
  const tmp = target + ".part";
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, target);
  logLine("store", { ref: entry.ref, version: entry.version, digest: entry.digest, size: buf.length });
  return target;
}

/**
 * 무료 아티팩트 다운로드. 캐시 키가 digest 라 불변이다 — 있으면 재검증만 하고 재사용한다.
 */
export async function downloadArtifact(indexUrl: string, entry: StoreEntry): Promise<string> {
  const hit = cacheHit(entry.digest);
  if (hit) return hit;
  if (!entry.url) throw new Error(`공개 url 이 없는 엔트리: ${entry.ref} — 유료면 키가 필요합니다`);
  return fetchVerified(new URL(entry.url, indexUrl), entry); // 상대 URL 은 인덱스 기준으로 푼다
}

export class RedeemError extends Error {}

/**
 * 유료 아티팩트: 키 제시 -> 임시 URL -> 다운로드. redeem 은 다운로드의 문일 뿐이라
 * 받은 뒤의 봉인 대조·캐시·설치는 무료와 완전히 같은 길을 지난다.
 * 키가 틀리거나 폐기됐으면 RedeemError — 호출부가 "키를 다시" 처방으로 구분한다.
 */
export async function redeemArtifact(indexUrl: string, redeem: string | null, entry: StoreEntry, key: string): Promise<string> {
  const hit = cacheHit(entry.digest);
  if (hit) return hit; // 이미 받은 봉투는 내 것 — 재설치에 키를 다시 묻지 않는다
  if (!redeem) throw new Error(`정본에 redeem 엔드포인트가 없습니다 — 유료 설치 불가: ${entry.ref}`);
  const ru = new URL(redeem, indexUrl);
  assertSafeUrl(ru);
  const res = await fetchWithTimeout(ru.toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key: key.trim(), ref: entry.ref }),
  });
  const j = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !j.url) {
    throw new RedeemError(j.error ?? `redeem 거부 (${res.status}) — 키를 확인하세요`);
  }
  return fetchVerified(new URL(j.url, ru), entry);
}
