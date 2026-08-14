"use client";

/**
 * Super Admin → global search (§9).
 *
 * Searches clients, users, visits, tasks, subtasks, carry-forward, attendance
 * and activity in one box, and hands each hit to the Records explorer, which
 * opens it with its relationships and history.
 *
 * The request is debounced and only fires from 2 characters — typing does not
 * produce a request per keystroke, and no interval or retry loop exists here.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2, CornerDownLeft } from "lucide-react";
import { Pill } from "./shared";
import { cn } from "@/lib/utils/utils";

interface Hit {
  entity: string;
  id: string;
  title: string;
  subtitle: string;
  kind: string;
}

export function GlobalSearch({ autoFocus = false }: { autoFocus?: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Debounced: one request 300ms after typing stops, and the previous one is
  // aborted so a slow response can never overwrite a newer result.
  //
  // Nothing is cleared here when the query gets too short — whether results
  // are shown is DERIVED at render (`visible` below) rather than mirrored into
  // state by an effect, which would cost an extra render pass on every
  // keystroke.
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const res = await fetch(`/api/super-admin/search?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        if (!res.ok) { setHits([]); return; }
        const j = await res.json() as { hits: Hit[] };
        setHits(j.hits ?? []);
        setOpen(true);
      } catch {
        /* aborted or offline — leave the previous result in place */
      } finally {
        setBusy(false);
      }
    }, 300);

    return () => { clearTimeout(timer); controller.abort(); };
  }, [q]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const go = (hit: Hit) => {
    setOpen(false);
    router.push(`/admin/records?entity=${hit.entity}&id=${hit.id}`);
  };

  // Results belong to the query that fetched them; a query shortened below the
  // minimum simply stops showing them.
  const visible = q.trim().length >= 2 ? hits : null;

  return (
    <div ref={boxRef} className="relative w-full">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8896a9] pointer-events-none" />
        <input
          type="search"
          value={q}
          autoFocus={autoFocus}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => visible && setOpen(true)}
          placeholder="Search clients, executives, visits, tasks, activity, or a date (2026-08-13)…"
          aria-label="Global search"
          className="w-full pl-9 pr-9 py-2.5 bg-white border border-[#e2e7f0] rounded-lg text-sm text-[#0f1829] placeholder:text-[#c7d0dd] focus:outline-none focus:ring-2 focus:ring-[#25488e]/30 focus:border-[#25488e]"
        />
        {busy && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8896a9] animate-spin" />
        )}
      </div>

      {open && visible && (
        <div className="absolute z-30 mt-1.5 w-full bg-white border border-[#e2e7f0] rounded-xl shadow-xl overflow-hidden">
          {visible.length === 0 ? (
            <p className="px-4 py-6 text-sm text-[#8896a9] text-center">
              Nothing matched “{q.trim()}”.
            </p>
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto overscroll-contain divide-y divide-[#f1f4f9]">
              {visible.map((h) => (
                <li key={`${h.entity}:${h.id}`}>
                  <button
                    type="button"
                    onClick={() => go(h)}
                    className={cn(
                      "w-full text-left px-3 py-2.5 flex items-start gap-2.5 transition-colors",
                      "hover:bg-[#f8fafc] focus:bg-[#eef2fb] focus:outline-none"
                    )}
                  >
                    <Pill tone="primary" className="mt-0.5">{h.kind}</Pill>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-[#0f1829] truncate">{h.title}</span>
                      <span className="block text-[11px] text-[#8896a9] truncate">{h.subtitle}</span>
                    </span>
                    <CornerDownLeft className="w-3.5 h-3.5 text-[#c7d0dd] flex-shrink-0 mt-1" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
