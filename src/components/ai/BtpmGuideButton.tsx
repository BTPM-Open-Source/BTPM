import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import BtpmGuideDrawer from "./BtpmGuideDrawer";

const STORAGE_KEY = "btpm-guide-button-pos";

interface Pos {
  x: number;
  y: number;
}

function clampToViewport(pos: Pos, el: HTMLElement | null): Pos {
  const w = el?.offsetWidth ?? 140;
  const h = el?.offsetHeight ?? 36;
  const maxX = Math.max(0, window.innerWidth - w - 4);
  const maxY = Math.max(0, window.innerHeight - h - 4);
  return {
    x: Math.min(Math.max(4, pos.x), maxX),
    y: Math.min(Math.max(4, pos.y), maxY),
  };
}

interface BtpmGuideButtonProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export default function BtpmGuideButton({ open: controlledOpen, onOpenChange }: BtpmGuideButtonProps = {}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (v: boolean) => {
    if (onOpenChange) onOpenChange(v);
    else setUncontrolledOpen(v);
  };
  const [pos, setPos] = useState<Pos>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    // default: top-right (≈ top-4 right-4)
    return { x: window.innerWidth - 160, y: 16 };
  });
  const [dragging, setDragging] = useState(false);
  const dragState = useRef<{ dx: number; dy: number; moved: boolean }>({
    dx: 0,
    dy: 0,
    moved: false,
  });
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onResize = () => setPos((p) => clampToViewport(p, wrapRef.current));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pos));
    } catch {}
  }, [pos]);

  const onPointerDown = (e: React.PointerEvent) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragState.current = {
      dx: e.clientX - rect.left,
      dy: e.clientY - rect.top,
      moved: false,
    };
    setDragging(true);
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    const next = clampToViewport(
      { x: e.clientX - dragState.current.dx, y: e.clientY - dragState.current.dy },
      wrapRef.current,
    );
    if (
      Math.abs(next.x - pos.x) > 2 ||
      Math.abs(next.y - pos.y) > 2
    ) {
      dragState.current.moved = true;
    }
    setPos(next);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    setDragging(false);
    try {
      (e.target as Element).releasePointerCapture(e.pointerId);
    } catch {}
  };

  const onClick = () => {
    if (dragState.current.moved) {
      dragState.current.moved = false;
      return;
    }
    setOpen(true);
  };

  return (
    <>
      {!open && (
        <div
          ref={wrapRef}
          style={{
            position: "fixed",
            left: pos.x,
            top: pos.y,
            zIndex: 40,
            touchAction: "none",
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <Button
            type="button"
            size="sm"
            variant="default"
            onClick={onClick}
            className={`shadow-md gap-1.5 select-none ${dragging ? "cursor-grabbing opacity-90" : "cursor-grab"}`}
            title="Drag to move • Click to open"
          >
            <Sparkles className="h-4 w-4" />
            BTPM Guide
          </Button>
        </div>
      )}
      <BtpmGuideDrawer open={open} onOpenChange={setOpen} />
    </>
  );
}
