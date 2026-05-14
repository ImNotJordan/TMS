import * as React from "react";
import { Check, ChevronsUpDown, Search, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type FancySelectOption = {
  value: string;
  label: string;
  description?: string;
  icon?: LucideIcon;
  badge?: string;
  group?: string;
  disabled?: boolean;
};

type FancySelectProps = {
  value?: string;
  onChange: (value: string) => void;
  options: FancySelectOption[];
  placeholder?: string;
  searchable?: boolean;
  triggerIcon?: LucideIcon;
  className?: string;
  error?: boolean;
  disabled?: boolean;
  emptyMessage?: string;
};

export function FancySelect({
  value,
  onChange,
  options,
  placeholder = "Select an option",
  searchable = true,
  triggerIcon: TriggerIcon,
  className,
  error,
  disabled,
  emptyMessage = "No matches found",
}: FancySelectProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const searchRef = React.useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value);

  const filtered = React.useMemo(() => {
    if (!query.trim()) return options;
    const q = query.toLowerCase();
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.description?.toLowerCase().includes(q) ?? false) ||
        (o.group?.toLowerCase().includes(q) ?? false),
    );
  }, [options, query]);

  const grouped = React.useMemo(() => {
    const map = new Map<string, FancySelectOption[]>();
    for (const opt of filtered) {
      const key = opt.group ?? "";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(opt);
    }
    return Array.from(map.entries());
  }, [filtered]);

  React.useEffect(() => {
    if (open && searchable) {
      setTimeout(() => searchRef.current?.focus(), 30);
    } else {
      setQuery("");
    }
  }, [open, searchable]);

  const SelectedIcon = selected?.icon ?? TriggerIcon;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "group relative flex h-10 w-full items-center gap-2.5 rounded-lg border bg-card px-3 text-left text-sm shadow-sm transition-all",
            "border-input hover:border-primary/40 hover:shadow",
            "focus:outline-none focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/20",
            open && "border-primary/60 ring-2 ring-primary/20 shadow",
            error && "border-destructive/60 ring-2 ring-destructive/15",
            disabled && "cursor-not-allowed opacity-50",
            className,
          )}
        >
          {SelectedIcon && (
            <span
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors",
                selected
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary",
              )}
            >
              <SelectedIcon className="h-3.5 w-3.5" />
            </span>
          )}
          <span className="min-w-0 flex-1 truncate">
            {selected ? (
              <span className="font-medium text-foreground">{selected.label}</span>
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
          </span>
          {selected?.badge && (
            <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
              {selected.badge}
            </span>
          )}
          <ChevronsUpDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180 text-primary",
            )}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[var(--radix-popover-trigger-width)] overflow-hidden p-0"
      >
        <div className="border-b border-border/70 bg-gradient-to-b from-muted/40 to-transparent">
          {searchable && (
            <div className="flex items-center gap-2 px-3 py-2">
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search..."
                className="h-7 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="rounded px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
                >
                  Clear
                </button>
              )}
            </div>
          )}
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              {emptyMessage}
            </div>
          ) : (
            grouped.map(([group, items]) => (
              <div key={group || "_"} className="mb-1 last:mb-0">
                {group && (
                  <div className="sticky top-0 z-10 bg-popover/95 px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">
                    {group}
                  </div>
                )}
                {items.map((opt) => {
                  const Icon = opt.icon;
                  const isSelected = opt.value === value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={opt.disabled}
                      onClick={() => {
                        onChange(opt.value);
                        setOpen(false);
                      }}
                      className={cn(
                        "group/item relative flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left text-sm transition-colors",
                        "hover:bg-accent hover:text-accent-foreground",
                        isSelected && "bg-primary/8",
                        opt.disabled && "cursor-not-allowed opacity-50",
                      )}
                    >
                      {Icon && (
                        <span
                          className={cn(
                            "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors",
                            isSelected
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground group-hover/item:bg-primary/10 group-hover/item:text-primary",
                          )}
                        >
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span
                            className={cn(
                              "truncate text-sm font-medium text-foreground",
                              isSelected && "text-primary",
                            )}
                          >
                            {opt.label}
                          </span>
                          {opt.badge && (
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                              {opt.badge}
                            </span>
                          )}
                        </span>
                        {opt.description && (
                          <span className="mt-0.5 line-clamp-1 block text-xs text-muted-foreground">
                            {opt.description}
                          </span>
                        )}
                      </span>
                      {isSelected && <Check className="mt-1.5 h-3.5 w-3.5 shrink-0 text-primary" />}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
        <div className="flex items-center justify-between border-t border-border/70 bg-muted/30 px-3 py-1.5 text-[10px] text-muted-foreground">
          <span>
            {filtered.length} of {options.length} options
          </span>
          <span className="font-medium">↑↓ Esc</span>
        </div>
      </PopoverContent>
    </Popover>
  );
}
