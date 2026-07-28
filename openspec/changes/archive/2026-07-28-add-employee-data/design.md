## Context

Karyawan adalah entitas inti terakhir yang masih berupa array statis di
browser. `apps/web/lib/employees-data.ts` memegang sepuluh orang contoh, dan
tiga layar membacanya: daftar, detail, dan form. Formnya sendiri sudah setengah
tersambung — departemen, mess, tipe SIMPER, dan kode SIMPER sudah diambil dari
`/v1/master/:kind` lewat TanStack Query — jadi yang statis tinggal record
orangnya.

Dua change yang sudah diarsipkan meninggalkan lubang berbentuk persis tabel
ini, dan keduanya menuliskannya:

- **auth D5/D8.** `users.nik` sengaja tanpa foreign key, dan
  `auth/scope.ts:73` `departemenOf()` mengembalikan `null` tanpa syarat —
  dengan komentar bahwa employees mendarat di change berikutnya. Akibatnya
  scope `dept` fail-closed: setiap `admin` melihat himpunan kosong.
- **master-data D13.** `employees.dept_id`, `mess_id`, dan join
  `employee_skills → simper_codes` disebut namanya dan ditunda, dengan alasan
  bahwa arah referensinya membuat penundaan itu aman: karyawan menunjuk
  katalog, bukan sebaliknya.

Dua katalog — `simper` dan `mess` — sampai hari ini tidak punya satu pun
referrer (`master.ts` menulis `countReferences: null` untuk keduanya). Keduanya
dibuat untuk direferensi karyawan.

Batasannya: monorepo Bun + Turbo, Elysia + Drizzle + Postgres di API, Next.js
App Router + TanStack Query di web, tipe mengalir lewat Eden Treaty tanpa
codegen. Enum hidup di `packages/contracts` supaya DB, API, dan klien tidak
bisa menyimpang. Setiap route mendeklarasikan `body`, `params`, dan `response`
karena spek OpenAPI-nya adalah kontrak untuk klien mobile nanti.

## Goals / Non-Goals

**Goals:**

- Karyawan menjadi record terpersistensi dengan NIK sebagai kunci bisnis, dan
  ketiga layar Karyawan dilayani API.
- Menutup lingkaran pencocokan: `employee_skills → simper_codes ← units`.
  Setelah change ini, "spare mana yang boleh mengambil unit ini" dapat dijawab
  satu query walaupun engine alokasinya belum ada.
- Menghidupkan scope `dept` di RBAC, dan membuat import akun memvalidasi NIK.
- Menambah dua katalog (`perusahaan`, `jabatan`) tanpa menambah satu pun
  handler baru — keduanya menumpang route generik yang sudah ada.
- Export/import spreadsheet karyawan dengan bentuk preview-then-commit yang
  sama seperti katalog dan unit.

**Non-Goals:**

- Roster, attendance, Fit To Work, pasangan PLAN dua-operator-per-unit, dan
  spare pool. Masing-masing punya sumber data eksternal atau model sendiri.
- Riwayat perpanjangan SIMPER dan MCU. Yang disimpan adalah nilai yang
  berlaku.
- Engine alokasi. Change ini menyediakan sisi orangnya, bukan penjodohannya.
- Menaikkan `jabatan` menjadi penentu spare pool. Lihat D5.

## Decisions

### D1 — Satu tabel lebar, satu tabel join

`employees` menampung seluruh atribut orang dalam satu baris — identitas,
kepegawaian, SIMPER, medis, mess, kontak — dan hanya keahlian yang dipisah,
karena keahlian memang banyak-ke-banyak dan tidak bisa jadi kolom.

Preseden di repo ini sudah tegas: `units` adalah satu tabel lebar dengan enam
foreign key, bukan konstelasi tabel satelit. Memecah karyawan menjadi
`employee_medical`, `employee_contacts`, dan `employee_housing` akan
menghasilkan tiga tabel yang seluruhnya satu-ke-satu, seluruhnya dibaca
bersama di setiap layar, dan seluruhnya hanya menambah join tanpa menambah
kebenaran apa pun. Satu-ke-satu yang tidak pernah nol dan tidak pernah dua
bukan relasi; itu kolom.

