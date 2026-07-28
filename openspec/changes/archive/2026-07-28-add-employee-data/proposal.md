## Why

Karyawan adalah satu-satunya entitas inti UNIVERSE yang masih berupa array
statis di browser (`apps/web/lib/employees-data.ts`), dan ketiadaannya menahan
dua hal yang sudah berdiri di atasnya: **scope `dept` di RBAC mati total** —
`departemenOf()` selalu menjawab `null`, sehingga setiap `admin` departemen
melihat himpunan kosong — dan **import akun menerima NIK yang tidak dikenal**,
karena tidak ada tabel yang bisa membantahnya. Dua change yang sudah diarsipkan
menuliskan lubang ini secara eksplisit (auth D5/D8, master-data D13) dan
menunda pengisiannya ke change ini.

Selain itu, katalog `simper` dan `mess` sampai hari ini belum punya satu pun
referrer — keduanya dibuat justru untuk direferensi karyawan. Dan lingkaran
pencocokan yang menjadi inti produk (spare mana yang boleh mengambil unit
kosong) baru tertutup ketika `employee_skills → simper_codes ← units` ada:
sisi unit sudah jadi, sisi orangnya belum.

## What Changes

- **Tabel `employees`** dengan NIK unik sebagai kunci bisnis: nama, perusahaan,
  jabatan, departemen, tanggal masuk, SIMPER (tipe, nomor, masa berlaku), data
  medis (MCU, masa berlaku, golongan darah, riwayat), mess + blok + kamar,
  telepon, kontak darurat, dan status kepegawaian.
- **Tabel `employee_skills`** — relasi banyak-ke-banyak ke `simper_codes`. Ini
  yang dicocokkan engine alokasi terhadap `units.simper_code_id`.
- **Dua katalog master baru**: `perusahaan` dan `jabatan`, menumpang route
  generik `/v1/master/:kind` yang sudah ada. Master kinds menjadi sebelas.
- **Foto karyawan** disimpan mengikuti pola `sounds`: metadata di Postgres,
  byte di direktori `PHOTO_DIR`, disajikan lewat `Bun.file`, nama file
  digenerate server. `/health` melaporkan direktori tersebut writable.
- **Export dan import spreadsheet karyawan**, mengikuti bentuk
  preview-then-commit yang sudah dipakai katalog dan unit.
- **Scope `dept` menjadi hidup.** `departemenOf()` berubah dari stub menjadi
  query nyata; scope `self` berlaku pada koleksi karyawan.
  **BREAKING (perilaku, bukan API):** caller ber-scope `dept` yang sebelumnya
  selalu melihat himpunan kosong kini melihat data departemennya.
- **BREAKING:** import akun menolak baris yang NIK-nya tidak terdaftar sebagai
  karyawan. Spreadsheet yang sebelumnya lolos kini bisa gagal validasi.
- **BREAKING (data statis):** `employees-data.ts` dihapus; layar Karyawan
  (list, detail, form) dilayani API. Filter status kehilangan pilihan `cuti` —
  status kepegawaian menyusut menjadi `aktif | nonaktif`, dan "cuti" menjadi
  turunan roster pada change berikutnya.
- **Katalog `simper` dan `mess` memperoleh referrer**, sehingga penghapusan
  keduanya kini bisa ditolak 409 dengan jumlah karyawan yang memakainya.

### Non-goals

Roster (upload bulanan, revisi, approval), attendance, Fit To Work, pasangan
PLAN dua operator per unit, dan spare pool. Masing-masing punya sumber data
eksternal atau model sendiri dan menjadi change tersendiri. Riwayat
perpanjangan SIMPER dan MCU juga di luar lingkup: yang disimpan adalah nilai
yang berlaku, bukan jejaknya.

## Capabilities

### New Capabilities

- `employee-data`: karyawan sebagai record terpersistensi — bentuk field dan
  referensi katalognya, NIK sebagai kunci bisnis, keahlian SIMPER sebagai
  relasi banyak-ke-banyak, foto, aturan penghapusan yang menolak karyawan
  berjejak, dan aturan bahwa setiap layar yang menawarkan karyawan membacanya
  dari API.

### Modified Capabilities

- `master-data`: jumlah katalog berubah dari sembilan menjadi sebelas
  (`perusahaan`, `jabatan`), dan perlindungan referensial kini juga berlaku
  bagi `simper`, `mess`, `departemen`, dan `kode-simper` melalui karyawan.
- `master-import`: export dan import spreadsheet meluas ke karyawan, dengan
  kolom multi-nilai untuk keahlian SIMPER.
- `rbac`: scope `dept` menjadi dapat diselesaikan; skenario "employee master
  data belum ada" digantikan skenario "tidak ada karyawan dengan NIK itu", dan
  scope `self` memperoleh koleksi pertama yang benar-benar dibatasinya.
- `auth`: import akun memvalidasi NIK terhadap data karyawan, menggantikan
  skenario yang menerima NIK asing untuk sementara.

## Impact

**`packages/contracts`** — `MASTER_KINDS` dan `MENU_SLUGS`/`MENU_LABELS`
bertambah `perusahaan` dan `jabatan`; enum baru untuk status kepegawaian,
status MCU, dan golongan darah; kolom import karyawan.

**`apps/api`** — tabel `employees` dan `employee_skills` di `db/schema.ts`
beserta migrasinya; `routes/employees.ts` dan bagian import/export-nya;
`routes/schemas.ts`; `auth/scope.ts` (`departemenOf()` berhenti menjadi stub —
dan karena departemen kini uuid, yang dikembalikan adalah `dept_id`, bukan
nama); `routes/users-import.ts` (validasi NIK); `routes/master.ts`
(`countReferences` untuk katalog yang kini direferensi); `db/seed.ts`;
`env.ts` dan `/health` untuk `PHOTO_DIR`; `storage.ts`.

**`apps/web`** — `lib/queries/employees.ts` baru; `lib/employees-data.ts`
dihapus; `components/menus/employees.tsx`, `employees-detail.tsx`, dan
`employees-form.tsx` beralih ke API; `lib/nav.ts` dan
`components/menus/registry.tsx` untuk dua menu master baru.

**Operasional** — `PHOTO_DIR` wajib menunjuk volume yang bertahan melewati
redeploy; tanpa itu setiap foto hilang di deploy berikutnya sementara barisnya
tetap ada di database. Urutan provisioning menjadi penting: karyawan lebih
dulu, akun kemudian, karena akun `dept` yang NIK-nya belum terdaftar tetap
buta.
