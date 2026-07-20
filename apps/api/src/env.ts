/**
 * Fail fast on boot rather than at the first request that needs a missing var.
 */
function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const env = {
  NODE_ENV: required("NODE_ENV", "development"),
  PORT: Number(required("PORT", "3001")),
  /** Comma-separated. Mobile clients send no Origin, so they bypass CORS entirely. */
  CORS_ORIGINS: required("CORS_ORIGINS", "http://localhost:3000").split(","),

  /** No fallback on purpose — a default here would silently point at the wrong
   *  database. Postgres and Redis are shared dev containers, so a typo would
   *  land in another project's data rather than failing. */
  DATABASE_URL: required("DATABASE_URL"),
  REDIS_URL: required("REDIS_URL"),
} as const;

export const isProd = env.NODE_ENV === "production";
