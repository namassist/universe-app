## 1. Kontrak bersama (`packages/contracts`)

Dikerjakan lebih dulu karena API dan web sama-sama bersandar padanya.

- [x] 1.1 Tambahkan `perusahaan` dan `jabatan` ke `MENU_SLUGS` dan `MENU_LABELS` di `src/access.ts` ("Perusahaan", "Jabatan")
- [x] 1.2 Tambahkan `perusahaan` dan `jabatan` ke `MASTER_KINDS`, dan perbarui komentar "nine lookup catalogues" menjadi sebelas
- [x] 1.3 Tambahkan `EMPLOYEE_STATUSES = ["aktif", "nonaktif"]` di `src/master.ts` beserta tipe dan type guard-nya, mengikuti bentuk `AREA_TYPES` (D7)
- [x] 1.4 Tambahkan `MCU_RESULTS` dan `BLOOD_TYPES` beserta tipe dan type guard-nya (D6)
- [x] 1.5 Tambahkan entri `perusahaan` dan `jabatan` ke `MASTER_IMPORT_COLUMNS` di `src/master-import.ts` dengan kolom `["nama", "deskripsi", "aktif"]`
- [x] 1.6 Tambahkan `EMPLOYEE_IMPORT_COLUMNS` dan konstanta pemisah daftar keahlian (`;`), lalu ekspor semuanya lewat `src/index.ts`
- [x] 1.7 Jalankan typecheck paket dan pastikan tidak ada impor server-only yang ikut masuk

## 2. Skema dan migrasi (`apps/api/src/db`)

- [x] 2.1 Tambahkan `pgEnum` untuk status kepegawaian, hasil MCU, dan golongan darah di `schema.ts`, diturunkan dari konstanta contracts
- [x] 2.2 Tambahkan tabel `companies` dan `positions` memakai `describedCatalogueColumns()` + `lowerNameUnique()` (D5)
- [x] 2.3 Tambahkan tabel `employees`: `id` uuid PK, `nik` text notNull unique, `name`, FK `company_id`/`position_id`/`department_id` notNull, FK `mess_id`/`simper_type_id` nullable, `join_date`, `license`, `simper_no`, `simper_exp`, `mcu`, `mcu_exp`, `blood`, `medical`, `block`, `room`, `phone`, `emergency`, `photo_file_name` nullable, `status`, `created_at` — semua FK `onDelete: "restrict"` (D1, D2, D3)
- [x] 2.4 Tambahkan indeks pada `employees.department_id`, `company_id`, dan `position_id` mengikuti pola indeks di `units`
- [x] 2.5 Tambahkan tabel `employee_skills` dengan PK gabungan `(employee_id, simper_code_id)`, `onDelete: "cascade"` ke employees dan `"restrict"` ke `simper_codes` (D4)
- [x] 2.6 Tambahkan tipe `$inferSelect` untuk `CompanyRow`, `PositionRow`, `EmployeeRow`, `EmployeeSkillRow`
- [x] 2.7 Jalankan `bun run --cwd apps/api db:generate` dan periksa SQL yang dihasilkan sebelum commit
- [x] 2.8 Jalankan `bun run --cwd apps/api db:migrate` pada database dev dan pastikan berhasil

## 3. Katalog baru menumpang route generik

- [x] 3.1 Tambahkan `perusahaan` dan `jabatan` ke `MENU_OF_KIND` dan `KIND_TABLES` di `routes/master.ts` dengan `extra: "description"`
- [x] 3.2 Isi `countReferences` kedua katalog baru dengan hitungan karyawan yang memakainya
- [x] 3.3 Ubah `countReferences` untuk `departemen`, `mess`, `simper`, dan `kode-simper` agar menjumlahkan referensi karyawan di samping referensi unit yang sudah ada — `kode-simper` juga menghitung baris `employee_skills` (D10, spec master-data)
- [x] 3.4 Verifikasi menghapus departemen yang dipakai karyawan menjawab 409 dengan jumlah yang benar

## 4. Penyimpanan foto (`apps/api`)

- [x] 4.1 Tambahkan `PHOTO_DIR` ke `env.ts` dengan default `./storage/photos` dan komentar alasan konfigurasi eksplisit, mengikuti `SOUND_DIR` (D8)
- [x] 4.2 Tambahkan `PHOTO_DIR` ke `apps/api/.env.example` di sebelah `SOUND_DIR`, karena README menyuruh menyalin file itu saat setup
- [x] 4.3 Generalisasi `storage.ts`: jadikan path/write/delete/ping berparameter direktori, pertahankan `soundPath`/`writeSound`/`deleteSound`/`pingSoundStorage` sebagai pembungkus tipis agar pemanggil lama tidak berubah
- [x] 4.4 Tambahkan padanan untuk foto dengan daftar ekstensi sendiri (`.jpg`, `.jpeg`, `.png`, `.webp`) dan `MAX_PHOTO_BYTES`
- [x] 4.5 Tambahkan laporan direktori foto ke `/health` di samping database, cache, dan direktori sound
- [x] 4.6 Perluas `storage.test.ts` untuk kasus foto, termasuk nama file klien yang mengandung `../`

