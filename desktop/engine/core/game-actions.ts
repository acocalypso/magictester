import { z } from "zod";
export const actionLogSchema = z
  .object({
    version: z.literal(1),
    entries: z
      .array(
        z.object({
          sequence: z.number().int().nonnegative(),
          kind: z.string().regex(/^[A-Z_]{1,40}$/),
          text: z.string().max(4096),
          turn: z.number().int().nonnegative(),
          phase: z.string().max(40).nullable(),
          activePlayer: z.number().int().nonnegative().nullable(),
        }),
      )
      .max(5000),
    total: z.number().int().nonnegative(),
    complete: z.boolean(),
  })
  .superRefine((log, ctx) => {
    if (
      log.total < log.entries.length ||
      (log.complete && log.total !== log.entries.length) ||
      log.entries.some((entry, i) => entry.sequence !== i) ||
      log.entries.reduce(
        (sum, entry) => sum + Buffer.byteLength(entry.text),
        0,
      ) > 262144
    )
      ctx.addIssue({
        code: "custom",
        message: "Invalid action history ordering or recording limits",
      });
  });
export type ActionLog = z.infer<typeof actionLogSchema>;
export type ActionHistoryRef = {
  id: string;
  count: number;
  total: number;
  complete: boolean;
};
