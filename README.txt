CSL Fingerprint Server PUBLIC READY

Update:
1. Hapus user massal sekarang dikunci berdasarkan SN mesin.
   - Jika SN kosong, hapus massal akan ditolak agar tidak salah mesin.
   - Isi SN di Edit Mesin.

2. GUI dirapikan lebih modern/public ready.

3. Clone user:
   - Search mesin tujuan dihapus.
   - Search hanya di mesin asal.
   - Ketik huruf awal, misalnya J, nama yang diawali J diprioritaskan muncul.
   - Tekan Enter untuk memilih hasil pertama dan masuk ke list pilihan.
   - Bisa ketik banyak nama/ID dengan Enter atau koma.

4. Auto Sync Center:
   - Auto reconnect, auto sync user, realtime attendance dijadikan 1 form.
   - Ada aksi manual: cek status, tarik absensi, jalankan sync sekarang.

5. Database SQL:
   - File database.sql disertakan.
   - Menu Dashboard memiliki link SQL Schema.
   - Saat nanti dibuat EXE/public, schema ini bisa dipakai untuk migrasi ke MySQL/MariaDB/SQLite.

Catatan:
- Sistem saat ini masih menyimpan data runtime di JSON agar install npm tetap ringan dan stabil di Windows.
- Untuk EXE public, tahap berikutnya adalah migrasi storage ke SQLite/MySQL sesuai file database.sql.
- Clone sidik jari/template belum bisa melalui zkteco-js standar.


V2 FIX:
- Fix device_sn terkirim sebagai array saat hapus massal.
- Bulk delete mengambil SN pertama yang valid.
- Tombol Edit/Hapus per user tidak lagi nested form di dalam form hapus massal.


V7 SHIFT REPORT:
- Menu Shift Kerja.
- 3 shift default: 05:00-15:00, 14:00-22:00, 21:00-04:00.
- Toleransi telat per shift.
- Istirahat otomatis di tengah shift sesuai durasi.
- Mapping user ke shift atau auto detect.
- Laporan filter tanggal, user, mesin, shift, status.
- Status Terlambat setelah melewati toleransi.
- Status Pulang Dulu jika status pulang sebelum jam pulang shift.
- Export Excel/CSV/Print.
- database.sql diperbarui untuk shifts, user_shift_map, attendance_shift_report.


V8 TARGET LOCK FIX:
- Semua aksi sensitif (kirim user, hapus user, hapus massal, tarik absensi, reboot) dikunci dengan device_id + SN + alamat final.
- Jika alamat config berubah dari alamat form, aksi dibatalkan agar tidak salah mesin.
- Hapus massal tidak lagi hanya SN; sekarang validasi id + SN + address.
- Tombol pilih semua user ditambah: pilih semua user tampil dan pilih semua user total.
- Penyebab bug sebelumnya: target form/alamat final bisa ambigu atau Tailscale/IP tidak sesuai, sehingga aksi bisa mengarah ke mesin lain.


V9 BACKUP RESTORE:
- Menu Backup & Restore.
- Backup mesin ke JSON.
- Upload dan inspect file DAT.
- Restore user dari JSON backup ke mesin target.
- Simpan riwayat backup.
- database.sql ditambah backup_history dan fingerprint_templates.
- Parser DAT dibuat mode aman: tidak akan menulis fingerprint binary jika template belum terbaca valid.
- Clone sidik jari penuh masih tergantung command template firmware/library.


V9.1 UPLOAD FIX:
- Fix PayloadTooLargeError saat upload file .dat.
- Multipart/form-data tidak lagi diparse oleh express.text.
- Limit upload DAT dinaikkan ke 500MB.


V10 DETECT MACHINE:
- Menu Detek Mesin.
- Detek 1 mesin berdasarkan IP/host + port.
- Scan banyak port pada 1 IP/host.
- Jika mesin terbaca, SN ditampilkan readonly.
- Jika SN/alamat belum terdaftar, muncul form daftarkan mesin.
- Form pendaftaran memuat IP mesin, port, IP Tailscale/IP port forwarding, SN, IP ADMS, Port ADMS.
- Daftar mesin dirapikan: aksi mesin masuk ke dropdown/details agar tabel tidak terlalu ramai.


V11 UI + DETECT SN:
- Tampilan dipisah ke public/style.css.
- Ditambahkan public/index.html.
- Deteksi SN diperkuat dengan banyak method: getInfo, getSerialNumber, getDeviceSN, getDeviceInfo, getFirmware, getPlatform, dll.
- Jika SN belum terbaca, halaman menampilkan serial candidates dan raw info untuk diagnosa.
- Endpoint diagnosa: /api/detect-methods?address=IP&port=4370
- Form register tetap aman: SN readonly jika terbaca otomatis.


