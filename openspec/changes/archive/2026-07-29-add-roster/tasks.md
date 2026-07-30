## 1. Kontrak bersama (`packages/contracts`)

Dikerjakan lebih dulu karena DB, API, dan web sama-sama bersandar padanya.

- [x] 1.1 Buat `src/roster.ts` dengan `ROSTER_CODES` — 28 kode legenda (`D`, `N`, `R`, `STB`, `OFF`, `CR`, `AL`, `LWP`, `LWOP`, `PH`, `PHD`, `S`, `A`, `MCU`, `MCR`, `MCUF`, `ISM`, `OBC`, `KRT`, `TGS`, `DNS`, `TRV`, `TR`, `TRS`, `IN`, `TERM`, `EOC`, `RSG`) beserta tipe dan type guard, mengikuti bentuk `AREA_TYPES` (D1)
- [x] 1.2 Tambahkan `ROSTER_CODE_KINDS` dan peta `ROSTER_CODE_KIND: Record<RosterCode, RosterCodeKind>` dengan sembilan kind (`day`, `night`, `working`, `off`, `absent`, `medical`, `isolated`, `assignment`, `ended`); pastikan tipenya memaksa setiap kode punya kind (D2)
- [x] 1.3 Tambahkan helper turunan yang dipakai alokasi dan layar: kode shift siang, kode shift malam, dan predikat "terjadwal shift" — supaya tidak ada pemanggil yang menuliskan `code === "D"` sendiri (D2, D3)
- [x] 1.4 Pindahkan pengelompokan legenda dari `apps/web/lib/roster-data.ts` ke sini sebagai metadata presentasi (kode + urutan grup), tanpa membawa terjemahan — teks tetap urusan i18n web (D2)
- [x] 1.5 Tambahkan `ROSTER_REVISION_STATUSES = ["pending", "approved", "rejected"]` beserta tipe dan type guard
- [x] 1.6 Tambahkan `ROSTER_IMPORT_FIXED_COLUMNS = ["nik", "nama"]` di `src/master-import.ts` dan komentar yang menjelaskan kolom hari bersifat dinamis mengikuti bulan (D7)
- [x] 1.7 Ekspor semuanya lewat `src/index.ts`, lalu typecheck paket dan pastikan tidak ada impor server-only yang ikut masuk

## 2. Skema dan migrasi (`apps/api/src/db`)

- [x] 2.1 Tambahkan `pgEnum` `roster_code` dan `roster_revision_status` di `schema.ts`, diturunkan dari konstanta contracts (D1)
- [x] 2.2 Tambahkan tabel `roster_documents`: `id` uuid PK, `department_id` FK restrict, `month` date (selalu tanggal 1), `file_name`, `uploaded_by` FK ke `users` restrict, `status` (`aktif`/`arsip`), `created_at` (D4)
- [x] 2.3 Tambahkan partial unique index `(department_id, month) WHERE status = 'aktif'` — satu departemen, satu bulan, satu dokumen aktif (D5)
- [x] 2.4 Tambahkan tabel `roster_days`: `id` uuid PK, `document_id` FK cascade, `employee_id` FK **restrict**, `date`, `code`; unique `(document_id, employee_id, date)` (D4, D14)
- [x] 2.5 Tambahkan indeks `roster_days (date, code)` untuk query alokasi dan `roster_days (employee_id, date)` untuk revisi dan riwayat per orang (D15)
- [x] 2.6 Tambahkan tabel `roster_revisions`: `id` uuid PK, `code` text unique (`REV-nnnn`), `document_id` FK cascade, `submitted_by` FK ke `users` restrict, `submitted_at` (D10)
- [x] 2.7 Tambahkan tabel `roster_revision_items`: `id` uuid PK, `revision_id` FK cascade, `employee_id` FK **restrict**, `date`, `from_code`, `to_code`, `start_time`/`end_time` nullable, `reason` notNull, `status`, `decided_by` nullable FK restrict, `decided_at` nullable, `decision_note` default `""` (D10)
- [x] 2.8 Tambahkan indeks `roster_revision_items (status)` untuk antrean approval dan `(employee_id, date)` untuk deteksi revisi tertimpa saat preview (D9)
- [x] 2.9 Tambahkan tipe `$inferSelect` untuk keempat tabel
- [x] 2.10 `bun run --cwd apps/api db:generate`, periksa SQL yang dihasilkan — terutama partial unique index — sebelum commit
- [x] 2.11 `bun run --cwd apps/api db:migrate` pada database dev dan pastikan berhasil

