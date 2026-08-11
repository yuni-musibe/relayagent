/* chat widget - core 위의 UI. 기판이 /assets/chat-widget.js 로 서빙하는 기판 소유 자산이다.
   자동: 패키지 view 문서에서 <script type="module" src="/assets/chat-widget.js"> 한 줄이면
        URL 의 패키지로 우측하단 부유 위젯. window.RELAY_CHAT_MANUAL = true 면 자동 마운트 안 함.
   명시: import { mount } from "/assets/chat-widget.js";
        mount({ pkg, mode: "float"|"inline", target, slot, agent }) → { client, root, remove }
   룩은 relay-chat 의 것을 따른다: 토큰(--rc-*) 소비, 유저 = 회색 버블, 어시스턴트 = 잉크 산문

   구조: 셸(헤더·탭 스트립·대화 드로어·컨텍스트 메뉴) + 팬(pane, 세션 하나의 로그·컴포저·설정).
   탭 1개 = 세션 1개 = pane 1개(자체 core 클라이언트). 탭이 열려 있는 동안 pane 은 살아 있어
   백그라운드 탭의 턴도 계속 돌고, 끝나면 탭에 읽지 않음 표시가 남는다.
   분할뷰: 탭 우클릭 → "오른쪽에 분할로 열기". 오른쪽 pane 은 캡 바(라벨 + 분할 해제)를 단다 */
import { createChat } from "./core.js";

