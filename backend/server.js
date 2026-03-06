// backend/server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { spawn } = require("child_process");
const path = require("path");
// const nodemailer = require("nodemailer");
const fs = require("fs");
const { Resend } = require("resend");
const resend = new Resend(process.env.RESEND_API_KEY);
const app = express();
app.use(cors());
app.use(express.json());

const { Pool } = require("pg");
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});
pool.query("SELECT * FROM orders;").then(res => console.log("DB CONNECTION SUCCESS!")).catch(err => console.error("DB CONNECTION ERROR:", err));

//? Multer setup
// const storage = multer.diskStorage({
//   destination: "uploads/",
//   filename: (req, file, cb) => {
//     cb(null, Date.now() + path.extname(file.originalname));
//   },
// });
// const upload = multer({ storage });
const upload = multer({ storage: multer.memoryStorage() });

//? Nodemailer setup (Gmail örnek)
// const transporter = nodemailer.createTransport({
//   host: "smtp.gmail.com",
//   port: 587,
//   secure: false,
//   auth: {
//     user: process.env.EMAIL_USER,         // Gönderici mail
//     pass: process.env.EMAIL_PASS,         // Gmail App Password
//   },
// });
// transporter.verify(function(error, success) {
//   if (error) {
//     console.log("MAIL ERROR:", error);
//   } else {
//     console.log("MAIL SERVER READY");
//   }
// });

//? Fiyat hesaplama fonksiyonu
function calculatePrice(width, height, partCount = 1, partsList = null) {
  let price = ((((width * height * 1.5 * 8) / 1_000_000) * 35 * 2.5 + 200) * 1.8 * 0.9166);
  // =====================================================
  // ✅ %10 zam (35cm kontrolü)
  // =====================================================
  if (width > 359 || height > 359) {
    price *= 1.10;
  }
  // =====================================================
  // ✅ UZUN KENAR KONTROLÜ (YENİ SİSTEM)
  // =====================================================
  const longestSide = Math.max(width, height);
  if (longestSide > 690 && longestSide < 995) {
    price += 100;
  } else if (longestSide >= 995 && longestSide < 1195) {
    price += 200;
  } else if (longestSide >= 1195 && longestSide < 1395) {
    price += 300;
  } else if (longestSide >= 1395 && longestSide < 1495) {
    price += 400;
  } else if (longestSide >= 1495) {
    price += 500;
  }
  // =====================================================
  // ✅ MERGE EXTRA PARÇA ÜCRETİ (EN BÜYÜK ALAN HARİÇ)
  // =====================================================
  if (partCount > 1 && Array.isArray(partsList) && partsList.length) {
    // en büyük parçanın indexini bul
    const biggestIndex = partsList
      .map(p => p.width * p.height)
      .indexOf(Math.max(...partsList.map(p => p.width * p.height)));

    partsList.forEach((part, i) => {
      // sadece en büyük parçayı atla
      if (i === biggestIndex) return;
      const longest = Math.max(part.width, part.height);
      if (longest <= 100) {
        price += 10;
      } else if (longest < 250) {
        price += 15;
      } else {
        price += 25;
      }
    });
  }
  return price;
}

//? Upload endpoint (disk storage version)
// app.post("/upload", upload.single("file"), (req, res) => {
//   const filePath = req.file.path;

//   const python = spawn("python3", ["analyze_file.py", filePath]);

//   let output = "";
//   let errorOutput = "";

//   python.stdout.on("data", (data) => {
//     output += data.toString();
//   });

//   python.stderr.on("data", (data) => {
//     errorOutput += data.toString();
//   });

//   python.on("close", (code) => {
//     console.log("PYTHON EXIT CODE:", code);
//     console.log("PYTHON STDOUT:", output);
//     console.log("PYTHON STDERR:", errorOutput);

//     try {
//       const parsed = JSON.parse(output);
//       res.json(parsed);
//     } catch (err) {
//       res.status(500).json({
//         error: "Python JSON parse failed",
//         rawOutput: output,
//         stderr: errorOutput,
//       });
//     }
//   });
// });

//? Upload endpoint (memory storage version)
app.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Dosya yok" });
  }
  // 🔹 gerçek dosya yolu oluştur
  const tempPath = path.join(
    __dirname,
    "uploads",
    Date.now() + path.extname(req.file.originalname)
  );
  // 🔹 buffer → dosya
  fs.writeFileSync(tempPath, req.file.buffer);

  const python = spawn("python", ["analyze_file.py", tempPath]);
  let output = "";
  let errorOutput = "";
  python.stdout.on("data", (data) => {
    const text = data.toString();
    output += text;
  });
  python.stderr.on("data", (data) => {
    const text = data.toString();
    errorOutput += text;
  });
  python.on("close", (code) => {
    console.log("PYTHON EXIT CODE:", code);
    console.log("PYTHON STDERR:", errorOutput);
    // 🔹 temp dosyayı sil
    fs.unlinkSync(tempPath);
    try {
      const parsed = JSON.parse(output);
      res.json(parsed);
    } catch (err) {
      console.error("❌ JSON PARSE FAILED");
      console.error("PYTHON EXIT CODE:", code);
      console.error("RAW OUTPUT:");
      console.error(output);
      console.error("STDERR:");
      console.error(errorOutput);
      res.status(500).json({
        error: "Python JSON parse failed",
        rawOutput: output,
        stderr: errorOutput,
      });
    }
  });
});

//? Calculate price endpoint
app.post("/calculate-price", (req, res) => {
  const { width, height, partCount, partsList } = req.body;

  if (!width || !height) {
    return res.status(400).json({
      error: "En ve boy ölçüsü tespit edilemedi!",
    });
  }

  const price = calculatePrice(
    Number(width),
    Number(height),
    Number(partCount || 1),
    partsList
  );
  res.json({ price });
});

