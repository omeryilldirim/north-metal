// backend/server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { spawn } = require("child_process");
const path = require("path");
const nodemailer = require("nodemailer");
const fs = require("fs");


const app = express();
app.use(cors());
app.use(express.json());

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
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,         // Gönderici mail
    pass: process.env.EMAIL_PASS,         // Gmail App Password
  },
});


//? Fiyat hesaplama fonksiyonu
function calculatePrice(width, height, partCount = 1) {
  let price = ((((width * height * 1.5 * 8) / 1_000_000) * 35 * 2.5 + 200) * 1.8 * 0.9166);

  // 🔹 // %10 zam : 35 cm kontrolü (350 mm) 
  if (width > 350 || height > 350) {
    price *= 1.10;
  }

  // 🔹 Uzun kenar kontrolü (990 mm üstü)
  if (width > 990 || height > 990) {
    price += 200;
  }

  // 🔹 Merge ekstra parça ücreti
  if (partCount > 1) {
    price += (partCount - 1) * 25;
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

  const python = spawn("python3", ["analyze_file.py", tempPath]);
  let output = "";
  let errorOutput = "";
  python.stdout.on("data", (data) => {
    output += data.toString();
  });
  python.stderr.on("data", (data) => {
    errorOutput += data.toString();
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
      // ! yeni eklendi
      console.error("❌ JSON PARSE FAILED");
      console.error("PYTHON EXIT CODE:", code);
      console.error("RAW OUTPUT:");
      console.error(output);
      console.error("STDERR:");
      console.error(errorOutput);
      //  !
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
  const { width, height, partCount } = req.body;

  if (!width || !height) {
    return res.status(400).json({
      error: "En ve boy ölçüsü tespit edilemedi!",
    });
  }

  const price = calculatePrice(
    Number(width),
    Number(height),
    Number(partCount || 1)
  );
  res.json({ price });
});

//? Send order email endpoint
app.post("/submit-order", upload.single("zip"), async (req, res) => {
  const zipFile = req.file;
  const customer = req.body.customer;

  if (!zipFile || !customer) {
    return res.status(400).json({ error: "Dosya ve müşteri ismi gerekli!" });
  }

  try {
    const mailOptions = {
      from: `${customer} <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_USER,
      subject: `${customer} - Yeni Sipariş`,
      text: `${customer} yeni sipariş dosyasi ektedir.`,
      attachments: [
        {
          filename: zipFile.originalname,
          content: zipFile.buffer,
        },
      ],
    };

    await transporter.sendMail(mailOptions);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Mail gönderme hatası" });
  }
});


app.listen(3001, () => console.log("Backend running on http://localhost:3001"));