const CSS = `
.rw-dock, .rw-inline, .rw-dock *, .rw-inline * { box-sizing: border-box; }
.rw-dock { position: fixed; right: 20px; bottom: 20px; z-index: 9999; }
.rw-dock, .rw-inline { font: 14px/1.6 var(--rc-sans, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Pretendard", sans-serif); color: var(--rc-ink, #16181b); }
.rw-fab {
  width: 52px; height: 52px; border-radius: 50%; border: none; cursor: pointer;
  background: var(--rc-accent, #0f766e); color: #fff; font-size: 22px;
  box-shadow: 0 6px 20px rgba(0,0,0,0.18);
}
.rw-fab:hover { background: var(--rc-accent-strong, #115e59); }
/* float = 우측 전체 높이 사이드바. 열려 있는 동안 fab 은 숨는다. 분할이 켜지면 넓어진다 */
.rw-panel {
  position: fixed; top: 0; right: 0; bottom: 0; width: 440px; max-width: 96vw;
  background: var(--rc-bg, #fff); border-left: 1px solid var(--rc-line, #e6e9ec);
  box-shadow: -10px 0 36px rgba(0,0,0,0.10); display: none; flex-direction: column; overflow: hidden;
  transition: width 200ms ease;
}
.rw-panel.open { display: flex; }
.rw-dock.rw-open .rw-fab { display: none; }
.rw-inline { width: 100%; height: 100%; }
.rw-inline .rw-panel { position: relative; width: 100%; height: 100%; border-radius: 10px; box-shadow: none; display: flex; transition: none; }

.rw-head {
  display: flex; align-items: center; gap: 8px; padding: 11px 16px; flex: 0 0 auto;
  border-bottom: 1px solid var(--rc-line, #e6e9ec);
  font-size: 13px; font-weight: 600; color: var(--rc-soft, #5c6570);
}
.rw-d { width: 7px; height: 7px; border-radius: 50%; background: var(--rc-ok, #059669); flex: 0 0 auto; }
.rw-d.run { background: var(--rc-accent, #0f766e); animation: rw-pulse 1.5s ease-in-out infinite; }
.rw-t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rw-sp { flex: 1 1 auto; }
.rw-head button {
  border: none; background: transparent; color: var(--rc-faint, #98a1aa); cursor: pointer;
  padding: 4px 8px; border-radius: 6px; font: 600 11.5px inherit; font-family: inherit; flex: 0 0 auto;
}
.rw-head button:hover { background: var(--rc-hover, #eef0f2); color: var(--rc-soft, #5c6570); }

/* ── 탭 스트립 — 탭 1개 = 세션 1개. 넘치면 가로 스크롤, + 는 항상 오른쪽에 고정 ── */
.rw-tabs { display: flex; align-items: stretch; border-bottom: 1px solid var(--rc-line, #e6e9ec); background: var(--rc-ground, #f5f6f7); flex: 0 0 auto; }
.rw-tabbar { display: flex; flex: 1 1 auto; min-width: 0; overflow-x: auto; overflow-y: hidden; scrollbar-width: thin; }
.rw-tabbar::-webkit-scrollbar { height: 5px; }
.rw-tabbar::-webkit-scrollbar-thumb { background: #dfe2e6; border-radius: 4px; }
.rw-tab {
  flex: 0 0 auto; display: flex; align-items: center; gap: 6px; max-width: 170px; min-width: 76px;
  padding: 7px 7px 7px 11px; border-right: 1px solid var(--rc-line-soft, #eef0f2);
  cursor: pointer; font-size: 12px; color: var(--rc-soft, #5c6570); user-select: none; position: relative;
}
.rw-tab:hover { background: var(--rc-hover, #eef0f2); }
.rw-tab.on { background: var(--rc-bg, #fff); color: var(--rc-ink, #16181b); font-weight: 600; box-shadow: inset 0 2px 0 var(--rc-accent, #0f766e); }
.rw-tab.sp { background: var(--rc-bg, #fff); box-shadow: inset 0 2px 0 var(--rc-accent-soft2, #a8cfc9); }
.rw-tab .tb-t { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rw-tab .tb-d { width: 6px; height: 6px; border-radius: 50%; flex: 0 0 auto; display: none; }
.rw-tab.busy .tb-d { display: block; background: var(--rc-accent, #0f766e); animation: rw-pulse 1.5s ease-in-out infinite; }
.rw-tab.unread .tb-d { display: block; background: var(--rc-accent, #0f766e); }
.rw-tab .tb-x { flex: 0 0 auto; border: none; background: none; color: var(--rc-faint, #98a1aa); cursor: pointer; font-size: 13px; line-height: 1; padding: 2px 5px; border-radius: 4px; font-family: inherit; visibility: hidden; }
.rw-tab:hover .tb-x, .rw-tab.on .tb-x { visibility: visible; }
.rw-tab .tb-x:hover { background: var(--rc-hover, #eef0f2); color: var(--rc-err, #c0392b); }
.rw-tab .rw-sess-input { font-size: 12px; padding: 2px 6px; }
.rw-tab-add { flex: 0 0 auto; border: none; border-left: 1px solid var(--rc-line-soft, #eef0f2); background: transparent; color: var(--rc-soft, #5c6570); font-size: 16px; font-family: inherit; cursor: pointer; padding: 4px 13px; }
.rw-tab-add:hover { color: var(--rc-accent, #0f766e); background: var(--rc-hover, #eef0f2); }
/* 탭 드래그 재배열 — 놓일 자리를 세로 하이라이트로 예고한다 */
.rw-tab.drop-l { box-shadow: inset 3px 0 0 var(--rc-accent, #0f766e); }
.rw-tab.drop-r { box-shadow: inset -3px 0 0 var(--rc-accent, #0f766e); }
.rw-tab.dragging { opacity: 0.45; }

/* ── 탭 컨텍스트 메뉴 (우클릭) ── */
.rw-ctx {
  position: absolute; z-index: 80; min-width: 165px; background: var(--rc-bg, #fff);
  border: 1px solid var(--rc-line, #e6e9ec); border-radius: 10px;
  box-shadow: 0 8px 28px rgba(15, 23, 42, 0.14); padding: 4px;
}
.rw-ctx button { display: block; width: 100%; text-align: left; border: none; background: transparent; cursor: pointer; border-radius: 7px; padding: 7px 10px; font: 12.5px inherit; font-family: inherit; color: var(--rc-ink, #16181b); }
.rw-ctx button:hover { background: var(--rc-hover, #eef0f2); }
.rw-ctx button:disabled { color: var(--rc-faint, #98a1aa); cursor: default; background: transparent; }
.rw-ctx button.danger { color: var(--rc-err, #c0392b); font-weight: 600; }
.rw-ctx hr { border: none; border-top: 1px solid var(--rc-line-soft, #eef0f2); margin: 4px 6px; }

/* ── pane 영역 — 분할이면 좌우 2개, 오른쪽 pane 은 캡 바를 단다 ── */
.rw-body { flex: 1 1 auto; min-height: 0; display: flex; align-items: stretch; }
.rw-pane { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; position: relative; overflow: hidden; }
.rw-pane.as-split { border-left: none; }
/* 분할 경계 — 드래그로 좌우 비율을 바꾼다. 가는 선이지만 잡는 폭은 7px */
.rw-divider { flex: 0 0 7px; order: 1; cursor: col-resize; position: relative; touch-action: none; }
.rw-divider::after { content: ""; position: absolute; left: 3px; top: 0; bottom: 0; width: 1px; background: var(--rc-line, #e6e9ec); }
.rw-divider:hover::after, .rw-divider.drag::after { left: 2px; width: 3px; background: var(--rc-accent, #0f766e); }
.rw-cap { display: none; }
.rw-pane.as-split .rw-cap {
  display: flex; align-items: center; gap: 8px; padding: 6px 12px; flex: 0 0 auto;
  border-bottom: 1px solid var(--rc-line-soft, #eef0f2); font-size: 11.5px; font-weight: 600; color: var(--rc-soft, #5c6570);
}
.rw-cap .rw-cap-t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rw-cap button { border: 1px solid var(--rc-line, #e6e9ec); background: var(--rc-bg, #fff); border-radius: 6px; padding: 1px 8px; font: 600 11px inherit; font-family: inherit; cursor: pointer; color: var(--rc-soft, #5c6570); flex: 0 0 auto; }
.rw-cap button:hover { color: var(--rc-accent-strong, #115e59); border-color: var(--rc-accent, #0f766e); }

.rw-log { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 18px 16px 8px; display: flex; flex-direction: column; gap: 14px; }
.rw-log::-webkit-scrollbar { width: 10px; }
.rw-log::-webkit-scrollbar-thumb { background: #dfe2e6; border-radius: 6px; border: 3px solid var(--rc-bg, #fff); }

.rw-empty { margin: auto; text-align: center; color: var(--rc-faint, #98a1aa); font-size: 13.5px; display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 0 20px; }
.rw-empty i { font-style: normal; font-size: 24px; color: var(--rc-accent, #0f766e); opacity: 0.75; }
.rw-empty .rw-hint { font-size: 11px; color: var(--rc-faint, #98a1aa); opacity: 0.85; }

.rw-msg { max-width: 100%; animation: rw-rise 0.18s ease-out; }
.rw-msg.u { align-self: flex-end; max-width: 86%; background: var(--rc-ground, #f5f6f7); padding: 6px 12px; border-radius: 14px 14px 4px 14px; white-space: pre-wrap; word-break: break-word; line-height: 1.5; }
/* 일하는 중에 보낸 메시지는 지금 턴을 끊지 않고 줄을 선다(core.pump). 말풍선만 그려 두면
   묵살된 것처럼 보이므로, 제 차례가 올 때까지 대기 중임을 말풍선에 그대로 적는다 */
.rw-msg.u.q { opacity: 0.66; }
.rw-msg.u.q::after { content: "전송 대기 중"; display: block; margin-top: 3px; font-size: 10.5px; font-weight: 600; letter-spacing: -0.01em; }
.rw-msg.b { align-self: stretch; color: var(--rc-ink, #16181b); word-break: break-word; line-height: 1.6; }
.rw-msg.s { align-self: center; color: var(--rc-faint, #98a1aa); font-size: 12px; text-align: center; }
/* 봇 말풍선의 마크다운 요소 */
.rw-msg.b p { margin: 0 0 8px; }
.rw-msg.b p:last-child { margin-bottom: 0; }
.rw-msg.b .rw-mdh { font-weight: 700; margin: 12px 0 6px; }
.rw-msg.b .rw-mdh.h1 { font-size: 16px; }
.rw-msg.b .rw-mdh.h2 { font-size: 15px; }
.rw-msg.b .rw-mdh.h3 { font-size: 14px; }
.rw-msg.b ul, .rw-msg.b ol { margin: 0 0 8px; padding-left: 20px; }
.rw-msg.b li { margin: 2px 0; }
.rw-msg.b code { font-family: var(--rc-mono, ui-monospace, Menlo, monospace); font-size: 12.5px; background: var(--rc-ground, #f5f6f7); border: 1px solid var(--rc-line-soft, #eef0f2); border-radius: 4px; padding: 1px 4px; }
.rw-msg.b pre { margin: 0 0 8px; padding: 10px 12px; background: var(--rc-ground, #f5f6f7); border: 1px solid var(--rc-line-soft, #eef0f2); border-radius: 8px; overflow-x: auto; }
.rw-msg.b pre code { border: none; background: none; padding: 0; white-space: pre; }
.rw-msg.b blockquote { margin: 0 0 8px; padding: 2px 12px; border-left: 3px solid var(--rc-line, #e6e9ec); color: var(--rc-soft, #5c6570); }
.rw-msg.b hr { border: none; border-top: 1px solid var(--rc-line-soft, #eef0f2); margin: 10px 0; }
.rw-msg.b table { border-collapse: collapse; margin: 0 0 8px; font-size: 13px; display: block; overflow-x: auto; max-width: 100%; }
.rw-msg.b th, .rw-msg.b td { border: 1px solid var(--rc-line, #e6e9ec); padding: 4px 8px; text-align: left; }
.rw-msg.b th { background: var(--rc-ground, #f5f6f7); }
.rw-msg.b a { color: var(--rc-accent, #0f766e); }

.rw-running { display: flex; flex-direction: column; gap: 6px; padding: 2px 2px; font-size: 12.5px; color: var(--rc-soft, #5c6570); flex: 0 0 auto; }
/* 실황 줄이 수십 줄로 자라면 상태 줄(일하는 중 · 중지)이 화면 밖으로 밀려난다 — 그러면
   도구 로그만 흐르고 "지금 일하고 있다"는 유일한 신호와 중지 버튼이 함께 사라진다.
   상태 줄은 실황 로그 아래에 있으므로 .rw-log 뷰포트 바닥에 붙인다(sticky bottom):
   위를 읽으러 올라가 있어도 상태와 중지는 항상 손 닿는 곳에 남는다 */
.rw-running .rw-head { display: flex; align-items: center; gap: 8px; position: sticky; bottom: 0; z-index: 2; padding: 4px 0; background: var(--rc-bg, #fff); border-bottom: none; }
.rw-running span.tx { font-weight: 500; animation: rw-shimmer 1.6s ease-in-out infinite; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 240px; }
/* 실황 로그는 제 높이로 자란다. 스크롤은 대화 전체(.rw-log)가 하나로 소유한다 —
   말풍선 안에 또 스크롤 상자를 두면 일하는 과정이 200px 우물에 갇힌다 */
.rw-proc { display: flex; flex-direction: column; gap: 4px; font-size: 12px; line-height: 1.5; }
/* flex 자식은 기본으로 줄어든다 — 줄들이 세로로 짓눌려 글자 조각만 남는 사고를 막는다 */
.rw-proc .pv-tool, .rw-proc .pv-delta { flex: 0 0 auto; }
.rw-proc .pv-tool { color: var(--rc-accent, #0f766e); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rw-proc .pv-delta { white-space: pre-wrap; word-break: break-word; }
.rw-stop { border: 1px solid var(--rc-line, #e6e9ec); background: var(--rc-bg, #fff); color: var(--rc-soft, #5c6570); border-radius: 6px; padding: 1px 8px; font: 600 11px inherit; font-family: inherit; cursor: pointer; flex: 0 0 auto; }
.rw-stop:hover { border-color: var(--rc-err, #c0392b); color: var(--rc-err, #c0392b); }
.rw-dots { display: inline-flex; gap: 4px; }
.rw-dots i { width: 5px; height: 5px; border-radius: 50%; background: var(--rc-accent, #0f766e); animation: rw-blink 1.4s ease-in-out infinite both; }
.rw-dots i:nth-child(2) { animation-delay: 0.18s; }
.rw-dots i:nth-child(3) { animation-delay: 0.36s; }

.rw-sug { display: none; flex-direction: column; border-top: 1px solid var(--rc-line, #e6e9ec); max-height: 150px; overflow: auto; flex: 0 0 auto; }
.rw-sug.open { display: flex; }
.rw-sug button { display: flex; gap: 8px; align-items: baseline; border: none; background: var(--rc-bg, #fff); padding: 7px 14px; font-size: 12.5px; cursor: pointer; text-align: left; font-family: inherit; }
.rw-sug button:hover { background: var(--rc-hover, #eef0f2); }
.rw-sug button b { font-family: var(--rc-mono, ui-monospace, Menlo, monospace); font-size: 12px; color: var(--rc-accent-strong, #115e59); }
.rw-sug button span { color: var(--rc-faint, #98a1aa); font-size: 11.5px; flex: 1; }
.rw-sug button i { font-style: normal; font-size: 10px; color: var(--rc-faint, #98a1aa); border: 1px solid var(--rc-line, #e6e9ec); border-radius: 5px; padding: 0 5px; }

/* 컴포저 — 상단 에이전트 pill, 중단 클립+둥근 입력+원형 전송, 하단 Effort·Model·컨텍스트 링 */
.rw-in { display: flex; flex-direction: column; gap: 9px; padding: 10px 14px 12px; border-top: 1px solid var(--rc-line, #e6e9ec); flex: 0 0 auto; }
.rw-in-top { display: flex; position: relative; }
.rw-agpill { display: inline-flex; align-items: center; gap: 7px; border: 1px solid var(--rc-line, #e6e9ec); border-radius: 999px; padding: 4px 13px; font: 600 12.5px inherit; font-family: inherit; background: var(--rc-bg, #fff); color: var(--rc-ink, #16181b); cursor: pointer; }
.rw-agpill:hover { background: var(--rc-ground, #f5f6f7); }
.rw-agpill i { width: 8px; height: 8px; border-radius: 50%; background: var(--rc-ok, #059669); font-style: normal; }
.rw-agpill em { font-style: normal; font-size: 9px; color: var(--rc-faint, #98a1aa); }
.rw-ag-menu { position: absolute; bottom: calc(100% + 6px); left: 0; z-index: 60; min-width: 180px; background: var(--rc-bg, #fff); border: 1px solid var(--rc-line, #e6e9ec); border-radius: 10px; box-shadow: 0 8px 28px rgba(15, 23, 42, 0.14); padding: 4px; }
.rw-ag-menu button { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; border: none; background: transparent; cursor: pointer; border-radius: 7px; padding: 7px 9px; font: 12.5px inherit; font-family: inherit; color: var(--rc-ink, #16181b); }
.rw-ag-menu button:hover { background: var(--rc-hover, #eef0f2); }
.rw-ag-menu button.on { font-weight: 600; background: var(--rc-accent-soft, rgba(13, 148, 136, 0.10)); color: var(--rc-accent-strong, #115e59); }
/* 여러 줄로 자라므로 아래를 기준선으로 맞춘다 — 클립·전송 원이 마지막 줄에 붙어 있어야 한다 */
.rw-in-row { display: flex; align-items: flex-end; gap: 10px; }
/* shift+Enter 줄바꿈을 받으려면 한 줄짜리 input 으로는 안 된다. 높이는 내용만큼 자라고
   한 줄일 때의 알약 모양은 그대로 유지한다 (여러 줄이면 둥근 사각으로 자연히 풀린다) */
.rw-in-row textarea {
  flex: 1; min-width: 0; min-height: 46px; max-height: 168px; border: 1px solid var(--rc-line, #e6e9ec);
  border-radius: 23px; padding: 12px 18px; resize: none; overflow-y: auto;
  font: 14px/1.5 inherit; font-family: inherit; outline: none; background: var(--rc-bg, #fff); color: var(--rc-ink, #16181b);
}
.rw-in-row textarea:focus { border-color: var(--rc-accent, #0f766e); }
.rw-pick { width: 44px; height: 44px; flex: 0 0 auto; border-radius: 50%; border: 1px solid var(--rc-line, #e6e9ec); background: var(--rc-bg, #fff); color: var(--rc-soft, #5c6570); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
.rw-pick:hover { border-color: var(--rc-accent, #0f766e); color: var(--rc-accent, #0f766e); }
.rw-pick svg { width: 19px; height: 19px; pointer-events: none; }
.rw-send { width: 44px; height: 44px; flex: 0 0 auto; border-radius: 50%; border: none; background: var(--rc-accent-soft2, #a8cfc9); color: #fff; font-size: 19px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: background 120ms; }
.rw-send:hover, .rw-in-row textarea:focus ~ .rw-send { background: var(--rc-accent, #0f766e); }
.rw-in-foot { display: flex; align-items: center; gap: 16px; font-size: 12px; color: var(--rc-soft, #5c6570); min-height: 26px; }
.rw-eff { display: inline-flex; align-items: center; gap: 10px; }
.rw-eff-lb b { color: var(--rc-ink, #16181b); font-weight: 700; }
.rw-eff-dots { display: inline-flex; gap: 9px; align-items: flex-start; }
.rw-eff-d { display: flex; flex-direction: column; align-items: center; gap: 3px; cursor: pointer; border: none; background: none; padding: 0; font-family: inherit; }
.rw-eff-d i { width: 9px; height: 9px; border-radius: 50%; background: #d7dce0; font-style: normal; transition: background 120ms, box-shadow 120ms; }
.rw-eff-d:hover i { background: var(--rc-faint, #98a1aa); }
.rw-eff-d.on i { background: var(--rc-accent, #0f766e); box-shadow: 0 0 0 4px var(--rc-accent-soft, rgba(13, 148, 136, 0.14)); }
.rw-eff-d b { font-size: 9px; font-weight: 700; color: var(--rc-faint, #98a1aa); letter-spacing: 0.2px; }
.rw-eff-d.on b { color: var(--rc-ink, #16181b); }
.rw-modelbtn { display: inline-flex; align-items: center; gap: 6px; border: none; background: none; cursor: pointer; font: 12px inherit; font-family: inherit; color: var(--rc-soft, #5c6570); padding: 0; }
.rw-modelbtn b { color: var(--rc-ink, #16181b); font-weight: 700; max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rw-modelbtn:hover b { color: var(--rc-accent-strong, #115e59); }
.rw-ring { margin-left: auto; display: none; align-items: center; gap: 6px; font-weight: 700; color: var(--rc-soft, #5c6570); font-variant-numeric: tabular-nums; }
.rw-ring.has { display: inline-flex; }
.rw-ring svg { width: 16px; height: 16px; transform: rotate(-90deg); }
.rw-ring .rg-bg { fill: none; stroke: #e3e7ea; stroke-width: 3; }
.rw-ring .rg-arc { fill: none; stroke: var(--rc-accent, #0f766e); stroke-width: 3; stroke-linecap: round; }

.rw-set { display: none; flex: 1 1 auto; min-height: 0; overflow: auto; padding: 14px 16px; }
.rw-pane.setting .rw-set { display: block; }
.rw-pane.setting .rw-log, .rw-pane.setting .rw-sug, .rw-pane.setting .rw-in { display: none; }
.rw-sec { margin-bottom: 18px; }
.rw-recheck { border: 1px solid #e6e9ec; background: #fff; border-radius: 7px; padding: 4px 10px; font-size: 11.5px; font-weight: 600; cursor: pointer; color: #16181b; margin: 4px 0; }
.rw-recheck:hover { background: #eef0f2; }
.rw-lv { border: 1px solid var(--rc-line, #e6e9ec); border-radius: 12px; background: var(--rc-bg, #fff); overflow: hidden; }
.rw-lvrow { display: flex; align-items: center; gap: 11px; padding: 10px 13px; cursor: pointer; border-top: 1px solid var(--rc-line-soft, #eef0f2); transition: background 120ms ease; }
.rw-lvrow:first-child { border-top: none; }
.rw-lvrow:hover { background: var(--rc-ground, #f5f6f7); }
.rw-lvic { width: 28px; height: 28px; flex: 0 0 auto; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--rc-line, #e6e9ec); font-size: 12px; font-weight: 700; color: var(--rc-soft, #5c6570); overflow: hidden; }
.rw-lvic img { width: 17px; height: 17px; object-fit: contain; }
.rw-lvtx { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.rw-lvtx b { font-size: 13px; font-weight: 600; color: var(--rc-ink, #16181b); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rw-lvtx span { font-size: 11.5px; color: var(--rc-faint, #98a1aa); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rw-lvring { width: 17px; height: 17px; flex: 0 0 auto; border-radius: 50%; border: 2px solid #c9ced3; position: relative; transition: border-color 120ms; }
.rw-lvrow:hover .rw-lvring { border-color: var(--rc-faint, #98a1aa); }
.rw-lvrow.on .rw-lvring { border-color: var(--rc-accent, #0f766e); }
.rw-lvrow.on .rw-lvring::after { content: ""; position: absolute; left: 50%; top: 50%; width: 7px; height: 7px; transform: translate(-50%, -50%); border-radius: 50%; background: var(--rc-accent, #0f766e); }
.rw-lvadd { color: var(--rc-soft, #5c6570); font-size: 12.5px; font-weight: 600; gap: 8px; }
.rw-lvadd b { font-size: 15px; color: var(--rc-faint, #98a1aa); }
.rw-login-pane { margin-top: 8px; border: 1px solid var(--rc-line, #e6e9ec); border-radius: 10px; overflow: hidden; }
.rw-login-out { max-height: 190px; overflow: auto; padding: 9px 11px; margin: 0; background: var(--rc-ground, #f5f6f7); font: 11.5px/1.55 var(--rc-mono, ui-monospace, Menlo, monospace); white-space: pre-wrap; word-break: break-word; color: var(--rc-ink, #16181b); }
.rw-login-out a { color: var(--rc-accent-strong, #115e59); }
.rw-login-in { display: flex; gap: 6px; padding: 8px; border-top: 1px solid var(--rc-line, #e6e9ec); }
.rw-login-in input { flex: 1; border: 1px solid var(--rc-line, #e6e9ec); border-radius: 7px; padding: 5px 9px; font: 12px var(--rc-mono, ui-monospace, Menlo, monospace); outline: none; }
.rw-login-in input:focus { border-color: var(--rc-accent, #0f766e); }
.rw-login-in button { border: 1px solid var(--rc-line, #e6e9ec); background: #fff; border-radius: 7px; padding: 4px 10px; font-size: 11.5px; font-weight: 600; cursor: pointer; }
.rw-mfree { display: flex; gap: 6px; margin-top: 6px; }
.rw-mfree input { flex: 1; border: 1px solid var(--rc-line, #e6e9ec); border-radius: 7px; padding: 5px 9px; font: 12px var(--rc-mono, ui-monospace, Menlo, monospace); outline: none; }
.rw-mfree input:focus { border-color: var(--rc-accent, #0f766e); }
.rw-mfree button { border: 1px solid var(--rc-line, #e6e9ec); background: #fff; border-radius: 7px; padding: 4px 10px; font-size: 11.5px; font-weight: 600; cursor: pointer; }
.rw-mfree button:hover { background: var(--rc-hover, #eef0f2); }
.rw-lb { font-size: 10.5px; font-weight: 700; color: var(--rc-faint, #98a1aa); letter-spacing: 0.4px; margin-bottom: 6px; text-transform: uppercase; }
.rw-set label { display: flex; gap: 8px; align-items: center; padding: 6px 2px; font-size: 13px; cursor: pointer; }
.rw-set input[type="radio"] { accent-color: var(--rc-accent, #0f766e); }
.rw-row { display: flex; gap: 8px; align-items: baseline; padding: 4px 0; font-size: 12.5px; }
.rw-row b { font-weight: 600; }
.rw-ok { color: var(--rc-ok, #059669); font-size: 12.5px; }
.rw-err { color: var(--rc-err, #c0392b); font-size: 12.5px; white-space: pre-wrap; }
.rw-note { color: var(--rc-faint, #98a1aa); font-size: 11.5px; }

.rw-att { display: none; flex-wrap: wrap; gap: 6px; padding: 8px 12px 0; border-top: 1px solid var(--rc-line, #e6e9ec); flex: 0 0 auto; }
.rw-att.has { display: flex; }
.rw-chipf { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; border: 1px solid var(--rc-line, #e6e9ec); background: var(--rc-ground, #f5f6f7); border-radius: 999px; padding: 3px 10px; font-size: 11.5px; color: var(--rc-ink, #16181b); }
.rw-chipf.err { border-color: var(--rc-err, #c0392b); color: var(--rc-err, #c0392b); }
.rw-chipf b { font-weight: 600; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rw-chipf i { font-style: normal; color: var(--rc-faint, #98a1aa); font-variant-numeric: tabular-nums; }
.rw-chipf button { border: none; background: none; cursor: pointer; color: var(--rc-faint, #98a1aa); padding: 0 2px; font-size: 12px; font-family: inherit; }
.rw-chipf button:hover { color: var(--rc-err, #c0392b); }
.rw-chipf img { width: 22px; height: 22px; object-fit: cover; border-radius: 5px; margin-left: -5px; flex: 0 0 auto; }
.rw-pane.dropping::after {
  content: "파일을 놓으면 첨부됩니다"; position: absolute; inset: 0; z-index: 70; pointer-events: none;
  display: flex; align-items: center; justify-content: center;
  background: rgba(13, 148, 136, 0.08); border: 2px dashed var(--rc-accent, #0f766e); border-radius: inherit;
  font-size: 13px; font-weight: 600; color: var(--rc-accent-strong, #115e59);
}
.rw-files { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.rw-filelink { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--rc-line, #e6e9ec); background: var(--rc-bg, #fff); border-radius: 8px; padding: 4px 10px; font-size: 12px; color: var(--rc-accent-strong, #115e59); text-decoration: none; }
.rw-filelink:hover { background: var(--rc-accent-soft, rgba(13, 148, 136, 0.10)); }
/* 이미지 첨부는 이름 대신 그림으로 — "들어갔다"는 사실이 눈으로 확인돼야 한다 */
.rw-fileimg { display: block; max-width: 220px; border: 1px solid var(--rc-line, #e6e9ec); border-radius: 10px; overflow: hidden; background: var(--rc-bg, #fff); }
.rw-fileimg img { display: block; max-width: 100%; max-height: 180px; }

/* ── 대화 드로어 — 검색 + 열린 목록 + 보관함 ── */
.rw-sess-menu {
  position: absolute; top: 42px; right: 10px; z-index: 60; min-width: 250px; max-width: 320px;
  background: var(--rc-bg, #fff); border: 1px solid var(--rc-line, #e6e9ec); border-radius: 10px;
  box-shadow: 0 8px 28px rgba(15, 23, 42, 0.14); padding: 4px; max-height: min(480px, 70vh); overflow-y: auto;
}
.rw-sess-search { display: flex; padding: 3px 3px 5px; }
.rw-sess-search input { flex: 1; min-width: 0; border: 1px solid var(--rc-line, #e6e9ec); border-radius: 7px; padding: 5px 9px; font: 12px inherit; font-family: inherit; outline: none; color: var(--rc-ink, #16181b); background: var(--rc-bg, #fff); }
.rw-sess-search input:focus { border-color: var(--rc-accent, #0f766e); }
.rw-sess-item {
  display: flex; align-items: center; gap: 10px; width: 100%; text-align: left;
  border: none; background: transparent; cursor: pointer; border-radius: 7px;
  padding: 7px 9px; font-size: 12.5px; color: var(--rc-ink, #16181b); font-family: inherit;
}
.rw-sess-item:hover { background: var(--rc-hover, #eef0f2); }
.rw-sess-item.on { font-weight: 600; background: var(--rc-accent-soft, rgba(13, 148, 136, 0.10)); color: var(--rc-accent-strong, #115e59); }
.rw-sess-item.arch .rw-sess-name { color: var(--rc-soft, #5c6570); }
.rw-sess-name { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 고정 마크 — 고정된 행 이름 앞의 작은 압정 모양(사각+꼬리를 CSS 로) */
.rw-pinmark { display: none; width: 7px; height: 7px; border-radius: 2px 50% 50% 50%; transform: rotate(45deg); background: var(--rc-accent, #0f766e); flex: 0 0 auto; }
.rw-sess-item.pin .rw-pinmark { display: inline-block; }
.rw-sess-time { flex: 0 0 auto; font-size: 11px; color: var(--rc-faint, #98a1aa); font-variant-numeric: tabular-nums; }
.rw-sess-acts { display: none; flex: 0 0 auto; gap: 2px; align-items: center; }
.rw-sess-item:hover .rw-sess-acts { display: inline-flex; }
.rw-sess-item:hover .rw-sess-time { display: none; }
.rw-sess-act { border: none; background: transparent; cursor: pointer; color: var(--rc-faint, #98a1aa); padding: 3px 5px; border-radius: 5px; font-size: 11.5px; font-family: inherit; }
.rw-sess-act:hover { background: var(--rc-hover, #eef0f2); color: var(--rc-soft, #5c6570); }
.rw-sess-danger, .rw-sess-danger:hover { color: var(--rc-err, #c0392b); font-weight: 600; }
.rw-sess-input {
  flex: 1 1 auto; min-width: 0; font: inherit; font-size: 12.5px; color: var(--rc-ink, #16181b);
  border: 1px solid var(--rc-accent, #0f766e); border-radius: 6px; padding: 4px 7px; background: var(--rc-bg, #fff); outline: none;
}
.rw-sess-sec {
  display: flex; align-items: center; gap: 6px; width: 100%; text-align: left; border: none; background: transparent;
  cursor: pointer; margin-top: 3px; padding: 7px 9px 4px; border-top: 1px solid var(--rc-line-soft, #eef0f2);
  font: 700 10.5px inherit; font-family: inherit; color: var(--rc-faint, #98a1aa); letter-spacing: 0.4px;
}
.rw-sess-sec i { font-style: normal; font-size: 9px; transition: transform 120ms; }
.rw-sess-sec.open i { transform: rotate(90deg); }
.rw-sess-new {
  display: block; width: 100%; text-align: left; border: none; cursor: pointer;
  margin-top: 2px; padding: 7px 9px; font-size: 12.5px; font-weight: 600; font-family: inherit;
  color: var(--rc-accent-strong, #115e59); background: transparent; border-top: 1px solid var(--rc-line, #e6e9ec);
}
.rw-sess-new:hover { background: var(--rc-accent-soft, rgba(13, 148, 136, 0.10)); }
.rw-sess-note { padding: 8px 9px; font-size: 11.5px; color: var(--rc-faint, #98a1aa); }

@keyframes rw-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes rw-pulse { 0%, 100% { transform: scale(1); opacity: 0.9; } 50% { transform: scale(1.55); opacity: 0.35; } }
@keyframes rw-shimmer { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
@keyframes rw-blink { 0%, 70%, 100% { opacity: 0.25; transform: translateY(0); } 35% { opacity: 1; transform: translateY(-3px); } }
`;