V12 SN DETECT FIX:
- Nilai boolean/status seperti true/false/ok tidak boleh lagi dianggap SN.
- Kandidat SN divalidasi: minimal 6 karakter, alphanumeric, punya angka, bukan nilai umum.
- Kandidat SN diberi score; serialNumber/SN diprioritaskan.
- Halaman Detek Mesin menampilkan jumlah Mesin Baru Valid, Sudah Terdaftar, dan Koneksi OK SN Kosong.
- Scan port menghindari duplikat hasil yang sama.
- Register mesin menolak SN tidak valid.



V13 TIMEOUT SAFE:
- Fix server crash saat zkteco-js timeout: Cannot read properties of null (reading subarray/substring).
- Tarik absensi memakai timeout wrapper dan retry 1x dengan socket baru.
- Timeout koneksi ZKTeco diperpanjang.
- Server tidak langsung mati jika library melempar uncaught exception.
- Catatan: lebih stabil pakai Node.js LTS 20/22 daripada Node.js 24.


V14 SIDEBAR + REPORT USER FIX:
- Menu desktop dipindahkan ke sidebar kiri.
- Mode HP memakai bottom navigation dan hamburger menu.
- Dropdown User di Laporan Shift mengambil data dari users.json dan attendance.json.
- Jika user belum ada di database lokal tapi sudah ada log absensi, tetap muncul di filter laporan.


V15 FINGER ENROLL:
- Tombol Finger di List/Edit User Mesin.
- Menu daftar sidik jari per user.
- Pilih jari 0-9.
- Mencoba remote enroll jika library/firmware menyediakan method startEnroll/enrollFinger/enrollUser.
- Jika tidak didukung, tampil pesan jelas dan tidak menulis data ke mesin.
- Sensor tetap di mesin; web tidak menerima gambar/grafik sidik jari dari sensor.


V16 REMOTE ENROLL TRIGGER + SDK BRIDGE READY:
- Menu Remote Enroll Center.
- SDK Bridge Config.
- Cek support remote enroll per mesin.
- Tombol Finger mencoba Node library dulu, lalu SDK Bridge jika aktif.
- Bridge contract disiapkan untuk ZkEnrollBridge.exe.
- Folder bridge berisi README dan placeholder.
- Firmware mesin tidak diubah; bridge hanya mengirim command resmi jika SDK/firmware mendukung.


V17 MULTI BRAND + FP STATUS:
- Tambah adapter merk/protocol: ZKTeco compatible, Solution X100C, BioFinger ZK, FingerSpot ZK, ADMS Push, SDK Bridge.
- Device config punya brand dan protocol.
- Menu Adapter Merk.
- List user mesin menampilkan status sidik jari di samping nama:
  ADA / MUNGKIN ADA / Belum bisa dicek.
- Jika firmware/library tidak expose template fingerprint, aplikasi tidak mengarang status.


V18 ONLINE + BACKUP MENU:
- Menu Backup & Restore dipindahkan ke bagian bawah sidebar.
- Tambah menu Akses Online.
- Panduan No-IP + Huawei Port Forward.
- Panduan CGNAT Biznet/ISP.
- Backup default tetap di folder backups.
- Remote Enroll Center menjelaskan error File bridge tidak ditemukan.


V19 ATTENDANCE NAME + AUTO SYNC CLEAN:
- Nama lokal di attendance diambil dari users.json, user-name-cache.json, dan user hasil baca mesin.
- Menu Auto Sync dibuat lebih clean: Mesin Master, Mesin Tujuan, Auto Sync, Status Mesin, Realtime.


V20 REPORT + AUTO SYNC FIX:
- Auto Sync Center menjadi switch ON/OFF sederhana.
- Sync User diberi peringatan agar user tidak otomatis menyebar antar mesin.
- Laporan Shift: dropdown user mengambil dari users.json, cache nama, log absensi, dan mencoba baca user dari mesin terpilih.
- Filter laporan lebih toleran terhadap format tanggal dd/mm/yyyy atau yyyy-mm-dd.
- Filter mesin cocok dengan SN, device_id, atau nama mesin.


V21 LIVE + REPORT MACHINE FILTER:
- Dropdown user laporan mengikuti mesin yang dipilih.
- Rekap laporan memakai data real dari mesin/log mesin yang dipilih.
- Jam masuk/pulang di laporan ditampilkan format jam.
- Live Dashboard GUI baru dengan filter mesin.
- Live menampilkan sapaan user terbaru dan tabel 10 orang terbaru.


