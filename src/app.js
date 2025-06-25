// BACKEND/src/app.js
require('dotenv').config(); // Memuat variabel lingkungan dari file .env

const express = require('express');
const cors = require('cors');
const mysql = require('mysql2'); // Menggunakan mysql2 untuk dukungan promise
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3001; // Mengambil PORT dari .env atau default ke 3001

// Middleware
app.use(cors()); // Mengaktifkan CORS untuk semua origin
app.use(bodyParser.json()); // Mengurai body request JSON

// Koneksi database
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});

// Sambungkan ke database
db.connect((err) => {
  if (err) {
    console.error('❌ Gagal koneksi ke database:', err);
    // Dalam produksi, Anda mungkin ingin keluar dari aplikasi atau mencoba kembali setelah beberapa waktu.
    process.exit(1); // Keluar dari aplikasi jika koneksi database gagal
  }
  console.log('✅ Terhubung ke database MySQL');
});

// --- Endpoint API ---

// Mendapatkan semua bookings
app.get('/api/bookings', (req, res) => {
  db.query('SELECT * FROM bookings ORDER BY created_at DESC', (err, results) => {
    if (err) {
      console.error('❌ Gagal mengambil data bookings:', err);
      return res.status(500).json({ error: 'Gagal mengambil data' });
    }
    // Parse string JSON 'items' kembali ke array untuk setiap booking
    const parsedResults = results.map(booking => {
        if (typeof booking.items === 'string') {
            try {
                booking.items = JSON.parse(booking.items);
            } catch (e) {
                console.error("Gagal mengurai JSON items dari DB:", e);
                booking.items = []; // Fallback jika penguraian gagal
            }
        }
        return booking;
    });
    res.json(parsedResults);
  });
});

// Mendapatkan satu booking berdasarkan kode booking
app.get('/api/bookings/:bookingCode', (req, res) => {
  const { bookingCode } = req.params;
  db.query('SELECT * FROM bookings WHERE booking_code = ?', [bookingCode], (err, results) => {
    if (err) {
      console.error('❌ Gagal mengambil booking berdasarkan kode:', err);
      return res.status(500).json({ error: 'Gagal mengambil data booking' });
    }
    if (results.length === 0) {
      return res.status(404).json({ message: 'Booking tidak ditemukan.' });
    }
    // Parse string JSON 'items' kembali ke array
    const booking = results[0];
    if (typeof booking.items === 'string') {
        try {
            booking.items = JSON.parse(booking.items);
        } catch (e) {
            console.error("Gagal mengurai JSON items dari DB:", e);
            booking.items = []; // Fallback jika penguraian gagal
        }
    }
    res.json(booking);
  });
});

// Mendapatkan semua data equipment (alat)
app.get('/api/equipment', (req, res) => {
  db.query('SELECT * FROM equipment', (err, results) => { // Pastikan nama tabel adalah 'equipment'
    if (err) {
      console.error('❌ Gagal mengambil data equipment:', err);
      return res.status(500).json({ error: 'Gagal mengambil data equipment' });
    }
    res.json(results);
  });
});

