CSL FINGERPRINT FULL JAVASCRIPT

File utama:
- server.js
- package.json
- src/
- bridge/zk_device_cli.js

Cara running harian:
1. Double click START_JS_APP_BACKGROUND_WINDOWS.bat
2. Buka http://127.0.0.1:8080/

Cara running sambil lihat log:
1. Double click RUN_JS_APP_WINDOWS.bat
2. Browser akan terbuka ke http://127.0.0.1:8080/
3. Jangan tutup jendela CMD selama aplikasi dipakai.

Cara stop server background:
- Double click STOP_JS_APP_WINDOWS.bat

Catatan:
- File AppleDouble ._* sudah dibersihkan.
- Aplikasi JS tidak butuh Apache untuk route utama.
- XAMPP/MySQL tetap boleh dipakai jika dibutuhkan, tetapi server web aplikasi utama berjalan dari Node.js.
- Jika port 8080 bentrok, jalankan dari CMD:
  set PORT=8090
  node server.js
