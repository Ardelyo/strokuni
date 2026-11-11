# Strokuni: Konsep dan Rencana Teknis (Uji Keluarga)

8 November 2026

## Ringkasan

Strokuni adalah aplikasi Android untuk Lio, pasien pasca stroke, yang menyatukan pengingat obat layar penuh, latihan huruf dan keyboard, dan "otak kedua" yang dirangkum AI setiap malam.

Ini uji coba keluarga, bukan produk publik. Aplikasi dibagikan sebagai file APK langsung ke HP Lio dan HP keluarga, tanpa Google Play. Batasan toko aplikasi (izin layar penuh, alarm tepat waktu, akses galeri) tidak berlaku, jadi semua kemampuan Android bisa dipakai. Aturan sistem Android tetap berlaku: setiap izin harus diaktifkan sekali di Pengaturan HP.

Tiga keputusan utama:

- Dua mode: Mode Lio (satu layar "Sekarang") dan Mode Keluarga (jadwal, pengaturan, persetujuan).
- AI berjalan di cloud lewat server perantara milik kita. AI mengusulkan, keluarga memutuskan. AI tidak pernah menentukan obat atau dosis.
- Alur harian dibangun lebih dulu: obat, latihan, catatan malam, rencana besok. Galeri dan pelacak aktivitas menyusul.

## Kebutuhan Lio dan fitur yang menjawabnya

| Kebutuhan Lio | Fitur Strokuni | Di kode |
| --- | --- | --- |
| Sulit mengenali dan membaca huruf, penglihatan kabur | Latihan menelusuri huruf dan mencari tombol keyboard. Huruf besar, kontras tinggi, semua dibacakan. | `www/js/views/practice.js` |
| Sulit mengetik di HP | Latihan menulis kata dengan tiga tingkat bantuan, memakai kata dari keluarga. | `wordExercise`, `www/js/srs.js` |
| Bingung kiri dan kanan | Tombol dan petunjuk memakai ikon dan warna. Latihan khusus kiri-kanan menyusul. | Fase berikutnya |
| Ingatan pendek hilang sebagian, membaik cepat | Pengingat obat dengan kunci dosis ganda, Buku Ingatan, catatan malam yang disusun AI. | `meds.js`, `MedAlarmActivity.kt`, `ai.js` |
| Bisa mengobrol baik sekitar 30 menit, lalu lelah | Sesi 5–15 menit dengan layar istirahat. Pada hari lelah AI mengusulkan tugas lebih sedikit. | `practiceView`, `restView`, prompt server |
| Motorik sangat baik | Interaksi sentuh dan menelusuri dengan jari dimanfaatkan penuh. | `traceExercise` |

## Satu hari bersama Strokuni

1. Pagi: alarm obat layar penuh → Lio menekan "Sudah diminum" → terkunci "Sudah diminum jam 08:05".
2. Kartu "Sekarang": latihan 5 menit (telusuri huruf).
3. Layar istirahat.
4. Siang: obat, latihan cari tombol / tulis kata.
5. Sekitar 21.00: catatan malam (dua pertanyaan + cerita suara).
6. Server menyusun draf → keluarga menyetujui (satu persetujuan keluarga).
7. Besok pagi rencana yang disetujui muncul di "Sekarang".

## Prinsip desain

1. Suara dulu, teks kedua.
2. Satu tugas per layar. Huruf besar, kontras tinggi, tombol minimal 56 piksel.
3. Hemat tenaga. Sesi 5 sampai 15 menit, lalu layar istirahat.
4. Tanpa hukuman. Tidak ada nilai buruk. Bantuan diberikan bertahap lalu dikurangi, dan huruf lama diuji ulang dengan jeda yang makin lebar.
5. AI mengusulkan, keluarga memutuskan.
6. Lio ikut tahu. Apa yang dicatat ditampilkan juga kepada Lio, dan ada tombol jeda pencatatan.

## Peta kemampuan Android (v1)

| Kemampuan | API atau izin | Dipakai untuk | v1 |
| --- | --- | --- | --- |
| Alarm tepat waktu | `AlarmManager.setAlarmClock`, `SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM` | Jadwal obat tepat jam | Ya |
| Layar penuh di atas kunci layar | `USE_FULL_SCREEN_INTENT`, `setShowWhenLocked`, `setTurnScreenOn` | Layar obat menyala sendiri | Ya |
| Notifikasi | `POST_NOTIFICATIONS`, channel prioritas tinggi | Cadangan, peringatan keluarga | Ya |
| Bertahan di latar belakang | WorkManager, abaikan optimasi baterai, mulai otomatis | Heartbeat, alarm | Ya |
| Hidup lagi setelah restart | `RECEIVE_BOOT_COMPLETED` | Alarm dipulihkan | Ya |
| Suara dan dikte | TextToSpeech, RecognizerIntent, `RECORD_AUDIO` | Petunjuk dibacakan, catatan suara | Ya |
| Kamera | `CAMERA` | Foto label obat, foto kejadian | Ya |
| Telepon | `CALL_PHONE` | Tombol besar "Telepon" | Ya |
| Tampil di atas aplikasi lain | `SYSTEM_ALERT_WINDOW` | Cadangan layar penuh | Opsional |
| Kalender, galeri, aktivitas, pemakaian aplikasi | | | Fase 2 |
| Lokasi / geofence | | | Fase 3 |
| Layanan aksesibilitas, mode kios | | Tidak dipakai | Tidak |

