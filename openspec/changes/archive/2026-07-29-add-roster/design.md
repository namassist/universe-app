## Context

Roster adalah masukan pertama mesin alokasi. Setiap pagi, pada 05:25, sistem
harus menjawab satu pertanyaan untuk sampai seribu unit: _siapa yang terjadwal
shift ini hari ini._ Semua yang lain — PLAN, Fit To Work, fingerprint, SIMPER —
adalah penyaring di atas jawaban itu. Tanpa roster, tidak ada yang bisa
disaring.

Yang sudah ada di repo:

- **Tujuh komponen web** (`components/menus/roster-*.tsx`, ±2.000 baris) lengkap
  sampai dialog dan paginasinya, tapi seluruhnya membaca `lib/roster-data.ts` —
  array statis, grid yang dihasilkan fungsi, dan progress upload berupa
  `setInterval`. Satu-satunya bagian yang sudah nyata adalah `AsyncSelect`
  karyawan di form revisi, yang memanggil `api.v1.employees`.
- **Tiga menu slug** (`roster-data`, `roster-revision`, `roster-approval`) sudah
  ada di `MENU_SLUGS`, jadi tidak ada perubahan RBAC di sisi kosakata menu.
- **`scopeWhere()`** sudah bisa menyaring `dept` lewat `employees.department_id`
  dan `self` lewat NIK — keduanya tinggal dipakai.
- **`ImportErrorRow`** di `contracts/master-import.ts` sudah menyebut roster
  secara eksplisit sebagai salah satu penghasil bentuk itu, jadi tabel hasil
  validasi tidak perlu dirancang ulang.
- **Tiga importer preview-then-commit** (katalog, unit, karyawan) sudah mapan;
  roster mengikuti bentuknya, tapi tidak bisa memakai machinery kolomnya.

Batasannya, dari README dan bukan dari selera: 2.000 karyawan, 500–1.000 unit,
dan alokasi harus selesai antara 05:25 dan 05:30. Satu bulan penuh adalah
±62.000 baris `roster_days`; setahun ±750.000. Itu kecil untuk Postgres tapi
besar untuk satu respons JSON, dan perbedaan itu menentukan beberapa keputusan
di bawah.

Satu kontradiksi diwarisi dari port statis: legenda mendefinisikan 28 kode
(`D`, `N`, `OFF`, `CR`, …) sementara data contoh revisi dan approval memakai
`P-1`, `M-2`, `P-2`. Legenda adalah sumber kebenarannya — dikonfirmasi, bukan
diasumsikan. Kosakata satunya dibuang.

## Goals / Non-Goals

**Goals:**

- Roster terpersistensi sebagai dokumen bulanan per departemen, dengan kode
  harian per karyawan yang bertahan melewati reload dan terlihat oleh semua
  pemanggil.
- Satu pertanyaan alokasi dijawab satu query berindeks: siapa `D` (atau `N`)
  pada tanggal ini, di departemen ini.
- Revisi dan approval yang benar-benar mengubah roster, dengan jejak yang cukup
  untuk menjawab "kenapa hari ini berubah, oleh siapa, kapan".
- Impor spreadsheet yang tidak pernah menghilangkan keputusan yang sudah dibuat
  manusia tanpa mengatakannya lebih dulu.
- Ketujuh layar roster berhenti memakai data contoh.

**Non-Goals:**

- Mesin alokasi, pasangan PLAN, kolam spare, attendance, Fit To Work. Roster
  menyediakan masukan dan berhenti.
- Menurunkan status `cuti` untuk layar Karyawan. Kode roster sudah cukup untuk
  menjawabnya; yang belum jelas adalah bentuk pertanyaannya, dan itu milik
  change Attendance.
- Snapshot roster per versi. Rantai `dari → ke` di entri revisi sudah cukup
  untuk merekonstruksi, dan menggandakan tabel terbesar di sistem untuk itu
  tidak sepadan.
- Notifikasi (email, push) saat revisi diajukan atau diputuskan.

## Decisions

### D1 — Kode roster adalah enum di `contracts`, bukan katalog master

