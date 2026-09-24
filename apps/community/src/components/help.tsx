import { useState } from "react";
import { CircleHelp } from "lucide-react";
import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  safePolygon,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useRole,
} from "@floating-ui/react";

export function Help({ children }: { children: string }) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: "top-end",
    strategy: "fixed",
    middleware: [offset(10), flip({ padding: 12 }), shift({ padding: 12 })],
    whileElementsMounted: autoUpdate,
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useHover(context, { move: false, handleClose: safePolygon() }),
    useFocus(context),
    useClick(context),
    useDismiss(context),
    useRole(context, { role: "tooltip" }),
  ]);
  return (
    <>
      <button
        type="button"
        className="help"
        ref={refs.setReference}
        aria-label="Nápověda"
        {...getReferenceProps()}
      >
        <CircleHelp size={16} aria-hidden="true" />
      </button>
      {open ? (
        <FloatingPortal>
          <div
            className="tooltip"
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
          >
            {children}
          </div>
        </FloatingPortal>
      ) : null}
    </>
  );
}
