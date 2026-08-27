import { ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { ZOOM_LABELS, type ZoomLevel } from "./useTimelineZoom";

interface Props {
  zoom: ZoomLevel;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
}

export function TimelineZoomControls({
  zoom,
  canZoomIn,
  canZoomOut,
  onZoomIn,
  onZoomOut,
  onFit,
}: Props) {
  return (
    <div className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-1 py-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onZoomOut}
            disabled={!canZoomOut}
            aria-label="Zoom out"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Zoom out</TooltipContent>
      </Tooltip>

      <Badge variant="secondary" className="h-6 px-2 text-[10px] font-medium tabular-nums">
        {ZOOM_LABELS[zoom]}
      </Badge>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onZoomIn}
            disabled={!canZoomIn}
            aria-label="Zoom in"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Zoom in</TooltipContent>
      </Tooltip>

      <div className="mx-1 h-5 w-px bg-border" />

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px] gap-1"
            onClick={onFit}
            aria-label="Fit timeline"
          >
            <Maximize2 className="h-3.5 w-3.5" />
            Fit
          </Button>
        </TooltipTrigger>
        <TooltipContent>Fit timeline to screen</TooltipContent>
      </Tooltip>
    </div>
  );
}
