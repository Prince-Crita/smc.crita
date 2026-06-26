"use client";

import { useState, useEffect, useCallback, useMemo, memo } from "react";
import {
  Plus, Search, Building2, Mail, Phone, Users,
  Archive, RefreshCw, Edit, MapPin,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { AddClientModal } from "@/components/admin/AddClientModal";
import toast from "react-hot-toast";
import { formatDate, cn } from "@/lib/utils/utils";

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
  assignedExec?: { id: string; name: string; email: string } | null;
  startDate?: string | null;
  endDate?: string | null;
  isArchived: boolean;
  createdAt: string;
  visitCount: number;
  recentVisitDate?: string | null;
}

interface Executive { id: string; name: string }

// ─── Client Card (memoized) ───────────────────────────────────────────────────

const ClientCard = memo(function ClientCard({
  client,
  onEdit,
  onArchive,
  onUnarchive,
}: {
  client: Client;
  onEdit: (client: Client) => void;
  onArchive: (client: Client) => void;
  onUnarchive: (client: Client) => void;
}) {
  return (
    <div className={cn(
      "bg-slate-900 border rounded-2xl p-5 transition-all duration-200 card-hover flex flex-col",
      client.isArchived ? "border-slate-800 opacity-60" : "border-slate-800 hover:border-slate-700"
    )}>
      {/* Header */}
      <div className="flex items-start gap-3 mb-4">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-bold text-sm flex-shrink-0 shadow-sm shadow-purple-500/20">
          {client.code.slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white truncate leading-tight">{client.name}</p>
          <p className="text-xs text-slate-500 mt-0.5 font-mono">{client.code}</p>
        </div>
        {client.isArchived && <Badge variant="inactive">Archived</Badge>}
      </div>

      {/* Contact info */}
      <div className="space-y-1.5 mb-4">
        <p className="text-xs text-slate-500 flex items-center gap-1.5">
          <Users className="w-3 h-3 flex-shrink-0" />
          {client.contactPerson}
        </p>
        {client.email && (
          <p className="text-xs text-slate-500 flex items-center gap-1.5">
            <Mail className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">{client.email}</span>
          </p>
        )}
        {client.phone && (
          <p className="text-xs text-slate-500 flex items-center gap-1.5">
            <Phone className="w-3 h-3 flex-shrink-0" />
            {client.phone}
          </p>
        )}
        {client.address && (
          <p className="text-xs text-slate-500 flex items-center gap-1.5">
            <MapPin className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">{client.address}</span>
          </p>
        )}
        {client.assignedExec && (
          <p className="text-xs text-blue-400 flex items-center gap-1.5">
            <span className="text-[10px] font-bold bg-blue-500/15 border border-blue-500/20 px-1.5 py-0.5 rounded-md text-blue-400">
              EXEC
            </span>
            {client.assignedExec.name}
          </p>
        )}
      </div>

      {/* Stats bar */}
      <div className="flex items-center gap-0 p-2.5 rounded-xl bg-slate-800/40 border border-slate-700/30 mb-4">
        <div className="text-center flex-1">
          <p className="text-lg font-bold text-white leading-tight">{client.visitCount}</p>
          <p className="text-[10px] text-slate-600 font-medium">Visits</p>
        </div>
        {client.reportEmails.length > 0 && (
          <div className="text-center flex-1 border-l border-slate-700/40">
            <p className="text-lg font-bold text-blue-400 leading-tight">{client.reportEmails.length}</p>
            <p className="text-[10px] text-slate-600 font-medium">Recipients</p>
          </div>
        )}
        {client.recentVisitDate && (
          <div className="text-center flex-1 border-l border-slate-700/40">
            <p className="text-xs font-semibold text-slate-300 leading-tight">
              {formatDate(new Date(client.recentVisitDate))}
            </p>
            <p className="text-[10px] text-slate-600 font-medium">Last Visit</p>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-3 border-t border-slate-800/60 mt-auto">
        <button
          onClick={() => onEdit(client)}
          className="flex-1 py-2 text-xs font-semibold rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-all press-effect flex items-center justify-center gap-1.5"
        >
          <Edit className="w-3 h-3" />
          Edit
        </button>
        {client.isArchived ? (
          <button
            onClick={() => onUnarchive(client)}
            className="flex-1 py-2 text-xs font-semibold rounded-xl bg-emerald-600/15 hover:bg-emerald-600/25 text-emerald-400 transition-all press-effect"
          >
            Restore
          </button>
        ) : (
          <button
            onClick={() => onArchive(client)}
            className="p-2 rounded-xl bg-slate-800 hover:bg-amber-500/15 text-slate-500 hover:text-amber-400 transition-all press-effect"
            title="Archive"
          >
            <Archive className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
});

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [executives, setExecutives] = useState<Executive[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editClient, setEditClient] = useState<Client | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [clientRes, execRes] = await Promise.all([
        fetch(`/api/admin/clients?archived=${showArchived}`),
        fetch("/api/admin/executives"),
      ]);
      const [clientData, execData] = await Promise.all([clientRes.json(), execRes.json()]);
      setClients(clientData.clients ?? []);
      setExecutives(execData.executives ?? []);
    } catch {
      toast.error("Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [showArchived]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    return clients.filter(
      (c) =>
        c.name.toLowerCase().includes(term) ||
        c.code.toLowerCase().includes(term) ||
        c.contactPerson.toLowerCase().includes(term)
    );
  }, [clients, search]);

  const handleArchive = useCallback(async (client: Client) => {
    if (!confirm(`Archive client "${client.name}"? They will be hidden from active lists.`)) return;
    try {
      const res = await fetch(`/api/admin/clients/${client.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isArchived: true }),
      });
      if (!res.ok) { toast.error("Failed to archive"); return; }
      toast.success("Client archived");
      fetchAll();
    } catch {
      toast.error("Error archiving client");
    }
  }, [fetchAll]);

  const handleUnarchive = useCallback(async (client: Client) => {
    try {
      const res = await fetch(`/api/admin/clients/${client.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isArchived: false }),
      });
      if (!res.ok) { toast.error("Failed to restore"); return; }
      toast.success("Client restored");
      fetchAll();
    } catch {
      toast.error("Error restoring client");
    }
  }, [fetchAll]);

  const handleEdit = useCallback((client: Client) => setEditClient(client), []);

  return (
    <div className="space-y-6 animate-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Clients</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Manage client accounts · {clients.length} {showArchived ? "archived" : "active"}
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-sm font-semibold transition-all press-effect shadow-sm shadow-blue-600/20 self-start"
        >
          <Plus className="w-4 h-4" />
          Add Client
        </button>
      </div>

      {/* Controls */}
      <div className="flex gap-2.5">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/60 focus:ring-2 focus:ring-blue-500/20 text-sm transition-all"
            placeholder="Search clients..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button
          onClick={() => setShowArchived(!showArchived)}
          className={cn(
            "flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border text-sm font-medium transition-all press-effect",
            showArchived
              ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
              : "bg-slate-900 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700"
          )}
        >
          <Archive className="w-4 h-4" />
          <span className="hidden sm:inline">{showArchived ? "Archived" : "Active"}</span>
        </button>
        <button
          onClick={fetchAll}
          className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700 transition-all press-effect"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(5)].map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-2xl">
          <div className="w-16 h-16 rounded-2xl bg-slate-800/60 flex items-center justify-center mb-4 mx-auto">
            <Building2 className="w-8 h-8 text-slate-600" />
          </div>
          <p className="text-base font-semibold text-slate-400">
            {search ? "No clients match your search" : showArchived ? "No archived clients" : "No active clients"}
          </p>
          {!search && !showArchived && (
            <button
              onClick={() => setShowAddModal(true)}
              className="mt-3 text-sm text-blue-400 hover:text-blue-300 transition-colors"
            >
              Add the first client →
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((client) => (
            <ClientCard
              key={client.id}
              client={client}
              onEdit={handleEdit}
              onArchive={handleArchive}
              onUnarchive={handleUnarchive}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      {showAddModal && (
        <AddClientModal executives={executives} onClose={() => setShowAddModal(false)} onSuccess={fetchAll} />
      )}
      {editClient && (
        <AddClientModal client={editClient} executives={executives} onClose={() => setEditClient(null)} onSuccess={fetchAll} />
      )}
    </div>
  );
}