28 kode, ditulis sekali di `packages/contracts`, dibaca DB (`pgEnum`), TypeBox,
dan klien dari satu tempat — persis pola `EMPLOYEE_STATUSES`, `MCU_RESULTS`,
`AREA_TYPES`.

Alternatif yang dipertimbangkan: tabel katalog seperti sebelas katalog master
lain, dengan layar CRUD-nya sendiri. Ditolak karena dua alasan. Pertama, ini
kosakata perusahaan yang stabil, bukan data yang berubah tiap bulan — sebelas
katalog itu berisi merek alat berat dan nama departemen, hal-hal yang memang
bertambah. Kedua dan yang menentukan: setiap kode membawa `kind` (D2) yang
dibaca mesin alokasi, dan `kind` yang bisa diisi lewat form adalah `kind` yang
bisa salah diisi. Kode baru yang `kind`-nya keliru tidak menimbulkan error —
gejalanya adalah operator yang tidak pernah terpilih, atau unit yang menganggur
pagi-pagi. Menambah kode menjadi perubahan kode plus migrasi, dan itu memang
yang seharusnya.

### D2 — Setiap kode membawa `kind`; hanya `D` dan `N` yang berarti bagi alokasi

Di port statis sudah hidup **tiga** taksonomi yang tidak saling setuju:
`legendGroupsFor()` mengelompokkan 28 kode ke 6 grup untuk ditampilkan;
`rosterCodeColor()` mengelompokkannya ke 4 bucket warna; dan mesin alokasi
butuh sumbu ketiga yang belum ditulis. Keduanya yang sudah ada berbeda: grup
"Medis & karantina" pecah dua di fungsi warna — `MCU`/`MCR`/`MCUF` netral,
`ISM`/`OBC`/`KRT` merah. Itu bukan kelalaian; fungsi warna diam-diam
mengkodekan _terjadwal_ versus _mendadak_, perbedaan yang nyata bagi orang yang
menyusun shift dan tidak ada di grup legenda.

Maka: **grup legenda adalah presentasi**, dan sumbu yang selama ini hidup diam
di fungsi warna dinaikkan menjadi `kind` yang eksplisit.

```
kind         kode                                  arti
────────────────────────────────────────────────────────────────────────
day          D                                     terjadwal, shift siang
night        N                                     terjadwal, shift malam
working      R, STB                                bekerja, bukan slot shift
off          OFF, CR, AL, LWP, LWOP, PH, PHD       libur terencana
absent       S, A                                  tidak hadir, mendadak
medical      MCU, MCR, MCUF                        tak tersedia, terjadwal
isolated     ISM, OBC, KRT                         tak tersedia, mendadak
assignment   TGS, DNS, TRV, TR, TRS, IN            tak tersedia, di tempat lain
ended        TERM, EOC, RSG                        bukan karyawan lagi
```

Sembilan `kind` lebih halus dari yang dibutuhkan alokasi — baginya semua kecuali
`day`/`night` runtuh menjadi "tidak tersedia". Tapi Attendance dan Fit To Work
membaca sumbu yang sama dengan pertanyaan berbeda ("kenapa dia tidak ada?"), dan
meruntuhkannya sekarang berarti memisahkannya lagi nanti dari kolom yang sudah
telanjur ditulis.

`kind` **tidak disimpan sebagai kolom.** Ia turunan murni dari kode, jadi peta
`code → kind` di `contracts` adalah satu-satunya definisinya dan tidak bisa
melenceng dari nilai yang tersimpan.

### D3 — `R` dan `STB` tidak menandai kolam spare

Dikonfirmasi: operator spare dirosterkan persis seperti operator berunit — `D`
atau `N`. Spare adalah orang yang **tidak memegang unit di PLAN**, dan itu sifat
pairing, bukan sifat roster. `R` (reguler) dan `STB` (standby) jarang dipakai
dan tidak berarti apa-apa bagi alokasi; keduanya tetap ada di enum karena bisa
muncul di file dan parser tidak boleh menolak baris yang sah.