## 3. Skema TypeBox dan route dokumen roster (`apps/api`)

- [x] 3.1 Tambahkan skema TypeBox roster ke `routes/schemas.ts`: dokumen, hari, grid berpaginasi, dan enum kode — jangan letakkan di `contracts` (aturan repo)
- [x] 3.2 Buat `routes/roster.ts` dengan prefix `/roster` dan tag `roster`, memakai `requireAuth` seperti route lain
- [x] 3.3 `GET /` — daftar dokumen berfilter (departemen, bulan, status, pencarian), disaring `scopeWhere` lewat `department_id`, diurutkan terbaru dulu (D13)
- [x] 3.4 `GET /:id` — satu dokumen dengan nama departemen dan pengunggah yang sudah di-resolve; 404 bila di luar scope
- [x] 3.5 `GET /:id/days` — grid dokumen **berpaginasi server** dengan pencarian NIK/nama; kembalikan baris per karyawan berisi kodenya per hari (D8, spec roster-data)
- [x] 3.6 `GET /in-force` — kode berlaku untuk satu tanggal, hanya dari dokumen aktif; ini bentuk yang akan dibaca mesin alokasi (D11, D15)
- [x] 3.7 Daftarkan `rosterRoutes` di `index.ts` dan tambahkan tag `roster` ke dokumentasi OpenAPI
- [x] 3.8 Pastikan setiap route mendeklarasikan `body`, `params`/`query`, dan `response` — termasuk 401/403/404

## 4. Importer roster (`apps/api/src/routes/roster-import.ts`)

- [x] 4.1 Parser sheet berkolom dinamis: baca `nik` dan `nama`, lalu N kolom hari; tolak file sebagai satu kesatuan bila jumlah kolom hari tidak sama dengan panjang bulan yang dinyatakan (D7)
- [x] 4.2 Validasi per baris: NIK ada di register, NIK milik departemen yang dinyatakan, setiap sel berisi kode yang dikenal, tidak ada sel hari yang kosong, tidak ada NIK ganda — semuanya memakai bentuk `ImportErrorRow` yang sudah ada (D6)
- [x] 4.3 Hitung revisi yang akan dibatalkan: iris tanggal-tanggal file dengan entri `approved` pada dokumen aktif yang kode hasilnya berbeda dari sel file, keluarkan sebagai `warnings` dengan nama, tanggal, dan perubahan yang hilang (D9)
- [x] 4.3a Laporkan pertentangan status kepegawaian sebagai `warnings` — sel ber-`TERM`/`EOC`/`RSG` pada karyawan yang masih `aktif`, dan sel ber-`D`/`N` pada karyawan yang sudah `nonaktif`; **jangan** ubah `employees.status` (D19)
- [x] 4.4 `GET /import/template?month=YYYY-MM` — template kosong berkolom sesuai panjang bulan itu (D7)
- [x] 4.5 `POST /import/preview` — terima file + departemen + bulan; kembalikan hitungan penuh, seluruh `errors` dan `warnings`, dan halaman pertama grid; simpan file sementara berikut TTL-nya untuk paginasi lanjutan (D8)
- [x] 4.6 `GET /import/preview/:token/rows` — halaman berikutnya dari grid preview yang sama (D8)
- [x] 4.7 `POST /import` — **parse ulang file**, tolak bila masih ada error blocking, lalu dalam satu transaksi: arsipkan dokumen aktif bulan itu bila ada, tolak otomatis seluruh entri `pending` miliknya dengan `decision_note` alasan sistem, buat dokumen baru, sisipkan barisnya (D5, D12)
- [x] 4.8 Paksa departemen dari record pemanggil untuk scope `dept`, abaikan nilai di body (D6)
- [x] 4.9 Tulis test: jumlah kolom tidak cocok bulan, NIK asing, NIK lintas departemen, sel kosong, kode tidak dikenal, dan unggah ulang yang mengarsipkan sambil menolak `pending` — mengikuti bentuk `master-import.test.ts`

## 5. Route revisi dan approval (`apps/api/src/routes/roster-revision.ts`)