**Alternatif yang dipertimbangkan:** tabel satelit per bagian form. Menarik
kalau bagian-bagian itu diisi oleh peran berbeda dengan izin berbeda — misalnya
medis hanya boleh disentuh `medic`. Itu memang benar untuk Fit To Work, tapi
Fit To Work adalah layar dan tabelnya sendiri; kolom MCU di sini adalah
ringkasan kepegawaian, bukan rekam medis.

### D2 — `id` uuid sebagai primary key, `nik` sebagai kunci bisnis unik

Tabel memakai `id uuid` primary key seperti seluruh tabel lain, dan `nik text
notNull unique`. Route dan URL web dikunci pada NIK
(`/v1/employees/:nik`, `/employees/[nik]`), persis seperti unit dikunci pada
`code` sementara primary key-nya uuid.

Alasannya bukan estetika: NIK adalah nomor yang diterbitkan manusia dan
sesekali dikoreksi. Sebagai primary key, koreksi satu digit berarti cascade ke
setiap tabel yang menunjuk karyawan — dan tabel-tabel itu (roster, attendance,
FTW) belum ada, jadi keputusan ini dibuat sekarang justru karena harganya baru
akan ditagih nanti.

`users.nik` tetap **tanpa** foreign key, sesuai auth D5. Yang bertambah adalah
validasi di lapisan aplikasi, bukan constraint di database, dan keduanya bukan
hal yang sama:

- **Validasi berlaku di kedua jalur pembuatan akun** — route pembuatan satuan
  maupun import spreadsheet. Aturannya satu: NIK harus menemukan karyawan.
  Alasannya bukan kerapian melainkan fungsi — akun ber-scope `dept` atau `self`
  yang NIK-nya tidak menemukan siapa pun lahir dalam keadaan buta (D9), dan
  menolaknya saat dibuat jauh lebih baik daripada menyerahkan akun yang diam
  tidak menampilkan apa-apa. Kalau import lebih ketat daripada form, operator
  akan memutar lewat form.
- **Constraint tetap tidak ada**, karena siklus hidup keduanya berbeda:
  menghapus karyawan tidak boleh menghanyutkan akunnya (D10 justru menolak
  penghapusan itu), dan kebijakan di lapisan aplikasi bisa dilonggarkan
  per-route kalau kelak ada jenis akun yang memang bukan karyawan — akun
  integrasi, misalnya — sementara foreign key tidak bisa.
- **Superadmin bootstrap dikecualikan.** Seed membuat dan memulihkan akun itu
  tanpa memeriksa karyawan. Akun yang ada justru untuk memulihkan instalasi
  yang salah konfigurasi tidak boleh bisa diblokir oleh master data yang belum
  ada — itu akan mengunci semua orang di luar tepat pada database yang paling
  membutuhkannya.

### D3 — SIMPER dan MCU inline; tidak ada tabel riwayat

`simper_type_id`, `simper_no`, `simper_exp`, `mcu`, `mcu_exp`, `blood`, dan
`medical` adalah kolom di `employees`.

Keduanya punya tanggal kedaluwarsa, yang berarti keduanya diperpanjang, dan
model ini tidak menyimpan jejak perpanjangan itu: memperbarui SIMPER menimpa
nomor dan tanggal lama. Yang dibaca sistem hanyalah "apakah berlaku hari ini",
dan itulah satu-satunya pertanyaan yang diajukan engine alokasi maupun ketiga
layar yang ada.

**Alternatif yang dipertimbangkan:** `employee_simpers` dengan satu baris aktif
plus riwayat. Memberi jejak audit perpanjangan dan bisa menjawab "siapa yang
expired bulan lalu". Ditolak karena tidak ada satu pun layar atau aturan yang
menanyakannya hari ini, dan karena arah referensinya membuat promosi nanti
tetap murah: kolom pindah ke tabel baru, sementara tidak ada yang menunjuk
kolom-kolom itu dari luar. Ini penundaan yang aman dengan alasan yang sama
seperti master-data D13.