Konsekuensinya bersih dan layak ditulis: **`roster_days` tidak punya kolom unit,
tidak punya penanda spare, dan tidak tahu PLAN itu ada.** Batas antara ketiga
lapisan jadi tegas — roster menjawab shift, PLAN menjawab kepemilikan unit,
ACTUAL menjawab siapa naik apa pagi ini.

### D4 — Dokumen dan hari; hari **dimiliki** dokumennya

```
roster_documents  id, department_id, month (date, tgl 1), file_name,
                  uploaded_by, status: aktif | arsip, created_at
                  UNIQUE (department_id, month) WHERE status = 'aktif'

roster_days       document_id → roster_documents (cascade)
                  employee_id → employees (restrict)
                  date, code
                  UNIQUE (document_id, employee_id, date)
```

Alternatifnya adalah tabel datar dengan `UNIQUE (employee_id, date)` dan dokumen
sebagai metadata belaka. Ditolak, dan alasannya bukan estetika:

- `roster-detail.tsx` merender grid **per dokumen**, termasuk dokumen berstatus
  arsip. Pada model datar, unggahan ulang meng-upsert barisnya ke dokumen baru
  dan dokumen lama kehilangan seluruh isinya — detailnya jadi kosong, yang
  tidak bisa dibedakan dari fitur yang rusak.
- Revisi jadi tidak punya induk yang jelas. Dengan kepemilikan dokumen, revisi
  menempel pada dokumen (D11), sehingga mengarsipkan satu dokumen membekukan
  seluruh keputusan yang menyangkutnya dan tidak meninggalkan baris menggantung.

Ongkosnya satu join ke `roster_documents` pada query alokasi. Tabel itu berisi
belasan baris per tahun per departemen; join-nya tidak terukur.

`onDelete: "restrict"` ke `employees` mengikuti seluruh repo — dan itu yang
membuat hari roster menjadi jejak yang menahan penghapusan karyawan (D14).
`cascade` ke dokumen karena baris hari memang bagian dari dokumen itu, tidak
punya arti sendiri.

### D5 — Unggah ulang mengarsipkan, tidak menimpa

Partial unique index `(department_id, month) WHERE status = 'aktif'` menegakkan
aturannya di skema: satu departemen, satu bulan, satu dokumen aktif. Mengunggah
Juli-Hauling untuk kedua kalinya menjalankan satu transaksi — dokumen lama
menjadi `arsip`, dokumen baru menjadi `aktif`, dan barisnya masing-masing tetap
di tempatnya.

Roster yang **berlaku** karenanya selalu `status = 'aktif'`, dan dokumen arsip
adalah sejarah yang bisa dibaca tapi tidak bisa diubah.

### D6 — Departemen dan bulan dinyatakan operator, bukan ditebak

Tiga sumber yang mungkin, dua ditolak:

- **Nama file** — `roster-hauling-2607.xlsx` menggoda, lalu seseorang menyalinnya
  dan namanya menjadi `Copy of roster-hauling-2607 (1).xlsx`.
- **Sel header di dalam sheet** — pola kerja nyatanya adalah menyalin file bulan
  lalu dan mengubah kodenya. Sel bulan adalah hal pertama yang lupa diubah, dan
  roster mendarat di bulan yang salah tanpa satu pun gejala.
- **Diturunkan dari NIK di baris** — departemen bisa, bulan tidak: kolom hari
  hanya `01…31` dan tidak menyebut bulan maupun tahun.

Maka keduanya menjadi field di form upload, dipilih ulang setiap unggahan. Dan
karena departemen kini **dinyatakan**, parser bisa membantahnya per baris:
_"baris 214: NIK 508210388 milik Loading, file ini Hauling."_ Kalau departemen
diturunkan dari isi file, kesalahan yang sama hanya menghasilkan dokumen
campuran tanpa ada yang bisa disebut salah.

Pemanggil ber-scope `dept` dipaksa ke departemennya sendiri di server, apa pun
isi body — mengikuti aturan repo tentang field privilese di request body.

