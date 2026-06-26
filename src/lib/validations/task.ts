import { z } from "zod";

/**
 * Schema for saving task progress.
 * NOTE: We intentionally do NOT enforce incompletionReason here.
 * Reasons are only required at visit-CLOSE time (validateVisitClose).
 * This allows partial saves while the user is still filling in reasons.
 */
export const completeSubtasksSchema = z.object({
  subtasks: z.array(
    z.object({
      id: z.string(),
      isCompleted: z.boolean(),
      incompletionReason: z.string().nullable().optional(),
    })
  ),
  mdMeetingAnswer: z.enum(["YES", "NO"]).optional().nullable(),
});

export const closeVisitSchema = z.object({
  notes: z.string().optional(),
});

export type CompleteSubtasksInput = z.infer<typeof completeSubtasksSchema>;
export type CloseVisitInput = z.infer<typeof closeVisitSchema>;
