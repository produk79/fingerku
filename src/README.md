# Full JS Structure

Struktur ini menjaga aplikasi tetap full JavaScript/Node.js sambil memindahkan bagian yang stabil keluar dari `server.js`.

- `config/`: konfigurasi runtime dan lokasi file aplikasi.
- `utils/`: helper umum seperti JSON store dan text formatting.
- `services/`: logika domain yang bisa dipakai route, misalnya alamat mesin dan reboot.
- `server.js`: entry lama yang masih memegang route besar. Route dipindah bertahap agar fitur mesin tidak putus.

Target berikutnya:

1. Pindahkan auth/session ke `src/middleware` dan `src/services/auth-service.js`.
2. Pindahkan route device ke `src/routes/device-routes.js`.
3. Pindahkan route role user ke `src/routes/app-user-routes.js`.
4. Pindahkan template HTML kecil ke `src/views`.
