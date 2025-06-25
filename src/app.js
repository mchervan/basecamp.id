// BACKEND/src/app.js
require('dotenv').config(); // Memuat variabel lingkungan dari file .env

// --- MULAI KODE DEBUGGING SEMENTARA ---
// Baris-baris ini akan membantu Anda melihat nilai variabel lingkungan saat aplikasi berjalan.
// Hapus baris-baris ini setelah Anda berhasil terhubung ke database di kedua lingkungan.
console.log('DEBUG (Initial Env Vars):');
console.log('  process.env.DB_HOST =', process.env.DB_HOST);
console.log('  process.env.DB_USER =', process.env.DB_USER);
console.log('  process.env.DB_PASSWORD =', process.env.DB_PASSWORD ? '*****' : 'UNDEFINED/EMPTY');
console.log('  process.env.DB_NAME =', process.env.DB_NAME);
console.log('  process.env.PORT =', process.env.PORT);

console.log('  process.env.MYSQL_HOST =', process.env.MYSQL_HOST);
console.log('  process.env.MYSQL_USER =', process.env.MYSQL_USER);
console.log('  process.env.MYSQL_PASSWORD =', process.env.MYSQL_PASSWORD ? '*****' : 'UNDEFINED/EMPTY');
console.log('  process.env.MYSQL_DATABASE =', process.env.MYSQL_DATABASE);
console.log('  process.env.MYSQL_PORT =', process.env.MYSQL_PORT);
console.log('  process.env.MYSQL_URL =', process.env.MYSQL_URL ? '***** (URL exists)' : 'UNDEFINED/EMPTY');
// --- AKHIR KODE DEBUGGING SEMENTARA ---


const express = require('express');
const cors = require('cors');
const mysql = require('mysql2'); // Menggunakan mysql2 untuk dukungan promise
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Koneksi database
let dbConfig;
if (process.env.MYSQL_URL) {
  // Jika MYSQL_URL ada (dari Railway), gunakan URL tersebut
  dbConfig = process.env.MYSQL_URL;
  console.log('DEBUG (DB Config Source): Using MYSQL_URL for database connection.');
} else {
  // Jika tidak ada (lokal atau jika Railway tidak menginjeksi URL), fallback ke variabel DB_* dari .env
  dbConfig = {
    host: process.env.MYSQL_HOST || process.env.DB_HOST,
    user: process.env.MYSQL_USER || process.env.DB_USER,
    password: process.env.MYSQL_PASSWORD || process.env.DB_PASSWORD,
    database: process.env.MYSQL_DATABASE || process.env.DB_NAME,
    port: process.env.MYSQL_PORT ? parseInt(process.env.MYSQL_PORT) : (process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 3306)
  };
  console.log('DEBUG (DB Config Source): Using DB_* or individual MYSQL_* variables for database connection.');
}

console.log('DEBUG (Final DB Config):', {
    host: typeof dbConfig === 'string' ? dbConfig : dbConfig.host,
    user: typeof dbConfig === 'string' ? 'from URL' : dbConfig.user,
    password: typeof dbConfig === 'string' ? 'from URL' : (dbConfig.password ? '*****' : 'UNDEFINED/EMPTY'),
    database: typeof dbConfig === 'string' ? 'from URL' : dbConfig.database,
    port: typeof dbConfig === 'string' ? 'from URL' : dbConfig.port
});


const db = mysql.createConnection(dbConfig);


// Sambungkan ke database
db.connect((err) => {
  if (err) {
    console.error('❌ Gagal koneksi ke database:', err);
    process.exit(1);
  }
  console.log('✅ Terhubung ke database MySQL');
});

// --- Endpoint API (tidak ada perubahan di sini) ---