### D4 — Keahlian adalah foreign key, bukan teks

`employee_skills(employee_id, simper_code_id)` dengan primary key gabungan
kedua kolom, dan `onDelete: "restrict"` ke `simper_codes` sejalan dengan
seluruh repo.

Ini bagian yang paling penting untuk produk, dan alasannya bukan kebersihan
skema. Data statis menyimpan keahlian sebagai array string (`["OHT 777", "OHT
773"]`) sementara `units.simper_code_id` sudah berupa uuid. Mencocokkan
keduanya berarti membandingkan nama dengan kunci, dan satu kode yang diketik
salah tidak menghasilkan error — ia menghasilkan spare yang tidak pernah cocok
dengan unit mana pun. Gejalanya adalah unit menganggur di awal shift, yaitu
persis kegagalan yang ingin dicegah produk ini, dan ia tidak akan pernah muncul
sebagai pesan kesalahan.

Primary key gabungan, bukan `id` sendiri: baris kedua untuk pasangan yang sama
tidak punya makna, dan menolaknya di skema lebih murah daripada menolaknya di
tiap penulis.

### D5 — `perusahaan` dan `jabatan` menjadi katalog kesepuluh dan kesebelas

Keduanya menumpang `/v1/master/:kind`. Yang bertambah adalah entri di
`MASTER_KINDS`, `MENU_SLUGS`, `MENU_LABELS`, `KIND_TABLES`,
`MASTER_IMPORT_COLUMNS`, `lib/nav.ts`, `registry.tsx`, dan seed — **nol handler
baru**. Inilah yang dibeli master-data D3 dengan route generiknya, dan change
ini adalah penagihan pertamanya.

Argumen D2 dari master-data berlaku identik: `PT UDU` di sebelah `PT Unggul
Dinamika Utama` adalah kecelakaan pengetikan dalam setiap kasus, dan begitu
keduanya ada, separuh karyawan menunjuk yang satu dan separuh yang lain.
Perusahaan hari ini dua nilai hardcoded di `<option>`; jabatan hari ini
`<Input>` bebas dengan nilai yang berulang di ratusan baris dan dipakai
memfilter.

Keduanya memakai bentuk katalog **berdeskripsi** (`describedCatalogueColumns`),
sama seperti `departemen`, bukan varian baru.

**Alternatif yang dipertimbangkan.** _Enum di contracts_ untuk perusahaan:
nol tabel dan nol menu, tapi menambah PT baru menjadi perubahan kode dan
deploy, sementara ini justru pekerjaan administratif. _Teks bebas untuk
jabatan:_ termurah sekarang, tapi promosinya nanti adalah migrasi data yang
harus menebak mana `Driver OHT` dan mana `driver oht`. _Katalog jabatan dengan
kolom `is_operator`_ untuk menandai siapa yang masuk spare pool: ditolak karena
menambah varian keempat pada `extra` di `KIND_TABLES` (kini hanya `none`,
`description`, `type`) demi mendahului keputusan model alokasi yang lingkupnya
sudah dikeluarkan dari change ini.

### D6 — Garis antara katalog, enum, dan teks bebas

Tiga vokabulari kecil lain muncul di form, dan ketiganya **tidak** menjadi
katalog:

| Nilai                           | Bentuk              | Alasan                                                                  |
| ------------------------------- | ------------------- | ----------------------------------------------------------------------- |
| Status MCU                      | enum di `contracts` | vokabulari tertutup, tidak dikelola admin, hanya dirender sebagai label |
| Golongan darah                  | enum di `contracts` | sama, dan jumlahnya tidak akan berubah                                  |
| Status kepegawaian              | enum di `contracts` | lihat D7                                                                |
| Blok, kamar, HP, kontak darurat | teks bebas          | master-data D5 sudah memutuskannya                                      |

