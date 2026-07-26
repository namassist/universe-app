import { env } from "../env";

/**
 * `Bun.password` is argon2id by default — no new dependency, and the algorithm
 * and its parameters are encoded in the hash, so a future cost bump does not
 * invalidate stored hashes.
 */
export function hashPassword(plain: string): Promise<string> {
  return Bun.password.hash(plain);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return Bun.password.verify(plain, hash);
}

/**
 * A hash of a value nobody can present, used to spend the same argon2id time on
 * an unknown identifier as on a wrong password. Without it, login answers
 * "which identifiers exist" through its response time.
 */
export const DUMMY_HASH = await hashPassword(
  `timing-equaliser:${crypto.randomUUID()}`
);

export type PasswordProblem =
  | { code: "password_too_short"; message: string }
  | { code: "password_is_default"; message: string };

/**
 * The policy from D12. The second rule is what stops the forced-change gate
 * from being theatre: without it an account satisfies the change by retyping
 * the password it was issued, and one shared secret survives indefinitely.
 */
export function checkPasswordPolicy(plain: string): PasswordProblem | null {
  if (plain.length < env.PASSWORD_MIN_LENGTH)
    return {
      code: "password_too_short",
      message: `Password minimal ${env.PASSWORD_MIN_LENGTH} karakter`,
    };
  if (plain === env.DEFAULT_USER_PASSWORD)
    return {
      code: "password_is_default",
      message: "Password baru tidak boleh sama dengan password awal",
    };
  return null;
}
