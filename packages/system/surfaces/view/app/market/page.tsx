"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { activateInstall, fetchMarket, prepareInstall, type MarketDisclosure, type MarketEntry, type PreparedInstall } from "@/lib/api";

// 보관함 — 내 컴퓨터 관리 화면. 스토어 진열은 웹(호스팅 스토어프론트)의 일이고,
// 여기는 두 가지만 한다:
//   (1) 내 선반 — relay pack 으로 구운 내 봉투들을 보여주고 설치한다
//   (2) 설치 착지점 — 스토어 웹의 [설치]가 ?ref=(&key=) 로 넘어오면 이어받는다
// 설치는 어느 경로든 2단 관문(prepare 고지서 -> 동의 -> activate)을 지난다.
// 원격 카탈로그를 그리지 않는 이유: 등재 안 된 내 봉투가 "스토어에 보이는" 혼란을 없애고,
// 진열의 정본을 스토어 웹 하나로 만들기 위해서다 (2026-08-12 스토어프론트 분리 결정).

const CSS = `
.mk-shell { min-height: 100vh; background: var(--rc-bg); display: flex; flex-direction: column; }
.mk-top { display: flex; align-items: center; gap: 14px; padding: 14px 30px; }
.mk-top .brand { display: flex; align-items: center; gap: 7px; font-weight: 700; font-size: 13.5px; }
.mk-top .count { font-size: 11.5px; color: var(--rc-faint); }
.mk-main { width: 100%; max-width: 1180px; margin: 0 auto; padding: 0 30px 64px; }

.mk-hero { display: flex; align-items: center; gap: 30px; padding: 30px 0 0; }
.mk-hero-tx { flex: 1 1 auto; min-width: 0; }
.mk-hero h1 { margin: 0; font-size: clamp(30px, 4.4vw, 46px); line-height: 1.14; font-weight: 800; letter-spacing: -0.035em; }
.mk-hero .sub { margin: 12px 0 0; font-size: 15px; color: var(--rc-soft); }
.mk-hero-art { flex: 0 0 auto; color: var(--rc-ink); opacity: 0.9; }
.mk-searchbig { display: flex; align-items: center; gap: 10px; max-width: 540px; margin: 24px 0 0; border: 1px solid var(--rc-line); border-radius: 12px; padding: 11px 16px; background: var(--rc-bg); box-shadow: 0 1px 2px rgba(16, 24, 32, 0.04); transition: border-color 0.15s, box-shadow 0.15s; }
.mk-searchbig:focus-within { border-color: var(--rc-accent); box-shadow: 0 0 0 3px var(--rc-accent-soft); }
.mk-searchbig input { border: 0; outline: none; padding: 0; flex: 1; font: 14.5px var(--rc-sans); background: none; }
.mk-searchbig .glass { color: var(--rc-faint); font-family: var(--rc-mono); font-size: 15px; }

.mk-chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 20px 0 30px; }
.mk-chip { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--rc-line); border-radius: 999px; background: var(--rc-bg); padding: 6px 14px; font: 600 12.5px var(--rc-sans); color: var(--rc-soft); cursor: pointer; transition: border-color 0.14s, background 0.14s, color 0.14s; }
.mk-chip:hover { border-color: var(--rc-faint); color: var(--rc-ink); }
.mk-chip.on { border-color: var(--rc-accent); background: var(--rc-accent-soft); color: var(--rc-accent-strong); }
.mk-chip em { font-style: normal; font-size: 11px; color: var(--rc-faint); }
.mk-chip.on em { color: var(--rc-accent-strong); opacity: 0.75; }

.mk-sect { display: flex; align-items: baseline; gap: 10px; margin: 0 0 16px; }
.mk-sect h2 { margin: 0; font-size: 21px; font-weight: 800; letter-spacing: -0.02em; }
.mk-sect span { font-size: 12px; color: var(--rc-faint); }

.mk-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(248px, 1fr)); gap: 18px; }
.mk-card { border: 1px solid var(--rc-line); border-radius: 14px; background: var(--rc-bg); overflow: hidden; display: flex; flex-direction: column; text-align: left; cursor: pointer; color: inherit; padding: 0; font: inherit; animation: rc-rise 0.28s ease backwards; transition: box-shadow 0.18s ease, transform 0.18s ease, border-color 0.18s ease; }
.mk-card:hover { border-color: transparent; box-shadow: 0 12px 32px rgba(16, 24, 32, 0.12); transform: translateY(-2px); }
.mk-thumb { aspect-ratio: 16 / 9.4; display: grid; place-items: center; border-bottom: 1px solid var(--rc-line-soft); }
.mk-tile { width: 58px; height: 58px; border-radius: 14px; background: #fff; box-shadow: 0 5px 16px rgba(16, 24, 32, 0.12); display: grid; place-items: center; }
.mk-tile img { width: 38px; height: 38px; }
.mk-tile .mk-glyph { width: 38px; height: 38px; border-radius: 9px; display: grid; place-items: center; font: 700 16px var(--rc-mono); }
.mk-card-body { padding: 13px 15px 14px; display: flex; flex-direction: column; gap: 3px; flex: 1; }
.mk-title { font-weight: 700; font-size: 14px; line-height: 1.4; }
.mk-by { font-size: 12px; color: var(--rc-faint); }
.mk-foot { display: flex; align-items: center; margin-top: auto; padding-top: 10px; }
.mk-price { font-weight: 700; font-size: 12.5px; }
.mk-price.free { color: var(--rc-soft); font-weight: 600; }
.mk-foot .rc-btn { margin-left: auto; padding: 4px 11px; font-size: 11.5px; }
.mk-empty { color: var(--rc-faint); font-size: 13px; padding: 48px 0; text-align: center; }
.mk-empty code { font-family: var(--rc-mono); font-size: 12px; background: var(--rc-line-soft); border-radius: 6px; padding: 2px 7px; }
.mk-note { margin-bottom: 14px; font-size: 12px; color: var(--rc-soft); background: var(--rc-line-soft); border-radius: 8px; padding: 8px 12px; }

.mk-back { margin: 26px 0 18px; }
.mk-dgrid { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 34px; align-items: start; }
.mk-dhero { aspect-ratio: 16 / 9; border-radius: 16px; display: grid; place-items: center; }
.mk-dhero .mk-tile { width: 92px; height: 92px; border-radius: 22px; }
.mk-dhero .mk-tile img { width: 60px; height: 60px; }
.mk-dhero .mk-tile .mk-glyph { width: 60px; height: 60px; border-radius: 14px; font-size: 26px; }
.mk-about { margin-top: 28px; }
.mk-about h3 { margin: 0 0 10px; font-size: 17px; font-weight: 800; letter-spacing: -0.01em; }
.mk-about p { margin: 0; font-size: 14px; line-height: 1.75; color: var(--rc-soft); max-width: 620px; }
.mk-side { position: sticky; top: 20px; border: 1px solid var(--rc-line); border-radius: 14px; padding: 20px 22px; display: flex; flex-direction: column; background: var(--rc-bg); }
.mk-side h2 { margin: 0; font-size: 19px; font-weight: 800; letter-spacing: -0.02em; line-height: 1.3; }
.mk-creator { display: flex; align-items: center; gap: 8px; margin-top: 10px; font-size: 12.5px; }
.mk-creator .mk-glyph { width: 22px; height: 22px; border-radius: 50%; font-size: 10px; display: grid; place-items: center; background: var(--rc-accent-soft); color: var(--rc-accent-strong); font-weight: 700; }
.mk-creator span { color: var(--rc-faint); }
.mk-dprice { margin: 18px 0 10px; font-size: 24px; font-weight: 800; letter-spacing: -0.02em; }
.mk-dprice.free { color: var(--rc-accent-strong); }
.mk-side .rc-btn.accent { width: 100%; padding: 10px 0; font-size: 13.5px; border-radius: 9px; text-align: center; }
.mk-cta-note { margin-top: 9px; font-size: 11.5px; color: var(--rc-faint); text-align: center; }
.mk-sidesep { height: 1px; background: var(--rc-line-soft); margin: 18px 0 14px; }
.mk-facts { display: flex; flex-direction: column; gap: 7px; font-size: 12.5px; color: var(--rc-soft); }
.mk-facts div { display: flex; }
.mk-facts b { margin-left: auto; color: var(--rc-ink); font-weight: 600; }
.mk-digest { margin-top: 12px; font-family: var(--rc-mono); font-size: 10.5px; color: var(--rc-faint); overflow-wrap: anywhere; line-height: 1.6; }

.mk-veil { position: fixed; inset: 0; background: rgba(22, 24, 27, 0.42); display: grid; place-items: center; padding: 20px; z-index: 60; }
.mk-modal { width: min(430px, 100%); background: var(--rc-bg); border: 1px solid var(--rc-line); border-radius: 14px; box-shadow: 0 18px 44px rgba(16, 24, 32, 0.14); padding: 22px 24px; display: flex; flex-direction: column; gap: 14px; max-height: 88vh; overflow-y: auto; }
.mk-modal h3 { margin: 0; font-size: 16px; font-weight: 700; }
.mk-verify { display: flex; flex-direction: column; gap: 5px; }
.mk-verify div { display: flex; gap: 8px; font-size: 12px; color: var(--rc-soft); align-items: baseline; }
.mk-verify i { font-style: normal; color: var(--rc-ok); font-family: var(--rc-mono); font-weight: 700; }
.mk-grants { display: flex; flex-direction: column; gap: 11px; border-top: 1px solid var(--rc-line); padding-top: 14px; }
.mk-grant { display: flex; gap: 12px; }
.mk-grant-key { width: 36px; height: 30px; flex: none; border-radius: 8px; display: grid; place-items: center; background: var(--rc-line-soft); color: var(--rc-soft); font: 600 10.5px var(--rc-sans); }
.mk-grant-body strong { display: block; font-size: 13px; overflow-wrap: anywhere; }
.mk-grant-body span { font-size: 12px; color: var(--rc-soft); }
.mk-nots { font-size: 12.5px; color: var(--rc-soft); background: var(--rc-ground); border-radius: 8px; padding: 10px 12px; }
.mk-modal-foot { display: flex; gap: 8px; justify-content: flex-end; }
.mk-toast { position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%); background: var(--rc-ink); color: var(--rc-bg); border-radius: 999px; padding: 9px 18px; font: 600 12.5px var(--rc-sans); z-index: 70; max-width: calc(100vw - 40px); text-align: center; }

@media (max-width: 900px) { .mk-dgrid { grid-template-columns: minmax(0, 1fr) } .mk-side { position: static; } }
@media (max-width: 720px) { .mk-hero-art { display: none; } .mk-top, .mk-main { padding-left: 18px; padding-right: 18px; } }
`;