let cssDone = false;
function injectCss() {
  if (cssDone) return;
  cssDone = true;
  const st = document.createElement("style");
  st.textContent = CSS;
  document.head.appendChild(st);
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + "MB" : n >= 1024 ? Math.round(n / 1024) + "KB" : n + "B");
// 브라우저가 <img> 로 그릴 수 있는 확장자만 — 못 그리는 형식(heic 등)은 이름 링크로 남는다
const IMG_RE = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;
// 클립보드·드롭의 파일 수집 — files 가 비는 브라우저(일부 웹뷰)는 items 에서 줍는다
function dtFiles(dt) {
  if (!dt) return [];
  if (dt.files && dt.files.length) return Array.from(dt.files);
  const out = [];
  for (const it of Array.from(dt.items || [])) {
    if (it.kind === "file") {
      const f = it.getAsFile();
      if (f) out.push(f);
    }
  }
  return out;
}
const rel = (ms) => {
  const d = Date.now() - ms;
  if (d < 60_000) return "방금";
  if (d < 3_600_000) return Math.floor(d / 60_000) + "분 전";
  if (d < 86_400_000) return Math.floor(d / 3_600_000) + "시간 전";
  return Math.floor(d / 86_400_000) + "일 전";
};
const shortModel = (id) => String(id).replace(/^claude-/, "").replace(/-\d{8}$/, "");
// 별칭('fable')과 실제 id('claude-fable-5-20260115')는 글자가 다르다. 별칭이 실제 id 안에
// 들어 있으면 같은 모델로 본다 — 이 판정이 어긋나면 고른 값이 안 먹은 것이다
const modelMatches = (picked, actual) =>
  !picked || !actual || String(actual).toLowerCase().includes(String(picked).toLowerCase());
const EFFORTS = [["low", "L", "Low"], ["medium", "M", "Medium"], ["high", "H", "High"], ["xhigh", "XH", "XHigh"], ["max", "MAX", "Max"]];

