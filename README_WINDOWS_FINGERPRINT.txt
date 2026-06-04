FILE WINDOWS UNTUK CEK IP DAN PORT FINGERPRINT

1. WINDOWS_CEK_IP_FINGERPRINT.bat
   Jalankan di PC aplikasi/XAMPP untuk cek:
   - ping IP/host
   - port TCP mesin fingerprint, default 4370

   Contoh:
   WINDOWS_CEK_IP_FINGERPRINT.bat 100.113.92.55 4370

2. WINDOWS_SETUP_PORTPROXY_FINGERPRINT_ADMIN.bat
   Jalankan di PC Windows yang satu jaringan dengan mesin fingerprint.
   Wajib klik kanan -> Run as administrator.

   Isi:
   - IP Tailscale PC tersebut, contoh 100.113.92.55
   - IP lokal mesin fingerprint, contoh 192.168.1.200
   - listen port, default 4370
   - connect port mesin, default 4370

   Setelah selesai, dari PC aplikasi/XAMPP tes:
   WINDOWS_CEK_IP_FINGERPRINT.bat 100.113.92.55 4370

CATATAN
- IP Tailscale 100.x biasanya IP PC, bukan IP mesin fingerprint.
- Kalau mesin fingerprint tidak menjalankan Tailscale, perlu portproxy atau subnet route.
- Jika dua kantor memakai subnet LAN yang sama, misalnya sama-sama 192.168.18.x, portproxy lebih aman daripada subnet route.
