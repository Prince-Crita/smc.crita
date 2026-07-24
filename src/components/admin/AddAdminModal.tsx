"use client";

import { useState, useCallback } from "react";
import { Modal } from "@/components/ui/Modal";
import { Eye, EyeOff } from "lucide-react";
import toast from "react-hot-toast";

interface Admin {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  isActive: boolean;
}

interface AddAdminModalProps {
  admin?: Admin | null;
  onClose: () => void;
  onSuccess: () => void;
}

const inputClass =
  "bg-[#f8f9fc] border border-[#e2e7f0] rounded-lg px-3.5 py-2.5 text-[#0f1829] placeholder-[#8896a9] focus:outline-none focus:ring-2 focus:ring-[#25488e]/15 focus:border-[#25488e] text-sm w-full transition-all";

export function AddAdminModal({ admin, onClose, onSuccess }: AddAdminModalProps) {
  const isEdit = !!admin;

  const [form, setForm] = useState({
    name:     admin?.name     ?? "",
    email:    admin?.email    ?? "",
    phone:    admin?.phone    ?? "",
    password: "",
    isActive: admin?.isActive ?? true,
  });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading]           = useState(false);
  const [errors, setErrors]             = useState<Record<string, string>>({});

  const update = useCallback(
    (field: string, value: string | boolean) =>
      setForm((f) => ({ ...f, [field]: value })),
    []
  );

  const validate = () => {
    const errs: Record<string, string> = {};
    if (form.name.trim().length < 2)
      errs.name = "Name must be at least 2 characters";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
      errs.email = "Valid email required";
    if (!isEdit && form.password.length < 8)
      errs.password = "Password must be at least 8 characters";
    if (isEdit && form.password && form.password.length < 8)
      errs.password = "Password must be at least 8 characters";
    return errs;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setErrors({});
    setLoading(true);

    try {
      const url    = isEdit ? `/api/super-admin/admins/${admin.id}` : "/api/super-admin/admins";
      const method = isEdit ? "PATCH" : "POST";
      const body: Record<string, unknown> = {
        name:  form.name.trim(),
        email: form.email.trim(),
        phone: form.phone || null,
      };
      if (!isEdit)                 body.password = form.password;
      if (isEdit && form.password) body.password = form.password;
      if (isEdit)                  body.isActive  = form.isActive;

      const res  = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Failed to save"); return; }

      toast.success(isEdit ? "Admin updated" : "Admin added successfully");
      onSuccess();
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
      title={isEdit ? "Edit Admin" : "Add New Admin"}
      size="md"
    >
      <form onSubmit={handleSubmit}>
        {/* Fields */}
        <div className="p-5 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-semibold text-[#0f1829] mb-1.5">Full Name *</label>
            <input
              className={inputClass}
              placeholder="e.g. Murali"
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
            />
            {errors.name && <p className="text-red-600 text-xs mt-1">{errors.name}</p>}
          </div>

          {/* Email */}
          <div>
            <label className="block text-sm font-semibold text-[#0f1829] mb-1.5">Email Address *</label>
            <input
              type="email"
              className={inputClass}
              placeholder="admin@company.com"
              value={form.email}
              onChange={(e) => update("email", e.target.value)}
            />
            {errors.email && <p className="text-red-600 text-xs mt-1">{errors.email}</p>}
          </div>

          {/* Phone */}
          <div>
            <label className="block text-sm font-semibold text-[#0f1829] mb-1.5">
              Phone <span className="text-[#8896a9] font-normal">(optional)</span>
            </label>
            <input
              className={inputClass}
              placeholder="+91 99999 00000"
              value={form.phone}
              onChange={(e) => update("phone", e.target.value)}
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm font-semibold text-[#0f1829] mb-1.5">
              Password{" "}
              {isEdit ? (
                <span className="text-[#8896a9] font-normal">(leave blank to keep current)</span>
              ) : (
                "*"
              )}
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                className={`${inputClass} pr-10`}
                placeholder={isEdit ? "••••••••" : "Min 8 characters"}
                value={form.password}
                onChange={(e) => update("password", e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8896a9] hover:text-[#4a5568] transition-colors press-effect"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {errors.password && <p className="text-red-600 text-xs mt-1">{errors.password}</p>}
          </div>

          {/* Active toggle (edit only) */}
          {isEdit && (
            <div className="flex items-center justify-between p-3.5 rounded-xl bg-[#f8f9fc] border border-[#e2e7f0]">
              <div>
                <p className="text-sm text-[#0f1829] font-semibold">Account Status</p>
                <p className="text-xs text-[#8896a9] mt-0.5">Inactive accounts cannot log in</p>
              </div>
              <button
                type="button"
                onClick={() => update("isActive", !form.isActive)}
                className={`relative w-11 h-6 rounded-full transition-colors press-effect ${
                  form.isActive ? "bg-green-500" : "bg-[#c8d2e0]"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${
                    form.isActive ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white px-5 py-4 border-t border-[#e2e7f0] flex gap-3">
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
            {loading ? "Saving…" : isEdit ? "Save Changes" : "Add Admin"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