## 5. Route karyawan (`apps/api/src/routes/employees.ts`)

- [x] 5.1 Tambahkan `EmployeeSchema` dan skema turunannya di `routes/schemas.ts`, termasuk nama katalog hasil join dan daftar kode SIMPER
- [x] 5.2 Tulis query join karyawan mengikuti `unitQuery()`: `innerJoin` untuk FK notNull, `leftJoin` untuk mess dan tipe SIMPER agar karyawan tanpa keduanya tidak hilang dari daftar
- [x] 5.3 `GET /v1/employees` dengan pencarian dan filter di server (nama, NIK, nama katalog hasil join; filter status dan departemen), memakai `scopeWhere(principal, { dept: employees.departmentId, self: employees.nik })` (D12, D9)
- [x] 5.4 `GET /v1/employees/:nik` — 404 bila tidak ada, tunduk pada scope yang sama
- [x] 5.5 `POST /v1/employees` — resolve seluruh referensi katalog sebelum menulis dan sebut field yang gagal resolve, mengikuti alasan yang ditulis `units.ts`; 409 untuk NIK duplikat lewat `isUniqueViolation`
- [x] 5.6 `PATCH /v1/employees/:nik` dengan aturan resolve yang sama
- [x] 5.7 Penulisan keahlian: ganti seluruh himpunan dalam satu transaksi, buang duplikat dalam satu submission, 422 untuk kode yang tidak resolve (D4)
- [x] 5.8 `DELETE /v1/employees/:nik` — 409 bila ada akun dengan NIK yang sama, sebutkan alasannya; hapus baris `employee_skills` bersama karyawannya (D10)
- [x] 5.9 `POST` dan `GET /v1/employees/:nik/photo` — multipart masuk, `Bun.file` keluar, nama file digenerate server, foto lama dihapus saat diganti (D8)
- [x] 5.10 Pastikan setiap route mendeklarasikan `body`, `params`, dan `response`, dan daftarkan modulnya di `src/index.ts`
- [x] 5.11 Periksa dokumen OpenAPI di `/openapi` memuat seluruh route baru dengan skema respons yang lengkap

## 6. Menghidupkan scope dan validasi NIK

- [x] 6.1 Ganti stub `departemenOf()` di `auth/scope.ts` dengan `select department_id from employees where nik = $1`, dan **kembalikan id-nya, bukan namanya** — nama yang dibandingkan dengan kolom uuid tidak error, ia hanya selalu kosong (D9)
- [x] 6.2 Perbarui komentar di `scope.ts` yang menyatakan employees mendarat di change berikutnya
- [x] 6.3 Verifikasi manual: akun `admin` ber-scope `dept` yang NIK-nya terdaftar **melihat baris**, dan yang NIK-nya tidak terdaftar tetap melihat himpunan kosong — "tidak error" bukan bukti yang cukup di sini
- [x] 6.4 Tambahkan validasi NIK terhadap data karyawan di route pembuatan/penyuntingan akun (422 bila tidak ditemukan), dengan pengecualian untuk seed superadmin bootstrap (D2)
- [x] 6.5 Tambahkan validasi NIK per baris di `routes/users-import.ts` sebagai error, menggantikan penerimaan sementara; perbarui pesan menjadi "NIK tidak terdaftar di data karyawan"
- [x] 6.6 Perbarui komentar di `users-import.ts` dan `db/schema.ts` yang menjelaskan bahwa NIK belum bisa divalidasi

## 7. Export dan import karyawan

