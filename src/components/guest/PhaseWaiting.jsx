import { useEffect, useState } from "react";
import { GUEST_TEXT } from "@/lib/constants";

export default function PhaseWaiting({ guestName }) {
  const [dotIndex, setDotIndex] = useState(0);
  const dots = GUEST_TEXT.WAITING.dots;

  // Render randomized floating hearts for the dreamlike background
  const [hearts, setHearts] = useState([]);
  useEffect(() => {
    const list = Array.from({ length: 15 }).map((_, i) => ({
      id: i,
      left: `${Math.random() * 100}%`,
      size: `${Math.random() * 16 + 10}px`,
      delay: `${Math.random() * 6}s`,
      duration: `${Math.random() * 8 + 6}s`,
      opacity: Math.random() * 0.4 + 0.2,
    }));
    setHearts(list);
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      setDotIndex((i) => (i + 1) % dots.length);
    }, 1500);
    return () => clearInterval(id);
  }, [dots.length]);

  return (
    <div className="min-h-screen menu-dream-bg flex items-center justify-center px-6 relative overflow-hidden">
      {/* Decorative Floating Hearts */}
      {hearts.map((h) => (
        <span
          key={h.id}
          className="absolute text-pink-300 pointer-events-none select-none menu-float-particle"
          style={{
            left: h.left,
            fontSize: h.size,
            animationDelay: h.delay,
            animationDuration: h.duration,
            opacity: h.opacity,
          }}
        >
          ♥
        </span>
      ))}

      {/* Decorative lace borders on top and bottom */}
      <div className="absolute top-0 left-0 w-full h-3 menu-lace-strip opacity-40" />
      <div className="absolute bottom-0 left-0 w-full h-3 menu-lace-strip opacity-40" />

      {/* Premium Content Box */}
      <div className="max-w-md w-full bg-white/60 backdrop-blur-xl border-2 border-pink-200/60 rounded-3xl p-8 text-center shadow-[0_20px_50px_rgba(251,180,216,0.3)] relative z-10 transition-all duration-300 hover:shadow-[0_25px_60px_rgba(251,180,216,0.45)]">
        {/* Glowing Heart Ring Icon */}
        <div className="relative w-20 h-20 mx-auto mb-6 flex items-center justify-center">
          <div className="absolute inset-0 bg-pink-300/30 rounded-full blur-xl animate-pulse" />
          <div className="w-16 h-16 bg-gradient-to-tr from-pink-400 to-rose-400 rounded-full flex items-center justify-center shadow-lg transition-transform duration-500 hover:scale-110">
            <span className="text-white text-3xl animate-bounce" style={{ animationDuration: '2.5s' }}>
              ♥
            </span>
          </div>
        </div>

        <h1
          className="text-3xl font-extrabold bg-gradient-to-r from-pink-600 to-rose-500 bg-clip-text text-transparent mb-3 tracking-wide"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          {GUEST_TEXT.WAITING.title}
        </h1>

        <p className="text-pink-600/70 text-sm font-medium mb-10 leading-relaxed px-4">
          {guestName
            ? `${guestName}様、${GUEST_TEXT.WAITING.subtitle}`
            : GUEST_TEXT.WAITING.subtitle}
        </p>

        {/* Customized Neon Progress and Status Indicators */}
        <div className="flex items-center justify-center gap-3 mb-8">
          {dots.map((label, i) => (
            <div key={label} className="flex flex-col items-center gap-1.5">
              <div
                className={`w-3.5 h-3.5 rounded-full transition-all duration-500 ${
                  i === dotIndex
                    ? "bg-pink-500 scale-125 ring-4 ring-pink-100 shadow-[0_0_12px_#ec4899]"
                    : "bg-pink-200"
                }`}
              />
              <span
                className={`text-xs transition-colors duration-300 ${
                  i === dotIndex ? "text-pink-600 font-extrabold" : "text-pink-300/70"
                }`}
                style={{ fontFamily: "var(--font-heading)" }}
              >
                {label}
              </span>
            </div>
          ))}
        </div>

        {/* Premium animated dual loading progress bar */}
        <div className="w-full h-2 bg-pink-100/60 rounded-full overflow-hidden shadow-inner p-[1px]">
          <div
            className="h-full bg-gradient-to-r from-pink-400 to-rose-400 rounded-full shadow-[0_0_8px_rgba(236,72,153,0.5)]"
            style={{ animation: "progress-bar 4s ease-in-out infinite alternate" }}
          />
        </div>
      </div>
    </div>
  );
}