- [x] 5.1 `GET /` — daftar pengajuan berisi entrinya, berfilter status dan pencarian, disaring `scopeWhere` lewat `employees.department_id` / `employees.nik` (D13)
- [x] 5.2 `POST /` — buat pengajuan berisi N entri dalam satu transaksi; validasi setiap entri: karyawan dalam scope, tanggal di dalam bulan dokumen aktif, ada barisnya di roster, `to_code` kode yang dikenal, alasan tidak kosong; simpan `from_code` dari kode yang berlaku saat itu (D10)
- [x] 5.2a Jangan tambahkan batas mundur maupun maju di luar bulan dokumen — tanggal lampau dan tanggal mendatang sama-sama sah (D17)
- [x] 5.3 Turunkan karyawan dari NIK sesi untuk scope yang hanya mengenali satu orang; untuk scope lebih luas validasi nilai di body terhadap predikat scope sebelum menulis (D13)
- [x] 5.4 Bangkitkan `code` pengajuan (`REV-nnnn`) di server, berurutan dan unik
- [x] 5.5 `GET /queue` — antrean approval berfilter status, membutuhkan `view` pada `roster-approval`
- [x] 5.6 `POST /items/:id/approve` — bandingkan `from_code` dengan kode berlaku, 409 bila berbeda menyebut kedua nilainya; bila cocok, dalam satu transaksi tulis `to_code` ke `roster_days` dan set status entri, `decided_by`, `decided_at`, catatan opsional (D10, D11)
- [x] 5.7 `POST /items/:id/reject` — wajib beralasan, 422 tanpa alasan; set status tanpa menyentuh roster (D11)
- [x] 5.8 Tolak keputusan atas entri yang sudah diputus (409) dan atas entri milik dokumen arsip (409) (D12)
- [x] 5.8a Jangan tambahkan pemeriksaan "pengaju ≠ penyetuju" — dibolehkan dengan sengaja; pastikan `submitted_by` dan `decided_by` keduanya ikut di respons agar kejadiannya terlihat (D18)
- [x] 5.9 Daftarkan route dan tag OpenAPI-nya; pastikan `body`/`params`/`response` lengkap di semua route
- [x] 5.10 Tulis test: entri basi ditolak 409, tolak tanpa alasan 422, setuju mengubah roster dan terlihat di `/in-force`, dan `dept` tidak bisa mengajukan lintas departemen

## 6. Jejak penghapusan karyawan (`apps/api/src/routes/employees.ts`)

- [x] 6.1 Tambahkan hitungan hari roster dan entri revisi ke pemeriksaan sebelum menghapus karyawan; jawab 409 yang menyebut keduanya secara terpisah (D14)
- [x] 6.2 Pastikan dokumen **arsip** juga menahan penghapusan — sejarah harus tetap terbaca
- [x] 6.3 Tambahkan test untuk kedua jejak baru itu

## 7. Integrasi web — data roster (`apps/web`)

- [x] 7.1 Buat `lib/queries/roster.ts` mengikuti bentuk `lib/queries/employees.ts`: `queryOptions` untuk daftar dokumen berfilter, satu dokumen, dan grid berpaginasi
- [x] 7.2 Sambungkan `components/menus/roster-data.tsx` ke API; pencarian dan filter (departemen, status, bulan) dikirim ke server, bukan disaring di klien
- [x] 7.3 Sambungkan `components/menus/roster-detail.tsx`: grid dari `GET /:id/days`, paginasi memanggil API alih-alih mengiris array bulan (D8)
- [x] 7.4 Sambungkan tombol unduh dokumen ke endpoint file-nya, ganti toast palsu yang sekarang
- [x] 7.5 Tambahkan prefetch + hydration di route `roster-data` dan detailnya, mengikuti pola halaman lain

## 8. Integrasi web — unggah roster