- [x] 7.1 Tambahkan target `employees` ke `routes/master-import.ts`: pembacaan workbook, kolom, dan bentuk preview mengikuti target unit yang sudah ada
- [x] 7.2 Parsing kolom keahlian multi-nilai: pisah dengan `;`, trim, buang duplikat, cocokkan tanpa memedulikan huruf besar-kecil (spec master-import)
- [x] 7.3 Sambungkan referensi katalog karyawan ke jalur `pendingOf`/`newMasters` yang sudah dipakai import unit, dengan predikat `mayCreate` yang menanyakan `manage` per katalog (D11)
- [x] 7.4 Kecualikan `kode-simper` dari jalur itu: kode kualifikasi yang tidak resolve selalu menggagalkan barisnya, dan teks issue-nya harus menjelaskan kenapa — bukan sekadar "tidak ada di master" (D11)
- [x] 7.5 Pastikan katalog yang dibuat dari import karyawan ditulis di dalam transaksi yang sama dengan karyawannya, dan `mastersCreated` dilaporkan di respons commit
- [x] 7.6 `GET` template dan export `.xlsx` karyawan, dengan kolom yang identik antara export dan import agar file hasil export bisa langsung diimpor kembali
- [x] 7.7 Route preview dan commit, dijaga `manage` pada `employees`; commit me-parse ulang file dan mengevaluasi ulang izin di balik setiap penambahan katalog, bukan mempercayai preview yang dikembalikan klien
- [x] 7.8 Tambahkan test di `master-import.test.ts` untuk: round-trip export→import tanpa perubahan, sel keahlian multi-nilai, sel keahlian kosong, NIK duplikat dalam satu file, kode SIMPER tak dikenal selalu menjadi error, jabatan tak dikenal menjadi `newMasters`, dan jabatan tak dikenal menjadi error ketika pemanggil tidak memegang `manage` pada `jabatan`

## 8. Seed (`apps/api/src/db`)

- [x] 8.1 Seed katalog `perusahaan` (dua PT dari form) dan `jabatan` (jabatan yang muncul di data contoh) secara idempoten by name di `seed-master.ts`
- [x] 8.2 Berikan `manage` pada `perusahaan` dan `jabatan` kepada `superadmin` dan `manpower` di `seed.ts`, tanpa mengubah grant yang sudah ada
- [x] 8.3 Seed sepuluh karyawan contoh dari `employees-data.ts` beserta keahliannya, **hanya bila tabel `employees` kosong**, mengikuti pola guard unit (D13)
- [x] 8.4 Jalankan seed dua kali berturut-turut dan pastikan tidak ada duplikat serta tidak ada error

## 9. Integrasi web (`apps/web`)

- [x] 9.1 Buat `lib/queries/employees.ts` mengikuti bentuk `lib/queries/units.ts`: `queryOptions` untuk daftar berfilter dan untuk satu karyawan, plus tipe baris turunan
- [x] 9.2 Sambungkan `components/menus/employees.tsx` ke API: baris dari query, pencarian dan filter dikirim ke server, mutasi memanggil `invalidateQueries` (bukan `router.refresh()`)
- [x] 9.3 Hapus pilihan filter `cuti` dan badge-nya dari layar daftar (D7)
- [x] 9.4 Sambungkan `components/menus/employees-detail.tsx` ke API dengan prefetch + hydration di route-nya
- [x] 9.5 Sambungkan `components/menus/employees-form.tsx`: perusahaan dan jabatan menjadi dropdown katalog, keahlian menulis kode SIMPER, submit benar-benar membuat/menyunting lewat API
- [x] 9.6 Sambungkan Dropzone foto ke endpoint upload dan tampilkan foto tersimpan di daftar dan detail, dengan inisial nama sebagai fallback
- [x] 9.7 Sambungkan tombol import dan export di toolbar ke route preview/commit, memakai komponen hasil import yang sudah dipakai layar lain
- [x] 9.8 Tambahkan dua menu master baru ke `lib/nav.ts` dan `components/menus/registry.tsx`, dan buat route-nya
- [x] 9.9 Hapus `lib/employees-data.ts` dan pastikan tidak ada lagi yang mengimpornya
- [x] 9.10 Tambahkan string i18n untuk label dan pesan baru; jangan tinggalkan teks Indonesia yang di-hardcode di komponen
- [x] 9.11 Pastikan tidak ada warna hex arbitrer di className baru — hanya token dari `app/globals.css`

## 10. Verifikasi

- [x] 10.1 `bun run --cwd apps/api test` — seluruh test API lulus
- [x] 10.2 `bun run format:check` dan `bun run lint` dari root
- [x] 10.3 `rm -rf apps/web/.next`, lalu `tsc --noEmit` dan `next build` untuk apps/web
- [x] 10.4 Uji jalur ujung ke ujung: buat karyawan, unggah foto, muat ulang halaman, sunting, lalu hapus dan pastikan penolakan 409 muncul ketika ada akun dengan NIK yang sama
- [x] 10.5 Uji jalur scope: masuk sebagai akun `dept` yang NIK-nya terdaftar dan pastikan daftarnya berisi; masuk sebagai akun `self` dan pastikan hanya satu baris miliknya sendiri
- [x] 10.6 Uji import: unggah hasil export tanpa diubah dan pastikan preview membaca "0 baru, 0 berubah"
- [x] 10.7 Perbarui bagian status di `README.md` — Karyawan pindah dari daftar "static design port" ke daftar yang sudah tersambung API, dan `PHOTO_DIR` masuk ke catatan deployment bersama `SOUND_DIR`
