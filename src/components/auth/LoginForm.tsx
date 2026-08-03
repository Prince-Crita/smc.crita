"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import toast from "react-hot-toast";
import Image from "next/image";
import { Eye, EyeOff, Lock, User } from "lucide-react";
import { loginSchema, LoginInput } from "@/lib/validations/auth";

export default function LoginForm() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { rememberMe: false },
  });

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

      if (json.user.role === "EXECUTIVE") {
        router.push("/executive");
      } else {
        router.push("/admin");
      }
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

          {/* Card */}
          <div className="bg-white rounded-2xl border border-[#e2e7f0] shadow-xl p-8">
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

              {/* Remember Me — extends the session to 30 days. The session is
                  still a signed, httpOnly, Secure cookie verified server-side
                  on every request; only its lifetime changes. */}
              <label htmlFor="rememberMe" className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  id="rememberMe"
                  type="checkbox"
                  {...register("rememberMe")}
                  className="w-4 h-4 rounded border-[#c8d2e0] accent-[#25488e]"
                />
                <span className="text-sm text-[#4a5568]">Remember me</span>
                <span className="text-xs text-[#8896a9] ml-auto">Stay signed in for 30 days</span>
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
