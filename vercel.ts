import type { VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  framework: "nextjs",
  // Runs Prisma migrations against the direct (unpooled) database URL before building.
  buildCommand: "npm run vercel-build",
  // São Paulo, close to Brazilian customers. Keep the database in the same region (e.g. Neon sa-east-1).
  regions: ["gru1"],
  crons: [
    // Hobby plan allows only daily crons. On Pro, change to "*/5 * * * *".
    // Maintenance also runs opportunistically (throttled) after bot updates and webhooks.
    { path: "/api/cron/maintenance", schedule: "0 3 * * *" },
  ],
};
