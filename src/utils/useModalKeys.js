import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Escape-to-close + focus trap for modals.
 *
 * Returns a ref to attach to the modal's outer element. Focus is moved into
 * the dialog on mount, Tab/Shift+Tab cycle inside it, and focus returns to the
 * previously active element on unmount.
 */
export function useModalKeys(onClose, enabled = true) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!enabled) return undefined;
    const node = ref.current;
    const previous =
      typeof document !== "undefined" ? document.activeElement : null;

    const getFocusable = () =>
      node
        ? [...node.querySelectorAll(FOCUSABLE)].filter(
            (el) => el.offsetParent !== null || el === document.activeElement,
          )
        : [];

    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current?.();
        return;
      }
      if (e.key !== "Tab") return;
      const items = getFocusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKey, true);
    const timer = setTimeout(() => {
      const items = getFocusable();
      (items[0] || node)?.focus?.();
    }, 30);

    return () => {
      window.removeEventListener("keydown", onKey, true);
      clearTimeout(timer);
      if (previous && typeof previous.focus === "function") previous.focus();
    };
  }, [enabled]);

  return ref;
}