Garisnya: **sesuatu menjadi katalog kalau admin perlu menambahnya tanpa deploy,
atau kalau ada yang menunjuknya dengan foreign key.** Golongan darah tidak
memenuhi keduanya. Pola enum-nya mengikuti `AREA_TYPES` — nilai di
`packages/contracts`, `pgEnum` diturunkan darinya, TypeBox memvalidasi terhadap
daftar yang sama.

### D7 — Status menyusut menjadi `aktif | nonaktif`

Data statis punya tiga nilai: `aktif`, `cuti`, `nonaktif`. Yang tengah dibuang.

"Cuti" adalah keadaan **per tanggal** yang berasal dari roster — README sudah
menuliskannya sebagai penyebab unit kosong yang harus diisi spare. Kolom status
tidak punya tanggal, jadi menyimpannya di sini berarti dua sumber kebenaran
yang salah satunya tidak bisa menjawab "cuti sampai kapan". Ketika roster
mendarat, `employees.status = 'aktif'` bisa berdiri berhadapan dengan roster
yang bilang orang ini cuti, dan engine alokasi harus memilih salah satu.

Konsekuensi yang terlihat sekarang: filter status di layar Karyawan kehilangan
satu pilihan, dan badge `cuti` hilang dari daftar sampai roster mendarat. Itu
kemunduran tampilan yang disengaja — layar yang menampilkan status cuti yang
tidak ada penulisnya lebih buruk daripada layar yang tidak menampilkannya.

**Alternatif yang dipertimbangkan:** menyimpan tiga nilai tapi menolak `cuti`
di request body, sehingga hanya roster yang boleh menulisnya. Menjaga tampilan
tetap utuh, tapi meninggalkan nilai enum yang belum punya penulis sama sekali,
dan itu membuat pembaca skema harus mencari siapa yang menulisnya untuk
menemukan bahwa jawabannya "belum ada".

### D8 — Foto mengikuti pola `sounds`, bukan Postgres

`employees.photo_file_name` nullable menyimpan nama file; byte-nya ditulis ke
`env.PHOTO_DIR` dan disajikan lewat `Bun.file`. Nama file **digenerate server**
(`storedFileName`: uuid + ekstensi yang divetting), sehingga upload bernama
`../../etc/passwd` tidak pernah menyentuh path — nama klien tidak dibersihkan
dari traversal, ia sama sekali tidak dipakai. `/health` ikut melaporkan
direktori ini writable dengan menulis dan menghapus file probe, sama seperti
`pingSoundStorage`.

`storage.ts` digeneralisasi: yang hari ini `soundPath`/`writeSound`/
`deleteSound`/`pingSoundStorage` menjadi fungsi berparameter direktori, dengan
dua pembungkus tipis. Konstanta ukuran dan daftar ekstensi terpisah — foto
menerima `.jpg`/`.jpeg`/`.png`/`.webp`, suara tidak.

`PHOTO_DIR` adalah konfigurasi eksplisit dengan alasan yang sama seperti
`SOUND_DIR` dan `COOKIE_SECURE`: direktori yang benar bergantung pada cara API
di-deploy, bukan pada environment yang diyakininya. Di container ephemeral ini
**wajib** volume ter-mount, kalau tidak setiap foto hilang di redeploy
berikutnya sementara barisnya tetap ada di database.

**Alternatif yang dipertimbangkan:** base64 di kolom Postgres. Nol
infrastruktur dan ikut ter-backup bersama database, tapi setiap `SELECT` daftar
karyawan menyeret byte gambar kecuali kolomnya dikecualikan eksplisit di setiap
query — dan `sounds` sudah memutuskan hal yang sama ke arah sebaliknya dengan
alasan yang lebih lemah (satu klip untuk beberapa kiosk, bukan ratusan foto).

### D9 — `departemenOf()` mengembalikan `dept_id`, bukan nama

Ini perubahan kecil dengan jebakan besar.

