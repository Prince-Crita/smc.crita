"use client";

import { useState, useCallback, useEffect } from "react";
import { Modal } from "@/components/ui/Modal";
import { X, Plus } from "lucide-react";
import toast from "react-hot-toast";
import { revalidateAll } from "@/lib/hooks/useLiveQuery";

interface Client {
  id: string;
  name: string;
  code: string;
  contactPerson: string;
  address: string;
  phone?: string | null;
  email?: string | null;
  reportEmails: string[];
  assignedExecId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

interface AddClientModalProps {
  client?: Client | null;
  executives: { id: string; name: string }[];
  onClose: () => void;
  onSuccess: () => void;
}

const inputClass =
  "bg-[#f8f9fc] border border-[#e2e7f0] rounded-lg px-3.5 py-2.5 text-[#0f1829] placeholder-[#8896a9] focus:outline-none focus:ring-2 focus:ring-[#25488e]/20 focus:border-[#25488e] text-sm w-full transition-all";

export function AddClientModal({ client, executives, onClose, onSuccess }: AddClientModalProps) {
  const isEdit = !!client;

  const [form, setForm] = useState({
    name:           client?.name ?? "",
    code:           client?.code ?? "",
    contactPerson:  client?.contactPerson ?? "",
    address:        client?.address ?? "",
    phone:          client?.phone ?? "",
    email:          client?.email ?? "",
    assignedExecId: client?.assignedExecId ?? "",
    startDate: client?.startDate ? new Date(client.startDate).toISOString().split("T")[0] : "",
    endDate:   client?.endDate   ? new Date(client.endDate).toISOString().split("T")[0]   : "",
  });

  // Solo (previous behaviour) or Team. `assignedExecId` doubles as the Team
  // Lead when TEAM. Prefilled from the client's current visit when editing.
  const [visitType, setVisitType] = useState<"SOLO" | "TEAM">("SOLO");
  const [memberIds, setMemberIds] = useState<string[]>([]);

  useEffect(() => {
    if (!client?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/admin/clients/${client.id}/assignment`);
        if (!res.ok) return;
        const j = await res.json() as { assignment?: { visitType: "SOLO" | "TEAM"; teamLead: { id: string } | null; teamMembers: { id: string }[] } };
        if (cancelled || !j.assignment) return;
        setVisitType(j.assignment.visitType);
        setMemberIds(j.assignment.teamMembers.map((m) => m.id));
      } catch { /* prefill is best-effort */ }
    })();
    return () => { cancelled = true; };
  }, [client?.id]);

  const [reportEmails, setReportEmails] = useState<string[]>(client?.reportEmails ?? []);
  const [emailInput, setEmailInput]     = useState("");
  const [errors, setErrors]             = useState<Record<string, string>>({});
  const [loading, setLoading]           = useState(false);

  const update = useCallback(
    (field: string, value: string) => setForm((f) => ({ ...f, [field]: value })),
    []
  );

  const addEmail = useCallback(() => {
    const e = emailInput.trim().toLowerCase();
    if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { toast.error("Enter a valid email"); return; }
    if (reportEmails.includes(e)) { toast.error("Email already added"); return; }
    setReportEmails((prev) => [...prev, e]);
    setEmailInput("");
  }, [emailInput, reportEmails]);

  const removeEmail = useCallback(
    (em: string) => setReportEmails((prev) => prev.filter((e) => e !== em)),
    []
  );

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!form.name.trim())          errs.name          = "Client name is required";
    if (!form.code.trim())          errs.code          = "Client code is required";
    if (!form.contactPerson.trim()) errs.contactPerson = "Contact person is required";
    if (!form.address.trim())       errs.address       = "Address is required";
    // The assignment rules the server enforces, checked here too so the admin
    // is told what is missing instead of the save appearing to succeed while
    // the assignment is quietly rejected.
    if (visitType === "TEAM") {
      if (!form.assignedExecId) errs.assignedExecId = "Select a Team Lead";
      else if (memberIds.length === 0) errs.assignedExecId = "A Team Visit needs at least one team member besides the Team Lead";
    }
    return errs;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setErrors({});
    setLoading(true);

    try {
      const url    = isEdit ? `/api/admin/clients/${client.id}` : "/api/admin/clients";
      const method = isEdit ? "PATCH" : "POST";
      const body   = {
        ...form,
        code:           form.code.toUpperCase().trim(),
        phone:          form.phone  || null,
        email:          form.email  || null,
        reportEmails,
        assignedExecId: form.assignedExecId || null,
        startDate:      form.startDate || null,
        endDate:        form.endDate   || null,
        // Applied to the client's visit; omitted members keep it Solo.
        visitType,
        ...(visitType === "TEAM" ? { memberIds } : {}),
      };

      const res  = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || `Failed to save — server responded ${res.status} ${res.statusText}`);
        return;
      }

      // The client row can save while the visit/assignment part of the same
      // request could not be applied. Reporting only "Client updated" there is
      // what made an assignment change look like it had synced when it had
      // not — the warning is now shown instead of being discarded.
      if (data?.visitWarning) {
        toast.error(`Client saved, but the visit assignment was not applied: ${data.visitWarning}`, { duration: 6000 });
      } else {
        toast.success(isEdit ? "Client updated" : "Client added successfully");
      }
      onSuccess();
      // Every other mounted screen showing this data (admin visits, calendar,
      // dashboard, and the executive's own lists in this session) refetches
      // once. Mutation-driven, not polling.
      revalidateAll();
      onClose();
    } catch {
      toast.error("An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={isEdit ? "Edit Client" : "Add New Client"}
      size="lg"
      fullScreenOnMobile
    >
      {/*
       * The form has two parts:
       *   1. scrollable body (all the fields)
       *   2. sticky footer (Cancel / Save buttons)
       * This ensures the action buttons are always visible on small screens.
       */}
      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
        {/* Scrollable field area
         *  flex-1 min-h-0 → takes remaining height from the panel (100dvh on mobile)
         *  overflow-y-auto → this is the ONE scroll container for the form
         *  pb-4 → breathing room before the sticky footer
         */}
        <div className="flex-1 overflow-y-auto overscroll-contain p-5 space-y-4 pb-4">

          {/* Row: Name + Code */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-[#4a5568] mb-1.5 font-semibold">Client Name *</label>
              <input
                className={inputClass}
                placeholder="e.g. Clifton Exports"
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
              />
              {errors.name && <p className="text-red-600 text-xs mt-1">{errors.name}</p>}
            </div>
            <div>
              <label className="block text-xs text-[#4a5568] mb-1.5 font-semibold">Client Code *</label>
              <input
                className={inputClass}
                placeholder="e.g. CLIFF"
                value={form.code}
                onChange={(e) => update("code", e.target.value.toUpperCase())}
                disabled={isEdit}
                style={isEdit ? { opacity: 0.5 } : {}}
              />
              {errors.code && <p className="text-red-600 text-xs mt-1">{errors.code}</p>}
            </div>
          </div>

          {/* Contact Person */}
          <div>
            <label className="block text-xs text-[#4a5568] mb-1.5 font-semibold">Contact Person *</label>
            <input
              className={inputClass}
              placeholder="Primary contact name"
              value={form.contactPerson}
              onChange={(e) => update("contactPerson", e.target.value)}
            />
            {errors.contactPerson && <p className="text-red-600 text-xs mt-1">{errors.contactPerson}</p>}
          </div>

          {/* Address */}
          <div>
            <label className="block text-xs text-[#4a5568] mb-1.5 font-semibold">Address *</label>
            <textarea
              className={`${inputClass} resize-none`}
              rows={2}
              placeholder="Full business address"
              value={form.address}
              onChange={(e) => update("address", e.target.value)}
            />
            {errors.address && <p className="text-red-600 text-xs mt-1">{errors.address}</p>}
          </div>

          {/* Row: Phone + Email */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-[#4a5568] mb-1.5 font-semibold">
                Phone <span className="text-[#8896a9] font-normal">(optional)</span>
              </label>
              <input
                className={inputClass}
                placeholder="+91 99999 00000"
                value={form.phone}
                onChange={(e) => update("phone", e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs text-[#4a5568] mb-1.5 font-semibold">
                Client Email <span className="text-[#8896a9] font-normal">(optional)</span>
              </label>
              <input
                type="email"
                className={inputClass}
                placeholder="client@company.com"
                value={form.email}
                onChange={(e) => update("email", e.target.value)}
              />
            </div>
          </div>

          {/* Report recipient emails */}
          <div>
            <label className="block text-xs text-[#4a5568] mb-1.5 font-semibold">
              Report Recipient Emails
            </label>
            <div className="flex gap-2">
              <input
                className={`${inputClass} flex-1`}
                placeholder="Add email and press +"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addEmail(); } }}
              />
              <button
                type="button"
                onClick={addEmail}
                className="px-3 py-2.5 rounded-lg bg-[#25488e] hover:bg-[#1e3a72] active:bg-[#172d58] text-white transition-all press-effect flex-shrink-0"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
            {reportEmails.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {reportEmails.map((em) => (
                  <span
                    key={em}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#eef2fb] border border-[#d4ddf5] text-[#25488e] text-xs"
                  >
                    <span className="truncate max-w-[160px]">{em}</span>
                    <button
                      type="button"
                      onClick={() => removeEmail(em)}
                      className="flex-shrink-0 hover:text-red-600 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Visit Type + assignment — replaces the single-executive picker.
              Solo keeps the previous behaviour exactly; Team adds a lead and
              members. Applies to the client's visit when it is saved. */}
          <div>
            <label className="block text-xs text-[#4a5568] mb-1.5 font-semibold">Visit Type</label>
            <div className="flex gap-2">
              {(["SOLO", "TEAM"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => { setVisitType(t); setMemberIds([]); }}
                  className={
                    "flex-1 py-2 rounded-lg text-sm font-semibold border transition-colors " +
                    (visitType === t
                      ? "bg-[#25488e] text-white border-[#25488e]"
                      : "bg-white text-[#4a5568] border-[#e2e7f0] hover:bg-[#f1f4f9]")
                  }
                >
                  {t === "SOLO" ? "Solo Visit" : "Team Visit"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs text-[#4a5568] mb-1.5 font-semibold">
              {visitType === "TEAM" ? "Team Lead" : "Assigned Executive"}
            </label>
            <select
              className={inputClass}
              value={form.assignedExecId}
              onChange={(e) => {
                update("assignedExecId", e.target.value);
                setMemberIds((prev) => prev.filter((id) => id !== e.target.value));
              }}
            >
              <option value="">— None —</option>
              {executives.map((ex) => (
                <option key={ex.id} value={ex.id}>{ex.name}</option>
              ))}
            </select>
          </div>

          {visitType === "TEAM" && (
            <div>
              <label className="block text-xs text-[#4a5568] mb-1.5 font-semibold">Team Members</label>
              {/* The Team Lead is filtered out, so the same executive can never
                  be selected twice — the API enforces the same rule. */}
              <div className="border border-[#e2e7f0] rounded-lg divide-y divide-[#f1f4f9] max-h-40 overflow-y-auto">
                {executives.filter((ex) => ex.id !== form.assignedExecId).map((ex) => {
                  const checked = memberIds.includes(ex.id);
                  return (
                    <label key={ex.id} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[#f8fafc]">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setMemberIds((p) => checked ? p.filter((id) => id !== ex.id) : [...p, ex.id])}
                        className="w-4 h-4 accent-[#25488e]"
                      />
                      <span className="text-sm text-[#0f1829]">{ex.name}</span>
                    </label>
                  );
                })}
              </div>
              <p className="text-[11px] text-[#8896a9] mt-1">
                {memberIds.length} member{memberIds.length === 1 ? "" : "s"} selected. Only the Team Lead can close a team visit.
              </p>
            </div>
          )}

          {/* Row: Start Date + End Date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-[#4a5568] mb-1.5 font-semibold">Start Date</label>
              <input
                type="date"
                className={inputClass}
                value={form.startDate}
                onChange={(e) => update("startDate", e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs text-[#4a5568] mb-1.5 font-semibold">End Date</label>
              <input
                type="date"
                className={inputClass}
                value={form.endDate}
                onChange={(e) => update("endDate", e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Sticky footer — always visible even when form scrolls */}
        <div className="flex-shrink-0 px-5 py-4 border-t border-[#e2e7f0] flex gap-3 bg-white">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-lg bg-[#f1f4f9] hover:bg-[#e2e7f0] text-[#4a5568] text-sm font-medium transition-all press-effect"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="flex-1 py-2.5 rounded-lg bg-[#25488e] hover:bg-[#1e3a72] disabled:opacity-50 text-white text-sm font-semibold transition-all press-effect"
          >
            {loading ? "Saving…" : isEdit ? "Save Changes" : "Add Client"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
