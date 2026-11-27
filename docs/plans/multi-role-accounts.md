# Plan — Multi-role per akun + pilih role saat login

Status: disetujui (2026-11-27) · Branch: `feat/multi-role-accounts` · Ukuran: large

## Masalah

Satu akun hanya bisa memegang satu role. Orang yang bertindak sebagai
Superadmin **dan** Pengawas Lapangan harus dibuat dua akun, padahal email dan
NIK-nya sama — dan keduanya unik, jadi akun kedua tidak bisa memakai identitas
yang sama.

## Ide inti

- Satu akun memegang **beberapa role**, salah satunya **role default**.
- **Satu sesi membawa tepat satu role aktif.** Scope dan izin per request tetap
  tunggal — alasan lama menolak multi-role ("dua role bisa beda scope") tidak
  berlaku, karena pertanyaannya selalu dijawab oleh satu role.
- Login: email/NIK + password → bila role > 1, layar **"Masuk sebagai…"**
  **selalu muncul** → setelah masuk, role bisa diganti dari **topbar tanpa
  password ulang**.
- Pilihan role ditampilkan **setelah** password benar, jadi orang asing tidak
  bisa melihat role apa yang dimiliki sebuah akun.

Hampir semua route membaca `principal.roleId` / `principal.scope`; kalau
principal dibangun dari role aktif sesi, route tersebut tidak perlu berubah.

## Keputusan

| #   | Pertanyaan               | Keputusan                                                                |
| --- | ------------------------ | ------------------------------------------------------------------------ |
| 1   | Ganti role setelah login | Dari topbar, tanpa password ulang                                        |
| 2   | Import xlsx              | Kolom `role` menerima beberapa nama dipisah koma; role pertama = default |
| 3   | Layar "Masuk sebagai…"   | Selalu muncul bila akun punya > 1 role                                   |

## Langkah (urutan dependency)

1. **`packages/contracts`** — `UserPrincipal.roles: {id, name, scope}[]`;
   `roleId/roleName/scope` = role **aktif**. `LoginRequest.roleId?`.
2. **`apps/api` schema + migrasi** — tabel `user_roles(user_id, role_id)` berisi
   role **tambahan** saja; `users.role_id` tetap role default. Set role akun =
   default ∪ `user_roles`. (Diubah saat implementasi dari rencana awal "semua
   role di `user_roles` + backfill": dengan cara ini provisioning, seed, import
   dan fixture test lama tetap benar tanpa ikut menulis ke tabel baru, dan
   migrasi tidak perlu backfill.)
3. **`apps/api` sesi & auth** (test dulu)
   - Record sesi Redis ditambah `roleId` (perubahan sadar atas design D1).
     Sesi lama tanpa `roleId` → role default; tidak ada logout paksa saat deploy.
   - `POST /auth/login` menerima `roleId` opsional (tanpa = default) dan
     mengembalikan `roles`. Aplikasi HP lama tetap jalan dengan role default.
   - `POST /auth/switch-role {roleId}` — server memastikan role milik akun;
     selain itu 403.
   - Role aktif dicabut admin → request berikutnya 401 (login ulang).
4. **`apps/api` Users & Roles** — `POST/PATCH /users` menerima `roleIds[]` +
   `defaultRoleId` (`roleId` tunggal tetap diterima). NIK wajib bila salah satu
   role ber-scope `dept`/`self`. `isLastRolesAdmin`, hitungan pemegang, hapus
   role, ubah scope role, invalidasi cache → membaca `user_roles`.
5. **`apps/web`** — form user: checkbox role + pilihan default; daftar user
   menampilkan beberapa badge; login langkah kedua "Masuk sebagai…"; topbar
   "Ganti role"; i18n `id`/`en`.
6. **Import xlsx** — kolom `role` multi-nilai (koma); set role akun = isi kolom.
7. **Docs** — `docs/prd.md`, `apps/api/docs/design.md` (D1), `apps/*/docs/schema.md`,
   `docs/domain-map.md` bila terdampak.
8. **Verifikasi & review** — format, lint, typecheck, `bun test` (api + web),
   build; `/code-review`, `/react-review`, `database-reviewer`,
   `security-reviewer`.

## Tidak termasuk

- Akun ganda yang sudah ada tidak digabung otomatis — admin menambah role ke
  akun utama lalu menghapus duplikatnya.
- Aplikasi HP (repo terpisah) belum punya layar pilih role; API sudah siap, dan
  sampai itu dikerjakan HP masuk dengan role default.
