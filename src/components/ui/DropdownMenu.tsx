"use client";

import * as RadixDropdownMenu from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils/utils";

export const DropdownMenu = RadixDropdownMenu.Root;
export const DropdownMenuTrigger = RadixDropdownMenu.Trigger;

export function DropdownMenuContent({
  children,
  align = "end",
  className,
}: {
  children: React.ReactNode;
  align?: "start" | "center" | "end";
  className?: string;
}) {
  return (
    <RadixDropdownMenu.Portal>
      <RadixDropdownMenu.Content
        align={align}
        sideOffset={6}
        className={cn(
          "z-[80] min-w-[180px] bg-white border border-[#e2e7f0] rounded-xl shadow-xl p-1.5",
          "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          className
        )}
      >
        {children}
      </RadixDropdownMenu.Content>
    </RadixDropdownMenu.Portal>
  );
}

export function DropdownMenuItem({
  children,
  onSelect,
  danger,
  disabled,
}: {
  children: React.ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <RadixDropdownMenu.Item
      onSelect={(e) => {
        e.preventDefault();
        if (!disabled) onSelect();
      }}
      disabled={disabled}
      className={cn(
        "flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium cursor-pointer outline-none transition-colors select-none",
        "min-h-[40px]",
        disabled
          ? "opacity-40 cursor-not-allowed"
          : danger
          ? "text-red-600 data-[highlighted]:bg-red-50"
          : "text-[#4a5568] data-[highlighted]:bg-[#f1f4f9] data-[highlighted]:text-[#0f1829]"
      )}
    >
      {children}
    </RadixDropdownMenu.Item>
  );
}
