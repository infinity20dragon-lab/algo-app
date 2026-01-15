"use client";

import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  showValue?: boolean;
}

const Slider = forwardRef<HTMLInputElement, SliderProps>(
  ({ className, showValue = false, value, ...props }, ref) => {
    return (
      <div className="flex items-center gap-3">
        <input
          type="range"
          className={cn(
            "h-2 w-full cursor-pointer appearance-none rounded-lg bg-[var(--bg-tertiary)] accent-[var(--accent-blue)]",
            className
          )}
          ref={ref}
          value={value}
          {...props}
        />
        {showValue && (
          <span className="w-10 text-right text-sm font-medium text-[var(--text-secondary)]">
            {value}%
          </span>
        )}
      </div>
    );
  }
);

Slider.displayName = "Slider";

export { Slider };