// 파스텔 썸네일 — 스크린샷이 붙기 전까지 카드의 얼굴. ref 해시로 고정되어
// 같은 패키지는 언제나 같은 색을 입는다 (노션 갤러리의 틴트 문법)
const TINTS: Array<{ bg: string; fg: string }> = [
  { bg: "#fdf3ec", fg: "#b4540a" }, // 피치
  { bg: "#eef3fd", fg: "#3a5bc7" }, // 페리윙클
  { bg: "#edf7f0", fg: "#1f7a3f" }, // 민트
  { bg: "#f9f1fb", fg: "#8a3fa8" }, // 라일락
  { bg: "#fdf7e6", fg: "#946f00" }, // 크림
  { bg: "#ecf6f9", fg: "#0b6e8a" }, // 하늘
];

function tintOf(ref: string): { bg: string; fg: string } {
  let h = 0;
  for (let i = 0; i < ref.length; i++) h = (h * 31 + ref.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length];
}

function Glyph({ e }: { e: MarketEntry }) {
  if (e.icon) {
    // 로컬 선반은 사본 파일명, 원격 스토어는 URL(절대 또는 인덱스 기준 상대)
    const src = /^https?:\/\//.test(e.icon)
      ? e.icon
      : e.source !== "local"
        ? new URL(e.icon, e.source).toString()
        : `/market/asset/${encodeURIComponent(e.icon)}`;
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" />;
  }
  const t = tintOf(e.ref);
  return <div className="mk-glyph" style={{ background: t.bg, color: t.fg }}>{(e.display_name || e.ref).slice(0, 1)}</div>;
}