//? Send order email endpoint
app.post("/submit-order", upload.single("zip"), async (req, res) => {
  const zipFile = req.file;
  const customer = req.body.customer;
  const email = req.body.email;
  const fileName = req.body.fileName;

  if (!zipFile || !customer) {
    return res.status(400).json({ error: "Dosya ve müşteri ismi gerekli!" });
  }

  const orderId = crypto.randomUUID();

  try {
    const result = await resend.emails.send({
      from: "North Metal <info@northlasercut.com>",
      to: process.env.EMAIL_ADMIN,
      subject: `${customer} - Yeni Sipariş`,
      text: `${customer} yeni sipariş dosyasi ektedir.
        Sipariş No: ${orderId}
        Admin Panel : https://north-metal.up.railway.app/admin?token=NorthMetal2026`,
      attachments: [
        {
          filename: zipFile.originalname,
          content: zipFile.buffer.toString("base64"),
          contentType: "application/zip",
        },
      ],
    });
    console.log("RESEND RESULT:", result);
    console.log(`${customer} - ${fileName} Sipariş maili gönderildi.`);
    
    const cleanEmail = email && email.trim() !== "" ? email.trim() : null;
    const initialStatus = cleanEmail ? "Bekliyor" : "Kesime Alındı";
    pool.query(
      "INSERT INTO orders (id, customer, email, status, file_name) VALUES ($1,$2,$3,$4,$5)",
      [orderId, customer, cleanEmail, initialStatus, fileName]
    ).then(() => {
      console.log("Sipariş DB'ye kaydedildi:", orderId);
    }).catch(err => {
      console.error("DB KAYIT HATASI:", err);
    }).finally(() => {
      res.json({ success: true });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Mail gönderme hatası" });
  }
});

app.get("/", (req,res)=>{
 res.send("API OK");
});

//? Admin panel endpoint
app.get("/admin", async (req, res) => {

  if (req.query.token !== process.env.ADMIN_SECRET) {
    return res.status(403).send("Yetkisiz ❌");
  }

  const result = await pool.query(
    "SELECT * FROM orders ORDER BY created_at DESC"
  );

  const rows = result.rows.map(order => `
    <tr>
      <td>${order.id}</td>
      <td>${new Date(order.created_at).toLocaleString("tr-TR",{
        timeZone: "Europe/Istanbul"
      })}</td>
      <td>${order.customer}</td>
      <td>${order.file_name || "-"}</td>
      <td>${order.email}</td>
      <td>
        ${
          order.status === "Kesime Alındı"
            ? `<button disabled class="btn-green">Kesime Alındı</button>`
            : `
              <form method="POST" action="/admin/production/${order.id}?token=${req.query.token}">
                <button type="submit" class="btn-red">Kesime Al</button>
              </form>
            `
        }
      </td>
    </tr>
  `).join("");

  res.send(`
    <html>
      <head>
        <title>North Metal - Admin Panel</title>
        <style>
          h2 {
            text-align: center;
            margin-bottom: 30px;
          }
          table {
            margin: 0 auto; /* tabloyu da ortalar */
            border-collapse: collapse;
          }
          td {
            max-width: 250px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .btn-red {
            background:#dc3545;
            color:white;
            padding:6px 12px;
            border:none;
            border-radius:4px;
            cursor:pointer;
          }

          .btn-green {
            background:#28a745;
            color:white;
            padding:6px 12px;
            border:none;
            border-radius:4px;
          }
        </style>
      </head>
      <body style="font-family:Arial;padding:40px;">
        <h2>North Metal - Admin Panel</h2>
        <table border="1" cellpadding="10" cellspacing="0">
          <thead>
            <tr>
              <th>ID No</th>
              <th>Tarih</th>
              <th>Mağaza</th>
              <th>Dosya Adı</th>
              <th>Email</th>
              <th>İşlem</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </body>
    </html>
  `);
});

//? Admin - Kesime Al endpoint
app.post("/admin/production/:id", async (req, res) => {
  if (req.query.token !== process.env.ADMIN_SECRET) {
    return res.status(403).send("Yetkisiz ❌");
  }

  const { id } = req.params;

  const result = await pool.query(
    "SELECT * FROM orders WHERE id = $1",
    [id]
  );

  if (!result.rows.length) {
    return res.send("Sipariş bulunamadı ❌");
  }

  const order = result.rows[0];

  if (order.status === "Kesime Alındı") {
    return res.redirect(`/admin?token=${req.query.token}`);
  }

  await pool.query(
    "UPDATE orders SET status = $1 WHERE id = $2",
    ["Kesime Alındı", id]
  );

  // 🔹 Email varsa müşteriye mail gönder
  if (order.email && order.email.trim() !== "") {
    try {
      const response = await resend.emails.send({
        from: "North Metal <info@northlasercut.com>",
        to: order.email,
        subject: `${order.customer} - ${order.file_name}`,
        text: `Siparişiniz kesime alınmıştır.
              Dosya ismi : '${order.file_name}'
              ID no : '${order.id}'`,
      });
      console.log("RESEND FEEDBACK RESULT:", response);
      console.log(`${order.customer} - ${order.file_name} Kesime alındı maili gönderildi.`);
    } catch (mailErr) {
      console.error("Müşteri mail gönderim hatası:", mailErr);
    }
  } else {
    console.log("Email yok, müşteriye mail gönderilmedi.");
  }
  res.redirect(`/admin?token=${req.query.token}`)
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () =>
  console.log(`Backend running on ${PORT}`)
);