## Otak AI berbasis cloud

HP tidak pernah memanggil model AI langsung. Semua panggilan lewat server perantara.

1. Sekitar 21.00 (bisa diatur), HP Lio menyusun log hari itu menjadi JSON ringkas (`buildDayLog` di `www/js/ai.js`).
2. Server menambahkan instruksi tetap dan skema JSON, lalu memanggil model (`server/ai.mjs`).
3. Model mengembalikan JSON terstruktur: catatan hari ini, pola (fakta dan angka), rencana besok (maks 5 tugas), pertanyaan untuk keluarga.
4. Server menyimpan draf untuk HP keluarga.
5. Keluarga menyetujui atau mengubahnya.
6. Besok pagi rencana yang disetujui muncul di layar "Sekarang".

Penjaga di server:

- Kunci API hanya ada di server.
- Instruksi tetap melarang diagnosis dan perubahan obat atau dosis.
- Keluaran divalidasi terhadap skema (structured output + zod). Yang tidak sesuai ditolak.
- Penjaga kata kunci menolak keluaran yang menyebut perubahan obat.
- Ringkasan hanya boleh memuat apa yang ada di log.
- Batas jumlah panggilan harian per keluarga.
- Bila server atau AI gagal, ringkasan standar tanpa AI dan rencana standar tetap berjalan.

## Keselamatan obat dan batas AI

1. Satu sumber kebenaran: jadwal diisi di Mode Keluarga (dikunci PIN) berdasarkan resep.
2. Foto label obat: AI membaca nama dan aturan pakai untuk mengisi draf, keluarga wajib mencentang "sudah dicocokkan dengan resep" sebelum disimpan.
3. Kunci dosis ganda: setelah "Sudah diminum", tombol terkunci sampai jadwal berikutnya.
4. Eskalasi: pengingat ulang tiap 10 menit; 30 menit → peringatan keras ke HP keluarga; 60 menit → tombol besar "Telepon".
5. Dosis terlewat: aplikasi tidak pernah menyarankan menggandakan dosis. Layar hanya mengatakan "Jangan minum dua kali. Kalau ragu, telepon keluarga atau dokter."
6. HP tidak dikunci: layar obat selalu bisa ditutup.
7. Batas AI: hanya fakta dan angka dari data yang tercatat. Tidak mendiagnosis.
8. Lapis cadangan: selama masa uji, alarm bawaan HP pada jam obat tetap menyala.

## Rencana uji bersama Lio

- Hari 1: hanya alarm obat, ditemani keluarga.
- Hari 2 dan 3: tambah latihan 5 menit.
- Hari 4 dan seterusnya: catatan malam dan rencana besok, diperiksa keluarga.
- Setiap hari dua pertanyaan untuk Lio: apakah layar membingungkan, dan apakah terlalu melelahkan (sudah ada di kartu catatan malam).

## Risiko

| Risiko | Cara menanganinya |
| --- | --- |
| Pengingat tidak berbunyi karena hemat baterai | Tiga lapis: setAlarmClock, sinyal "masih hidup", alarm bawaan HP. Tes di HP Lio. |
| Layar penuh membuat Lio kaget | Suara tenang, satu tombol besar, selalu bisa ditutup. |
| AI salah membaca label obat | AI hanya mengisi draf. Keluarga mencocokkan dengan resep. |
| AI salah menafsirkan pola harian | Hanya fakta dan angka, tanpa kesimpulan klinis. |
| Tanpa internet | Rencana standar tetap berjalan. Obat dan latihan tidak bergantung pada AI. |
| Foto dan catatan ke cloud | Hanya foto yang dipilih. Data lama dihapus berkala. |
| Lio merasa diawasi | Lio ikut melihat apa yang dicatat dan bisa menjeda pencatatan. |

## Keputusan yang masih dibutuhkan keluarga

- [ ] APK langsung atau jalur uji internal Play (default proyek ini: APK langsung via GitHub Releases)
- [ ] Model AI cloud dan siapa yang menanggung biaya kunci API (default: Claude, bisa diganti lewat `MODEL`)
- [ ] Jam pengingat obat dan jam ringkasan malam
- [ ] Siapa pemegang PIN Mode Keluarga
- [ ] Berapa lama satu sesi latihan (setelah bicara dengan terapis)
- [ ] Lomba yang dituju

## Sumber

- [Full-screen intent limits (AOSP)](https://source.android.com/docs/core/permissions/fsi-limits)
- [Play Console: foreground service and full-screen intent requirements](https://support.google.com/googleplay/android-developer/answer/16965181?hl=en)
- [Android 14: schedule exact alarms](https://developer.android.com/about/versions/14/changes/schedule-exact-alarms)
- [Google Play Photo and Video Permissions policy](https://support.google.com/googleplay/android-developer/answer/14115180?hl=en)
- [Gemini Nano on Android](https://developer.android.com/ai/gemini-nano)
- [Middleton & Schwartz, tinjauan errorless learning](https://pmc.ncbi.nlm.nih.gov/articles/PMC3381647/)