Konsekuensi FE: `roster-upload.tsx` sekarang hanya `Dropzone`; dua field harus
ditambahkan di atasnya, dan tombol unggah nonaktif sampai keduanya terisi.

### D7 — Sheet berkolom dinamis: parser baru, kontrak lama

Tiga importer yang ada berkolom tetap dan bernama (`MASTER_IMPORT_COLUMNS`,
`EMPLOYEE_IMPORT_COLUMNS`, `UNIT_IMPORT_COLUMNS`). Sheet roster lebarnya
mengikuti panjang bulan:

```
no | nik | nama | departemen | posisi | 01 Aug 26 | … | 31 Aug 26
```

Jadi `contracts` hanya mendefinisikan **kolom tetapnya** (`no`, `nik`, `nama`,
`departemen`, `posisi`) plus aturan bahwa sisanya adalah hari 1..N di mana N =
jumlah hari bulan yang dipilih. Parser memvalidasi jumlah kolom hari cocok
dengan bulan itu — sheet 31 kolom untuk bulan Juni adalah error file, bukan
error baris, dan ditolak sebelum satu pun baris diperiksa.

Dari blok tetap itu hanya `nik` yang dibaca. `no` adalah nomor urut untuk mata
manusia, dan `departemen` serta `posisi` ada karena sheet ini dicetak dan
diedarkan — departemennya sudah ditentukan lingkup pengunggah (D6) dan posisinya
milik data karyawan, jadi keduanya tidak pernah dibaca balik dari file. Bentuk
ini mengikuti workbook yang memang sudah dipakai perencana, bukan bentuk minimal
yang paling enak diparsing: template yang tidak dikenali orang yang mengisinya
adalah template yang tidak dipakai.

Template karenanya bukan formulir kosong. Ia dibuat untuk satu departemen dan
satu bulan, dan turun sudah berisi karyawan **aktif** departemen itu — satu
baris per orang, kolom harinya kosong. Yang tersisa untuk operator hanyalah
bagian yang memang tidak bisa dikerjakan mesin: mengetik kodenya. Departemennya
diresolusi lewat jalur yang sama dengan unggahannya, sehingga template berisi
orang departemen A yang lalu diunggah sebagai departemen B tidak mungkin
terjadi.

Konsekuensi FE: tombol unduh template ikut bergantung pada dua field itu, jadi
ia turun dari header halaman ke bawah keduanya. Tombol yang mati di header
karena input yang jauh di bawahnya terbaca sebagai unduhan yang rusak, bukan
sebagai prasyarat.

Yang **tidak** berubah adalah kontrak keluarannya: `MasterImportPreview`,
`ImportErrorRow`, dan `MasterImportResult` dipakai apa adanya, karena
`master-import.ts` sudah menyatakan bentuk itu milik bersama tiga importer plus
roster.

### D8 — Preview tidak mengirim seluruh grid

62.000 sel dalam satu respons JSON adalah beberapa megabyte yang dirender ke
tabel yang tetap saja dipaginasi di klien. Ketiga importer lain mengembalikan
seluruh barisnya karena barisnya ratusan, bukan puluhan ribu.

Preview roster mengembalikan hitungan penuh (valid, duplikat, error), seluruh
`errors` dan `warnings` — keduanya kecil dan justru itu yang dibaca operator —
tapi **grid-nya dipaginasi server**. Halaman preview meminta potongan
karyawannya lewat query, bukan mengiris array yang sudah ada di memori browser.

Konsekuensinya: file yang sedang divalidasi harus bisa dibaca ulang antar
request. Filenya di-hash dan disimpan sementara (TTL pendek, Redis untuk
metadata + `PHOTO_DIR`-style direktori untuk byte-nya), dan commit tetap
**mem-parsing ulang file yang dikirim klien** seperti tiga importer lain —
preview tidak pernah menjadi sumber kebenaran commit.

### D9 — Preview menyebut revisi yang akan dibatalkan

