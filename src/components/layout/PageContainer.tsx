import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Shared page-width foundation.
 *
 * Three modes — surfaces own the choice; no user toggle.
 *  - standard : readable bounded width (detail / forms / narrative)         → max-w-5xl
 *  - wide     : wider bounded width (page shells, list/dashboard headers)   → max-w-7xl
 *  - canvas   : near full usable width with safe gutters (Gantt / Calendar) → max-w-[1800px]
 *
 * Centralizes width so pages stop inventing local max-w-* caps.
 */
export type PageWidth = "standard" | "wide" | "canvas";

const WIDTH_CLASS: Record<PageWidth, string> = {
  standard: "max-w-5xl",
  wide: "max-w-7xl",
  // Fluid: full available content width with safe gutters; no fixed cap.
  canvas: "max-w-none",
};

export interface PageContainerProps extends HTMLAttributes<HTMLDivElement> {
  width?: PageWidth;
  /** Override default horizontal padding if needed. */
  padded?: boolean;
}

export const PageContainer = forwardRef<HTMLDivElement, PageContainerProps>(
  ({ width = "standard", padded = true, className, children, ...rest }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "mx-auto w-full",
          WIDTH_CLASS[width],
          padded && "px-4 sm:px-6",
          className,
        )}
        {...rest}
      >
        {children}
      </div>
    );
  },
);
PageContainer.displayName = "PageContainer";