// Mendapatkan semua bookings
app.get('/api/bookings', (req, res) => {
  db.query('SELECT * FROM bookings ORDER BY created_at DESC', (err, results) => {
    if (err) {
      console.error('❌ Gagal mengambil data bookings:', err);
      return res.status(500).json({ error: 'Gagal mengambil data' });
    }
    const parsedResults = results.map(booking => {
        if (typeof booking.items === 'string') {
            try {
                booking.items = JSON.parse(booking.items);
            } catch (e) {
                console.error("Gagal mengurai JSON items dari DB:", e);
                booking.items = [];
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
    const booking = results[0];
    if (typeof booking.items === 'string') {
        try {
            booking.items = JSON.parse(booking.items);
        } catch (e) {
            console.error("Gagal mengurai JSON items dari DB:", e);
            booking.items = [];
        }
    }
    res.json(booking);
  });
});

// Mendapatkan semua data equipment (alat)
app.get('/api/equipment', (req, res) => {
  db.query('SELECT * FROM equipment', (err, results) => {
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
    items,
    rent_date,
    return_date,
    payment_method,
    status
  } = req.body;

  if (!booking_code || !user_name || !items || items.length === 0 || !rent_date || !return_date || !payment_method || !status) {
    return res.status(400).json({ error: 'Semua field wajib diisi (booking_code, user_name, items, rent_date, return_date, payment_method, status).' });
  }

  const isValidDate = (dateString) => {
    const regEx = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateString.match(regEx)) return false;
    const d = new Date(dateString);
    const dNum = d.getTime();
    if (isNaN(dNum)) return false;
    return d.toISOString().slice(0, 10) === dateString;
  };

  if (!isValidDate(rent_date) || !isValidDate(return_date)) {
    return res.status(400).json({ error: 'Format tanggal tidak valid. Harap gunakan-MM-DD.' });
  }

  const startDate = new Date(rent_date);
  const endDate = new Date(return_date);
  startDate.setHours(0,0,0,0);
  endDate.setHours(0,0,0,0);

  if (endDate < startDate) {
    return res.status(400).json({ error: 'Tanggal kembali tidak boleh sebelum tanggal sewa.' });
  }

  let totalPrice = 0;
  let itemsString;
  try {
    const [equipmentDataRows] = await db.promise().query('SELECT name, price, stock FROM equipment');
    const equipmentData = equipmentDataRows;

    const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    
    if (diffDays > 7) {
        return res.status(400).json({ error: 'Maksimal sewa adalah 7 hari.' });
    }

    for (const itemName of items) {
        const item = equipmentData.find(e => e.name === itemName);
        if (!item) {
            return res.status(400).json({ error: `Alat "${itemName}" tidak ditemukan.` });
        }
        totalPrice += item.price * diffDays;
    }
    itemsString = JSON.stringify(items);
  } catch (e) {
    console.error('Error selama perhitungan harga item atau stringify JSON:', e);
    return res.status(500).json({ error: 'Gagal memproses item.' });
  }

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
      totalPrice,
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
        console.error('Validation Error: Invalid date format in /api/check-stock request.');
        return res.status(400).json({ error: 'Format tanggal tidak valid. Harap gunakan-MM-DD.' });
    }

    const startDate = new Date(rentDate);
    const endDate = new Date(returnDate);
    startDate.setHours(0,0,0,0);
    endDate.setHours(0,0,0,0);

    if (endDate < startDate) {
        console.error('Validation Error: Return date before rent date in /api/check-stock request.');
        return res.status(400).json({ error: 'Tanggal kembali tidak boleh sebelum tanggal sewa.' });
    }

    try {
        const [equipmentDataRows] = await db.promise().query('SELECT name, stock FROM equipment');
        const equipmentData = equipmentDataRows;

        const [existingBookingsRows] = await db.promise().query("SELECT items, rent_date, return_date FROM bookings WHERE status IN ('Menunggu Pembayaran', 'Menunggu Pengambilan')");
        const existingBookings = existingBookingsRows;

        const stockStatus = {};

        for (const reqItem of items) {
            const itemInDb = equipmentData.find(e => e.name === reqItem);
            if (!itemInDb) {
                stockStatus[reqItem] = { isAvailable: false, availableStock: 0, message: 'Alat tidak ditemukan.' };
                continue;
            }

            let bookedCount = 0;
            existingBookings.forEach(booking => {
                let bookingItems;
                try {
                    bookingItems = JSON.parse(booking.items);
                } catch (e) {
                    console.error("Gagal mengurai JSON items dari DB saat cek stok:", e);
                    bookingItems = [];
                }
                const bookingRentDate = new Date(booking.rent_date);
                const bookingReturnDate = new Date(booking.return_date);
                bookingRentDate.setHours(0,0,0,0);
                bookingReturnDate.setHours(0,0,0,0);

                const hasOverlap = (startDate <= bookingReturnDate && endDate >= bookingRentDate);

                if (hasOverlap && bookingItems.includes(reqItem)) {
                    bookedCount++;
                }
            });

            const remainingStock = itemInDb.stock - bookedCount;
            stockStatus[reqItem] = {
                isAvailable: remainingStock > 0,
                availableStock: remainingStock
            };
        }
        res.json(stockStatus);

    } catch (error) {
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
