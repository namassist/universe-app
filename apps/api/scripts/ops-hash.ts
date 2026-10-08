/**
 * Print the hash to put in `OPS_PASSWORD_HASH` for the Operations Center.
 *
 *   bun run ops:hash
 *
 * Asks for the password rather than taking it as an argument, so it never
 * lands in the shell's history. The output is an argon2id hash — the same
 * `Bun.password` the account logins use — and only the hash goes into the
 * environment: whoever reads the compose file sees nothing that opens the page.
 * It prints the line for both env files, because they quote differently.
 */

const password = prompt("Operations Center password:")?.trim() ?? "";
if (password.length < 12) {
  console.error(
    "Use at least 12 characters — this one password opens the page."
  );
  process.exit(1);
}
const hash = await Bun.password.hash(password);

/*
 * The hash is full of `$`, and the two places it goes read `$` differently:
 * Bun's own .env loader expands `$name` even inside single quotes, so for
 * `apps/api/.env` every `$` is escaped; Compose takes a single-quoted value
 * literally, so `deploy/.env` gets the hash as it is. Paste the wrong line and
 * the hash is silently mangled — the symptom is a password never accepted.
 */
console.log(`
apps/api/.env (local, Bun):
OPS_PASSWORD_HASH=${hash.replaceAll("$", "\\$")}

deploy/.env (Docker Compose):
OPS_PASSWORD_HASH='${hash}'`);