/** 히어로 일러스트 — 열리는 상자들. 마켓의 은유(패키지를 꺼내 앉힌다)를 선화로 */
function HeroArt() {
  return (
    <svg className="mk-hero-art" width="190" height="120" viewBox="0 0 190 120" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
      <ellipse cx="42" cy="106" rx="30" ry="5" fill="currentColor" opacity="0.08" stroke="none" />
      <ellipse cx="138" cy="108" rx="40" ry="6" fill="currentColor" opacity="0.08" stroke="none" />
      <path d="M20 72 L42 62 L64 72 L64 96 L42 106 L20 96 Z" />
      <path d="M20 72 L42 82 L64 72 M42 82 L42 106" />
      <path d="M108 60 L138 46 L168 60 L168 92 L138 106 L108 92 Z" />
      <path d="M108 60 L138 74 L168 60 M138 74 L138 106" />
      <path d="M108 60 L96 42 L126 30 L138 46" />
      <path d="M168 60 L180 42 L150 30 L138 46" />
      <path d="M133 14 L135 22 M148 10 L146 19 M120 12 L124 20" strokeWidth="2" />
    </svg>
  );
}

/** 안 하는 것 문장 — 원본 고지서 기준으로만 계산한다 (빈 항목과 안 보여준 항목은 다르다) */
function ConsentNots({ d }: { d: MarketDisclosure }) {
  const nots: string[] = [];
  if (!d.network.length) nots.push("인터넷으로 나가지 않고");
  if (!d.wakeups.length) nots.push("스스로 깨어나지 않고");
  if (!d.borrows.length) nots.push("다른 패키지의 능력을 빌리지 않습니다");
  if (!nots.length) return null;
  return <div className="mk-nots">이 패키지는 {nots.join(", ")}.</div>;
}