`ScopeColumns.dept` di `auth/scope.ts` dirancang ketika departemen masih teks
bebas. Sejak master-data D2, departemen adalah uuid. Kalau `departemenOf()`
mengembalikan **nama** dan dibandingkan dengan kolom `dept_id`, hasilnya bukan
error melainkan `eq(uuid, text)` yang tidak pernah cocok — dan gejalanya adalah
scope `dept` yang tetap kosong, yaitu persis keadaan hari ini. Bug ini akan
terlihat seperti "belum selesai", bukan seperti "salah".

Maka: `departemenOf(nik)` menjalankan satu query
`select dept_id from employees where nik = $1`, dan setiap tabel ber-scope
menyodorkan kolom `dept_id`-nya ke `scopeWhere`. Untuk `employees` sendiri:
`scopeWhere(principal, { dept: employees.deptId, self: employees.nik })`.

Sifat fail-closed dari D8 auth dipertahankan utuh: NIK yang tidak menemukan
karyawan tetap menghasilkan `sql\`false\``, bukan koleksi penuh. Yang berubah
hanyalah bahwa kini ada NIK yang bisa menemukannya.

**Konsekuensi operasional yang harus dituliskan:** akun `admin` yang NIK-nya
belum terdaftar sebagai karyawan tetap buta. Urutan provisioning menjadi
karyawan dulu, akun kemudian.

### D10 — Menghapus karyawan ditolak kalau ada jejak

`DELETE /v1/employees/:nik` menjawab 409 bila ada yang menunjuk karyawan itu,
dan pesannya menyebut apa. Hari ini daftar pemeriksaannya berisi satu hal:
akun dengan `users.nik` yang sama. Ketika roster dan attendance mendarat,
daftar itu bertambah.

Bentuknya menyalin `countReferences` di `master.ts` — resolve dulu, jawab
dengan jumlah dan nama penghalangnya — bukan mengandalkan
`isForeignKeyViolation`. Alasannya sama dengan yang ditulis `units.ts`:
pelanggaran foreign key hanya bilang bahwa _sesuatu_ tidak resolve, dan
operator yang menghapus perlu tahu apa. Lagipula `users.nik` **bukan** foreign
key (D2), jadi tanpa pemeriksaan eksplisit akun akan menjadi yatim tanpa satu
pun constraint yang mengeluh.

Jalur normal untuk karyawan yang keluar adalah **nonaktif**, bukan hapus.
Menghapus disediakan untuk baris salah input — terutama dari import
spreadsheet — yang belum sempat dipakai apa pun.

### D11 — Import karyawan menawarkan katalog baru, kecuali kode SIMPER

Import karyawan memakai mesin yang sama dengan import unit: preview lalu
commit, kolom tak dikenal ditolak, dan nilai katalog yang tidak ditemukan
**ditawarkan** untuk dibuat — dilaporkan sebagai peringatan per baris,
dikumpulkan menjadi satu entri per nilai berikut jumlah baris yang memintanya,
dan ditulis hanya setelah operator mengonfirmasi, di dalam transaksi yang sama
dengan karyawannya. Pemanggil yang tidak memegang `manage` pada katalog
tersebut tetap mendapat penolakan per baris, karena import bukan jalan memutar
atas izin masternya sendiri.

Berlaku untuk perusahaan, jabatan, departemen, mess, dan tipe SIMPER.

**Satu pengecualian: `kode-simper` tidak pernah dibuat dari import karyawan.**
Baris yang menyebut kode kualifikasi tak dikenal ditolak dengan nomor barisnya.

Alasannya adalah asimetri akibat. Membuat `perusahaan` atau `jabatan` baru dari
salah ketik menghasilkan label jelek yang bisa dirapikan kapan saja — kerugian
kosmetik, dan terlihat. Membuat `kode-simper` baru dari salah ketik
menghasilkan **klaim kualifikasi yang tidak pernah cocok dengan unit mana pun**:
operatornya tampak punya keahlian, unitnya tetap menganggur di awal shift, dan
tidak ada pesan kesalahan di mana pun. Kode kualifikasi adalah satu-satunya di
antara keenam referensi yang merupakan pernyataan keselamatan, bukan penamaan —
dan satu-satunya yang kegagalannya diam.

