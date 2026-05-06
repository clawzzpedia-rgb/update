# TODO

## Plan implementasi
1. Perbaiki real-time chat/lokasi: buat room benar (client join-room) dan samakan pemakaian roomId.
2. Tambah login/register + hapus akun (tanpa DB):
   - simpan akun di file JSON di server
   - endpoint/emit untuk register/login/delete
   - simpan session token di client (atau cookie) untuk identifikasi socket
3. Perbaiki settings modal agar tombol settings bisa dipencet (open/close) dan tidak error.
4. Ubah map ke satellite view.
5. Perbaiki UI chat online count (berdasarkan user online) bukan jumlah pesan.
6. Tambah fitur indikator:
   - indikator baterai user sendiri dan teman (via getBattery + broadcast)
7. Tambah realtime speed dan tampilkan di UI serta broadcast ke teman.
8. Tambah nama jalan saat update lokasi: reverse geocoding di browser (fetch) dan kirim roadName dalam payload lokasi.
9. Implement klik marker teman:
   - tampilkan menu chat + tombol dengar mic teman (on/off) (minimal: mengaktifkan / menonaktifkan “listening” state UI; signaling WebRTC lanjutkan supaya bisa benar-benar mendengar).
10. Rapikan audio list: jangan dummy; bangun dari user online.
11. Test manual di 2 tab: login, lokasi, chat realtime, mic status, settings, indikator.