// Menyimpan booking baru
app.post('/api/bookings', async (req, res) => {
  const {
    booking_code,
    user_name,
    items, // Diharapkan berupa array of strings, misal: ["Tenda", "Sleeping Bag"]
    rent_date,
    return_date,
    payment_method,
    status
  } = req.body;

  // --- Validasi Input Sisi Server ---
  if (!booking_code || !user_name || !items || items.length === 0 || !rent_date || !return_date || !payment_method || !status) {
    return res.status(400).json({ error: 'Semua field wajib diisi (booking_code, user_name, items, rent_date, return_date, payment_method, status).' });
  }

  // Validasi format tanggal
  const isValidDate = (dateString) => {
    const regEx = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateString.match(regEx)) return false;
    const d = new Date(dateString);
    const dNum = d.getTime();
    if (isNaN(dNum)) return false; // Periksa tanggal tidak valid (misal: "2023-02-30")
    return d.toISOString().slice(0, 10) === dateString;
  };

  if (!isValidDate(rent_date) || !isValidDate(return_date)) {
    return res.status(400).json({ error: 'Format tanggal tidak valid. Harap gunakan YYYY-MM-DD.' });
  }

  // Pastikan tanggal kembali tidak sebelum tanggal sewa
  const startDate = new Date(rent_date);
  const endDate = new Date(return_date);
  startDate.setHours(0,0,0,0); // Normalisasi ke awal hari
  endDate.setHours(0,0,0,0);   // Normalisasi ke awal hari

  if (endDate < startDate) {
    return res.status(400).json({ error: 'Tanggal kembali tidak boleh sebelum tanggal sewa.' });
  }

  // Hitung total harga di backend untuk mencegah manipulasi
  let totalPrice = 0;
  let itemsString;
  try {
    const [equipmentDataRows] = await db.promise().query('SELECT name, price, stock FROM equipment');
    const equipmentData = equipmentDataRows; // Akses elemen pertama dari array hasil query

    const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
    // +1 karena sewa tanggal 5 dan kembali tanggal 5 adalah 1 hari, 5 hingga 6 adalah 2 hari.
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    
    // Periksa durasi sewa maksimum (jika diffDays > 7, harus ditangani di frontend, namun berguna untuk diperiksa kembali di sini)
    if (diffDays > 7) {
        return res.status(400).json({ error: 'Maksimal sewa adalah 7 hari.' });
    }

    for (const itemName of items) {
        const item = equipmentData.find(e => e.name === itemName);
        if (!item) {
            return res.status(400).json({ error: `Alat "${itemName}" tidak ditemukan.` });
        }
        totalPrice += item.price * diffDays; // Hitung total berdasarkan durasi
    }
    itemsString = JSON.stringify(items); // Simpan item sebagai string JSON
  } catch (e) {
    console.error('Error selama perhitungan harga item atau stringify JSON:', e);
    return res.status(500).json({ error: 'Gagal memproses item.' });
  }
  // --- Akhir Validasi Input & Perhitungan Harga ---

  const sql = `
    INSERT INTO bookings
    (booking_code, user_name, items, rent_date, return_date, payment_method, total_price, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

  db.query(
    sql,
    [
      booking_code,
      user_name,
      itemsString,
      rent_date,
      return_date,
      payment_method,
      totalPrice, // Menggunakan harga yang dihitung backend
      status
    ],
    (err, result) => {
      if (err) {
        console.error('❌ Gagal menyimpan booking:', err);
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'Kode Booking sudah ada. Silakan coba lagi.' });
        }
        return res.status(500).json({ error: 'Gagal menyimpan booking karena kesalahan server.' });
      }
      res.status(201).json({ success: true, message: 'Booking berhasil disimpan!', result });
    }
  );
});

// Endpoint untuk memeriksa ketersediaan stok
app.post('/api/check-stock', async (req, res) => {
    const { items, rentDate, returnDate } = req.body;

    if (!items || items.length === 0 || !rentDate || !returnDate) {
        // Ini adalah validasi pertama yang mengembalikan 400
        console.error('Validation Error: Missing items, rentDate, or returnDate in /api/check-stock request.');
        return res.status(400).json({ error: 'Items, rentDate, dan returnDate wajib diisi.' });
    }

    const isValidDate = (dateString) => {
        const regEx = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateString.match(regEx)) return false;
        const d = new Date(dateString);
        const dNum = d.getTime();
        if (isNaN(dNum)) return false;
        return d.toISOString().slice(0, 10) === dateString;
    };

    if (!isValidDate(rentDate) || !isValidDate(returnDate)) {
        // Ini adalah validasi kedua yang mengembalikan 400
        console.error('Validation Error: Invalid date format in /api/check-stock request.');
        return res.status(400).json({ error: 'Format tanggal tidak valid. Harap gunakan YYYY-MM-DD.' });
    }

    const startDate = new Date(rentDate);
    const endDate = new Date(returnDate);
    startDate.setHours(0,0,0,0); // Normalisasi ke awal hari
    endDate.setHours(0,0,0,0);   // Normalisasi ke awal hari

    if (endDate < startDate) {
        // Ini adalah validasi ketiga yang mengembalikan 400
        console.error('Validation Error: Return date before rent date in /api/check-stock request.');
        return res.status(400).json({ error: 'Tanggal kembali tidak boleh sebelum tanggal sewa.' });
    }

    try {
        const [equipmentDataRows] = await db.promise().query('SELECT name, stock FROM equipment');
        const equipmentData = equipmentDataRows;

        // Hanya booking dengan status "Menunggu Pembayaran" atau "Menunggu Pengambilan" yang memengaruhi stok
        const [existingBookingsRows] = await db.promise().query("SELECT items, rent_date, return_date FROM bookings WHERE status IN ('Menunggu Pembayaran', 'Menunggu Pengambilan')");
        const existingBookings = existingBookingsRows;

        const stockStatus = {};

        for (const reqItem of items) {
            const itemInDb = equipmentData.find(e => e.name === reqItem);
            if (!itemInDb) {
                // Jika item tidak ditemukan di DB, itu tidak tersedia
                stockStatus[reqItem] = { isAvailable: false, availableStock: 0, message: 'Alat tidak ditemukan.' };
                continue;
            }

            let bookedCount = 0;
            existingBookings.forEach(booking => {
                let bookingItems;
                try {
                    // Item disimpan sebagai string JSON, uraikan
                    bookingItems = JSON.parse(booking.items);
                } catch (e) {
                    console.error("Gagal mengurai JSON items dari DB saat cek stok:", e);
                    // Jika parsing gagal, anggap saja item ini tidak berpengaruh pada stok
                    // atau bisa juga dianggap item ini bermasalah
                    bookingItems = []; // Tetap berikan fallback yang aman
                }
                const bookingRentDate = new Date(booking.rent_date);
                const bookingReturnDate = new Date(booking.return_date);
                bookingRentDate.setHours(0,0,0,0);
                bookingReturnDate.setHours(0,0,0,0);

                // Periksa tumpang tindih tanggal:
                // Tumpang tindih terjadi jika (startDate <= bookingReturnDate) DAN (endDate >= bookingRentDate)
                const hasOverlap = (startDate <= bookingReturnDate && endDate >= bookingRentDate);

                if (hasOverlap && bookingItems.includes(reqItem)) {
                    bookedCount++;
                }
            });

            const remainingStock = itemInDb.stock - bookedCount;
            stockStatus[reqItem] = {
                isAvailable: remainingStock > 0, // Item tersedia jika sisa stok lebih besar dari 0
                availableStock: remainingStock
            };
        }
        res.json(stockStatus);

    } catch (error) {
        // Ini adalah catch block terakhir jika ada error di logika try
        console.error('Error saat memeriksa stok:', error);
        res.status(500).json({ error: `Gagal memeriksa stok karena kesalahan server: ${error.message}` });
    }
});


// Middleware penanganan kesalahan global
app.use((err, req, res, next) => {
    console.error('Unhandled Error:', err.stack);
    res.status(500).send('Terjadi kesalahan pada server!');
});


// Jalankan server
app.listen(PORT, () => {
  console.log(`🚀 Backend berjalan di http://localhost:${PORT}`);
});
