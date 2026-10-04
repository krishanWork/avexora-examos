import React, { useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { ChevronDown, Check } from "lucide-react";

// Renders a native-feeling bottom sheet picker on mobile, and a standard Select on desktop.
export default function SheetSelect({ value, onValueChange, placeholder, options, className }) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  if (!isMobile) {
    return (
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className={className}><SelectValue placeholder={placeholder} /></SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    );
  }

  const selected = options.find((o) => o.value === value);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ${className || ""}`}
      >
        <span className={selected ? "truncate" : "text-muted-foreground truncate"}>
          {selected?.label || placeholder}
        </span>
        <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
      </button>
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent>
          <DrawerHeader className="text-left">
            <DrawerTitle>{placeholder}</DrawerTitle>
          </DrawerHeader>
          <div className="max-h-[60vh] overflow-y-auto px-4 pb-8 space-y-1">
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => { onValueChange(o.value); setOpen(false); }}
                className="w-full flex items-center justify-between px-3 py-3 rounded-lg text-left text-sm hover:bg-accent active:bg-accent"
              >
                <span>{o.label}</span>
                {o.value === value && <Check className="w-4 h-4 text-primary shrink-0" />}
              </button>
            ))}
            {options.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">No options available</p>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}