export default function Market() {
  const [entries, setEntries] = useState<MarketEntry[]>([]);
  const [remote, setRemote] = useState<string | null>(null);
  const [buyPath, setBuyPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<MarketEntry | null>(null);
  const [consent, setConsent] = useState<PreparedInstall | null>(null);
  // 유료 관문: prepare 가 402(need_key)로 거절하면 키 입력을 처방한다
  const [keyAsk, setKeyAsk] = useState<{ entry: MarketEntry; error: string | null } | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const idx = await fetchMarket();
      setEntries(idx.entries);
      setRemote(idx.remote);
      setBuyPath(idx.buy);
      setError(null);
      return idx.entries;
    } catch (e) {
      setError(`기판에 닿지 않습니다: ${e instanceof Error ? e.message : e}`);
      return [];
    }
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  // 보관함이 그리는 것은 내 선반뿐 — 원격 엔트리는 ?ref= 착지(설치 이어받기)에만 쓴다
  const shelf = useMemo(() => entries.filter((e) => e.source === "local"), [entries]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return shelf.filter((e) => !needle || `${e.display_name} ${e.ref} ${e.description}`.toLowerCase().includes(needle));
  }, [shelf, q]);

  // 스토어 구경은 웹으로 — 진열의 정본은 스토어프론트 하나다
  const storeUrl = useMemo(() => {
    if (!remote) return null;
    try { return new URL(remote).origin; } catch { return null; }
  }, [remote]);

  // 설치 2단 관문. prepare 가 고지서를 만들고(코드 실행 없음), 동의 버튼이 activate 를 부른다.
  // 원격 엔트리면 다운로드와 봉인 대조가 prepare 안에서 일어난다.
  // 유료는 관문이 하나 더 있다: 키가 없거나 틀리면 402 — 키 입력 모달로 처방한다
  const startInstall = useCallback(async (e: MarketEntry, key?: string) => {
    setBusy(true);
    try {
      const prep = await prepareInstall(e.ref, key);
      setKeyAsk(null);
      setKeyInput("");
      setConsent(prep);
    } catch (err) {
      const data = (err as { data?: { need_key?: boolean } }).data;
      if (data?.need_key) {
        setKeyAsk({ entry: e, error: key ? (err instanceof Error ? err.message : String(err)) : null });
      } else {
        setToast(`준비 실패: ${err instanceof Error ? err.message : err}`);
      }
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    // 웹 카탈로그의 "콘솔에서 열기" 착지점: /market/?ref=@scope/name 이면 그 상세로 직행.
    // key 까지 실려 오면(키 자동 인계) 곧장 설치 준비로 — 동의 관문은 그대로 거친다.
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    const key = params.get("key");
    if (key) {
      // 키가 주소창·히스토리에 남지 않게 즉시 지운다 — 인계는 1회로 끝
      params.delete("key");
      const qs = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
    }
    void load().then((list) => {
      if (!ref) return;
      const entry = list.find((e) => e.ref === ref) ?? null;
      setSel(entry);
      if (!entry) {
        setToast(`스토어에서 ${ref} 정보를 가져오지 못했습니다 — 네트워크를 확인하고 스토어에서 다시 시도하세요`);
        return;
      }
      if (key) {
        setKeyInput(key);
        void startInstall(entry, key);
      }
    });
    // 첫 진입 1회만 — load/startInstall 은 안정된 콜백이다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirmInstall = useCallback(async () => {
    if (!consent) return;
    setBusy(true);
    try {
      const r = await activateInstall(consent.id);
      setConsent(null);
      setSel(null);
      setToast(`${r.fresh ? "설치했습니다" : "업데이트했습니다"}: ${r.name} — 내 Relay 에 카드가 생겼습니다`);
      void load();
    } catch (err) {
      setToast(`설치 실패: ${err instanceof Error ? err.message : err}`);
    } finally {
      setBusy(false);
    }
  }, [consent, load]);

  return (
    <div className="mk-shell">
      <style>{CSS}</style>

      <div className="mk-top">
        <Link className="rc-btn" style={{ textDecoration: "none", color: "var(--rc-soft)" }} href="/">← 내 Relay</Link>
        <span className="brand">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
            <path d="M3 5.5 L8 3 L13 5.5 L13 11 L8 13.5 L3 11 Z" />
            <path d="M3 5.5 L8 8 L13 5.5 M8 8 L8 13.5" />
          </svg>
          보관함
        </span>
        <span className="count">내 선반 {shelf.length}종</span>
        {storeUrl ? (
          <a className="rc-btn accent" style={{ marginLeft: "auto", textDecoration: "none" }} href={storeUrl} target="_blank" rel="noreferrer">
            스토어 구경하기 ↗
          </a>
        ) : null}
      </div>

      <main className="mk-main">
        {error ? <div className="mk-empty">{error}</div> : null}

        {!sel ? (
          <>
            <div className="mk-hero">
              <div className="mk-hero-tx">
                <h1>보관함</h1>
                <p className="sub">
                  relay pack 으로 구운 내 봉투들 — 스토어에 올리기 전의 내 것들입니다.
                  에이전트를 찾아 설치하는 곳은 {storeUrl ? <a href={storeUrl} target="_blank" rel="noreferrer" style={{ color: "var(--rc-accent-strong)", fontWeight: 600 }}>스토어</a> : "스토어"}입니다.
                </p>
                {shelf.length > 3 ? (
                  <div className="mk-searchbig">
                    <span className="glass">⌕</span>
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`선반의 ${shelf.length}개 봉투 검색`} aria-label="검색" />
                  </div>
                ) : null}
              </div>
              <HeroArt />
            </div>

            <div className="mk-sect" style={{ marginTop: 30 }}>
              <h2>내 선반</h2>
              <span>{filtered.length}종 · 이 화면은 내 컴퓨터에만 보입니다</span>
            </div>

            {!error && filtered.length === 0 ? (
              <div className="mk-empty">
                {shelf.length === 0 ? (
                  <>선반이 비어 있습니다. 터미널에서 <code>relay pack &lt;설치이름&gt;</code> 으로 패키지를 구우면 여기 올라옵니다.</>
                ) : (
                  <>검색 결과가 없습니다</>
                )}
              </div>
            ) : (
              <div className="mk-grid">
                {filtered.map((e, i) => {
                  const t = tintOf(e.ref);
                  return (
                    <div key={e.ref} className="mk-card" role="button" tabIndex={0}
                      style={{ animationDelay: `${Math.min(i, 11) * 35}ms` }}
                      onClick={() => setSel(e)}
                      onKeyDown={(ev) => { if (ev.key === "Enter") setSel(e); }}>
                      <div className="mk-thumb" style={{ background: t.bg }}>
                        <div className="mk-tile"><Glyph e={e} /></div>
                      </div>
                      <div className="mk-card-body">
                        <div className="mk-title">{e.display_name}</div>
                        <div className="mk-by">{e.ref}@{e.version}</div>
                        <div className="mk-foot">
                          <span className="mk-price free">{e.installed ? "설치됨" : "구운 봉투"}</span>
                          {e.installed ? (
                            <a className="rc-btn" style={{ marginLeft: "auto", textDecoration: "none" }}
                              href={`/pkg/${encodeURIComponent(e.installed)}/view/`}
                              onClick={(ev) => ev.stopPropagation()}>열기</a>
                          ) : (
                            <button className="rc-btn accent" type="button" disabled={busy}
                              onClick={(ev) => { ev.stopPropagation(); void startInstall(e); }}>설치</button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <>
            <button className="rc-btn mk-back" type="button" onClick={() => setSel(null)}>← 보관함</button>
            <div className="mk-dgrid">
              <div>
                <div className="mk-dhero" style={{ background: tintOf(sel.ref).bg }}>
                  <div className="mk-tile"><Glyph e={sel} /></div>
                </div>
                <div className="mk-about">
                  <h3>이 에이전트에 대해</h3>
                  <p>{sel.description}</p>
                </div>
              </div>

              <aside className="mk-side">
                <h2>{sel.display_name}</h2>
                <div className="mk-creator">
                  <div className="mk-glyph">{sel.seller.slice(1, 2).toUpperCase()}</div>
                  <b>{sel.seller}</b>
                  <span>· {sel.source === "local" ? "내 선반" : "스토어"}</span>
                </div>
                <div className={`mk-dprice${sel.price == null ? " free" : ""}`}>
                  {sel.price != null ? `₩${sel.price.toLocaleString()}` : "무료"}
                </div>
                {sel.installed ? (
                  <a className="rc-btn accent" style={{ textDecoration: "none" }} href={`/pkg/${encodeURIComponent(sel.installed)}/view/`}>열기</a>
                ) : (
                  <button className="rc-btn accent" type="button" disabled={busy} onClick={() => void startInstall(sel)}>
                    {busy ? "준비 중..." : sel.price != null ? "라이선스 키로 설치" : "설치"}
                  </button>
                )}
                {!sel.installed ? (
                  <div className="mk-cta-note">
                    {sel.price != null ? "구매 후 받은 키로 설치합니다 · 14일 환불" : "설치 전에 요구 사항에 동의하게 됩니다"}
                  </div>
                ) : (
                  <div className="mk-cta-note">이미 설치되어 있습니다</div>
                )}
                <div className="mk-sidesep" />
                <div className="mk-facts">
                  <div>버전 <b>{sel.version}</b></div>
                  <div>구성 파일 <b>{sel.files}개</b></div>
                  <div>크기 <b>{(sel.size / 1024).toFixed(0)}KB</b></div>
                  <div>ref <b style={{ fontFamily: "var(--rc-mono)", fontWeight: 500 }}>{sel.ref}</b></div>
                </div>
                <div className="mk-digest">{sel.digest}</div>
              </aside>
            </div>
          </>
        )}
      </main>

      {keyAsk ? (
        <div className="mk-veil" onClick={() => !busy && setKeyAsk(null)}>
          <div className="mk-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div>
              <h3>{keyAsk.entry.display_name} 라이선스 키</h3>
              <div style={{ fontFamily: "var(--rc-mono)", fontSize: 11, color: "var(--rc-faint)", marginTop: 2 }}>
                {keyAsk.entry.ref} · ₩{(keyAsk.entry.price ?? 0).toLocaleString()}
              </div>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--rc-soft)" }}>
              구매 후 받은 키를 넣으세요. 키는 이 컴퓨터의 금고(vault)에 보관되어 다시 묻지 않습니다.
              {buyPath && keyAsk.entry.source !== "local" ? (() => {
                const u = new URL(buyPath, keyAsk.entry.source);
                u.searchParams.set("ref", keyAsk.entry.ref);
                return (
                  <>
                    {" "}아직 키가 없다면{" "}
                    <a href={u.toString()} target="_blank" rel="noreferrer" style={{ color: "var(--rc-accent-strong)", fontWeight: 600 }}>
                      구매 페이지에서 결제
                    </a>
                    하세요.
                  </>
                );
              })() : null}
            </div>
            <input
              autoFocus
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && keyInput.trim()) void startInstall(keyAsk.entry, keyInput); }}
              placeholder="RELAY-XXXX-XXXX-XXXX-XXXX"
              aria-label="라이선스 키"
              style={{ fontFamily: "var(--rc-mono)", fontSize: 13, letterSpacing: "0.02em", textTransform: "uppercase" }}
            />
            {keyAsk.error ? (
              <div style={{ fontSize: 12, color: "var(--rc-err)", background: "var(--rc-err-bg)", borderRadius: 8, padding: "8px 11px" }}>{keyAsk.error}</div>
            ) : null}
            <div className="mk-modal-foot">
              <button className="rc-btn" type="button" disabled={busy} onClick={() => setKeyAsk(null)}>취소</button>
              <button className="rc-btn accent" type="button" disabled={busy || !keyInput.trim()} onClick={() => void startInstall(keyAsk.entry, keyInput)}>
                {busy ? "확인 중..." : "키 확인"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {consent ? (
        <div className="mk-veil" onClick={() => !busy && setConsent(null)}>
          <div className="mk-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div>
              <h3>{consent.display_name} 를 {consent.fresh ? "설치합니다" : "업데이트합니다"}</h3>
              <div style={{ fontFamily: "var(--rc-mono)", fontSize: 11, color: "var(--rc-faint)", marginTop: 2 }}>
                {consent.ref} {consent.version} · {(consent.size / 1024).toFixed(0)}KB
              </div>
            </div>
            <div className="mk-verify">
              <div><i>✓</i> <span>봉인 확인됨 <code style={{ fontFamily: "var(--rc-mono)" }}>{consent.digest.slice(0, 22)}...</code></span></div>
              <div><i>✓</i> <span>호스트 요구 충족 (미충족이면 여기 오기 전에 막힙니다)</span></div>
            </div>
            <div className="mk-grants">
              {consent.disclosure.folders.map((f) => (
                <div key={f.name} className="mk-grant">
                  <div className="mk-grant-key">폴더</div>
                  <div className="mk-grant-body">
                    <strong style={{ fontFamily: "var(--rc-mono)" }}>{f.path}</strong>
                    <span>이 폴더를 만들고 읽고 씁니다</span>
                  </div>
                </div>
              ))}
              {consent.disclosure.llm.map((l) => (
                <div key={l.provider} className="mk-grant">
                  <div className="mk-grant-key">계정</div>
                  <div className="mk-grant-body">
                    <strong>{l.provider}</strong>
                    <span>당신의 계정으로 에이전트를 돌립니다 ({l.auth})</span>
                  </div>
                </div>
              ))}
              {consent.disclosure.network.map((n) => (
                <div key={n.name} className="mk-grant">
                  <div className="mk-grant-key">외부</div>
                  <div className="mk-grant-body">
                    <strong style={{ fontFamily: "var(--rc-mono)" }}>{n.url}</strong>
                    <span>밖으로 나갑니다 (자격: {n.auth})</span>
                  </div>
                </div>
              ))}
              {consent.disclosure.wakeups.map((w) => (
                <div key={w.id} className="mk-grant">
                  <div className="mk-grant-key">자동</div>
                  <div className="mk-grant-body">
                    <strong>{w.when}</strong>
                    <span>당신이 없어도 스스로 깨어나 실행됩니다</span>
                  </div>
                </div>
              ))}
              {consent.disclosure.spawns.length ? (
                <div className="mk-grant">
                  <div className="mk-grant-key">실행</div>
                  <div className="mk-grant-body">
                    <strong>{consent.disclosure.spawns.join(", ")}</strong>
                    <span>패키지가 자기 프로세스를 띄웁니다</span>
                  </div>
                </div>
              ) : null}
              <ConsentNots d={consent.disclosure} />
            </div>
            <div className="mk-modal-foot">
              <button className="rc-btn" type="button" disabled={busy} onClick={() => setConsent(null)}>취소</button>
              <button className="rc-btn accent" type="button" disabled={busy} onClick={() => void confirmInstall()}>
                {busy ? "설치 중..." : consent.fresh ? "설치" : "업데이트"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? <div className="mk-toast">{toast}</div> : null}
    </div>
  );
}
