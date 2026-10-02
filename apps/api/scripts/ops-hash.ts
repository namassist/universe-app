/**
 * Print the hash to put in `OPS_PASSWORD_HASH` for the Operations Center.
 *
 *   bun run ops:hash
 *
 * Asks for the password rather than taking it as an argument, so it never
 * lands in the shell's history. The output is an argon2id hash — the same
 * `Bun.password` the account logins use — and only the hash goes into the
 * environment: whoever reads the compose file sees nothing that opens the page.
 */

const password = prompt("Operations Center password:")?.trim() ?? "";
if (password.length < 12) {
  console.error(
    "Use at least 12 characters — this one password opens the page."
  );
  process.exit(1);
}
// On a line of its own: `prompt` leaves the cursor after its question.
console.log(`\n${await Bun.password.hash(password)}`);
