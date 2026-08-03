"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import toast from "react-hot-toast";
import Image from "next/image";
import { Eye, EyeOff, Lock, User, X, Plus } from "lucide-react";
import { loginSchema, LoginInput } from "@/lib/validations/auth";
import {
  getAccountsSnapshot,
  getAccountsServerSnapshot,
  subscribeToAccounts,
  rememberAccount,
  forgetAccount,
  roleLabel,
  displayIdentifier,
  type RememberedAccount,
} from "@/lib/auth/remembered-accounts";

export default function LoginForm() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // ── Remembered accounts on THIS device ──────────────────────────────────
  // Read straight from localStorage — no API call, no polling, cards are on
  // screen in the first client paint. useSyncExternalStore handles the SSR
  // snapshot (empty) and keeps the list in sync if another tab edits it.
  const accounts = useSyncExternalStore(
    subscribeToAccounts,
    getAccountsSnapshot,
    getAccountsServerSnapshot
  );
  const [showForm, setShowForm] = useState(false);
  const [continuingId, setContinuingId] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    setFocus,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { rememberMe: false },
  });

  const goToDashboard = (role: string) => {
    if (role === "EXECUTIVE") router.push("/executive");
    else router.push("/admin");
  };

  /** Tap-to-continue on a remembered account — no credentials retyped. */
  const handleContinue = async (account: RememberedAccount) => {
    setContinuingId(account.id);
    try {
      const res = await fetch("/api/auth/continue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: account.id }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (json.code === "ACCOUNT_UNAVAILABLE") {
          // Deleted, deactivated by an admin, or otherwise unusable. Fail
          // gracefully: the server already dropped it from the device cookie,
          // so drop our local copy too and the card disappears. Other
          // remembered accounts are untouched; if this was the last one, fall
          // back to the existing login form.
          const remaining = forgetAccount(account.id);
          if (remaining.length === 0) setShowForm(true);
          toast.error(json.error || "This account is no longer available");
          return;
        }
        // Device cookie expired or cleared. The account stays listed, but it
        // now needs a password: open the form with the identifier prefilled.
        toast.error(json.error || "Please sign in to continue");
        setValue("identifier", account.identifier);
        setValue("rememberMe", true);
        setShowForm(true);
        setTimeout(() => setFocus("password"), 50);
        return;
      }

      toast.success(`Welcome back, ${json.user?.name ?? account.name}!`);
      // Refresh the stored profile in case the name, role, email or mobile
      // changed server-side. This also self-heals cards saved before the
      // role-based identifier rule existed.
      if (json.user) {
        rememberAccount({
          id: json.user.id,
          name: json.user.name,
          role: json.user.role,
          identifier:
            displayIdentifier(json.user.role, json.user.email, json.user.phone) ||
            account.identifier,
        });
      }
      goToDashboard(json.user?.role ?? account.role);
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setContinuingId(null);
    }
  };

  /** Remove ONE account from this device. Others are unaffected. */
  const handleRemove = async (account: RememberedAccount) => {
    const next = forgetAccount(account.id);
    if (next.length === 0) setShowForm(true);
    try {
      await fetch("/api/auth/forget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: account.id }),
      });
    } catch {
      /* local list is already updated; the cookie entry simply expires */
    }
    toast.success(`Removed ${account.name}`);
  };

  const onSubmit = async (data: LoginInput) => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      const json = await res.json();

      if (!res.ok) {
        toast.error(json.error || "Login failed");
        return;
      }

      toast.success(`Welcome back, ${json.user.name}!`);

      // Remember this account on this device — additive, so any accounts
      // already remembered here are kept. Only non-secret profile fields.
      // The card identifier comes from the user's RECORD by role (admin →
      // email, executive → mobile), not from whatever they typed to sign in.
      if (json.remembered) {
        rememberAccount({
          id: json.user.id,
          name: json.user.name,
          role: json.user.role,
          identifier:
            displayIdentifier(json.user.role, json.user.email, json.user.phone) ||
            data.identifier.trim(),
        });
      }

      goToDashboard(json.user.role);
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f8f9fc] flex">
      {/* Left panel - brand */}
      <div className="hidden lg:flex lg:w-[44%] xl:w-[48%] bg-[#172d58] flex-col items-center justify-center p-12 relative overflow-hidden">
        {/* Decorative circles */}
        <div className="absolute -top-24 -left-24 w-72 h-72 rounded-full bg-white/5" />
        <div className="absolute -bottom-24 -right-24 w-96 h-96 rounded-full bg-white/5" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full bg-[#25488e]/40" />

        <div className="relative z-10 max-w-sm text-center">
          {/* Logo - soft white container behind it for contrast against the navy panel (desktop only) */}
          <div className="inline-flex bg-white rounded-2xl shadow-sm px-6 py-4 mx-auto mb-8">
            <Image
              src="/logo.png"
              alt="Shaabi Management Consultancy"
              width={600}
              height={200}
              className="object-contain h-16 w-auto"
              priority
            />
          </div>

          <h1 className="text-3xl font-bold text-white mb-3">
            Shaabi Management Consultancy
          </h1>
          <p className="text-white/60 text-base leading-relaxed">
            Enterprise audit task management portal for field operations and compliance tracking.
          </p>

          {/* Feature pills */}
          <div className="flex flex-wrap gap-2 justify-center mt-8">
            {["Visit Tracking", "Task Management", "Carry Forward", "Reports"].map((f) => (
              <span key={f} className="px-3 py-1 rounded-full bg-white/10 text-white/70 text-xs font-medium border border-white/10">
                {f}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel - form */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="lg:hidden text-center mb-8">
            <div className="flex justify-center mx-auto mb-4">
              <Image
                src="/logo.png"
                alt="Shaabi Management Consultancy"
                width={600}
                height={200}
                className="object-contain h-14 w-auto"
                priority
              />
            </div>
          </div>

          {/* ── Remembered accounts on this device ──────────────────────────
              Rendered ABOVE the existing sign-in card, which is untouched.
              Only appears once mounted (localStorage is client-only) and only
              when this device actually has remembered accounts. */}
          {accounts.length > 0 && (
            <div className="bg-white rounded-2xl border border-[#e2e7f0] shadow-xl p-6 mb-5">
              <div className="mb-5">
                <h2 className="text-xl font-bold text-[#0f1829]">Choose an account</h2>
                <p className="text-[#8896a9] text-sm mt-1">Saved on this device</p>
              </div>

              <div className="space-y-3">
                {accounts.map((account) => (
                  <div
                    key={account.id}
                    className="flex items-center gap-3 p-3 rounded-xl border border-[#e2e7f0] bg-[#f8f9fc] hover:border-[#25488e]/40 transition-colors"
                  >
                    <div className="w-11 h-11 rounded-full bg-[#25488e] flex items-center justify-center text-white font-bold text-base flex-shrink-0">
                      {account.name.charAt(0).toUpperCase()}
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-[#0f1829] truncate">{account.name}</p>
                      <p className="text-xs text-[#8896a9]">{roleLabel(account.role)}</p>
                      <p className="text-xs text-[#8896a9] truncate">{account.identifier}</p>
                    </div>

                    <div className="flex-shrink-0 flex flex-col items-stretch gap-1">
                      <button
                        type="button"
                        onClick={() => handleContinue(account)}
                        disabled={continuingId !== null}
                        className="px-4 py-2 bg-[#25488e] hover:bg-[#1e3a72] disabled:bg-[#25488e]/50 text-white text-sm font-semibold rounded-lg transition-all press-effect flex items-center justify-center gap-2"
                      >
                        {continuingId === account.id ? (
                          <>
                            <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            <span>…</span>
                          </>
                        ) : (
                          "Continue"
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleRemove(account)}
                        disabled={continuingId !== null}
                        title={`Remove ${account.name} from this device`}
                        aria-label={`Remove ${account.name} from this device`}
                        className="px-4 py-1 text-xs font-semibold text-[#8896a9] hover:text-red-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
                      >
                        <X className="w-3 h-3" />
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {!showForm && (
                <button
                  type="button"
                  onClick={() => setShowForm(true)}
                  className="w-full mt-4 py-2.5 flex items-center justify-center gap-2 text-sm font-semibold text-[#25488e] hover:text-[#1e3a72] border border-dashed border-[#c8d2e0] hover:border-[#25488e] rounded-xl transition-colors press-effect"
                >
                  <Plus className="w-4 h-4" />
                  Login with another account
                </button>
              )}
            </div>
          )}

          {/* Card — the existing sign-in form, unchanged. Collapsed only while
              remembered accounts are being offered and the user has not asked
              to add another account. */}
          <div
            className={
              accounts.length > 0 && !showForm
                ? "hidden"
                : "bg-white rounded-2xl border border-[#e2e7f0] shadow-xl p-8"
            }
          >
            <div className="mb-8">
              <h2 className="text-2xl font-bold text-[#0f1829]">Sign In</h2>
              <p className="text-[#8896a9] text-sm mt-1">Enter your credentials to access the portal</p>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              {/* Email or Mobile Number */}
              <div>
                <label htmlFor="identifier" className="block text-sm font-semibold text-[#4a5568] mb-1.5">
                  Email or Mobile Number
                </label>
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8896a9]" />
                  <input
                    id="identifier"
                    type="text"
                    autoComplete="username"
                    placeholder="name@smcaudit.com or 9994096508"
                    {...register("identifier")}
                    className="w-full pl-10 pr-4 py-3 bg-[#f8f9fc] border border-[#e2e7f0] rounded-xl text-[#0f1829] placeholder-[#8896a9] text-sm focus:outline-none focus:ring-2 focus:ring-[#25488e]/30 focus:border-[#25488e] transition-all"
                  />
                </div>
                {errors.identifier && (
                  <p className="mt-1.5 text-xs text-red-500">{errors.identifier.message}</p>
                )}
              </div>

              {/* Password */}
              <div>
                <label htmlFor="password" className="block text-sm font-semibold text-[#4a5568] mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8896a9]" />
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    {...register("password")}
                    className="w-full pl-10 pr-11 py-3 bg-[#f8f9fc] border border-[#e2e7f0] rounded-xl text-[#0f1829] placeholder-[#8896a9] text-sm focus:outline-none focus:ring-2 focus:ring-[#25488e]/30 focus:border-[#25488e] transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#8896a9] hover:text-[#4a5568] transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {errors.password && (
                  <p className="mt-1.5 text-xs text-red-500">{errors.password.message}</p>
                )}
              </div>

              {/* Remember Me — extends the session to 30 days AND saves this
                  account on this device, so it is still offered on the login
                  screen after logging out. The session itself is unchanged: a
                  signed, httpOnly, Secure cookie verified server-side on every
                  request. No password is ever stored. */}
              <label htmlFor="rememberMe" className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  id="rememberMe"
                  type="checkbox"
                  {...register("rememberMe")}
                  className="w-4 h-4 rounded border-[#c8d2e0] accent-[#25488e]"
                />
                <span className="text-sm text-[#4a5568]">Remember me</span>
                <span className="text-xs text-[#8896a9] ml-auto">Save this account on this device</span>
              </label>

              {/* Submit */}
              <button
                type="submit"
                disabled={isLoading}
                id="login-btn"
                className="w-full py-3 px-4 bg-[#25488e] hover:bg-[#1e3a72] disabled:bg-[#25488e]/50 text-white font-semibold rounded-xl transition-all duration-200 flex items-center justify-center gap-2 mt-2 shadow-lg shadow-[#25488e]/20 press-effect"
              >
                {isLoading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Signing in...
                  </>
                ) : (
                  "Sign In"
                )}
              </button>

              {/* Back to the saved-account list (only when there is one) */}
              {accounts.length > 0 && showForm && (
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="w-full text-xs font-semibold text-[#8896a9] hover:text-[#25488e] transition-colors"
                >
                  ← Back to saved accounts
                </button>
              )}
            </form>
          </div>

          <p className="text-center text-xs text-[#8896a9] mt-6">
            &copy; 2026 SMC Audit Services. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}
