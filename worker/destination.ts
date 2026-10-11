import { z } from 'zod';

export const destinationSchema = z.strictObject({
  owner: z.string().regex(/^[a-zA-Z0-9-]+$/),
  repository: z.string().regex(/^[a-zA-Z0-9_.-]+$/),
  branch: z.string().min(1),
});
export type Destination = z.infer<typeof destinationSchema>;
