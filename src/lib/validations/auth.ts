import { z } from "zod";

export const loginSchema = z.object({
  identifier: z.string().min(3, "Enter your email or mobile number"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export type LoginInput = z.infer<typeof loginSchema>;