Ini yang paling gampang hilang dan paling mahal kalau hilang. Skenarionya nyata:
Budi mengajukan 21 Jul `D → OFF`, disetujui, `roster_days` sudah `OFF`.
Beberapa hari kemudian admin memperbaiki file Juli karena alasan lain dan
mengunggah ulang. File itu masih menulis `D` untuk Budi tanggal 21.

Tidak ada skema yang bisa menyelamatkan ini sendiri — di model mana pun, hari
itu kembali menjadi `D`. Yang membedakan adalah apakah manusia diberi tahu.
Maka preview menghitung irisan antara tanggal-tanggal di file dan entri revisi
`approved` pada dokumen aktif, lalu menyebutkannya sebagai `warnings` —
`badgeVariant: "warning"`, satu baris per revisi, dengan nama, tanggal, dan
perubahan yang akan hilang. Tabel hasilnya sudah ada dan sudah merender bentuk
ini untuk importer lain.

Peringatan, bukan penolakan: kadang mengembalikan hari itu memang yang
dimaksudkan. Yang tidak boleh terjadi adalah itu terjadi diam-diam.

### D10 — Pengiriman berisi entri; status hidup di **entri**

```
roster_revisions        id, code (REV-2481), document_id, submitted_by,
                        submitted_at
roster_revision_items   id, revision_id, employee_id, date,
                        from_code, to_code, start_time?, end_time?, reason,
                        status: pending | approved | rejected,
                        decided_by?, decided_at?, decision_note?
```

Port statis sudah menyiratkannya: daftar revisi menampilkan _himpunan_ badge per
pengajuan (`Array.from(new Set(g.rows.map(r => r.status)))`), dan layar approval
bertombol per baris. Satu pengiriman tiga entri bisa berakhir dua disetujui satu
ditolak, dan itu memang perilaku yang benar — menyetujui borongan berarti
seorang penyetuju harus menolak seluruh pengajuan demi satu baris yang salah.

`from_code` disimpan, bukan dihitung ulang saat approval. Kalau dihitung saat
approval, entri yang menunggu dua hari bisa menyetujui perubahan dari kode yang
sudah bukan kode saat diajukan — dan riwayatnya berbohong. Kalau `from_code`
tidak lagi cocok dengan `roster_days` pada saat keputusan, itu konflik yang
dilaporkan, bukan yang ditimpa.

`start_time`/`end_time` opsional dan hidup **hanya di entri revisi**, bukan di
`roster_days`. Form revisi menawarkannya sebagai centang opsional; hari roster
biasa tidak punya jam, dan menambahkan dua kolom yang selalu null pada tabel
62.000-baris-per-bulan demi kasus yang jarang bukan pertukaran yang baik.

### D11 — Approval mengubah `roster_days` di tempat

Alternatifnya adalah overlay: `roster_days` imutabel sebagai "apa kata file",
dan kode efektif = revisi approved terakhir kalau ada, kalau tidak ya isi file.

Ditolak. Bacaan panasnya adalah query alokasi yang harus selesai dalam jendela
lima menit untuk sampai seribu unit; overlay menambahkan join per hari pada
tabel yang justru paling besar. Sementara satu-satunya hal yang dibeli overlay —
"apa isi file aslinya" — sudah dibeli lebih murah oleh `from_code` di entri
revisi, yang harus disimpan (D10) apa pun modelnya.

Jadi: entri disetujui → `roster_days.code` untuk (dokumen aktif, karyawan,
tanggal) menjadi `to_code`, dalam transaksi yang sama dengan penulisan status
entri. Jejaknya di entri: siapa, kapan, catatan atau alasan.

Menolak **wajib beralasan**, menyetujui boleh tanpa catatan — persis yang sudah
dilakukan dialog di `roster-approval.tsx`, di mana tombol tolak nonaktif sampai
alasannya terisi.

### D12 — Revisi menempel pada dokumen; `pending` ditolak saat dokumen diarsip

Karena entri menunjuk hari yang dimiliki dokumen (D4), revisi ikut menempel pada
dokumen. Mengarsipkan dokumen membekukannya: entri `approved` dan `rejected`
tinggal sebagai sejarah, dan entri `pending` **ditolak otomatis** dalam
transaksi unggah ulang, dengan `decision_note` yang menyebut alasan sistem.

