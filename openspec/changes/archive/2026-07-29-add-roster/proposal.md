## Why

Roster adalah masukan **pertama** mesin alokasi dan satu-satunya yang belum
ada. README menaruhnya di depan segalanya — "Roster first" — karena setiap
keputusan pagi hari bermula dari satu pertanyaan: _siapa terjadwal shift apa
hari ini._ Tanpa tabel yang menjawabnya, PLAN tidak punya lawan bicara, kolam
spare tidak bisa disaring per shift, dan ACTUAL tidak bisa dihitung sama
sekali.

Tiga layarnya sudah berdiri lengkap sebagai port statis (tujuh komponen, ±2.000
baris) tapi tidak menyimpan apa pun: unggahan memakai `setInterval` sebagai
progress palsu, revisi hilang begitu halaman ditinggalkan, dan approval hanya
memanggil `setState`. Change `add-employee-data` yang sudah diarsipkan menyebut
roster sebagai non-goal-nya dan menitipkan dua hal ke sini — status `cuti` yang
dicabut dari data karyawan karena semestinya turunan roster, dan relasi
`employee_skills → simper_codes ← units` yang sudah tertutup di kedua sisi tapi
belum punya yang menanyakannya.

Ada juga satu kontradiksi yang harus dibereskan sebelum baris kode pertama:
layar revisi dan approval memakai kosakata (`P-1`, `M-2`) yang tidak ada di
legenda roster (`D`, `N`, `OFF`, …). **Legenda adalah sumber kebenarannya**;
kosakata satunya adalah sisa desain yang tidak pernah dipakai.

## What Changes

- **Kosakata kode roster di `contracts`** — 28 kode dari legenda, masing-masing
  dengan `kind` yang menjawab pertanyaan mesin alokasi. Hanya `D` dan `N` yang
  berarti "terjadwal, shift ini"; 26 sisanya runtuh menjadi "tidak tersedia",
  dengan alasan yang berbeda-beda untuk layar Attendance dan Fit To Work nanti.
  Operator spare dirosterkan persis seperti operator berunit — `D` atau `N` —
  jadi **roster tidak menyebut unit maupun kolam spare sama sekali.**

- **Tabel `roster_documents`** — satu unggahan: departemen, bulan, nama file,
  pengunggah, dan status `aktif | arsip`. Mengunggah ulang bulan yang sama
  mengarsipkan dokumen sebelumnya alih-alih menimpanya.

- **Tabel `roster_days`** — kode harian per karyawan, **dimiliki dokumennya**
  (`UNIQUE (document_id, employee_id, tanggal)`). Roster yang berlaku adalah
  baris milik dokumen `aktif`; dokumen arsip tetap utuh sehingga layar
  detailnya bisa dibuka kapan pun dan menampilkan apa adanya waktu itu.

- **Impor roster dua langkah** mengikuti bentuk preview-then-commit yang sudah
  dipakai katalog, unit, dan karyawan — tapi dengan sheet **berkolom dinamis**
  (`nik | nama | 01 … 31`, lebarnya mengikuti panjang bulan), yang belum pernah
  ada di importer mana pun. Departemen dan bulan dipilih operator di form,
  bukan ditebak dari nama file atau sel header, dan setiap NIK divalidasi
  memang milik departemen itu.

- **Peringatan revisi tertimpa.** Bila file yang diunggah mencakup tanggal yang
  sudah punya revisi disetujui, preview menyebutkannya satu per satu sebelum
  commit — mengunggah akan mengembalikan hari-hari itu ke isi file. Memakai
  bentuk `warnings: ImportErrorRow[]` yang sudah ada, jadi tabel hasilnya tidak
  perlu dibuat baru.

- **Tabel `roster_revisions` + `roster_revision_items`** — satu pengiriman
  berisi N entri, dan **status hidup di entri, bukan di pengiriman**. Itu yang
  sudah tersirat di port statis: daftar revisi menampilkan _himpunan_ badge per
  pengajuan, dan layar approval bertombol per baris.

- **Approval mengubah roster di tempat.** Entri yang disetujui menulis kode
  barunya ke `roster_days`; jejaknya hidup di entri (`dari`, `ke`, penyetuju,
  waktu). Grid roster karenanya selalu menjawab satu pertanyaan dengan satu
  baris, yang penting karena alokasi membacanya dalam jendela lima menit.
  Menolak wajib beralasan; menyetujui boleh tanpa catatan.

- **Revisi menempel pada dokumen.** Mengarsipkan dokumen membekukan revisinya,
  dan revisi yang masih `pending` saat bulan yang sama diunggah ulang ditolak
  otomatis dengan alasan sistem — antrean approval tidak boleh berisi keputusan
  yang tidak berakibat apa-apa.

- **BREAKING (data statis):** `apps/web/lib/roster-data.ts` menyusut menjadi
  presentasi saja (warna sel, pengelompokan legenda). `ROSTER_DOCS`,
  `rosterGrid()`, `upErrorRows()`, dan array `CREW` dihapus; ketujuh komponen
  roster dilayani API.