- [x] 8.1 Tambahkan pemilih **departemen** dan **bulan** di atas `Dropzone` pada `roster-upload.tsx`; nonaktifkan unggah sampai keduanya terisi (D6)
- [x] 8.2 Sembunyikan pemilih departemen bagi pemanggil ber-scope `dept` dan tampilkan departemennya sendiri — server tetap yang memutuskan (D6, D13)
- [x] 8.3 Ganti `setInterval` progress palsu dengan progres unggahan sebenarnya, dan hapus state `Stage` yang hanya melayani simulasi
- [x] 8.4 Sambungkan preview ke `POST /import/preview`; render hitungan, tabel error/warning, dan grid berpaginasi dari respons
- [x] 8.5 Render peringatan revisi tertimpa **dan** pertentangan status kepegawaian di tabel hasil yang sama, dibedakan severity-nya — jangan buat tabel kedua (D9, D19, spec master-import)
- [x] 8.6 Sambungkan tombol import ke `POST /import`, lalu `invalidateQueries` daftar dokumen dan arahkan ke daftar
- [x] 8.7 Sambungkan tombol template ke `GET /import/template` dengan bulan yang sedang dipilih
- [x] 8.8 Ubah `lib/roster-data.ts`: sisakan `rosterCodeColor()` dan pemetaan grup legenda ke i18n; hapus `ROSTER_DOCS`, `findRosterDoc`, `rosterGrid`, `upErrorRows`, dan array `CREW`

## 9. Integrasi web — revisi dan approval

- [x] 9.1 Sambungkan `components/menus/roster-revision.tsx` ke API; hapus array `ROWS`, dan bersamanya kosakata `P-1`/`M-2` yang tidak pernah sah
- [x] 9.2 Sambungkan `components/menus/roster-revision-new.tsx`: entri terkumpul di state lokal seperti sekarang, tapi Kirim benar-benar memanggil `POST /` sebagai satu pengajuan berisi N entri
- [x] 9.3 Isi dropdown kode dari `ROSTER_CODES` di contracts, bukan dari daftar yang dirakit di web (`revCodeList` diturunkan ulang dari kontrak)
- [x] 9.4 Tampilkan galat per entri dari respons 422 di tempat yang tepat pada form, jangan hanya toast
- [x] 9.5 Sambungkan `components/menus/roster-approval.tsx`: antrean dari API, setuju/tolak memanggil route-nya, `invalidateQueries` alih-alih `setState` lokal; hapus array `INITIAL`
- [x] 9.6 Tangani 409 entri basi dengan pesan yang menyebut kedua kode dan menyegarkan antrean
- [x] 9.7 Tambahkan string i18n untuk seluruh label dan pesan baru; jangan tinggalkan teks Indonesia yang di-hardcode di komponen
- [x] 9.8 Pastikan tidak ada warna hex arbitrer di className baru — hanya token dari `app/globals.css`

## 10. Verifikasi

- [x] 10.1 `bun run --cwd apps/api test` — seluruh test API lulus
- [x] 10.2 `bun run format:check` dan `bun run lint` dari root
- [x] 10.3 **Hentikan dev server lebih dulu**, lalu `rm -rf apps/web/.next`, `tsc --noEmit`, dan `next build` — `next build` sementara `bun run dev` berjalan merusak `.next` dan membuat setiap route menjawab 500
- [x] 10.4 Jalur ujung ke ujung: unggah roster satu bulan, buka detailnya, ajukan revisi, setujui, lalu pastikan `/in-force` untuk tanggal itu sudah berubah
- [x] 10.5 Jalur unggah ulang: unggah bulan yang sama sekali lagi, pastikan preview menyebut revisi yang akan dibatalkan satu per satu, dokumen lama menjadi arsip dengan grid yang masih utuh, dan entri `pending`-nya menjadi ditolak
- [x] 10.6 Jalur scope: masuk sebagai `admin` (dept) dan pastikan hanya dokumen departemennya terlihat serta pengajuan lintas departemen ditolak; masuk sebagai `user` (self) dan pastikan hanya revisi miliknya terlihat dan tidak ada tombol ajukan
- [x] 10.7 Jalur penolakan: hapus karyawan yang punya hari roster dan pastikan 409-nya menyebut roster sebagai alasan
- [x] 10.8 Jalur peringatan status: unggah file yang memuat `TERM` untuk karyawan yang masih `aktif`, pastikan preview memperingatkan, commit tetap bisa jalan, dan `employees.status` tidak berubah sesudahnya (D19)
- [x] 10.9 Jalur tanggal: ajukan revisi untuk tanggal lampau dan tanggal mendatang di bulan yang sama, pastikan keduanya diterima, lalu satu tanggal di luar bulan dokumen dan pastikan ditolak 422 (D17)
- [x] 10.10 Perbarui bagian status di `README.md` — Roster (upload / revisi / approval) pindah dari daftar "static design port" ke daftar yang sudah tersambung API