Dua alternatifnya lebih buruk. Membiarkan `pending` menggantung pada dokumen
beku mengisi antrean approval dengan keputusan yang tidak berakibat apa-apa —
penyetuju mengklik "setuju" dan tidak ada yang berubah. Memindahkannya ke
dokumen baru berarti menebak bahwa entri yang diajukan terhadap roster lama
masih masuk akal terhadap roster baru, dan `from_code`-nya belum tentu cocok
lagi.

### D13 — Yang diajukan revisi ditentukan server, bukan dibaca dari body

Matriks yang sudah diseed menentukan siapa mengajukan, dan bukan yang saya
duga di awal: peran **`admin`** (scope `dept`) memegang `manage` pada
`roster-revision` dan itulah yang mengajukan; peran **`user`** (scope `self`)
hanya `view` — operator **membaca** revisi yang menyangkut dirinya, tidak
mengajukannya. Yang memutuskan adalah **`manajer`**, satu-satunya pemegang
`manage` pada `roster-approval`. Tidak ada perubahan grant di change ini.

Jadi jalur tulis yang nyata adalah `dept`, dan aturannya: karyawan yang dirujuk
entri **divalidasi terhadap predikat scope pemanggil sebelum apa pun ditulis**.
Seorang admin Hauling yang mengirim NIK milik Loading dijawab 403/404, bukan
diterima karena NIK-nya ada. Ini footgun yang sudah tercatat di README dalam
bentuknya yang lain — field identitas di request body yang dipercaya begitu
saja.

Aturannya ditulis umum, bukan khusus `dept`, karena penetapan peran adalah data
runtime: seseorang bisa membuat peran ber-scope `self` yang memegang `manage`
pada `roster-revision`, dan saat itu terjadi subjeknya harus diturunkan dari NIK
sesi, bukan dari body. Menulis aturannya sekarang lebih murah daripada
menemukannya lewat peran yang dibuat setahun lagi.

FE: `AsyncSelect` karyawan di form revisi tidak perlu diubah bentuknya —
`loadEmployees()` sudah memanggil `api.v1.employees`, yang sudah discope server,
jadi seorang admin `dept` otomatis hanya menemukan orang departemennya.

Bacaan mengikuti `scopeWhere()` yang sudah ada: dokumen roster disaring lewat
`department_id`-nya sendiri; hari roster dan entri revisi lewat
`employees.department_id` dan `employees.nik` — yang terakhir itu yang membuat
peran `user` melihat revisinya sendiri saja.

### D14 — Hari roster dan entri revisi adalah jejak yang menahan penghapusan

`employee-data` sudah menetapkan bahwa karyawan berjejak tidak bisa dihapus dan
API menjawab 409 sambil menyebut apa yang merujuknya. Sampai sekarang jejak itu
hanya akun. Roster menambah dua, dan `onDelete: "restrict"` (D4) membuatnya
ditegakkan database, bukan sekadar dijanjikan route.

### D15 — Indeks yang dibaca alokasi

```sql
-- pertanyaan pagi hari, satu kali per shift
SELECT rd.employee_id
FROM roster_days rd
JOIN roster_documents doc ON doc.id = rd.document_id
WHERE rd.date = $1 AND rd.code = $2 AND doc.status = 'aktif'
```

Indeksnya: `roster_days (date, code)` untuk query itu,
`roster_days (employee_id, date)` untuk revisi dan riwayat per orang, dan unique
`(document_id, employee_id, date)` yang sekaligus melayani grid per dokumen.

Tiga indeks pada tabel yang bertambah 62.000 baris sebulan itu murah, dan ketiga
pola bacanya nyata — bukan indeks yang dipasang untuk berjaga-jaga.

### D16 — Seed: tidak ada roster contoh

