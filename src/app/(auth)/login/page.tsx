import LoginForm from "@/components/auth/LoginForm";
import { Toaster } from "react-hot-toast";

export const metadata = {
  title: "Sign In — SMC Audit Portal",
  description: "Sign in to the SMC Task Management Module",
};

export default function LoginPage() {
  return (
    <>
      <LoginForm />
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: "#ffffff",
            color: "#0f1829",
            border: "1px solid #e2e7f0",
            borderRadius: "12px",
            fontSize: "13px",
            fontWeight: "500",
            boxShadow: "0 8px 24px rgba(0,0,0,0.10)",
          },
        }}
      />
    </>
  );
}
