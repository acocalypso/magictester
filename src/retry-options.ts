import { z } from "zod";
export const retryOptionsSchema = z
  .object({
    mode: z.enum(["resume", "new"]).optional(),
    clockSeconds: z.number().int().min(5).max(300).optional(),
  })
  .strict()
  .refine(
    (options) =>
      options.mode !== "resume" || options.clockSeconds === undefined,
    {
      message:
        "Changing settings requires a new run; resume keeps the original settings",
    },
  );
export type RetryOptions = z.infer<typeof retryOptionsSchema>;