// 마크다운 미니 렌더러 — 봇 말풍선 전용. 원문을 전부 이스케이프한 뒤 우리가 만든
// 태그만 얹는다(외부 라이브러리 없음, 원문 HTML 은 절대 통과하지 않는다)
function mdEsc(t) {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function mdInline(t) {
  const codes = [];
  let s = mdEsc(t);
  s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return " " + (codes.length - 1) + " "; });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*/g, "$1<em>$2</em>");
  s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]*)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return s.replace(/ (\d+) /g, (_, i) => "<code>" + codes[i] + "</code>");
}
function mdRender(src) {
  const lines = String(src).split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      out.push("<pre><code>" + mdEsc(buf.join("\n")) + "</code></pre>");
      continue;
    }
    if (/^\s*$/.test(line)) { i++; continue; }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { out.push('<div class="rw-mdh h' + Math.min(h[1].length, 3) + '">' + mdInline(h[2]) + "</div>"); i++; continue; }
    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) { out.push("<hr>"); i++; continue; }
    if (/^\s*>\s?/.test(line)) {
      const qb = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { qb.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
      out.push("<blockquote>" + mdRender(qb.join("\n")) + "</blockquote>");
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const cells = (row) => row.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
      const head = cells(line);
      i += 2;
      let body = "";
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        body += "<tr>" + cells(lines[i]).map((c) => "<td>" + mdInline(c) + "</td>").join("") + "</tr>";
        i++;
      }
      out.push("<table><thead><tr>" + head.map((c) => "<th>" + mdInline(c) + "</th>").join("") + "</tr></thead><tbody>" + body + "</tbody></table>");
      continue;
    }
    const li = line.match(/^\s*([-*+]|\d+\.)\s+(.*)$/);
    if (li) {
      const ordered = /\d/.test(li[1]);
      let items = "";
      while (i < lines.length) {
        const it = lines[i].match(/^\s*([-*+]|\d+\.)\s+(.*)$/);
        if (!it) break;
        items += "<li>" + mdInline(it[2]) + "</li>";
        i++;
      }
      out.push(ordered ? "<ol>" + items + "</ol>" : "<ul>" + items + "</ul>");
      continue;
    }
    const pb = [];
    while (i < lines.length && lines[i].trim() !== "" && !/^(```|#{1,6}\s|\s*>|\s*([-*+]|\d+\.)\s|\s*\|.*\|\s*$)/.test(lines[i])) {
      pb.push(lines[i]);
      i++;
    }
    if (pb.length) out.push("<p>" + mdInline(pb.join("\n")).replace(/\n/g, "<br>") + "</p>");
    else i++;
  }
  return out.join("");
}

export function mount(opts) {
  const mode = opts.mode || "float";
  injectCss();

  const root = document.createElement("div");
  root.className = mode === "inline" ? "rw-inline" : "rw-dock";
  root.innerHTML = `
  <div class="rw-panel${mode === "inline" ? " open" : ""}">
    <div class="rw-head"><span class="rw-d"></span><span class="rw-t">${esc(opts.pkg)}</span><span class="rw-sp"></span>
      <button data-a="sess">대화</button>
      <button data-a="set" style="display:none">설정</button>${mode === "float" ? '<button data-a="close">닫기</button>' : ""}</div>
    <div class="rw-tabs"><div class="rw-tabbar"></div><button class="rw-tab-add" data-a="new" title="새 대화">+</button></div>
    <div class="rw-sess-menu" hidden></div>
    <div class="rw-ctx" hidden></div>
    <div class="rw-body"><div class="rw-divider" style="display:none"></div></div>
  </div>${mode === "float" ? `<button class="rw-fab" title="${esc(opts.pkg)} 와 대화">✳</button>` : ""}`;
  ((mode === "inline" && opts.target) || document.body).appendChild(root);

  const panel = root.querySelector(".rw-panel");
  const body = root.querySelector(".rw-body");
  const divider = root.querySelector(".rw-divider");
  const tabbar = root.querySelector(".rw-tabbar");
  const sess = root.querySelector(".rw-sess-menu");
  const ctx = root.querySelector(".rw-ctx");
  const headDot = root.querySelector(".rw-d");
  const setBtn = root.querySelector('[data-a="set"]');

  // ── 탭 상태 — 탭 목록·활성·분할을 localStorage 에 남겨 새로고침에도 유지한다 ──
  const STORE_KEY = "rw-tabs:" + opts.pkg;
  const SLOT_OK = /^[a-zA-Z0-9._-]{1,64}$/;
  let tabs = [];
  let active = null;
  let split = null; // 오른쪽 pane 에 띄운 slot (없으면 null)
  let ratio = 0.5; // 분할일 때 왼쪽 pane 의 폭 비율 (0.2~0.8)
  const panes = new Map(); // slot → pane (탭이 열려 있는 동안 살아 있다)
  const unread = new Set(); // 백그라운드 탭에서 턴이 끝난 세션
  const labels = new Map(); // slot → { label, updated, archived } (세션 장부 사본)

  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (saved && Array.isArray(saved.tabs)) {
      tabs = saved.tabs.filter((s) => typeof s === "string" && SLOT_OK.test(s));
      active = tabs.includes(saved.active) ? saved.active : tabs[0] || null;
      split = saved.split && tabs.includes(saved.split) && saved.split !== active ? saved.split : null;
      if (typeof saved.ratio === "number" && saved.ratio >= 0.2 && saved.ratio <= 0.8) ratio = saved.ratio;
    }
  } catch { /* 깨진 저장 — 기본값으로 */ }
  if (!tabs.length) {
    tabs = [opts.slot || "console"];
    active = tabs[0];
  }

  function saveState() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ tabs, active, split, ratio }));
    } catch { /* 저장 불가 환경 — 탭은 이번 문서에서만 산다 */ }
  }

  const genSlot = () => "c-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 4);
  const labelOf = (slot) => {
    const s = labels.get(slot);
    if (s && s.label && s.label !== slot) return s.label;
    return slot === "console" ? "메인" : s ? s.label : "새 대화";
  };
  const anyClient = () => {
    ensurePane(active);
    return panes.get(active).client;
  };

  // ── float 사이드바 — 본문을 덮지 않고 밀어낸다. 분할이 켜지면 넓어진다 ──
  function panelWidth() {
    return split ? Math.min(900, Math.round(window.innerWidth * 0.96)) : 440;
  }
  function applyWidth() {
    if (mode !== "float") return;
    const w = panelWidth();
    panel.style.width = w + "px";
    if (panel.classList.contains("open")) document.documentElement.style.paddingRight = w + "px";
  }
  function setOpen(open) {
    panel.classList.toggle("open", open);
    root.classList.toggle("rw-open", open);
    if (mode !== "float") return;
    const doc = document.documentElement;
    doc.style.transition = "padding-right 200ms ease";
    doc.style.paddingRight = open ? panelWidth() + "px" : "";
    if (open) applyWidth();
  }
  window.addEventListener("resize", applyWidth);

  // ── 문서 전역 첨부 입구 — 붙여넣기·드래그앤드롭을 문서 어디서든 받아 pane 으로 흘린다.
  // 캡쳐 붙여넣기는 포커스가 입력창 밖(로그·본문)에 있는 순간이 대부분이다 — 패널이 열려
  // 있으면 받는다. 커서·포커스가 특정 pane 안이면 그 pane, 아니면 활성 pane 이 받는다.
  // 탭 재배열 드래그는 Files 타입이 없어 여기 걸리지 않는다
  const routePane = (t) => {
    const pel = t && t.closest ? t.closest(".rw-pane") : null;
    if (pel) for (const pane of panes.values()) if (pane.el === pel) return pane;
    return panes.get(active) || null;
  };
  const isFileDrag = (ev) => !!ev.dataTransfer && Array.from(ev.dataTransfer.types || []).includes("Files");
  // 위젯 밖의 입력 필드(스튜디오 편집기 등)에 하는 붙여넣기는 그쪽 것이다 — 가로채지 않는다
  const editableOutside = (t) =>
    t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) && !root.contains(t);
  const docPaste = (ev) => {
    // __rwTaken: 한 문서에 위젯이 둘(float+inline)일 때 같은 붙여넣기를 두 번 첨부하지 않는다
    if (!panel.classList.contains("open") || ev.defaultPrevented || ev.__rwTaken || editableOutside(ev.target)) return;
    const files = dtFiles(ev.clipboardData);
    if (!files.length) return;
    const pane = routePane(ev.target);
    if (!pane) return;
    ev.__rwTaken = true;
    ev.preventDefault();
    pane.addFiles(files);
    pane.focus();
  };
  let dragDepth = 0;
  let dropPane = null; // 드롭 예고(하이라이트) 중인 pane
  const clearDrop = () => {
    dragDepth = 0;
    if (dropPane) dropPane.el.classList.remove("dropping");
    dropPane = null;
  };
  const docDragEnter = (ev) => {
    if (!panel.classList.contains("open") || !isFileDrag(ev)) return;
    ev.preventDefault();
    dragDepth++;
    const pane = routePane(ev.target);
    if (pane !== dropPane) {
      if (dropPane) dropPane.el.classList.remove("dropping");
      dropPane = pane;
      if (pane) pane.el.classList.add("dropping");
    }
  };
  const docDragOver = (ev) => {
    if (panel.classList.contains("open") && isFileDrag(ev)) ev.preventDefault();
  };
  const docDragLeave = () => {
    if (--dragDepth <= 0) clearDrop();
  };
  const docDrop = (ev) => {
    if (!panel.classList.contains("open")) return void clearDrop();
    const pane = dropPane || routePane(ev.target);
    clearDrop();
    const files = dtFiles(ev.dataTransfer);
    if (!files.length || !pane || ev.__rwTaken) return;
    ev.__rwTaken = true;
    ev.preventDefault();
    pane.addFiles(files);
    pane.focus();
  };
  document.addEventListener("paste", docPaste);
  document.addEventListener("dragenter", docDragEnter);
  document.addEventListener("dragover", docDragOver);
  document.addEventListener("dragleave", docDragLeave);
  document.addEventListener("drop", docDrop);

  // ── 세션 장부 새로고침 — 탭 라벨·드로어·분할 캡이 모두 이 사본을 읽는다 ──
  let labelsBusy = false;
  async function refreshLabels() {
    if (labelsBusy) return;
    labelsBusy = true;
    const r = await anyClient().sessions.list();
    labelsBusy = false;
    if (r.error) return;
    labels.clear();
    for (const s of r.sessions) labels.set(s.slot, s);
    renderTabs();
    updateCaps();
  }

  function updateCaps() {
    for (const [slot, pane] of panes) pane.setCap(labelOf(slot));
  }

  // ── 탭 스트립 ─────────────────────────────────────────────────────────
  let dragSlot = null; // 드래그 중인 탭의 slot
  function renderTabs() {
    tabbar.innerHTML = "";
    for (const slot of tabs) {
      const busy = panes.has(slot) && panes.get(slot).client.busy;
      const t = document.createElement("div");
      t.className = "rw-tab" + (slot === active ? " on" : "") + (slot === split ? " sp" : "")
        + (busy ? " busy" : unread.has(slot) ? " unread" : "");
      t.title = labelOf(slot) + (slot === split ? " (분할)" : "");
      t.innerHTML = `<span class="tb-d"></span><span class="tb-t">${esc(labelOf(slot))}</span><button class="tb-x" title="탭 닫기">×</button>`;
      t.addEventListener("click", (ev) => {
        if (ev.target.classList && ev.target.classList.contains("tb-x")) return void closeTab(slot);
        if (slot !== active && slot !== split) activate(slot, true);
        else if (panes.has(slot)) panes.get(slot).focus();
      });
      // 가운데 클릭 = 탭 닫기 (브라우저 탭 관례)
      t.addEventListener("auxclick", (ev) => {
        if (ev.button === 1) { ev.preventDefault(); closeTab(slot); }
      });
      t.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        openCtx(ev, slot);
      });
      t.addEventListener("dblclick", () => startTabRename(t, slot));
      // 드래그로 순서 변경 — 놓일 쪽(왼/오른쪽 절반)을 하이라이트로 예고한다.
      // pane 의 파일 드롭과는 안 섞인다: 그쪽은 dataTransfer 에 Files 가 있을 때만 반응한다
      t.draggable = true;
      t.addEventListener("dragstart", (ev) => {
        dragSlot = slot;
        t.classList.add("dragging");
        ev.dataTransfer.effectAllowed = "move";
        ev.dataTransfer.setData("text/plain", slot);
      });
      t.addEventListener("dragover", (ev) => {
        if (!dragSlot || dragSlot === slot) return;
        ev.preventDefault();
        ev.dataTransfer.dropEffect = "move";
        const r = t.getBoundingClientRect();
        const before = ev.clientX < r.left + r.width / 2;
        t.classList.toggle("drop-l", before);
        t.classList.toggle("drop-r", !before);
      });
      t.addEventListener("dragleave", () => t.classList.remove("drop-l", "drop-r"));
      t.addEventListener("drop", (ev) => {
        ev.preventDefault();
        t.classList.remove("drop-l", "drop-r");
        if (!dragSlot || dragSlot === slot) return;
        const from = tabs.indexOf(dragSlot);
        if (from === -1) return;
        const r = t.getBoundingClientRect();
        const before = ev.clientX < r.left + r.width / 2;
        tabs.splice(from, 1);
        tabs.splice(tabs.indexOf(slot) + (before ? 0 : 1), 0, dragSlot);
        dragSlot = null;
        layout();
      });
      t.addEventListener("dragend", () => {
        dragSlot = null;
        renderTabs();
      });
      tabbar.appendChild(t);
    }
    const on = tabbar.querySelector(".rw-tab.on");
    if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function layout() {
    divider.style.display = split ? "" : "none";
    for (const [slot, pane] of panes) {
      const vis = slot === active || slot === split;
      pane.el.style.display = vis ? "" : "none";
      pane.el.classList.toggle("as-split", slot === split);
      pane.el.style.order = slot === split ? 2 : 0; // 디바이더(order 1)를 사이에 둔다
      pane.el.style.flex = split && vis ? (slot === active ? ratio : 1 - ratio) + " 1 0%" : "";
    }
    const ap = panes.get(active);
    headDot.classList.toggle("run", !!(ap && ap.client.busy));
    setBtn.textContent = ap && ap.inSet() ? "대화로" : "설정";
    applyWidth();
    updateCaps();
    renderTabs();
    saveState();
  }

  function ensurePane(slot) {
    if (panes.has(slot)) return panes.get(slot);
    const pane = createPane(slot);
    panes.set(slot, pane);
    body.appendChild(pane.el);
    pane.el.style.display = "none";
    pane.el.querySelector(".rw-cap-x").addEventListener("click", () => setSplit(null));
    pane.client.on("busy", (b) => {
      if (!b && slot !== active && slot !== split && tabs.includes(slot)) unread.add(slot);
      if (slot === active) headDot.classList.toggle("run", b);
      renderTabs();
      if (!b) {
        refreshLabels(); // 첫 턴이 끝나면 서버가 첫 발화로 라벨을 만든다
        // 자동 제목은 턴 종료 뒤 하네스가 몇 초 늦게 짓는다 — 잠시 후 다시 당겨온다
        setTimeout(refreshLabels, 5000);
        setTimeout(refreshLabels, 15000);
      }
    });
    return pane;
  }

  function activate(slot, focus) {
    if (!tabs.includes(slot)) tabs.push(slot);
    active = slot;
    if (split === slot) split = null; // 같은 세션을 양쪽에 두 번 띄우지 않는다
    unread.delete(slot);
    const pane = ensurePane(slot);
    layout();
    if (focus) pane.focus();
  }

  function openTab(slot, focus) {
    if (slot === active || slot === split) {
      if (panes.has(slot) && focus) panes.get(slot).focus();
      unread.delete(slot);
      renderTabs();
      return;
    }
    activate(slot, focus);
  }

  function newTab() {
    activate(genSlot(), true);
  }

  function destroyPane(slot) {
    const pane = panes.get(slot);
    if (pane) {
      pane.el.remove();
      panes.delete(slot);
    }
    unread.delete(slot);
  }

  function closeTab(slot) {
    const i = tabs.indexOf(slot);
    if (i === -1) return;
    tabs.splice(i, 1);
    destroyPane(slot);
    if (split === slot) split = null;
    if (!tabs.length) return void newTab();
    if (active === slot) active = tabs[Math.min(i, tabs.length - 1)];
    ensurePane(active);
    layout();
  }

  function closeOthers(slot) {
    for (const s of [...tabs]) if (s !== slot) destroyPane(s);
    tabs = [slot];
    active = slot;
    split = null; // 남은 탭이 하나뿐이면 분할할 상대가 없다
    ensurePane(active);
    layout();
  }

  function closeRight(slot) {
    const i = tabs.indexOf(slot);
    if (i === -1) return;
    const removed = tabs.slice(i + 1);
    for (const s of removed) destroyPane(s);
    tabs = tabs.slice(0, i + 1);
    if (removed.includes(split)) split = null;
    if (!tabs.includes(active)) active = slot;
    ensurePane(active);
    layout();
  }

  function closeAll() {
    for (const s of [...tabs]) destroyPane(s);
    tabs = [];
    split = null;
    newTab();
  }

  function setSplit(slot) {
    if (slot === active) return; // 활성 세션은 이미 왼쪽에 있다
    split = slot || null;
    if (split) {
      if (!tabs.includes(split)) tabs.push(split);
      unread.delete(split);
      ensurePane(split);
    }
    layout();
  }

  // ── 분할 경계 드래그 — 좌우 비율을 바꾼다. 포인터 캡처라 pane 위를 지나도 안 놓친다 ──
  divider.addEventListener("pointerdown", (ev) => {
    if (!split) return;
    ev.preventDefault();
    divider.setPointerCapture(ev.pointerId);
    divider.classList.add("drag");
    const rect = body.getBoundingClientRect();
    const move = (e) => {
      ratio = Math.min(0.8, Math.max(0.2, (e.clientX - rect.left) / rect.width));
      const ap = panes.get(active);
      const sp = panes.get(split);
      if (ap) ap.el.style.flex = ratio + " 1 0%";
      if (sp) sp.el.style.flex = (1 - ratio) + " 1 0%";
    };
    const up = () => {
      divider.classList.remove("drag");
      divider.removeEventListener("pointermove", move);
      divider.removeEventListener("pointerup", up);
      divider.removeEventListener("pointercancel", up);
      saveState();
    };
    divider.addEventListener("pointermove", move);
    divider.addEventListener("pointerup", up);
    divider.addEventListener("pointercancel", up);
  });

  // ── 세션 정리 동작 — 드로어·컨텍스트 메뉴가 공유한다 ──
  async function archiveSession(slot, on) {
    await anyClient().sessions.archive(slot, on);
    if (on && tabs.includes(slot)) closeTab(slot);
    await refreshLabels();
  }
  async function deleteSession(slot) {
    await anyClient().sessions.remove(slot);
    if (tabs.includes(slot)) closeTab(slot);
    await refreshLabels();
  }
  async function pinSession(slot, on) {
    await anyClient().sessions.pin(slot, on);
    await refreshLabels();
  }

  // ── 탭 이름 바꾸기 (더블클릭 / 컨텍스트 메뉴) ──
  function startTabRename(tabEl, slot) {
    const name = tabEl.querySelector(".tb-t");
    if (!name) return;
    const cur = labelOf(slot);
    name.innerHTML = "";
    const inp = document.createElement("input");
    inp.className = "rw-sess-input";
    inp.value = cur;
    name.appendChild(inp);
    inp.focus();
    inp.select();
    let closed = false;
    const done = async (save) => {
      if (closed) return;
      closed = true;
      if (save && inp.value.trim() && inp.value.trim() !== cur) {
        await anyClient().sessions.rename(slot, inp.value.trim());
        await refreshLabels();
      }
      renderTabs();
    };
    inp.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.isComposing || ev.keyCode === 229) return;
      if (ev.key === "Enter") done(true);
      else if (ev.key === "Escape") done(false);
    });
    inp.addEventListener("click", (ev) => ev.stopPropagation());
    inp.addEventListener("blur", () => done(false));
  }

  // ── 탭 컨텍스트 메뉴 ──────────────────────────────────────────────────
  function openCtx(ev, slot) {
    const i = tabs.indexOf(slot);
    const items = [];
    items.push('<button data-c="rename">이름 바꾸기</button>');
    items.push(labels.get(slot) && labels.get(slot).pinned
      ? '<button data-c="unpin">고정 해제</button>'
      : '<button data-c="pin">목록 맨 위에 고정</button>');
    if (slot === split) items.push('<button data-c="unsplit">분할 해제</button>');
    else if (slot !== active) items.push('<button data-c="split">오른쪽에 분할로 열기</button>');
    items.push("<hr>");
    items.push(`<button data-c="close">탭 닫기</button>`);
    items.push(`<button data-c="others"${tabs.length < 2 ? " disabled" : ""}>나머지 탭 닫기</button>`);
    items.push(`<button data-c="right"${i >= tabs.length - 1 ? " disabled" : ""}>오른쪽 탭 모두 닫기</button>`);
    items.push(`<button data-c="all"${tabs.length < 2 ? " disabled" : ""}>모든 탭 닫기</button>`);
    items.push("<hr>");
    items.push('<button data-c="arch">보관함으로 이동</button>');
    items.push('<button data-c="del" class="danger">대화 삭제</button>');
    ctx.innerHTML = items.join("");
    ctx.hidden = false;
    const pr = panel.getBoundingClientRect();
    ctx.style.left = Math.max(4, Math.min(ev.clientX - pr.left, pr.width - ctx.offsetWidth - 8)) + "px";
    ctx.style.top = Math.max(4, Math.min(ev.clientY - pr.top, pr.height - ctx.offsetHeight - 8)) + "px";
    ctx.querySelectorAll("[data-c]").forEach((b) => {
      b.addEventListener("click", () => {
        const c = b.getAttribute("data-c");
        // 삭제는 메뉴 안에서 두 번 클릭 — 첫 클릭이 무장 (모달 없는 파괴 확인)
        if (c === "del" && !b.getAttribute("data-armed")) {
          b.setAttribute("data-armed", "1");
          b.textContent = "정말 삭제할까요?";
          return;
        }
        ctx.hidden = true;
        if (c === "rename") {
          const tabEl = [...tabbar.children][tabs.indexOf(slot)];
          if (tabEl) startTabRename(tabEl, slot);
        } else if (c === "pin") pinSession(slot, true);
        else if (c === "unpin") pinSession(slot, false);
        else if (c === "split") setSplit(slot);
        else if (c === "unsplit") setSplit(null);
        else if (c === "close") closeTab(slot);
        else if (c === "others") closeOthers(slot);
        else if (c === "right") closeRight(slot);
        else if (c === "all") closeAll();
        else if (c === "arch") archiveSession(slot, true);
        else if (c === "del") deleteSession(slot);
      });
    });
  }
  document.addEventListener("click", (ev) => {
    if (!ev.target.isConnected) return; // 내부 핸들러가 다시 그린 요소 — 바깥 클릭이 아니다
    if (!ctx.hidden && !ctx.contains(ev.target)) ctx.hidden = true;
    // 위젯 밖(페이지 본문) 클릭도 드로어를 닫는다 — root 클릭 배선에는 안 잡힌다
    if (!sess.hidden && !root.contains(ev.target)) sess.hidden = true;
  });

  // ── 대화 드로어 — 검색 + 목록 + 보관함 ────────────────────────────────
  let drawerQ = "";
  let archOpen = false;

  async function renderSessMenu() {
    sess.innerHTML = '<div class="rw-sess-note">불러오는 중...</div>';
    const r = await anyClient().sessions.list();
    if (r.error) {
      sess.innerHTML = `<div class="rw-sess-note">오류: ${esc(r.error.message)}</div>`;
      return;
    }
    labels.clear();
    for (const s of r.sessions) labels.set(s.slot, s);
    renderTabs();
    updateCaps();
    drawSessMenu(r.sessions);
  }

  function drawSessMenu(all) {
    const q = drawerQ.trim().toLowerCase();
    const match = (s) => !q || String(s.label).toLowerCase().includes(q) || s.slot.toLowerCase().includes(q);
    const alive = all.filter((s) => !s.archived && match(s));
    const arch = all.filter((s) => s.archived && match(s));

    const row = (s) => `
      <div class="rw-sess-item${s.slot === active ? " on" : ""}${s.archived ? " arch" : ""}${s.pinned ? " pin" : ""}" data-slot="${esc(s.slot)}">
        <i class="rw-pinmark" title="고정됨"></i>
        <span class="rw-sess-name">${esc(s.label)}</span>
        <span class="rw-sess-time">${rel(s.updated)}</span>
        <span class="rw-sess-acts">${s.archived
          ? '<button class="rw-sess-act" data-op="unarch">복원</button>'
          : `<button class="rw-sess-act" data-op="${s.pinned ? "unpin" : "pin"}">${s.pinned ? "해제" : "고정"}</button>`
            + '<button class="rw-sess-act" data-op="rename">이름</button><button class="rw-sess-act" data-op="arch">보관</button>'}
          <button class="rw-sess-act rw-sess-danger" data-op="del">삭제</button>
        </span>
      </div>`;

    const parts = [];
    parts.push(`<div class="rw-sess-search"><input type="search" placeholder="대화 검색" value="${esc(drawerQ)}"></div>`);
    parts.push(alive.map(row).join("") || `<div class="rw-sess-note">${q ? "검색 결과가 없습니다" : "저장된 대화가 없습니다"}</div>`);
    if (arch.length || archOpen) {
      parts.push(`<button class="rw-sess-sec${archOpen ? " open" : ""}" data-sec="arch"><i>▶</i>보관함 (${arch.length})</button>`);
      if (archOpen) parts.push(arch.map(row).join("") || '<div class="rw-sess-note">보관된 대화가 없습니다</div>');
    }
    parts.push('<button class="rw-sess-new">+ 새 대화</button>');
    sess.innerHTML = parts.join("");

    const search = sess.querySelector(".rw-sess-search input");
    search.addEventListener("input", () => {
      drawerQ = search.value;
      const pos = search.selectionStart;
      drawSessMenu(all);
      const again = sess.querySelector(".rw-sess-search input");
      again.focus();
      try { again.setSelectionRange(pos, pos); } catch { /* search 타입 미지원 브라우저 */ }
    });
    search.addEventListener("keydown", (ev) => ev.stopPropagation());

    const secBtn = sess.querySelector('[data-sec="arch"]');
    if (secBtn) secBtn.addEventListener("click", () => {
      archOpen = !archOpen;
      drawSessMenu(all);
    });

    sess.querySelector(".rw-sess-new").addEventListener("click", () => {
      newTab();
      sess.hidden = true;
    });

    sess.querySelectorAll(".rw-sess-item").forEach((rowEl) => {
      const slot = rowEl.getAttribute("data-slot");
      rowEl.addEventListener("click", (ev) => {
        const op = ev.target.getAttribute && ev.target.getAttribute("data-op");
        if (op === "rename") return void startRename(rowEl, slot);
        if (op === "del") return void confirmDelete(ev.target, slot);
        if (op === "arch") return void archiveSession(slot, true).then(renderSessMenu);
        if (op === "unarch") return void archiveSession(slot, false).then(renderSessMenu);
        if (op === "pin") return void pinSession(slot, true).then(renderSessMenu);
        if (op === "unpin") return void pinSession(slot, false).then(renderSessMenu);
        openTab(slot, true);
        sess.hidden = true;
      });
    });
  }

  function startRename(row, slot) {
    const name = row.querySelector(".rw-sess-name");
    const cur = name.textContent;
    name.innerHTML = "";
    const inp = document.createElement("input");
    inp.className = "rw-sess-input";
    inp.value = cur;
    name.appendChild(inp);
    inp.focus();
    inp.select();
    let closed = false;
    const done = async (save) => {
      if (closed) return;
      closed = true;
      if (save && inp.value.trim()) {
        await anyClient().sessions.rename(slot, inp.value.trim());
        await refreshLabels();
      }
      renderSessMenu();
    };
    inp.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.isComposing || ev.keyCode === 229) return;
      if (ev.key === "Enter") done(true);
      else if (ev.key === "Escape") done(false);
    });
    inp.addEventListener("click", (ev) => ev.stopPropagation());
    inp.addEventListener("blur", () => done(false));
  }

  // 삭제는 두 번 클릭 — 첫 클릭이 무장, 2.5초 뒤 자동 해제 (모달 없는 파괴 확인)
  function confirmDelete(btn, slot) {
    if (btn.getAttribute("data-armed")) {
      deleteSession(slot).then(() => renderSessMenu());
      return;
    }
    btn.setAttribute("data-armed", "1");
    btn.textContent = "삭제?";
    setTimeout(() => {
      if (btn.isConnected) {
        btn.removeAttribute("data-armed");
        btn.textContent = "삭제";
      }
    }, 2500);
  }

  // ── 셸 클릭 배선 ──────────────────────────────────────────────────────
  root.addEventListener("click", (ev) => {
    const t = ev.target;
    const hit = t.closest ? t.closest("[data-a]") : null;
    const a = hit && hit.getAttribute("data-a");
    // 드로어 안의 버튼이 클릭 처리 중 목록을 다시 그리면 t 는 이미 분리돼 있다 —
    // 그건 바깥 클릭이 아니다 (isConnected 가 아니면 판정하지 않는다)
    if (!sess.hidden && t.isConnected && !sess.contains(t) && a !== "sess") sess.hidden = true;
    if (t.classList && t.classList.contains("rw-fab")) {
      setOpen(!panel.classList.contains("open"));
      if (panel.classList.contains("open") && panes.has(active)) panes.get(active).focus();
    } else if (a === "close") {
      setOpen(false);
    } else if (a === "new") newTab();
    else if (a === "set") {
      const pane = panes.get(active);
      if (pane) setBtn.textContent = pane.toggleSettings() ? "대화로" : "설정";
    } else if (a === "sess") {
      sess.hidden = !sess.hidden;
      if (!sess.hidden) renderSessMenu();
    }
  });

  // ── pane — 세션 하나의 전체 UI. 탭이 열려 있는 동안 살아 있다 ───────────
  function createPane(slot) {
    const client = createChat({ pkg: opts.pkg, slot, agent: opts.agent });

    const el = document.createElement("div");
    el.className = "rw-pane";
    el.innerHTML = `
    <div class="rw-cap"><span class="rw-cap-t"></span><span class="rw-sp"></span><button class="rw-cap-x" type="button">분할 해제</button></div>
    <div class="rw-log"></div>
    <div class="rw-set"></div>
    <div class="rw-sug"></div>
    <div class="rw-att"></div>
    <div class="rw-in">
      <div class="rw-in-top">
        <button class="rw-agpill" data-a="agent" style="display:none"><i></i><span class="ag-name"></span><em>▾</em></button>
        <div class="rw-ag-menu" hidden></div>
      </div>
      <div class="rw-in-row">
        <button class="rw-pick" data-a="pick" title="파일 첨부"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M21 12.5l-8.6 8.6a5.5 5.5 0 01-7.8-7.8l9-9a3.7 3.7 0 015.2 5.2l-8.8 8.8a1.85 1.85 0 01-2.6-2.6l8.1-8.1"/></svg></button>
        <textarea rows="1" placeholder="여기에 메시지를 입력하세요"></textarea>
        <button class="rw-send" data-a="send" title="전송">↑</button>
      </div>
      <div class="rw-in-foot">
        <span class="rw-eff" style="display:none"><span class="rw-eff-lb">노력 (<b class="ef-cur">기본</b>)</span><span class="rw-eff-dots"></span></span>
        <button class="rw-modelbtn" data-a="pset" title="모델 설정">모델 <b class="md-cur">기본</b></button>
        <span class="rw-ring"><svg viewBox="0 0 20 20"><circle class="rg-bg" cx="10" cy="10" r="8"/><circle class="rg-arc" cx="10" cy="10" r="8"/></svg><b class="rg-pct"></b></span>
      </div>
    </div>
    <input type="file" multiple hidden>`;

    const log = el.querySelector(".rw-log");
    const set = el.querySelector(".rw-set");
    const sug = el.querySelector(".rw-sug");
    const input = el.querySelector(".rw-in textarea");
    // 입력창 높이는 내용이 정한다. 값을 코드로 바꾼 자리에서도 반드시 다시 재야 한다
    function grow() {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 168) + "px";
    }
    const att = el.querySelector(".rw-att");
    const fileInput = el.querySelector('input[type="file"]');

    // 빈 로그 = 빈 시작 화면(greeting). 메시지가 생기면 사라진다
    let empty = null;
    let running = null;
    // 실황 말풍선의 상태는 DOM 밖에도 남긴다 — 세션 전환·이력 재적재가 로그를 다시 그리면
    // (redraw) 말풍선이 통째로 날아가는데, busy 는 큐가 빌 때까지 한 번만 켜지므로 되살릴
    // 이벤트가 없다. 그러면 턴이 끝날 때까지 진행 표시가 영영 안 돌아온다
    let runLabel = "일하는 중";
    let procLines = [];
    // 줄 세운 사용자 말풍선들 — core 의 turn(다음 항목 시작) 신호마다 앞에서 하나씩 푼다
    let markQueued = false;
    let queuedEls = [];
    function syncEmpty(greeting) {
      if (client.history.length === 0 && !client.busy) {
        if (!empty) {
          empty = document.createElement("div");
          empty.className = "rw-empty";
          empty.innerHTML = `<i>✳</i><span>${esc(greeting || "무엇이든 물어보세요")}</span>`
            + '<span class="rw-hint">사진·파일은 붙여넣기(⌘V) · 드래그앤드롭 · 클립 단추로 첨부됩니다</span>';
          log.appendChild(empty);
        } else if (greeting) {
          // 기본 문구로 먼저 그려진 뒤 meta 가 늦게 도착해도 선언된 인사말이 이긴다
          empty.querySelector("span").textContent = greeting;
        }
      } else if (empty) {
        empty.remove();
        empty = null;
      }
    }

    function draw(m) {
      syncEmpty();
      const msgEl = document.createElement("div");
      msgEl.className = "rw-msg " + (m.role === "user" ? "u" : m.role === "bot" ? "b" : "s");
      if (m.role === "bot") msgEl.innerHTML = mdRender(m.text);
      else msgEl.textContent = m.text;
      if (Array.isArray(m.files) && m.files.length) {
        const row = document.createElement("div");
        row.className = "rw-files";
        for (const f of m.files) row.appendChild(fileNode(f.path, f.name));
        msgEl.appendChild(row);
      }
      if (m.role === "bot") probeFileLinks(msgEl, m.text);
      // 대기 표시는 이 말풍선을 만든 send() 가 켜 둔다 — client.send 가 push→emit→draw 를
      // 동기로 도는 덕에 "방금 그린 말풍선"이 곧 이 요소다
      if (m.role === "user" && markQueued) {
        msgEl.classList.add("q");
        queuedEls.push(msgEl);
      }
      log.appendChild(msgEl);
      // 대기 중 보낸 메시지는 실황 말풍선보다 뒤에 그려진다 — 말풍선을 다시 끝으로 옮겨
      // 진행 표시가 항상 마지막에 오게 한다(순서가 뒤집히면 지난 일처럼 보인다)
      if (running) log.appendChild(running);
      log.scrollTop = log.scrollHeight;
    }

    // 파일 한 개의 표시 노드 — 이미지는 썸네일로, 그 외는 이름 링크로 (클릭 = 다운로드)
    function fileNode(p, name) {
      const a = document.createElement("a");
      a.href = client.fileUrl(p, true);
      a.title = p;
      if (IMG_RE.test(p)) {
        a.className = "rw-fileimg";
        const img = document.createElement("img");
        img.src = client.fileUrl(p);
        img.alt = name || p;
        img.loading = "lazy";
        a.appendChild(img);
      } else {
        a.className = "rw-filelink";
        a.textContent = name || p.split("/").pop();
      }
      return a;
    }

    // 응답 본문에서 workspace 상대경로 후보를 찾아 실재하는 것만 다운로드 링크로 단다.
    // 판단은 HEAD 프로브가 한다 — 화면이 경로의 실재를 추측하지 않는다
    function probeFileLinks(msgEl, text) {
      const re = /(?:^|[\s("'\`])((?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9]{1,8})(?=$|[\s)"'\`.,])/g;
      const cands = [];
      let match;
      while ((match = re.exec(text)) && cands.length < 4) {
        if (!cands.includes(match[1])) cands.push(match[1]);
      }
      if (!cands.length) return;
      Promise.all(
        cands.map((p) => fetch(client.fileUrl(p), { method: "HEAD" }).then((r) => (r.ok ? p : null)).catch(() => null)),
      ).then((hits) => {
        const ok = hits.filter(Boolean);
        if (!ok.length || !msgEl.isConnected) return;
        const row = document.createElement("div");
        row.className = "rw-files";
        for (const p of ok) row.appendChild(fileNode(p));
        msgEl.appendChild(row);
        log.scrollTop = log.scrollHeight;
      });
    }

    // ── 첨부 컴포저 — 파일선택·드래그·붙여넣기 전부 바이트로 환원해 업로드 ──
    let pendingAtts = [];

    function renderAtt() {
      att.classList.toggle("has", pendingAtts.length > 0);
      att.innerHTML = pendingAtts
        .map((a, i) =>
          `<span class="rw-chipf${a.error ? " err" : ""}">${a.thumb ? `<img src="${a.thumb}" alt="">` : ""}<b>${esc(a.name)}</b><i>${a.error ? esc(a.error) : a.path ? fmtSize(a.size) : a.pct + "%"}</i><button data-rm="${i}" title="제거">x</button></span>`)
        .join("");
      att.querySelectorAll("button[data-rm]").forEach((b) =>
        b.addEventListener("click", () => {
          const [gone] = pendingAtts.splice(Number(b.getAttribute("data-rm")), 1);
          if (gone && gone.thumb) URL.revokeObjectURL(gone.thumb);
          renderAtt();
        }));
    }

    async function addFiles(files) {
      for (const f of Array.from(files || [])) {
        // 이미지는 칩에 미리보기를 함께 그린다 — 캡쳐가 "들어갔다"는 확인이 눈에 보여야 한다
        const entry = {
          name: f.name || "file", size: f.size, pct: 0,
          thumb: f.type && f.type.startsWith("image/") ? URL.createObjectURL(f) : null,
        };
        pendingAtts.push(entry);
        renderAtt();
        const r = await client.upload(f, (pct) => {
          entry.pct = pct;
          renderAtt();
        });
        if (r.error) entry.error = r.error.message;
        else {
          entry.path = r.path;
          entry.name = r.name;
          entry.size = r.size;
        }
        renderAtt();
      }
    }
    // 이력 복원은 로그 전체를 다시 그린다
    let metaGreeting = "";
    let metaAgents = [];
    let pillAgent = null;
    function redraw() {
      log.innerHTML = "";
      empty = null;
      running = null;
      queuedEls = []; // 말풍선 요소가 통째로 버려졌다 — 대기 표시는 아래에서 이력으로 다시 못 살린다
      syncEmpty(metaGreeting);
      for (const m of client.history) draw(m);
      // 로그를 다시 그렸어도 턴은 계속 돌고 있다 — 진행 표시를 되살린다(라벨·실황 줄 보존)
      if (client.busy) showRunning();
      // 게이지는 이 세션의 마지막 봉투 장부를 따른다 — 이력에도 usage 가 앉아 있다
      const last = [...client.history].reverse().find((m) => m.role === "bot" && m.usage);
      setGauge(last ? last.usage : null, last ? last.model : null);
      // 게이지가 못 그려도(usage 없음) 실제 모델은 알아야 한다 — 고른 값이 먹었는지의 유일한 증거다
      const lastM = [...client.history].reverse().find((m) => m.role === "bot" && m.model);
      if (lastM) setModelLabel(null, lastM.model);
    }
    for (const m of client.history) draw(m);
    client.on("message", draw);
    client.on("history", redraw);
    client.on("session", redraw);
    client.on("reset", redraw);

    // 실황 말풍선을 로그 끝에 세운다. 이미 서 있으면 그대로 둔다 — 재적재(redraw) 뒤에도
    // 같은 함수로 되살아나므로 라벨과 지금까지 쌓인 실황 줄이 그대로 복원된다
    function showRunning() {
      if (running) return;
      syncEmpty();
      running = document.createElement("div");
      running.className = "rw-running";
      // 실황 로그가 먼저, 지금 무엇을 하는지는 그 아래. 로그는 아래로 자라므로
      // 가장 최근 줄과 상태 표시가 맞닿아야 눈이 한 곳만 본다
      running.innerHTML = '<div class="rw-proc"></div><div class="rw-head"><span class="rw-dots"><i></i><i></i><i></i></span><span class="tx"></span><button class="rw-stop" type="button">중지</button></div>';
      running.querySelector(".tx").textContent = runLabel;
      running.querySelector(".rw-stop").addEventListener("click", () => {
        runLabel = "중지하는 중...";
        running.querySelector(".tx").textContent = runLabel;
        client.cancel();
      });
      const proc = running.querySelector(".rw-proc");
      for (const [cls, text] of procLines) {
        const d = document.createElement("div");
        d.className = cls;
        d.textContent = text;
        proc.appendChild(d);
      }
      log.appendChild(running);
      log.scrollTop = log.scrollHeight;
    }

    client.on("busy", (b) => {
      if (b) showRunning();
      else if (running) {
        running.remove();
        running = null;
        runLabel = "일하는 중";
        procLines = [];
        // 큐가 다 빠졌으니 남은 대기 표시도 없다(있다면 신호를 놓친 것 — 여기서 정리한다)
        for (const qEl of queuedEls) qEl.classList.remove("q");
        queuedEls = [];
      }
    });

    // 큐의 다음 항목이 실제로 발사됐다 — 가장 오래 기다린 말풍선의 대기 표시를 푼다
    client.on("turn", () => {
      const qEl = queuedEls.shift();
      if (qEl) qEl.classList.remove("q");
    });

    // 봉투 진행 이벤트 → 일하는 과정의 실황 로그: 중간 서술(delta)과 도구 호출을
    // 대기 말풍선 안에 줄로 쌓는다. 헤매는 과정까지 그대로 보이는 것이 의도다.
    // 턴이 끝나면 말풍선째 사라지고 최종 응답만 이력에 남는다 (정본은 events.jsonl)
    client.on("progress", (ev) => {
      if (!running) return;
      const tx = running.querySelector(".tx");
      const proc = running.querySelector(".rw-proc");
      if (!tx || !proc) return;
      const line = (cls, text) => {
        // 로그가 자라는 동안 사용자가 위를 읽고 있을 수 있다. 바닥에 붙어 있을 때만 따라 내린다
        const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
        // delta 는 문장 중간에서 잘린 조각으로 온다. 조각마다 div 를 만들면 한 문장이
        // 여러 줄로 쪼개지고 조각 앞의 공백이 들여쓰기처럼 보인다 — 직전 줄이 같은
        // delta 면 그 문단에 이어 붙여서 원래 문장 흐름을 되살린다
        const last = proc.lastElementChild;
        if (cls === "pv-delta" && last && last.className === "pv-delta") {
          last.textContent += text;
          if (procLines.length) procLines[procLines.length - 1][1] = last.textContent;
        } else {
          // 문단 첫 조각의 앞 공백·줄바꿈은 pre-wrap 에서 들여쓰기로 보인다. 문단 머리에서만 턴다
          const head = cls === "pv-delta" ? text.replace(/^\s+/, "") : text;
          if (!head) return;
          const d = document.createElement("div");
          d.className = cls;
          d.textContent = head;
          proc.appendChild(d);
          procLines.push([cls, head]);
        }
        if (stick) log.scrollTop = log.scrollHeight;
      };
      // 라벨도 DOM 밖에 남긴다 — 재적재 뒤 되살아난 말풍선이 같은 문구로 이어지게
      const setLabel = (t) => { runLabel = t; tx.textContent = t; };
      if (ev.event === "tool" && ev.status === "start") {
        setLabel(ev.name + " 실행 중");
        line("pv-tool", "▸ " + ev.name + (ev.detail ? " · " + String(ev.detail).slice(0, 120) : ""));
      } else if (ev.event === "tool" && ev.status === "end") {
        setLabel("일하는 중");
      } else if (ev.event === "delta" && ev.text) {
        line("pv-delta", String(ev.text));
      }
    });

    // 컨텍스트 게이지 — 봉투 reply 의 usage {input, context_window} 를 컴포저 링으로 그린다
    const ring = el.querySelector(".rw-ring");
    const ringArc = ring.querySelector(".rg-arc");
    const RING_C = 2 * Math.PI * 8;
    function setGauge(usage, model) {
      if (!usage || !usage.input || !usage.context_window) {
        ring.classList.remove("has");
        return;
      }
      const pct = Math.min(100, Math.round((usage.input / usage.context_window) * 100));
      ringArc.setAttribute("stroke-dasharray", ((RING_C * pct) / 100).toFixed(1) + " " + RING_C.toFixed(1));
      ring.querySelector(".rg-pct").textContent = pct + "%";
      ring.title = (model ? model + " · " : "") + usage.input.toLocaleString() + " / " + usage.context_window.toLocaleString() + " 토큰";
      ring.classList.add("has");
      if (model) setModelLabel(null, model);
    }
    client.on("usage", (u) => setGauge(u.usage, u.model));

    // 모델 라벨: 사용자가 고른 모델 > 마지막 턴의 실제 모델 > 기본. 날짜 꼬리는 잘라 읽기 좋게
    const mdCur = el.querySelector(".md-cur");
    let pickedModel = null;
    let actualModel = null; // 마지막 턴에 본류가 실제로 말한 모델 — 고른 값이 먹었는지의 증거
    function setModelLabel(picked, actual) {
      if (picked !== null) pickedModel = picked || null;
      if (actual) actualModel = actual;
      mdCur.textContent = pickedModel ? shortModel(pickedModel) : actualModel ? shortModel(actualModel) : "기본";
      mdCur.parentElement.title = "모델 설정 · " + (actualModel
        ? "마지막 응답 실제 모델: " + actualModel + (modelMatches(pickedModel, actualModel) ? "" : " — 고른 값과 다릅니다")
        : "아직 응답이 없어 실제 모델을 모릅니다");
    }

    // Effort 도트 — capabilities 에 effort 를 선언한 어댑터만 노출. 켜진 도트 재클릭 = 어댑터 기본
    const effEl = el.querySelector(".rw-eff");
    const effCur = el.querySelector(".ef-cur");
    const effDots = el.querySelector(".rw-eff-dots");
    let effortNow = null;
    function renderEffort() {
      effCur.textContent = (EFFORTS.find(([v]) => v === effortNow) || [null, null, "기본"])[2];
      effDots.innerHTML = EFFORTS.map(([v, s]) =>
        `<button type="button" class="rw-eff-d${effortNow === v ? " on" : ""}" data-eff="${v}" title="${v}"><i></i><b>${s}</b></button>`).join("");
      effDots.querySelectorAll("[data-eff]").forEach((b) => {
        b.addEventListener("click", async () => {
          const v = b.getAttribute("data-eff");
          const out = await client.harness.setEffort(effortNow === v ? null : v);
          if (!out.error) {
            effortNow = out.effort || null;
            renderEffort();
          }
        });
      });
    }

    client.meta().then((m) => {
      if (!m.chat || m.chat.mode === "none") {
        onMeta(m);
        draw({ role: "sys", text: "chat 표면이 없는 패키지입니다" });
        return;
      }
      metaGreeting = m.greeting;
      metaAgents = Array.isArray(m.agents) ? m.agents : [];
      if (metaAgents.length > 1) input.placeholder = "여기에 메시지를 입력하세요 — @로 에이전트 지정";
      // 컴포저 pill: 이 대화가 착지하는 에이전트. 목록이 여럿이면 드롭다운이 된다
      pillAgent = m.agent || null;
      const pill = el.querySelector(".rw-agpill");
      pill.querySelector(".ag-name").textContent = pillAgent || m.display_name;
      pill.querySelector("em").style.display = metaAgents.length > 1 ? "" : "none";
      pill.style.display = "";
      setModelLabel(m.model || null, null);
      effortNow = m.effort || null;
      if (m.harness) {
        // effort 노출 판정은 어댑터 info 1회로 (probe 전수 실행은 설정 시트 몫)
        client.harness.info().then((info) => {
          const caps = info && info.ok && info.value && Array.isArray(info.value.capabilities) ? info.value.capabilities : [];
          if (caps.includes("effort")) {
            renderEffort();
            effEl.style.display = "";
          }
        });
      }
      syncEmpty(m.greeting);
      onMeta(m);
    });

    // 셸에 meta 도착을 알린다 — 헤더 제목·설정 버튼 노출·chat 표면 유무 판정은 셸 몫
    let onMeta = () => {};

    // 에이전트 드롭다운 — pill 위로 열린다. 선택은 이후 메시지의 착지 오버라이드
    const agMenu = el.querySelector(".rw-ag-menu");
    function renderAgMenu() {
      agMenu.innerHTML = metaAgents.map((a) =>
        `<button type="button" class="${pillAgent === a ? "on" : ""}" data-agpick="${esc(a)}">${esc(a)}</button>`).join("");
      agMenu.querySelectorAll("[data-agpick]").forEach((b) => {
        b.addEventListener("click", () => {
          pillAgent = b.getAttribute("data-agpick");
          el.querySelector(".rw-agpill .ag-name").textContent = pillAgent;
          agMenu.hidden = true;
        });
      });
    }

    function send() {
      const t = input.value.trim();
      const atts = pendingAtts.filter((a) => a.path).map((a) => ({ path: a.path, name: a.name }));
      if (!t && !atts.length) return;
      if (pendingAtts.some((a) => !a.path && !a.error)) return; // 업로드 진행 중 — 완료 후 전송
      input.value = "";
      grow();
      for (const a of pendingAtts) if (a.thumb) URL.revokeObjectURL(a.thumb); // 말풍선 썸네일은 서버 사본으로 그린다
      pendingAtts = [];
      renderAtt();
      sug.classList.remove("open");
      // 선두 @에이전트 = 이 메시지의 착지 오버라이드 > pill 선택. 말풍선은 멘션 포함 원문으로 남긴다
      const mm = t.match(/^@([a-z0-9-]+)\s+(.+)$/s);
      // 이미 일하는 중이면 이 메시지는 줄을 선다 — 그 사실을 말풍선에 적기 위해 draw 에 알린다
      markQueued = client.busy;
      try {
        if (mm && metaAgents.includes(mm[1])) client.send(mm[2], { attachments: atts, agent: mm[1], display: t });
        else if (pillAgent) client.send(t, { attachments: atts, agent: pillAgent });
        else client.send(t, { attachments: atts });
      } finally {
        markQueued = false;
      }
    }

    let inSet = false;
    function toggleSettings() {
      inSet = !inSet;
      el.classList.toggle("setting", inSet);
      if (inSet) renderSettings();
      return inSet;
    }

    // headless 로그인 중계 화면 — pty 출력을 그대로 보여주고 입력을 stdin 으로 넣는다.
    // 토큰·코드는 화면을 지나가지만 어디에도 저장하지 않는다 (자격은 도구가 만든다)
    function openLoginPane(afterEl) {
      const pane = document.createElement("div");
      pane.className = "rw-login-pane";
      pane.innerHTML = '<pre class="rw-login-out">로그인 시작 중...</pre>'
        + '<div class="rw-login-in"><input placeholder="여기에 코드나 답을 입력하고 Enter"><button type="button">중단</button></div>';
      afterEl.insertAdjacentElement("afterend", pane);
      const outEl = pane.querySelector(".rw-login-out");
      const inEl = pane.querySelector("input");
      const stopBtn = pane.querySelector("button");
      let from = 0;
      let first = true;
      const linkify = (t) => esc(t).replace(/(https?:\/\/[^\s"'<>]+)/g, '<a href="$1" target="_blank" rel="noreferrer">$1</a>');
      const timer = setInterval(async () => {
        const r = await client.harness.loginRead(from);
        if (r.error) return;
        if (r.lines.length) {
          if (first) { outEl.textContent = ""; first = false; }
          outEl.innerHTML += linkify(r.lines.join("\n") + "\n");
          outEl.scrollTop = outEl.scrollHeight;
        }
        from = r.from;
        if (r.done) {
          clearInterval(timer);
          outEl.innerHTML += `<b>${r.code === 0 ? "로그인 종료 (성공)" : "로그인 종료 (코드 " + r.code + ")"}</b>\n`;
          inEl.disabled = true;
          stopBtn.textContent = "닫기";
          stopBtn.onclick = () => { pane.remove(); renderSettings(); };
        }
      }, 700);
      const submit = () => {
        const v = inEl.value;
        inEl.value = "";
        client.harness.loginInput(v);
      };
      inEl.addEventListener("keydown", (ev) => { if (ev.key === "Enter") submit(); });
      stopBtn.addEventListener("click", () => {
        if (inEl.disabled) return;
        client.harness.loginStop();
      });
      inEl.focus();
    }

    async function renderSettings() {
      set.innerHTML = '<div class="rw-note">불러오는 중...</div>';
      // probe = variant 전수 실행. 행별 준비 상태·계정·capabilities 가 실려 setup/info 개별 호출을 대체한다
      const [models, hv, m] = await Promise.all([
        client.harness.models(),
        client.harness.variants(true),
        client.meta(),
      ]);
      const secs = [];
      let micHtml = ""; // 모델 행 아이콘 — 직접 입력으로 새 행을 만들 때 같은 모양을 쓴다

      const hs = [];
      const assetU = (relPath) => "/pkg/" + encodeURIComponent(client.pkg) + "/asset/" + relPath;
      const av = !hv.error && Array.isArray(hv.variants) ? hv.variants.find((v) => v.name === hv.active) : null;
      if (!hv.error && Array.isArray(hv.variants) && hv.variants.length) {
        // providers 리스트 패턴: 행 = 아이콘 + 제목/부제, 우측 선택 링
        const row = (v) => {
          const state = v.ready != null ? (v.ready ? " · 준비됨" : " · 준비 안 됨") : "";
          const acct = v.account && v.account.email ? " · " + v.account.email + (v.account.plan ? " (" + v.account.plan + ")" : "") : "";
          return `<div class="rw-lvrow${hv.active === v.name ? " on" : ""}" data-hv="${esc(v.name)}">
             <span class="rw-lvic">${v.icon ? `<img src="${esc(assetU(v.icon))}" alt="">` : esc(v.name.slice(0, 1).toUpperCase())}</span>
             <span class="rw-lvtx"><b>${esc(v.name)}</b><span>${esc((v.provider ?? "자체 로그인") + state + acct)}</span></span>
             <span class="rw-lvring"></span></div>`;
        };
        hs.push(`<div class="rw-lv">${hv.variants.map(row).join("")}</div>`);
      }
      if (hv.error) hs.push(`<div class="rw-err">${esc(hv.error.message)}</div>`);
      else if (av && av.ready === false) {
        hs.push(`<div class="rw-err">${esc(av.note || "준비 안 됨")}</div>`);
        // no-tool 이면 처방은 설치다 — note 가 이미 설치 명령을 담고 있으니 입력창·로그인 안내를 띄우지 않는다
        if (av.reason === "no-tool") { /* note 만으로 충분 */ }
        else if (av.auth === "token") {
          // token 자격형은 웹에서 연결된다 — vault 에 provider 소속으로 앉는다
          hs.push(`<div class="rw-mfree rw-tok"><input type="password" placeholder="${esc((av.provider || "provider") + " API 토큰 붙여넣기")}"><button type="button">연결</button></div>`);
        } else if (av.login) {
          // 대화형 로그인: 인증은 터미널(TTY)이 소유하지만 그 창을 여는 것은 기판이 한다
          hs.push('<button class="rw-recheck rw-login" type="button">로그인</button><div class="rw-note rw-lnote"></div>');
        }
      } else if (av && av.ready) {
        hs.push(`<div class="rw-ok">준비됨${av.note ? " · " + esc(av.note) : ""}</div>`);
        // 준비됐다고 자격이 잠기면 안 된다 — 계정 전환·토큰 교체는 상시 열려 있어야 한다
        if (av.login) {
          hs.push('<button class="rw-recheck rw-login" type="button">계정 전환</button><div class="rw-note rw-lnote">다른 계정으로 다시 로그인합니다</div>');
        } else if (av.auth === "token") {
          hs.push(`<div class="rw-mfree rw-tok"><input type="password" placeholder="${esc((av.provider || "provider") + " 토큰 교체")}"><button type="button">교체</button></div>`);
        }
      }
      hs.push('<div class="rw-note rw-hsave"></div><button class="rw-recheck" type="button">다시 점검</button>');
      hs.push(`<div class="rw-note">세션 slot: ${esc(client.slot)}</div>`);
      secs.push(`<div class="rw-sec"><div class="rw-lb">하네스</div>${hs.join("")}</div>`);

      if (models.error) {
        secs.push(`<div class="rw-sec"><div class="rw-lb">모델</div><div class="rw-err">${esc(models.error.message)}</div></div>`);
      } else {
        const cur = models.current || "";
        const mic = av && av.llm_icon ? `<span class="rw-lvic"><img src="${esc(assetU(av.llm_icon))}" alt=""></span>` : "";
        micHtml = mic;
        const row = (v, title, sub) =>
          `<div class="rw-lvrow${cur === v ? " on" : ""}" data-mv="${esc(v)}">
             ${mic}<span class="rw-lvtx"><b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ""}</span>
             <span class="rw-lvring"></span></div>`;
        const rows = [
          row("", "어댑터 기본", "모델 지정 없음"),
          ...models.models.map((x) => row(x, x, "")),
          ...(cur && !models.models.includes(cur) ? [row(cur, cur, "직접 입력됨")] : []),
          '<div class="rw-lvrow rw-lvadd" data-mfree="1"><b>+</b> 직접 입력</div>',
        ].join("");
        // 저장 상태는 클릭 전에도 보여야 한다 — 장부(ledger)에 박힌 값이 곧 다음 세션의 --model 이다.
        // 실제로 무엇이 답했는지는 마지막 턴의 본류 모델로만 증명된다
        const saved = `저장됨: ${cur || "어댑터 기본"} · 다음 응답부터 적용`;
        const act = actualModel
          ? `<div class="rw-note">마지막 응답 실제 모델: ${esc(actualModel)}${modelMatches(cur, actualModel) ? "" : " — 고른 값과 다릅니다"}</div>`
          : "";
        secs.push(`<div class="rw-sec"><div class="rw-lb">모델</div><div class="rw-lv">${rows}</div><div class="rw-note rw-msave">${esc(saved)}</div>${act}</div>`);
      }

      // 추론 강도 — capabilities 에 effort 를 선언한 어댑터만. RELAY_EFFORT 로 전달된다
      if (av && Array.isArray(av.capabilities) && av.capabilities.includes("effort")) {
        const cur = m.effort || "";
        const levels = [["", "어댑터 기본"], ["low", "Low"], ["medium", "Medium"], ["high", "High"], ["xhigh", "XHigh"], ["max", "Max"]];
        const rows = levels.map(([v, label]) =>
          `<div class="rw-lvrow${cur === v ? " on" : ""}" data-ev="${esc(v)}">
             <span class="rw-lvtx"><b>${esc(label)}</b></span><span class="rw-lvring"></span></div>`).join("");
        const esaved = `저장됨: ${cur || "어댑터 기본"} · 다음 응답부터 적용`;
        secs.push(`<div class="rw-sec"><div class="rw-lb">추론 강도</div><div class="rw-lv">${rows}</div><div class="rw-note rw-esave">${esc(esaved)}</div></div>`);
      }

      set.innerHTML = secs.join("");

      set.querySelectorAll("[data-hv]").forEach((r) => {
        r.addEventListener("click", async () => {
          if (r.classList.contains("on")) return;
          const note = set.querySelector(".rw-hsave");
          if (note) note.textContent = "전환 중...";
          const out = await client.harness.setVariant(r.getAttribute("data-hv"));
          if (out.error) {
            if (note) note.textContent = "실패: " + out.error.message;
            return;
          }
          renderSettings();
        });
      });
      const recheck = set.querySelector(".rw-recheck");
      if (recheck) recheck.addEventListener("click", () => renderSettings());

      const lg = set.querySelector(".rw-login");
      if (lg) {
        lg.addEventListener("click", async () => {
          const note = set.querySelector(".rw-lnote");
          const sw = lg.textContent === "계정 전환";
          if (note) note.textContent = "로그인 시작...";
          const out = await client.harness.login({ switch: sw });
          if (out.error) {
            if (note) note.textContent = "실패: " + out.error.message;
            return;
          }
          if (out.mode === "terminal") {
            if (note) note.textContent = out.launched ? "터미널 창에서 마친 뒤 다시 점검" : (out.note || "") + " — " + (out.command || "");
            return;
          }
          if (note) note.textContent = "";
          openLoginPane(lg);
        });
      }

      const tok = set.querySelector(".rw-tok");
      if (tok) {
        const inp = tok.querySelector("input");
        const connect = async () => {
          if (!inp.value.trim()) return;
          const note = set.querySelector(".rw-hsave");
          if (note) note.textContent = "연결 중...";
          const out = await client.harness.connect(inp.value.trim());
          if (out.error) {
            if (note) note.textContent = "실패: " + out.error.message;
            return;
          }
          renderSettings();
        };
        tok.querySelector("button").addEventListener("click", connect);
        inp.addEventListener("keydown", (ev) => {
          if (ev.isComposing || ev.keyCode === 229) return;
          if (ev.key === "Enter") connect();
        });
      }

      // 선택 = 즉시 저장(장부 기록)이다. 저장 뒤 시트를 통째로 다시 그리면 하네스 전수 probe 가
      // 딸려 와 클릭마다 수 초 로딩이 걸리고, 방금 띄운 "저장됨" 문구까지 지워진다.
      // 모델·강도는 하네스 준비 상태를 바꾸지 않으므로 선택 표시만 그 자리에서 옮긴다
      const markPicked = (rows, hit) => rows.forEach((x) => x.classList.toggle("on", x === hit));

      const mvRows = [...set.querySelectorAll("[data-mv]")];
      const bindModelRow = (r, already = false) => {
        if (!already) mvRows.push(r);
        r.addEventListener("click", async () => {
          if (r.classList.contains("on")) return;
          const note = set.querySelector(".rw-msave");
          if (note) note.textContent = "저장 중...";
          const out = await client.harness.setModel(r.getAttribute("data-mv") || null);
          if (note) {
            note.textContent = out.error ? "실패: " + out.error.message
              : out.known === false ? "저장됨: " + out.model + " · 어댑터 목록에 없는 모델 — 세션에서 거부될 수 있습니다"
              : "저장됨: " + (out.model || "어댑터 기본") + " · 다음 응답부터 적용";
          }
          if (!out.error) {
            setModelLabel(out.model || null, null);
            markPicked(mvRows, r);
          }
        });
      };
      mvRows.forEach((r) => bindModelRow(r, true));

      const evRows = [...set.querySelectorAll("[data-ev]")];
      evRows.forEach((r) => {
        r.addEventListener("click", async () => {
          if (r.classList.contains("on")) return;
          const note = set.querySelector(".rw-esave");
          if (note) note.textContent = "저장 중...";
          const out = await client.harness.setEffort(r.getAttribute("data-ev") || null);
          if (note) note.textContent = out.error ? "실패: " + out.error.message
            : "저장됨: " + (out.effort || "어댑터 기본") + " · 다음 응답부터 적용";
          if (!out.error) {
            effortNow = out.effort || null;
            renderEffort();
            markPicked(evRows, r);
          }
        });
      });
      function bindFree(mfreeRow) {
        if (!mfreeRow) return;
        mfreeRow.addEventListener("click", () => {
          const wrap = document.createElement("div");
          wrap.className = "rw-mfree";
          wrap.innerHTML = '<input placeholder="모델 ID 직접 입력"><button type="button">적용</button>';
          mfreeRow.replaceWith(wrap);
          const inp = wrap.querySelector("input");
          const applyFree = async () => {
            const v = inp.value.trim();
            if (!v) return;
            const note = set.querySelector(".rw-msave");
            if (note) note.textContent = "저장 중...";
            const out = await client.harness.setModel(v);
            if (note) {
              note.textContent = out.error ? "실패: " + out.error.message
                : out.known === false ? "저장됨: " + (out.model || v) + " · 어댑터 목록에 없는 모델 — 세션에서 거부될 수 있습니다"
                : "저장됨: " + (out.model || v) + " · 다음 응답부터 적용";
            }
            if (out.error) return;
            setModelLabel(out.model || null, null);
            // 새 값은 목록에 없던 행이다 — 전체를 다시 그리는 대신 그 자리에 행 하나를 세운다
            const picked = out.model || v;
            const rowEl = document.createElement("div");
            rowEl.className = "rw-lvrow on";
            rowEl.setAttribute("data-mv", picked);
            rowEl.innerHTML = `${micHtml}<span class="rw-lvtx"><b>${esc(picked)}</b><span>직접 입력됨</span></span><span class="rw-lvring"></span>`;
            mvRows.forEach((x) => x.classList.remove("on"));
            wrap.replaceWith(rowEl);
            bindModelRow(rowEl);
            rowEl.insertAdjacentHTML("afterend", '<div class="rw-lvrow rw-lvadd" data-mfree="1"><b>+</b> 직접 입력</div>');
            bindFree(rowEl.nextElementSibling);
          };
          wrap.querySelector("button").addEventListener("click", applyFree);
          inp.addEventListener("keydown", (ev) => {
            if (ev.isComposing || ev.keyCode === 229) return;
            if (ev.key === "Enter") applyFree();
            if (ev.key === "Escape") {
              const back = document.createElement("div");
              back.className = "rw-lvrow rw-lvadd";
              back.setAttribute("data-mfree", "1");
              back.innerHTML = "<b>+</b> 직접 입력";
              wrap.replaceWith(back);
              bindFree(back);
            }
          });
          inp.focus();
        });
      }
      bindFree(set.querySelector("[data-mfree]"));
    }

    el.addEventListener("click", (ev) => {
      const t = ev.target;
      // 버튼 안의 svg·텍스트가 클릭 대상이어도 데이터 액션은 조상에서 찾는다
      const hit = t.closest ? t.closest("[data-a]") : null;
      const a = hit && hit.getAttribute("data-a");
      if (!agMenu.hidden && !agMenu.contains(t) && a !== "agent") agMenu.hidden = true;
      if (a === "send") send();
      else if (a === "pick") fileInput.click();
      else if (a === "pset") {
        // 컴포저의 모델 라벨 → 이 pane 의 설정 시트로. 헤더 버튼 라벨은 활성 pane 의 것이다
        const on = toggleSettings();
        if (slot === active) setBtn.textContent = on ? "대화로" : "설정";
      } else if (a === "agent") {
        if (metaAgents.length > 1) {
          agMenu.hidden = !agMenu.hidden;
          if (!agMenu.hidden) renderAgMenu();
        }
      }
    });
    input.addEventListener("keydown", (ev) => {
      // IME 조립 중 Enter(한글 마지막 글자 확정)는 전송이 아니다 — 무시하지 않으면
      // 본문이 먼저 가고 조립 중이던 글자가 두 번째 전송으로 새어 나간다
      if (ev.isComposing || ev.keyCode === 229) return;
      if (ev.key !== "Enter") return;
      // shift+Enter 는 줄바꿈 — textarea 의 기본 동작에 맡기고 높이만 다시 잰다
      if (ev.shiftKey) return void setTimeout(grow, 0);
      ev.preventDefault(); // 전송할 때 줄바꿈이 남지 않도록
      send();
    });

    fileInput.addEventListener("change", () => {
      addFiles(fileInput.files);
      fileInput.value = "";
    });
    // 붙여넣기·드래그앤드롭은 셸의 문서 전역 입구가 받아 pane 으로 흘린다 — 입력창 포커스나
    // pane 위 커서를 요구하면 캡쳐 붙여넣기가 "안 들어가는" 것처럼 보인다 (아래 전역 배선 참조)

    input.addEventListener("input", async () => {
      grow();
      const v = input.value;
      // @ 멘션 제안 — 첫 공백 전까지만. 선택하면 선두에 박히고 send 가 라우팅한다
      if (v.startsWith("@") && !v.includes(" ")) {
        const q = v.slice(1).toLowerCase();
        const hits = metaAgents.filter((a) => a.toLowerCase().startsWith(q));
        sug.innerHTML = hits.map((a) =>
          `<button data-ag="${esc(a)}"><b>@${esc(a)}</b><span>이 메시지를 ${esc(a)} 에이전트에게</span></button>`).join("");
        sug.classList.toggle("open", hits.length > 0);
        sug.querySelectorAll("button[data-ag]").forEach((b) => {
          b.addEventListener("click", () => {
            input.value = "@" + b.getAttribute("data-ag") + " ";
            sug.classList.remove("open");
            grow();
            input.focus();
          });
        });
        return;
      }
      if (!v.startsWith("/")) return void sug.classList.remove("open");
      const { commands } = await client.harness.commands();
      const q = v.slice(1).toLowerCase();
      const hits = (commands || []).filter((c) => c.name.toLowerCase().startsWith(q));
      sug.innerHTML = hits.map((c) =>
        `<button data-cmd="${esc(c.name)}"${c.tty ? " disabled" : ""}><b>/${esc(c.name)}</b><span>${esc(c.description ?? "")}</span>${c.tty ? "<i>TTY 전용</i>" : ""}</button>`,
      ).join("");
      sug.classList.toggle("open", hits.length > 0);
      sug.querySelectorAll("button[data-cmd]:not([disabled])").forEach((b) => {
        b.addEventListener("click", () => {
          input.value = "/" + b.getAttribute("data-cmd") + " ";
          sug.classList.remove("open");
          grow();
          input.focus();
        });
      });
    });

    return {
      slot,
      el,
      client,
      addFiles,
      focus: () => input.focus(),
      toggleSettings,
      inSet: () => inSet,
      setCap: (label) => { el.querySelector(".rw-cap-t").textContent = label; },
      setOnMeta: (fn) => { onMeta = fn; },
    };
  }

  // ── 부팅 — 활성 pane 을 세우고, 첫 meta 로 셸(제목·설정 버튼·표면 유무)을 채운다 ──
  const firstPane = ensurePane(active);
  firstPane.setOnMeta((m) => {
    if (!m.found || !m.chat || m.chat.mode === "none") {
      // chat 표면이 없는 패키지 — float 은 위젯 자체를 접는다 (inline 은 pane 이 안내문을 그린다)
      if (mode === "float") root.remove();
      return;
    }
    root.querySelector(".rw-t").textContent = m.display_name;
    if (m.harness) setBtn.style.display = "";
  });
  if (split) ensurePane(split);
  layout();
  refreshLabels();

  return {
    client: firstPane.client,
    root,
    remove: () => {
      if (mode === "float") document.documentElement.style.paddingRight = "";
      window.removeEventListener("resize", applyWidth);
      document.removeEventListener("paste", docPaste);
      document.removeEventListener("dragenter", docDragEnter);
      document.removeEventListener("dragover", docDragOver);
      document.removeEventListener("dragleave", docDragLeave);
      document.removeEventListener("drop", docDrop);
      root.remove();
    },
  };
}

// 자동 마운트: 기판 자산(/assets)으로 로드된 경우에만. npm 임포트(번들) 소비자가
// 부유 위젯을 원치 않게 떠안지 않도록 로드 경로로 판별한다
const asSubstrateAsset = typeof window !== "undefined" && String(import.meta.url).includes("/assets/");
if (asSubstrateAsset) {
  const auto = location.pathname.match(/^\/pkg\/([^/]+)\/view/);
  if (auto && !window.RELAY_CHAT_MANUAL) {
    mount({ pkg: decodeURIComponent(auto[1]), mode: "float" });
  }
}
