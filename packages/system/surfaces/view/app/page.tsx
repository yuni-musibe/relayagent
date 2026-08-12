"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Detail from "@/components/Detail";
import Graph from "@/components/Graph";
import ChatNudge from "@/components/ChatNudge"; // 말풍선
import Onboarding, { ONBOARD_KEY } from "@/components/Onboarding"; // 온보딩
import { edgesData, fetchRegistry } from "@/lib/api";
import { draftList, type DraftEntry } from "@/lib/studio";
import type { Registry } from "@/lib/types";

const EMPTY: Registry = { packages: [], grants: [] };

export default function Console() {
  const [reg, setReg] = useState<Registry>(EMPTY);
  const [drafts, setDrafts] = useState<DraftEntry[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 온보딩 — "다시 보지 않기"를 체크하고 닫을 때만 다음 방문부터 숨긴다
  const [onboard, setOnboard] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(ONBOARD_KEY)) setOnboard(true);
  }, []);

  const closeOnboard = useCallback((never: boolean) => {
    if (never) localStorage.setItem(ONBOARD_KEY, "1");
    setOnboard(false);
  }, []);

  const load = useCallback(async () => {
    try {
      setReg(await fetchRegistry());
      setError(null);
    } catch (e) {
      setError(`기판에 닿지 않습니다: ${e instanceof Error ? e.message : e}`);
    }
    // draft 목록은 부가 정보다 — 실패해도 콘솔은 산다
    try {
      setDrafts((await draftList()).drafts);
    } catch {
      setDrafts([]);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15000);
    return () => clearInterval(t);
  }, [load]);

  const edges = useMemo(() => edgesData(reg), [reg]);
  const selected = reg.packages.find((p) => p.name === sel) ?? null;

  // 패널 닫기 — 열 폭이 0 으로 줄어드는 동안(closing) 마지막 내용을 그대로 그려 오른쪽으로 밀려 나가게 한다
  const [closing, setClosing] = useState(false);
  const lastSel = useRef<typeof selected>(null);
  if (selected) lastSel.current = selected;
  const closeDetail = useCallback(() => {
    setSel(null);
    setClosing(true);
    window.setTimeout(() => setClosing(false), 280);
  }, []);
  const handleSelect = (name: string | null) => {
    if (name) setSel(name);
    else if (sel) closeDetail();
  };
  const shown = selected ?? (closing ? lastSel.current : null);

  return (
    <div className={`shell${selected ? " has-detail" : ""}${!selected && closing ? " detail-closing" : ""}`}>
      <div className="col">
        <div className="rc-card head">
          <span className="rc-dot" /> Relay <small>{reg.packages.length}개</small>
          {/* 온보딩 */}
          <button className="ob-open" type="button" title="사용 안내 다시 보기" onClick={() => setOnboard(true)}>
            안내
          </button>
        </div>
        <div className="rc-card pkg-list">
          {error ? <div className="banner">{error}</div> : null}
          {reg.packages.length === 0 && !error ? (
            <div className="empty">설치된 패키지가 없습니다</div>
          ) : (
            reg.packages.map((p) => {
              const d = drafts.find((x) => x.name === p.name);
              return (
                <div
                  key={p.name}
                  className={`pkg-item${sel === p.name ? " sel" : ""}`}
                  onClick={() => setSel(p.name)}
                >
                  <b>{p.manifest?.display_name ?? p.name}</b>
                  {d?.changes ? <span className="rc-chip" style={{ marginLeft: 0 }}>draft {d.changes}</span> : null}
                  <span>
                    {p.name}
                    {p.ring === 0 ? " · ring-0" : ""}
                  </span>
                </div>
              );
            })
          )}
          {/* 발행 전 draft — 설치본이 없어 그래프에는 안 뜬다. 스튜디오로 이어 편집한다 */}
          {drafts.filter((d) => !d.installed).map((d) => (
            <Link key={d.name} className="pkg-item" style={{ textDecoration: "none", color: "inherit" }} href={`/studio/?pkg=${encodeURIComponent(d.name)}`}>
              <b>{d.name}</b>
              <span className="rc-chip gray">미발행 draft</span>
            </Link>
          ))}
        </div>
        <Link className="rc-btn accent" style={{ textAlign: "center", textDecoration: "none" }} href="/studio/?new=1">
          + 패키지 만들기
        </Link>
      </div>

      <div className="col">
        <Graph reg={reg} edges={edges} sel={sel} onSelect={handleSelect} onChanged={() => void load()} />
      </div>

      {shown ? (
        <div className="col detail-col">
          <Detail pkg={shown} edges={edges} onChanged={() => void load()} onClose={closeDetail} />
        </div>
      ) : null}

      <Onboarding open={onboard} onClose={closeOnboard} /> {/* 온보딩 */}
      {!onboard ? <ChatNudge /> : null} {/* 말풍선 — 온보딩이 닫힌 뒤에 등장 */}
    </div>
  );
}
