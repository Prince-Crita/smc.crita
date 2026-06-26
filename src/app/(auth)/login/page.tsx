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
            background: "#1e293b",
            color: "#f1f5f9",
            border: "1px solid #334155",
            borderRadius: "12px",
          },
        }}
      />
    </>
  );
}
