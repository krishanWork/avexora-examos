import React, { useRef, useState } from "react";
import { Loader2, ArrowDown } from "lucide-react";

const THRESHOLD = 60;

export default function PullToRefresh({ onRefresh, children }) {
  const startY = useRef(null);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const handleTouchStart = (e) => {
    startY.current = window.scrollY <= 0 && !refreshing ? e.touches[0].clientY : null;
  };

  const handleTouchMove = (e) => {
    if (startY.current === null || refreshing) return;
    const dy = e.touches[0].clientY - startY.current;
    setPull(dy > 0 && window.scrollY <= 0 ? Math.min(dy * 0.4, 90) : 0);
  };

  const handleTouchEnd = async () => {
    startY.current = null;
    if (pull >= THRESHOLD && !refreshing) {
      setRefreshing(true);
      setPull(0);
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
      }
    } else {
      setPull(0);
    }
  };

  return (
    <div onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
      <div
        className="flex items-center justify-center overflow-hidden text-stone-400"
        style={{ height: refreshing ? 44 : pull, transition: pull === 0 ? "height 0.2s" : "none" }}
      >
        {refreshing ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          <ArrowDown className={`w-5 h-5 transition-transform ${pull >= THRESHOLD ? "rotate-180" : ""}`} />
        )}
      </div>
      {children}
    </div>
  );
}