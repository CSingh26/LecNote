import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Plus, type LucideIcon } from "lucide-react";

export type ActionMenuItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
};

export function ActionMenu({
  label,
  items,
  icon: Icon = Plus,
}: {
  label: string;
  items: ActionMenuItem[];
  icon?: LucideIcon;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const enabled = () =>
    Array.from(
      menu.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)',
      ) ?? [],
    );
  useEffect(() => {
    if (!open) return;
    enabled()[0]?.focus();
    const outside = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
    };
  }, [open]);
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  return (
    <div className="action-menu" ref={root}>
      <button
        ref={button}
        type="button"
        className="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Icon size={16} aria-hidden="true" />
        {label}
        <ChevronDown size={15} aria-hidden="true" className="menu-caret" />
      </button>
      {open && (
        <div
          ref={menu}
          id={id}
          role="menu"
          aria-label={label}
          className="menu-popover"
          onKeyDown={(event) => {
            const list = enabled();
            const index = list.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            if (event.key === "Escape") {
              event.preventDefault();
              close();
            } else if (event.key === "Tab") {
              setOpen(false);
            } else if (
              ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
            ) {
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? list.length - 1
                    : (index +
                        (event.key === "ArrowDown" ? 1 : list.length - 1)) %
                      list.length;
              list[next]?.focus();
            }
          }}
        >
          {items.map(
            ({ id: key, label: text, icon: ItemIcon, onSelect, disabled }) => (
              <button
                key={key}
                type="button"
                role="menuitem"
                tabIndex={-1}
                disabled={disabled}
                onClick={() => {
                  close();
                  onSelect();
                }}
              >
                <ItemIcon size={16} aria-hidden="true" />
                {text}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