V22 SQL + REAL ATTENDANCE FIX:
- Live dan laporan tidak lagi mengisi jam pulang sama dengan jam masuk jika hanya ada satu log.
- Jika state mesin tidak jelas, first log = masuk, last log berbeda = pulang.
- Nama user di-cache otomatis saat tarik absensi dengan membaca user list mesin terlebih dahulu.
- Tambah menu Database Tools.
- Export full database SQL berisi mesin, user, absensi, shift, dan cache nama.
- Import SQL hasil export aplikasi untuk restore data JSON runtime.
- Folder SQL backup: database-backups.
- Untuk XAMPP/MySQL: import file SQL ke phpMyAdmin agar data mesin/absensi tersimpan di MySQL. Aplikasi Node ini masih membaca JSON runtime, kecuali setelah kamu upload/import SQL lewat menu Database Tools.


V23 PRODUCTION REAL ATTENDANCE:
- Backup database SQL disimpan di dalam folder aplikasi: database-backups.
- Mode produksi real attendance:
  * Jam masuk dari status masuk; jika status mesin tidak jelas, log pertama dianggap masuk.
  * Jam pulang HANYA dari status pulang/out eksplisit.
  * Sistem tidak lagi menebak last log sebagai pulang jika status mesin tidak jelas.
  * Jika hanya ada satu log, jam pulang dikosongkan.
- Ini lebih aman untuk produksi/client karena tidak membuat data fake.


V24 SQL IMPORT PRODUCTION FIX:
- Import SQL diperbaiki agar membaca INSERT multi-line, backtick table, dan escaping quote.
- Import restore: devices, users, attendance_logs, shifts, user_name_cache.
- Jika import 0, halaman menampilkan debug SQL agar penyebab terlihat.
- Gunakan menu Database Tools > Export Full Database SQL, lalu file itu bisa di-import kembali.


V25 STRICT REAL MACHINE LOGS:
- Jam masuk/pulang dihitung dari log real mesin per user/tanggal.
- Jam pulang HANYA diisi jika ada status log Pulang/Out eksplisit.
- Jika mesin hanya mengirim timestamp tanpa status, sistem isi jam masuk saja dan jam pulang kosong.
- State raw dari mesin dipertahankan lebih banyak: punch, punch_state, attendanceState, attState, type.
- Tambah menu debug raw attendance: /attendance-raw-debug
- Ini mencegah data fake untuk produksi/client.


V26 DATABASE DEVICES FIX:
- Export SQL newline diperbaiki agar bukan literal \n.
- Import SQL lebih kuat: membaca INSERT dengan regex global dan normalize literal \n.
- Jika SQL tidak berisi data devices, mesin yang sudah ada di list aplikasi tetap dipertahankan.
- Tambah tombol Export Data Mesin Saja.
- Import result menampilkan Imported vs Tetap dari list mesin aplikasi.
- Penting: file schema kosong tidak berisi data. Gunakan Export Full Database SQL atau Export Data Mesin Saja.


V27 NO FAKE SAME TIME:
- Jam pulang dikosongkan jika sama persis atau masih menit yang sama dengan jam masuk.
- Jam pulang hanya dari log status Pulang/Out eksplisit dan waktunya berbeda.
- normalizeAttendanceLogs diperbaiki agar memakai waktu asli dari mesin: time, recordTime, timestamp, attendance_time, attTime, checkTime, punchTime, datetime.
- Log tanpa waktu asli mesin tidak disimpan.
- Laporan memberi catatan: pulang diabaikan jika jam sama dengan masuk.


V28 ATTENDANCE RECORDS TABLE:
- Halaman Attendance diubah menjadi raw Attendance Records.
- Kolom: #, SN, Employee ID, Timestamp, Status 1 sampai Status 5.
- Pagination seperti dashboard records.
- Filter mesin, user ID, tanggal awal/akhir, page size.
- Status 1-5 diambil dari raw log mesin jika tersedia.


V29 REAL FIRST-LAST ATTENDANCE:
- Perhitungan jam masuk/pulang memakai timestamp real mesin:
  * log pertama user pada tanggal itu = Jam Masuk
  * log terakhir yang berbeda = Jam Pulang
  * kalau hanya 1 log = Jam Pulang kosong
- Tidak bergantung lagi pada status Pulang/Out karena beberapa mesin mengirim status tidak konsisten.
- Tambahan pembacaan timestamp: record_time, logTime, log_time, DateTime, Time.


V30 ATTENDANCE FILTER FIX:
- Attendance Records filter diperkuat:
  * mesin cocok dari SN, device_id, device_name, dan raw log
  * user cocok walau string/number/70.0
  * tanggal membaca yyyy-mm-dd, dd/mm/yyyy, dan timestamp JS
- Jika hasil 0, halaman menampilkan debug: total raw attendance dan sample data.
- Tambah tombol Tarik Absensi Mesin Terpilih langsung dari halaman Attendance.


