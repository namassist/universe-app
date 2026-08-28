# Known issues

Defects worth remembering by their **symptom**, because each one reads as
something other than what it is. Closed entries stay listed: the requirement
that now covers each is where a future reader should look, not this file.

## Open

### Signing a low-privileged account into a paired TV's browser darkens it

`/display/*` now admits a user session as well as the device cookie, and the
API's auth macro resolves the **user** session first (`auth/macro.ts`). A TV
that holds both credentials is therefore judged as the person, not as the
screen: if that account lacks the kiosk menu's `view` grant the read is a 403,
and the device cookie sitting beside it is never consulted.

**Symptom:** one wall goes blank and stays blank while every other TV is fine,
with no banner — the kiosk treats 401/403 as "not paired" and deliberately
withholds the disconnection banner, so it reads as a pairing or network fault
rather than as somebody having logged in on that browser. Logging out restores
it.

### A direct SQL rename of an employee NIK breaks that person's account

`users.nik` has no foreign key to `employees.nik` — deliberately, because
accounts and employee records have different lifetimes (auth D5, employee D2).
The rename route keeps the two in step inside one transaction, and that
transaction is the _only_ thing keeping them in step. A rename written straight
to `employees` re-opens the defect below.

**Symptom:** a `dept`- or `self`-scoped account sees every screen empty, with
no error anywhere — `scopeWhere` fails closed, so it reads as missing master
data rather than as a broken link.

### A direct SQL insert can produce a mismatched employee

The department→company and position→department pairing on an employee row is
enforced by the route (`mismatchedOrganisation`), not by a database constraint
— a composite foreign key would force a redundant unique key on
`departments(id, company_id)` (organisation-chain D3). Every application write
path goes through the check; a hand-written `INSERT` does not.

## Closed

### Renaming an employee's NIK orphaned the account holding it _(closed)_

Nothing updated `users.nik`, so the account pointed at nobody and its holder
went silently blind. Now covered by requirement — `employee-data`: _an
employee's NIK rename carries the account in the same transaction_ (409
`nik_taken` on collision, race included) — and pinned by
`apps/api/src/routes/employees-scope.test.ts` ("renaming a NIK carries the
account holding it").

### Employee write routes reached past the caller's scope _(closed)_

A `dept`-scoped holder of `employees: manage` could create into, edit, delete,
and re-photograph other departments, and `PATCH` returned the record it
touched — a write was a way to read. Now covered by requirement —
`employee-data`: _a department-scoped caller writes, bounded; out-of-scope
targets answer 404_ — and pinned by `employees-scope.test.ts` for the
single-record routes and the import sheet both.