- **BREAKING (desain):** baris contoh berkode `P-1`/`M-2` di
  `roster-revision.tsx` dan `roster-approval.tsx` hilang bersama kosakatanya.
  Form revisi tidak terpengaruh — `revCodeList()` sudah menurunkan pilihannya
  dari legenda, jadi dropdown-nya sejak awal menawarkan kode yang benar.

- **Karyawan berjejak roster tidak bisa dihapus.** Hari roster dan entri revisi
  menjadi referensi baru yang membuat penghapusan karyawan dijawab 409.

### Non-goals

Mesin alokasi itu sendiri, pasangan PLAN dua operator per unit, kolam spare,
attendance, dan Fit To Work. Roster menyediakan masukannya dan berhenti di
situ — perbedaan antara "terjadwal `D`" dan "benar-benar naik unit" adalah
seluruh isi change berikutnya.

Menurunkan status `cuti` dari roster juga di luar lingkup. Kode roster memang
sudah cukup untuk menjawabnya, tapi yang bertanya adalah layar Attendance, dan
menjawabnya di sini berarti menebak bentuk pertanyaannya lebih dulu.

Riwayat "roster seperti apa sebelum revisi ke-3" tidak disimpan sebagai
snapshot; yang ada adalah rantai `dari → ke` di entri revisi, yang cukup untuk
merekonstruksinya dan tidak menggandakan tabel terbesar di sistem.

## Capabilities

### New Capabilities

- `roster-data`: roster sebagai dokumen bulanan per departemen berisi kode
  harian per karyawan — kosakata 28 kode beserta klasifikasi semantiknya,
  kepemilikan baris oleh dokumen, aturan arsip saat unggah ulang, impor
  spreadsheet berkolom dinamis dengan departemen dan bulan yang dinyatakan
  operator, dan aturan bahwa roster yang berlaku adalah dokumen aktif.

- `roster-revision`: pengajuan revisi sebagai pengiriman berisi banyak entri,
  status per entri, keputusan approval beserta catatan dan alasan wajib saat
  menolak, efek persetujuan terhadap hari roster, dan nasib revisi ketika
  dokumen yang menaunginya diarsipkan.

### Modified Capabilities

- `master-import`: roster menjadi target impor keempat, dan yang pertama
  dengan lebar kolom yang tidak tetap — jumlah kolom hari ditentukan bulan yang
  dipilih, bukan oleh daftar kolom konstan seperti tiga target sebelumnya.
  Preview memperoleh kelas peringatan baru: baris yang akan membatalkan revisi
  yang sudah disetujui.

- `employee-data`: hari roster dan entri revisi menjadi jejak yang menahan
  penghapusan karyawan, menambah daftar referensi yang sebelumnya hanya berisi
  akun.

- `rbac`: subjek sebuah tulisan berscope ditentukan server, bukan diterima
  sebagai field identitas di request body. Revisi roster adalah kasus pertama
  yang menuntutnya — entri menyebut karyawan, dan pengajunya adalah peran
  ber-scope `dept`, sehingga NIK di body harus divalidasi terhadap predikat
  scope sebelum apa pun ditulis. Tidak ada grant yang berubah: matriks yang
  sudah diseed sudah menempatkan pengajuan pada `admin` dan keputusan pada
  `manajer`.

## Impact

**`packages/contracts`** — `ROSTER_CODES` (28 kode) beserta peta `kind`-nya dan
pengelompokan legenda; status entri revisi; kolom tetap sheet roster (`nik`,
`nama`) yang disusul kolom hari dinamis. Semuanya dibaca DB, TypeBox, dan
klien dari satu tempat, seperti enum lain.

**`apps/api`** — `roster_documents`, `roster_days`, `roster_revisions`,
`roster_revision_items` di `db/schema.ts` beserta migrasinya;
`routes/roster.ts` dan `routes/roster-import.ts`; skema TypeBox di
`routes/schemas.ts`; pendaftaran plus tag OpenAPI di `index.ts`;
`routes/employees.ts` untuk jejak penghapusan yang baru.

**`apps/web`** — `lib/queries/roster.ts` baru; `lib/roster-data.ts` menyusut ke
presentasi; ketujuh komponen di `components/menus/roster-*.tsx` beralih ke API;
`roster-upload.tsx` memperoleh pemilih departemen dan bulan serta kehilangan
progress palsunya.

**Operasional** — satu bulan penuh untuk 2.000 karyawan adalah ±62.000 baris
`roster_days`, dan importer memparsinya dua kali (preview lalu commit, karena
commit tidak mempercayai preview yang dikirim balik klien). Preview tidak boleh
mengirim seluruh grid dalam satu respons; halaman pertama plus hitungan, sisanya
dipaginasi server. Urutan provisioning bertambah satu langkah: karyawan lebih
dulu, lalu roster, karena setiap baris roster harus menemukan NIK-nya di
register.