Kolom keahlian di spreadsheet adalah satu sel multi-nilai (`kode_simper`
dipisah `;`), karena satu kolom per kode berarti lebar file berubah setiap
katalog bertambah.

**Alternatif yang dipertimbangkan:** menolak seluruh nilai katalog tak dikenal,
tanpa pengecualian. Konsisten dalam dirinya sendiri, tapi membuat pengisian data
awal site menuntut lima import katalog dalam urutan yang benar sebelum satu
karyawan pun bisa masuk — sementara kelima daftar itu sudah ada di dalam sheet
karyawan. Ini persis argumen yang sudah dimenangkan `add-master-data` D10 untuk
import unit; mengulang perdebatannya di sini hanya akan membuat dua import
berperilaku berbeda dalam situasi yang sama.

> **Catatan.** Saat menulis desain ini ditemukan bahwa
> `openspec/specs/master-import/spec.md` masih memuat aturan lama ("nilai tak
> dikenal menggagalkan barisnya") sementara `master-import.ts` sudah lama
> menawarkan pembuatan katalog, lengkap dengan test — perilaku yang dijelaskan
> di `add-master-data` design D10 tapi tidak ikut tersalin saat spec di-sync.
> Kode dinyatakan yang benar, dan spec utama sudah diperbaiki agar sesuai. D11
> berdiri di atas spec yang sudah dikoreksi itu.

### D12 — Pencarian dan filter dilayani server, seperti `units`

Daftar karyawan memakai query key berisi filter, dan pencarian dijalankan API,
bukan disaring di browser dari daftar penuh. Jumlah karyawan di site nyata
berada di ratusan sampai ribuan, dan pencariannya harus menjangkau nama katalog
hasil join — departemen, jabatan, perusahaan — yang tidak diindeks klien.
`lib/queries/employees.ts` mengikuti bentuk `lib/queries/units.ts` persis:
`queryOptions` dipakai bersama oleh prefetch server dan `useQuery` klien,
mutasi melakukan `invalidateQueries`.

`lib/employees-data.ts` dihapus, bukan dikosongkan. Modul data statis yang
tertinggal akan dipakai lagi oleh layar berikutnya yang belum tersambung.

### D13 — Seed: katalog idempoten, karyawan contoh hanya ke tabel kosong

Mengikuti master-data D14 tanpa perubahan. `perusahaan` dan `jabatan` di-seed
berdasarkan nama dan melewati yang sudah ada. Sepuluh karyawan contoh — orang
yang sama dengan `employees-data.ts` supaya aplikasi setelah migrasi terlihat
persis seperti sekarang — ditulis **hanya bila tabel `employees` kosong**.
Database yang pernah memuat karyawan sungguhan tidak akan pernah menerima orang
karangan.

## Risks / Trade-offs

**Scope `dept` berubah dari kosong menjadi berisi, dan itu pembukaan akses,
bukan perbaikan bug.** → Perubahannya diucapkan sebagai BREAKING di proposal,
dan sifat fail-closed dipertahankan: hanya NIK yang menemukan karyawan yang
membuka data. Urutan provisioning (karyawan dulu, akun kemudian) menjadi bagian
dari catatan rilis, bukan pengetahuan lisan.

**`departemenOf()` yang mengembalikan nama alih-alih `dept_id` tidak akan
menghasilkan error.** → Gejalanya identik dengan keadaan hari ini, sehingga
lolos review dengan mudah. Mitigasi: tipe kembaliannya dinamai eksplisit
sebagai id, dan tasks memuat verifikasi manual bahwa akun `dept` benar-benar
melihat baris setelah karyawannya ada — bukan sekadar "tidak error".

**Import akun yang sebelumnya lolos kini bisa gagal.** → Spreadsheet berisi NIK
yang tidak terdaftar akan ditolak per baris. Ini disengaja dan dituliskan
sebagai BREAKING; mitigasinya adalah urutan yang sama: data karyawan diimpor
lebih dulu.

**`PHOTO_DIR` di container ephemeral tanpa volume menghapus setiap foto pada
redeploy, sementara barisnya bertahan.** → `/health` melaporkan direktori
writable sehingga mount yang hilang muncul saat startup, bukan saat upload
pertama. Tapi writable ≠ persisten, dan tidak ada pemeriksaan yang bisa
membedakan keduanya — ini dokumentasi, bukan pengaman.

**Kode SIMPER yang salah ketik menghasilkan spare yang tidak pernah cocok,
tanpa pesan apa pun.** → D4 memindahkannya ke foreign key sehingga nilai asing
mustahil tersimpan lewat API, dan D11 menolaknya di import alih-alih
membuatkannya. Yang tersisa: salah _pilih_ di antara kode yang sah, dan itu di
luar jangkauan skema.

**Menghapus departemen, mess, tipe SIMPER, atau kode SIMPER kini bisa ditolak
409 karena ada karyawan yang memakainya.** → Ini memang tujuannya, tapi layar
master akan menolak penghapusan yang kemarin berhasil. Pesannya harus menyebut
jumlah karyawan, mengikuti bentuk yang sudah dipakai unit.

**Dua slug menu baru dalam satu change.** → Menu Master menjadi sebelas item.
Biaya per slug kecil (`MENU_SLUGS`, label, nav, registry, seed, grant) tapi
tidak nol, dan keduanya menuntut keputusan grant di seed role.

## Migration Plan

Urutan yang membuat setiap langkah bisa diverifikasi sendiri:

1. **`packages/contracts` lebih dulu** — `MASTER_KINDS`, `MENU_SLUGS`,
   `MENU_LABELS`, enum status kepegawaian/MCU/golongan darah, dan kolom import
   karyawan. API dan web sama-sama bersandar padanya, jadi ia tidak boleh
   menyusul.
2. **Skema dan migrasi** — dua katalog baru, `employees`, `employee_skills`.
   `db:generate` lalu `db:migrate`. Aditif seluruhnya: tidak ada tabel yang
   diubah bentuknya, tidak ada data yang dipindah.
3. **Seed** — katalog baru idempoten by name; karyawan contoh hanya ke tabel
   kosong; grant untuk dua menu baru pada role yang sudah memegang menu master
   lain.
4. **API** — route karyawan, foto, import/export, lalu `scope.ts`,
   `users-import.ts`, dan `countReferences` di `master.ts`.
5. **Web** — `lib/queries/employees.ts`, tiga layar Karyawan, dua menu master
   baru, penghapusan `employees-data.ts`.

**Rollback.** Arah referensinya membuat pembatalan murah: tidak ada tabel lama
yang menunjuk `employees`, jadi menjatuhkan dua tabel dan dua katalog
mengembalikan keadaan sebelumnya. Yang tidak ikut kembali adalah akun yang
sudah terlanjur diimpor dengan NIK asing sebelum validasinya menyala — tapi
itu memang keadaan yang berlaku hari ini, jadi rollback mengembalikannya ke
toleransi yang sama.

**Verifikasi web** mengikuti pipeline yang sudah berlaku: `rm -rf .next`,
`prettier`, `tsc --noEmit`, `eslint`, `next build`.

## Open Questions

- **Apakah pengecualian `kode-simper` di D11 akan terasa sewenang-wenang bagi
  operator?** Lima kolom menawarkan penambahan dan satu kolom menolak. Teks
  penolakannya harus menjelaskan alasannya di tempat, bukan sekadar "tidak ada
  di master" — kalau tidak, ia terbaca sebagai bug.
- **Apakah `jabatan` akhirnya perlu penanda `is_operator`?** Ditunda ke change
  alokasi. Kalau ya, ia menambah varian keempat pada `extra` di `KIND_TABLES`,
  atau `jabatan` keluar dari route generik menjadi route sendiri.
- **Perusahaan sebagai dimensi scope.** Kalau kelak ada peran yang dibatasi per
  PT, `SCOPES` bertambah dan `ScopeColumns` ikut. Tidak ada yang memintanya
  sekarang, dan `company_id` sudah cukup untuk menjawabnya nanti.