V31 ATTENDANCE FILTER + MONTH DEBUG:
- Filter mesin cocok dengan data mesin terdaftar: id, SN, nama, IP, tailscale IP, dan raw log.
- Filter user dinormalisasi angka/string.
- Filter tanggal lebih kuat.
- Ringkasan data tersimpan menampilkan jumlah per bulan dan per mesin.
- Jika filter 0, debug menampilkan tahap: total raw, setelah filter mesin, user, tanggal.
- Tombol Tarik Absensi Semua Mesin ditambahkan di Attendance Records.


V32 ROLES ONLINE READY:
- Login system.
- Default admin: admin / admin123. Wajib ganti untuk online.
- Admin: semua menu/mesin.
- User: hanya Live, Attendance, Laporan dan hanya mesin yang diizinkan.
- Menu Role User untuk atur user aplikasi dan akses mesin.
- Admin dashboard bisa filter tampilan mesin berdasarkan user/role.
- Advanced menu untuk fitur teknis.


V33 ROLES BUGFIX:
- Fix ReferenceError: currentUser is not defined.
- Middleware role guard diperbaiki memakai req.currentUser.
- Login/role system tetap sama.


V34 ROLES FIXED FINAL:
- Fix final ReferenceError: currentUser is not defined.
- Semua referensi currentUser di route/middleware dipatch ke req.currentUser.
- Ditambahkan fallback global current user dan friendly error handler.


V35 CURRENTUSER FIX:
- Restore function currentUser(req)
- Fix middleware login/session
- Fix typo req.req.currentUser
- Login role system sudah stabil


V36 NO CURRENTUSER ERROR:
- Fix final currentUser is not defined.
- Semua route/middleware memakai getCurrentUser(req) dan req.currentUser.
- Ditambahkan alias aman currentUser(req) agar route lama tidak crash.
- Scan file memastikan tidak ada bare currentUser liar.


V37 AUTH USER MANAGE FIXED:
- Fix Server Error: loadAppUsers is not defined.
- Default login:
  admin / 12345
  user / 12345
- Login fallback akan memperbaiki password default jika app-users.json lama masih memakai password lama.
- Menu Kelola User Login:
  edit username/ID login
  edit nama
  edit password
  edit role admin/user
  edit mesin yang masuk kelompok user
  aktif/nonaktif user


V38 RELATIONAL DB + PRINTER SETTINGS:
- Struktur SQL relational dengan foreign key:
  app_users -> user_device_access -> devices
  devices -> attendance_logs
  fingerprint_users -> attendance_logs
  shifts -> user_shift_assignments
- Tambah tabel setting:
  app_settings
  printer_settings
- Tambah menu Pengaturan & Printer.
- Pengaturan aplikasi dan printer ikut masuk export SQL.
- Tambah preview print browser.
- Export SQL sekarang lebih cocok untuk MySQL/XAMPP/phpMyAdmin.


V39 PRINTER + TIMEZONE DETECT:
- Timezone dropdown lengkap memakai Intl.supportedValuesOf('timeZone') jika tersedia.
- Public Base URL bisa dikosongkan jika belum online.
- Printer type: Ink Tank/Inkjet/Laser, Thermal 58mm, Thermal 80mm, Dot Matrix.
- Detect Printer Windows via PowerShell Get-Printer, fallback WMIC.
- Test Server Print via PowerShell Out-Printer.
- Auto Print setelah tarik absensi bisa jalan jika:
  printer enabled,
  server_side_print enabled,
  auto_print_attendance enabled,
  printer terinstall di Windows server,
  nama printer benar.
- Preview browser tetap tersedia untuk print manual.


V40 ROLE DEVICE FILTER FIXED:
- Fix dashboard user masih menampilkan semua mesin.
- Role user sekarang hanya melihat mesin yang ada di allowed_device_ids.
- Matching akses mesin memakai device.id dan device.sn.
- Dashboard, Live, Attendance, dan Laporan difilter berdasarkan mesin user.
- User biasa tidak boleh melakukan POST/action mesin; hanya admin yang boleh.
- Admin tetap bisa melihat semua mesin dan filter tampilan berdasarkan user/role.


V41 DASHBOARD ROLE FIXED:
- Fix Server Error: canManageMachine is not defined.
- Dashboard sekarang mendefinisikan canManageMachine berdasarkan role admin/user.
- Template dashboard diberi fallback aman agar tidak crash.
- Role user tetap hanya melihat mesin yang diizinkan.


V42 USER FIXED CLEAN:
- Fix Server Error: user is not defined pada dashboard.
- Root dashboard sekarang selalu mendefinisikan user dari req.currentUser.
- Tidak mengubah function isAdminUser(user), sehingga syntax aman.
- Role user tetap difilter berdasarkan mesin yang diizinkan.
