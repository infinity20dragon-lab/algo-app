"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface VUMeterProps {
  level: number; // 0-100
  className?: string;
  barCount?: number;
  showPeakHold?: boolean;
}

export function VUMeter({
  level,
  className,
  barCount = 20,
  showPeakHold = true,
}: VUMeterProps) {
  const peakRef = useRef(0);
  const peakDecayRef = useRef<NodeJS.Timeout | null>(null);

  // Update peak hold
  useEffect(() => {
    if (level > peakRef.current) {
      peakRef.current = level;
      // Clear existing decay timeout
      if (peakDecayRef.current) {
        clearTimeout(peakDecayRef.current);
      }
      // Start decay after 1 second
      peakDecayRef.current = setTimeout(() => {
        const decayInterval = setInterval(() => {
          peakRef.current = Math.max(0, peakRef.current - 2);
          if (peakRef.current <= level) {
            clearInterval(decayInterval);
          }
        }, 50);
      }, 1000);
    }

    return () => {
      if (peakDecayRef.current) {
        clearTimeout(peakDecayRef.current);
      }
    };
  }, [level]);

  const activeBars = Math.floor((level / 100) * barCount);
  const peakBar = Math.floor((peakRef.current / 100) * barCount);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* Horizontal bar display */}
      <div className="flex items-center gap-1">
        {Array.from({ length: barCount }).map((_, i) => {
          const isActive = i < activeBars;
          const isPeak = showPeakHold && i === peakBar && peakBar > activeBars;
          const percentage = (i / barCount) * 100;

          // Color based on level: green -> yellow -> red
          let barColor = "bg-[var(--accent-green)]";
          if (percentage > 80) {
            barColor = "bg-[var(--accent-red)]";
          } else if (percentage > 60) {
            barColor = "bg-[var(--accent-orange)]";
          }

          return (
            <div
              key={i}
              className={cn(
                "h-8 w-2 rounded-sm transition-all duration-75",
                isActive || isPeak
                  ? barColor
                  : "bg-[var(--bg-tertiary)]",
                isPeak && "opacity-60"
              )}
            />
          );
        })}
      </div>

      {/* Level labels */}
      <div className="flex justify-between text-[10px] text-[var(--text-muted)] font-mono px-1">
        <span>-60</span>
        <span>-40</span>
        <span>-20</span>
        <span>-10</span>
        <span>0 dB</span>
      </div>
    </div>
  );
}

interface VUMeterVerticalProps {
  level: number; // 0-100
  className?: string;
  barCount?: number;
  label?: string;
}

export function VUMeterVertical({
  level,
  className,
  barCount = 16,
  label,
}: VUMeterVerticalProps) {
  const activeBars = Math.floor((level / 100) * barCount);

  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      {/* Vertical bars container */}
      <div className="flex flex-col-reverse gap-0.5">
        {Array.from({ length: barCount }).map((_, i) => {
          const isActive = i < activeBars;
          const percentage = (i / barCount) * 100;

          // Color based on level
          let barColor = "bg-[var(--accent-green)]";
          if (percentage > 80) {
            barColor = "bg-[var(--accent-red)]";
          } else if (percentage > 60) {
            barColor = "bg-[var(--accent-orange)]";
          }

          return (
            <div
              key={i}
              className={cn(
                "w-3 h-2 rounded-sm transition-all duration-75",
                isActive ? barColor : "bg-[var(--bg-tertiary)]"
              )}
            />
          );
        })}
      </div>

      {/* Level display */}
      <div className="text-xs font-mono text-[var(--accent-blue)]">
        {level.toFixed(0)}%
      </div>

      {/* Label */}
      {label && (
        <div className="text-[10px] text-[var(--text-muted)] font-semibold uppercase tracking-wider">
          {label}
        </div>
      )}
    </div>
  );
}

interface StereoVUMeterProps {
  leftLevel: number;
  rightLevel?: number;
  className?: string;
}

export function StereoVUMeter({ leftLevel, rightLevel, className }: StereoVUMeterProps) {
  const right = rightLevel ?? leftLevel;

  return (
    <div className={cn("flex items-end justify-center gap-4", className)}>
      <VUMeterVertical level={leftLevel} label="L" barCount={20} />
      <VUMeterVertical level={right} label="R" barCount={20} />
    </div>
  );
}

interface CircularVUMeterProps {
  level: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export function CircularVUMeter({
  level,
  size = 120,
  strokeWidth = 8,
  className,
}: CircularVUMeterProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (level / 100) * circumference;

  // Determine color based on level
  let strokeColor = "var(--accent-green)";
  if (level > 80) {
    strokeColor = "var(--accent-red)";
  } else if (level > 60) {
    strokeColor = "var(--accent-orange)";
  }

  return (
    <div className={cn("relative", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--bg-tertiary)"
          strokeWidth={strokeWidth}
        />
        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-100"
        />
      </svg>
      {/* Center text */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold font-mono text-[var(--text-primary)]">
          {level.toFixed(0)}
        </span>
        <span className="text-xs text-[var(--text-muted)]">%</span>
      </div>
    </div>
  );
}