Katalog diseed karena kosong berarti sistem tidak bisa dipakai. Roster tidak:
databasenya sah dalam keadaan kosong, dan roster palsu untuk 2.000 orang adalah
data yang akan disangka nyata. Mengikuti aturan seed unit dan karyawan yang
sudah ada — hanya masuk ke tabel kosong — tapi diambil satu langkah lebih jauh:
roster tidak diseed sama sekali.

### D17 — Revisi bebas maju dan mundur, batasnya bulan dokumen

Revisi adalah **koreksi maupun permintaan**, dan keduanya sah. Satu-satunya
batas adalah bulan yang dicakup dokumen aktif: entri untuk tanggal di luar bulan
itu ditolak 422, karena tidak ada hari roster untuk direvisi.

Tidak ada jendela kunci-mundur. Alternatifnya — mundur maksimal N hari — ditolak
karena menambah angka konfigurasi dan satu pesan galat yang harus dimengerti
operator, demi melindungi laporan yang belum ada. Konsekuensinya diterima
sadar: hari yang sudah masuk laporan attendance bisa berubah setelahnya, dan
laporan apa pun yang kelak dibangun di atas roster harus membaca ulang alih-alih
menganggap masa lalu beku. Kalau ternyata perlu, jendela itu bisa ditambahkan
belakangan tanpa mengubah skema — hanya satu predikat validasi.

### D18 — Pengaju boleh menjadi penyetuju, dan itu tercatat

Seseorang yang memegang `manage` pada `roster-approval` dapat menyetujui
pengajuannya sendiri. Tidak ditolak sistem.

Pemisahan tugas ditegakkan lewat **penetapan peran**, bukan lewat cabang aturan
di route — dan matriks yang sudah diseed memang memisahkannya: `admin`
mengajukan, `manajer` memutuskan. Menolaknya di kode akan memacetkan site kecil
yang hanya punya satu orang berperan `manajer` dan orang itu juga perlu mengubah
rosternya sendiri, sebuah kemacetan yang tidak punya jalan keluar selain
mengubah peran.

Yang menggantikannya adalah keterlihatan: `submitted_by` dan `decided_by`
keduanya disimpan dan keduanya dikembalikan, jadi kejadiannya selalu bisa
dilihat dan diaudit alih-alih dicegah.

### D19 — `TERM`/`EOC`/`RSG` disimpan, tidak mengubah status, tapi dilaporkan

Sebuah unggahan spreadsheet tidak boleh memberhentikan orang. Satu kolom yang
tergeser akan memberhentikan seluruh departemen, dan tidak ada langkah
konfirmasi yang cukup untuk membenarkan risiko itu. Jadi kode tetap disimpan
sebagai kode roster, dan `employees.status` tetap diurus di layar Karyawan.

Tapi diam bukan pilihannya. Perbedaan antara "roster bilang berhenti" dan
"register bilang aktif" bisa bertahan berbulan-bulan tanpa ada yang tahu. Maka
preview melaporkannya sebagai peringatan non-blocking — sama kelas dengan revisi
tertimpa (D9), di tabel yang sama, dengan nama dan tanggalnya. Manusia yang
menindaklanjutinya di layar Karyawan.

Pola yang sama untuk arah sebaliknya: karyawan yang sudah `nonaktif` di register
tapi masih dirosterkan `D` juga dilaporkan. Dua-duanya adalah pertanyaan "yang
mana yang benar", dan keduanya hanya bisa dijawab manusia.

## Risks / Trade-offs

**Preview memaksa file bertahan antar request (D8)** → Ini satu-satunya
mekanisme baru yang tidak punya preseden di repo; tiga importer lain memuat
seluruh hasilnya dalam satu respons. Mitigasi: TTL pendek, byte disimpan di
direktori yang sama-sama dilaporkan `/health`, dan commit tetap mem-parsing
ulang file yang dikirim klien — sehingga file sementara yang hilang menurunkan
preview menjadi tidak nyaman, bukan menjadi tidak benar.

