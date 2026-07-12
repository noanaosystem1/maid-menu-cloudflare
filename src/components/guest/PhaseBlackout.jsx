// @ts-nocheck
import { useEffect, useState } from "react";
import { STORAGE_KEYS } from "@/lib/constants";

export default function PhaseBlackout({ token }) {
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    if (token) {
      localStorage.setItem(STORAGE_KEYS.BLACKOUT_LOCK(token), "true");
    }

    // Block navigation
    const blockNav = (e) => {
      e.preventDefault();
      e.returnValue = "";
      document.body.style.background = "#000";
      document.body.style.overflow = "hidden";
      return "";
    };

    const blockPopState = () => {
      window.history.pushState(null, "", window.location.href);
      document.body.style.background = "#000";
    };

    window.addEventListener("beforeunload", blockNav);
    window.addEventListener("popstate", blockPopState);

    // Block history traversal
    window.history.pushState(null, "", window.location.href);
    window.history.pushState(null, "", window.location.href);

    document.body.style.background = "#000";
    document.body.style.overflow = "hidden";

    // Animated hacker lockout console logs
    const possibleLogs = [
      "CRITICAL: SECURITY BREACH DETECTED...",
      "EXECUTING LOCKOUT PROTOCOL [10.19.4]",
      "DECRYPTING SECURE KERNEL ENVELOPE...",
      "FORCE SYSTEM OVERRIDE AT COMPONENT_ID: DO_SQLITE",
      "TERMINATING ACTIVE CLIENT SESSIONS...",
      "MEM_DUMP: BUFFER OVERFLOW IS IMMINENT",
      "HACKER COMPROMISED: PERMANENT ENCRYPT LOCKOUT ACTRESS_1",
      "DEVICE QUARANTINED SUCCESSFULLY.",
    ];

    let currentLogIndex = 0;
    const interval = setInterval(() => {
      if (currentLogIndex < possibleLogs.length) {
        setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${possibleLogs[currentLogIndex]}`]);
        currentLogIndex++;
      } else {
        clearInterval(interval);
      }
    }, 1200);

    return () => {
      window.removeEventListener("beforeunload", blockNav);
      window.removeEventListener("popstate", blockPopState);
      clearInterval(interval);
      document.body.style.background = "";
      document.body.style.overflow = "";
    };
  }, [token]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#000000",
        color: "#ff3333",
        zIndex: 99999,
        userSelect: "none",
        WebkitUserSelect: "none",
        pointerEvents: "all",
        fontFamily: "'Courier Prime', 'Courier New', monospace",
        padding: "2rem",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
      }}
      className="scanlines hack-vignette"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Glitchy Error Warning Block */}
      <div className="flex-1 flex flex-col items-center justify-center text-center max-w-lg mx-auto">
        <div className="w-20 h-20 mb-6 border-4 border-red-600 rounded-full flex items-center justify-center hack-border-flicker">
          <span className="text-red-500 text-5xl font-extrabold glitch-main">!</span>
        </div>

        <h1
          className="text-2xl font-bold tracking-widest text-red-500 mb-4 uppercase hack-text-bleed"
          data-text="SECURITY ALERT: SYSTEM LOCKED"
        >
          SECURITY ALERT: SYSTEM LOCKED
        </h1>

        <p className="text-red-500/80 text-xs mb-8 leading-relaxed font-mono-hack">
          この端末はシステムセキュリティプロトコル違反により一時的に隔離されました。
          管理者の指示があるまで操作を中断してください。
        </p>

        {/* Live Terminal logs */}
        <div className="w-full text-left bg-black/80 border border-red-900/60 p-4 rounded-xl min-h-[160px] overflow-hidden text-[10px] space-y-1 opacity-70">
          {logs.map((log, i) => (
            <div key={i} className="text-red-400 font-mono-hack animate-pulse">
              {log}
            </div>
          ))}
          {logs.length < possibleLogs.length && (
            <div className="text-red-500 font-mono-hack animate-bounce">
              _ <span className="hack-cursor">█</span>
            </div>
          )}
        </div>
      </div>

      {/* Retro matrix aesthetics at the base */}
      <div className="text-center text-[10px] text-red-900 font-mono-hack tracking-widest opacity-40 uppercase">
        ID_TOKEN_MUTEX_EXPIRED // MAID_CAFE_DO_COGNITION_LOCKED
      </div>
    </div>
  );
}

const possibleLogs = [
  "CRITICAL: SECURITY BREACH DETECTED...",
  "EXECUTING LOCKOUT PROTOCOL [10.19.4]",
  "DECRYPTING SECURE KERNEL ENVELOPE...",
  "FORCE SYSTEM OVERRIDE AT COMPONENT_ID: DO_SQLITE",
  "TERMINATING ACTIVE CLIENT SESSIONS...",
  "MEM_DUMP: BUFFER OVERFLOW IS IMMINENT",
  "HACKER COMPROMISED: PERMANENT ENCRYPT LOCKOUT ACTRESS_1",
  "DEVICE QUARANTINED SUCCESSFULLY.",
];