**Unggah ulang tetap membatalkan revisi yang disetujui (D9)** → Skema tidak
menyelamatkannya; peringatan preview yang menyelamatkannya, dan peringatan bisa
diabaikan. Mitigasi: peringatan menyebut setiap revisi satu per satu dengan nama
dan tanggalnya, bukan sekadar angka; dan entri revisinya tetap tersimpan pada
dokumen arsip, jadi apa yang hilang selalu bisa ditelusuri.

**Sembilan `kind` lebih halus dari kebutuhan hari ini (D2)** → Delapan di
antaranya hanya dibedakan oleh layar yang belum ada. Mitigasi: `kind` adalah
turunan murni dari kode dan tidak tersimpan, jadi menggabungkan atau memecahnya
nanti adalah perubahan satu tabel konstanta, bukan migrasi.

**`from_code` bisa basi saat approval (D10)** → Entri yang diajukan sebelum
unggah ulang, atau sebelum revisi lain menyentuh hari yang sama. Mitigasi:
approval membandingkan `from_code` dengan kode yang berlaku dan menolak
memutuskan bila berbeda, mengembalikan konflik yang menyebut kedua nilainya
alih-alih menimpa diam-diam.

**Dokumen arsip menyimpan grid penuhnya (D4)** → Setahun unggah ulang bulanan
menumpuk salinan. Mitigasi: unggah ulang adalah kejadian luar biasa, bukan
rutin; dan 62.000 baris per dokumen tetap kecil dibanding manfaat detail arsip
yang bisa dibuka. Kalau kelak jadi masalah, dokumen arsip yang lebih tua dari N
bulan bisa dipangkas — barisnya, bukan dokumennya.

**Enum 28 nilai di Postgres (D1)** → Menambah nilai ke `pgEnum` adalah migrasi,
dan menghapus nilai praktis tidak bisa. Mitigasi: itu memang yang diinginkan
(D1); dan bila kelak kosakatanya ternyata berubah per site, kolomnya bisa
menjadi `text` yang divalidasi di batas API — pola yang sudah dipakai
`menu_slug` dan `runtext color`.

## Migration Plan

1. `contracts` lebih dulu — `ROSTER_CODES`, peta `kind`, grup legenda, status
   entri revisi, kolom tetap sheet. Baru setelahnya DB dan API bisa
   merujuknya, dan urutan ini yang diminta `config.yaml`.
2. Empat tabel plus indeksnya, satu migrasi. Semuanya tabel baru — tidak ada
   kolom yang berubah tipe, tidak ada data yang perlu dipindahkan, jadi
   rollback adalah `drop table` dan tidak ada yang hilang selain roster yang
   memang belum pernah ada.
3. Route roster (dokumen, hari, revisi, approval), lalu importernya.
4. Web: `lib/queries/roster.ts`, lalu ketujuh komponen satu per satu.
   `lib/roster-data.ts` menyusut di langkah terakhir, setelah pemakai
   terakhirnya berpindah — memangkasnya lebih awal mematahkan build di tengah.

Tidak ada backfill. Roster pertama yang nyata masuk lewat layar unggahnya,
seperti yang akan terjadi setiap bulan sesudahnya.

## Open Questions

Tidak ada yang menahan implementasi. Tiga pertanyaan yang sebelumnya terbuka
sudah diputuskan dan pindah menjadi D17, D18, dan D19.

Yang tersisa adalah konsekuensi yang sengaja diterima, bukan pertanyaan — dicatat
di sini supaya tidak ditemukan lagi sebagai kejutan:

- **Masa lalu tidak beku (D17).** Laporan apa pun yang kelak dibangun di atas
  roster tidak boleh menganggap hari yang sudah lewat tidak akan berubah. Bila
  payroll kelak membacanya, jendela kunci-mundur menjadi percakapan yang harus
  dibuka lagi — dan saat itu ia hanya satu predikat validasi.
- **Pemisahan tugas bergantung pada penetapan peran (D18).** Sebuah peran yang
  memegang `manage` pada `roster-revision` **dan** `roster-approval` sekaligus
  meniadakan pemisahan itu tanpa satu pun peringatan. Layar Role tidak
  mengatakannya; kalau kelak dianggap perlu, di sanalah tempatnya.
