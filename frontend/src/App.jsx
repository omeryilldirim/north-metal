import { useState, useRef } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import JSZip from "jszip";
import DejaVuBase64 from "./fonts/DejaVuSans.base64";


function App() {
  const [file, setFile] = useState(null)
  const [objects, setObjects] = useState([]);
  const [totalPrice, setTotalPrice] = useState(0);
  const [customer, setCustomer] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState(null); 
  const fileInputRef = useRef();
  const [selectedIds, setSelectedIds] = useState([]);
  const COLORS = [
    { name: "Siyah", hex: "#000000" },
    { name: "Eskitme", hex: "#bfa24a" },
    { name: "Sarı", hex: "#f4c430" },
    { name: "Kırmızı", hex: "#ff0000" },
    { name: "Simli Mavi", hex: "#3f6fa0" },
    { name: "Simli Kahve", hex: "#6b4f3f" },
    { name: "Krem", hex: "#f5f0dc" },
    { name: "Turuncu", hex: "#ff7a00" },
    { name: "Bakır", hex: "#a44413" },
    // { name: "Antrasit", hex: "#2f343a" },
    { name: "Gri", hex: "#808080" },
    { name: "Beyaz", hex: "#ffffff" },
    { name: "Gold Patina", hex: "#bfa24a" },
    { name: "Gümüş Patina", hex: "#bfc3c7" },
    { name: "Bakır Patina", hex: "#a44413" },
    { name: "Çatlak Siyah", hex: "#1c1c1c" },
    { name: "Çatlak Krem", hex: "#e6dcc8" },
  ];

  const toggleSelect = (id) => {
    setSelectedIds(prev =>
      prev.includes(id)
        ? prev.filter(x => x !== id)
        : [...prev, id]
    );
  };
  
  const showToast = (type, message) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  const getFormattedDateTime = () => {
    const now = new Date();
    return now.toLocaleString("tr-TR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).replace(/:/g, "."); // tüm : karakterlerini . ile değiştir
  };

  async function fetchPrice(width, height, partCount = 1, partsList = null) {
    const res = await fetch("https://north-metal.up.railway.app/calculate-price", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        width,
        height,
        partCount,
        partsList
      }),
    });

    if (!res.ok) {
      throw new Error("Fiyat hesaplama başarısız");
    }

    const data = await res.json();
    return Math.ceil(data.price);
  }

  const submitFile = async () => {
    if (isSubmitting) return; // ekstra güvenlik

    if (!allFieldsFilled) {
      showToast("error", "Lütfen tüm objeler için renk ve isim giriniz.");
      return;
    }

    if (!file || !customer) {
      showToast("error", "Dosya ve mağaza ismi zorunlu");
      return;
    }

    try {
      setIsSubmitting(true);

      const pdfBlob = await generatePdfBlob();
      if (!pdfBlob) return;

      const dateTimeText = getFormattedDateTime();

      const zip = new JSZip();
      zip.file(file.name, file); // AI veya SVG
      zip.file(`${customer}_${dateTimeText}.pdf`, pdfBlob); // PDF

      const zipBlob = await zip.generateAsync({ type: "blob" });

      // FormData ile backend'e gönder
      const formData = new FormData();
      formData.append("zip", zipBlob, `${customer}_${dateTimeText}.zip`);
      formData.append("customer", customer);

      const res = await fetch("https://north-metal.up.railway.app/submit-order", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        showToast("success", "Sipariş gönderildi ✅");
      } else {
        console.error(data);
        showToast("error", "Mail gönderilemedi ❌");
      }

      // DOM'a eklenmesini garanti altına al
      await new Promise(requestAnimationFrame);

    } catch (err) {
      console.error("Dosya gönderim hatası:", err);
      showToast("error", "Dosya gönderilemedi");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Drag & Drop
  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
      setObjects([]);
      setTotalPrice(0);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleFileSelect = (e) => {
    setFile(e.target.files[0]);
    setObjects([]);
    setTotalPrice(0);
  };

  const analyzeFile = async () => {
    if (!file) {
      alert("Lütfen dosya seçin");
      return;
    }
    setAnalyzing(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("https://north-metal.up.railway.app/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (!Array.isArray(data)) {
        alert("Analiz başarısız");
        return;
      }

      const prepared = [];
      let total = 0;

      for (const obj of data) {
        const width = Math.round(obj.width);
        const height = Math.round(obj.height);

        const price = await fetchPrice(width, height, 1);
        total += price;

        prepared.push({
          id: `obj-${crypto.randomUUID()}`,
          groupId: null,
          ...obj,
          width,
          height,
          price,
          color: COLORS[0].name,
          name: "",
          description: "",
          preview: obj.preview,
          preview_global: obj.preview_global,
        });
      }
      setObjects(prepared);
      setTotalPrice(total);
    } catch (err) {
      console.log(err);
      alert("Analiz sırasında hata oluştu");
    } finally {
      setAnalyzing(false);
    }
  };

  const updateColor = (index, value) => {
    const updated = [...objects];
    updated[index].color = value;
    setObjects(updated);
  };

  const updateName = (index, value) => {
    const updated = [...objects];
    updated[index].name = value;
    setObjects(updated);
  };

  const updateDescription = (index, value) => {
    const updated = [...objects];
    updated[index].description = value;
    setObjects(updated);
  };

  async function svgToPngWithSize(svgDataUrl) {
    return new Promise((resolve) => {
      if (!svgDataUrl || svgDataUrl === "data:,") {
        // Boş veya geçersiz SVG
        return resolve({ dataUrl: null, width: 0, height: 0 });
      }
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          // gorsel boyutunu koruyor ama dosya cok buyuk olabiliyor
          // canvas.width = img.width;
          // canvas.height = img.height;
          // const ctx = canvas.getContext("2d");
          // ctx.drawImage(img, 0, 0);
          const MAX = 300;
          const scale = Math.min( MAX / img.width, MAX / img.height, 1);
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          const ctx = canvas.getContext("2d");
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(
            img,
            0,
            0,
            canvas.width,
            canvas.height
          );
          const dataUrl = canvas.toDataURL("image/png");
          resolve({ dataUrl, width: img.width, height: img.height });
        } catch (error) {
          reject(error)
        }
      };
      img.onerror = () => reject(new Error("SVG -> PNG dönüşümü başarısız"));
      img.src = svgDataUrl;
    });
  }

  const generatePDF = async () => {
    if (!allFieldsFilled) {
      alert("Lütfen tüm objeler için renk ve isim seçin.");
      return;
    }
    const dateTimeText = getFormattedDateTime();
    setPdfLoading(true);
    try {
      // Önce tüm preview’leri PNG’ye çevir
      // objects[i].previewPng ile birlikte width ve height de sakla
      for (const o of objects) {
        try {
          const { dataUrl, width, height } = await svgToPngWithSize(o.preview);
          o.previewPng = dataUrl;
          o.previewWidth = width;
          o.previewHeight = height;
        } catch (error) {
          console.warn("Önizleme oluşturulamadı:", o, error);
          o.previewPng = null; // PDF’de resmi atla
        }
      }

      const doc = new jsPDF();
      doc.addFileToVFS("DejaVuSans.ttf", DejaVuBase64);
      doc.addFont("DejaVuSans.ttf", "DejaVu", "normal");
      doc.setFont("DejaVu");
      doc.setFontSize(12);
      doc.text(`Mağaza ismi: ${customer}`, 14, 15);

      autoTable(doc, {
        startY: 25,
        head: [["#", "Önizleme", "Renk", "Açıklama", "Müşteri ismi", "En (mm)", "Boy (mm)", "Fiyat (TL)"]],
        columnStyles: {
          1: { minCellWidth:40, minCellHeight: 40}, // Önizleme sütunu
        },
        styles: {
          font: "DejaVu",
          fontStyle: "normal",
          lineWidth: 0.3,              // 🔹 hücre çizgi kalınlığı
          lineColor: [180, 180, 180],  // 🔹 açık gri border
          valign: "middle",
          fontSize: 10,
        },
        headStyles: {
          font: "DejaVu",
          fontStyle: "normal",
          minCellHeight: 8,     // 🔹 başlık normal yükseklik
          halign: "center",
          valign: "middle",
        },
        bodyStyles: {
          font: "DejaVu",
          minCellHeight: 25,    // ✅ SADECE body satırları 25mm
          valign: "middle",
          halign: "center",
        },
        body: objects.map((o, i) => [
          i + 1,
          "",  // Önizleme hücresi boş bırakılıyor, resim didDrawCell ile ekleniyor
          o.color || "",
          o.description || "", 
          o.name || "",
          Math.round(o.width),
          Math.round(o.height),
          o.price,
        ]),
        didDrawCell: (data) => {
          if (data.section === 'body' && data.column.index === 1) {
            const obj = objects[data.row.index];
            if (!obj || !obj.previewPng) return; // geçersiz veya boş resmi atla

              const padding = 2;
              const cellWidth = data.cell.width - padding * 2;
              const cellHeight = data.cell.height - padding * 2;

              const ratio = Math.min(
                cellWidth / obj.previewWidth,
                cellHeight / obj.previewHeight
              );
              const w = obj.previewWidth * ratio;
              const h = obj.previewHeight * ratio;

              const x = data.cell.x + (cellWidth - w) / 2 + 1;
              const y = data.cell.y + (cellHeight - h) / 2 + 1;

              try {
                doc.addImage(obj.previewPng, 'PNG', x, y, w, h);
              } catch (err) {
                console.warn("Önizleme eklenemedi:", obj.name, err);
                showToast("error", `Önizleme eklenemedi: ${obj.name} ${err}`);
              }
            
          }
        },
        didDrawPage: (data) => {
          const pageCount = doc.internal.getNumberOfPages();
          doc.setFont("DejaVu");
          doc.setFontSize(10);
          doc.text(
            `Sayfa ${data.pageNumber} / ${pageCount}`,
            doc.internal.pageSize.getWidth() - 14,
            doc.internal.pageSize.getHeight() - 10,
            { align: "right" }
          );  
          doc.text(
            dateTimeText,
            doc.internal.pageSize.getWidth() - 14,
            12,
            { align: "right" }
          );      
        },
      });

      doc.text(
        `Toplam : ${totalPrice} TL`,
        doc.internal.pageSize.getWidth() - 14, // sağdan boşluk
        doc.lastAutoTable.finalY + 10,
        { align: "right" }
      );

      doc.save(`${customer}-siparis-${dateTimeText}.pdf`);
      showToast("success", "PDF başarıyla indirildi ✅");
    } catch (err) {
      showToast("error", "PDF indirilemedi ❌");
      console.error(err);
    } finally {
      setPdfLoading(false);
    }
  }

  const generatePdfBlob = async () => {
    if (!allFieldsFilled) {
      alert("Lütfen tüm objeler için renk ve isim seçin.");
      return null;
    }
    const dateTimeText = getFormattedDateTime();
    // preview PNG üretimi (generatePDF ile aynı)
    for (const o of objects) {
      try {
        const { dataUrl, width, height } = await svgToPngWithSize(o.preview);
        o.previewPng = dataUrl;
        o.previewWidth = width;
        o.previewHeight = height;
      } catch (error) {
        console.warn("Önizleme oluşturulamadı:", o, error);
        o.previewPng = null; // PDF’de resmi atla
      }
    }

    const doc = new jsPDF();
    doc.addFileToVFS("DejaVuSans.ttf", DejaVuBase64);
    doc.addFont("DejaVuSans.ttf", "DejaVu", "normal");
    doc.setFont("DejaVu");
    doc.setFontSize(12);
    doc.text(`Magaza ismi: ${customer}`, 14, 15);

    autoTable(doc, {
      startY: 25,
      head: [
        [
          "#",
          "Önizleme",
          "Renk",
          "Açıklama",
          "Müşteri ismi",
          "En (mm)",
          "Boy (mm)",
          "Fiyat (TL)",
        ],
      ],
      columnStyles: {
        1: { minCellWidth: 40, minCellHeight: 40 }, // Önizleme sütunu
      },
      styles: {
        font: "DejaVu",
        fontStyle: "normal",
        lineWidth: 0.3, // 🔹 hücre çizgi kalınlığı
        lineColor: [180, 180, 180], // 🔹 açık gri border
        valign: "middle",
        fontSize: 10,
      },
      headStyles: {
        font: "DejaVu",
        fontStyle: "normal",
        minCellHeight: 8, // 🔹 başlık normal yükseklik
        halign: "center",
        valign: "middle",
      },
      bodyStyles: {
        font: "DejaVu",
        minCellHeight: 25, // ✅ SADECE body satırları 25mm
        valign: "middle",
        halign: "center",
      },
      body: objects.map((o, i) => [
        i + 1,
        "",
        o.color,
        o.description || "",
        o.name,
        o.width,
        o.height,
        o.price,
      ]),
      didDrawCell: (data) => {
        if (data.section === "body" && data.column.index === 1) {
          const obj = objects[data.row.index];
          if (!obj || !obj.previewPng) return; // geçersiz veya boş resmi atla

          const padding = 2;
          const cellWidth = data.cell.width - padding * 2;
          const cellHeight = data.cell.height - padding * 2;

          const ratio = Math.min(
            cellWidth / obj.previewWidth,
            cellHeight / obj.previewHeight
          );
          const w = obj.previewWidth * ratio;
          const h = obj.previewHeight * ratio;

          const x = data.cell.x + (cellWidth - w) / 2 + 1;
          const y = data.cell.y + (cellHeight - h) / 2 + 1;

          try {
            doc.addImage(obj.previewPng, "PNG", x, y, w, h);
          } catch (err) {
            console.warn("Önizleme eklenemedi:", obj.name, err);
            showToast("error", `Önizleme eklenemedi: ${obj.name} ${err}`);
          }
        }
      },
      didDrawPage: (data) => {
        const pageCount = doc.internal.getNumberOfPages();
        doc.setFontSize(10);
        doc.text(
          `Sayfa ${data.pageNumber} / ${pageCount}`,
          doc.internal.pageSize.getWidth() - 14,
          doc.internal.pageSize.getHeight() - 10,
          { align: "right" }
        );
        doc.text(dateTimeText, doc.internal.pageSize.getWidth() - 14, 12, {
          align: "right",
        });
      },
    });
      doc.text(
        `Toplam : ${totalPrice} TL`,
        doc.internal.pageSize.getWidth() - 14, // sağdan boşluk
        doc.lastAutoTable.finalY + 10,
        { align: "right" }
      );

    return doc.output("blob");
  };

  const allFieldsFilled =
    objects.length > 0 &&
    objects.every(
      (o) => o.color.trim() !== "" && o.name.trim() !== ""
  );

  const generateMergedPreview = async (parts) => {
    const paddingMM = 1;

    // Global bounding box
    const minX = Math.min(...parts.map(p => p.minx));
    const minY = Math.min(...parts.map(p => p.miny));
    const maxX = Math.max(...parts.map(p => p.maxx));
    const maxY = Math.max(...parts.map(p => p.maxy));

    const widthMM = maxX - minX + paddingMM * 2;
    const heightMM = maxY - minY + paddingMM * 2;

    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(widthMM);
    canvas.height = Math.ceil(heightMM);

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const p of parts) {
      await new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
          // Global koordinatlara göre x/y
          const x = p.minx - minX + paddingMM;
          const y = p.miny - minY + paddingMM;

          ctx.drawImage(img, x, y, p.width, p.height);
          resolve();
        };
        img.src = p.preview_global; // merge için global preview
      });
    }

    return {
      preview: canvas.toDataURL("image/png"),
      width: widthMM,
      height: heightMM
    };
  };

  const mergeSelected = async () => {
    const selected = objects.filter(o => selectedIds.includes(o.id));
    const rest = objects.filter(o => !selectedIds.includes(o.id));

    if (selected.length < 2) return;

    const partsList = selected.map(o => ({ width: o.width, height: o.height }));
    const mergedPreview = await generateMergedPreview(selected)
    const mergedPrice = await fetchPrice( Math.round(mergedPreview.width), Math.round(mergedPreview.height), selected.length, partsList );

    const merged = {
      id: crypto.randomUUID(),
      groupId: crypto.randomUUID(),
      name: selected[0].name,
      color: selected[0].color,

      width: Math.round(mergedPreview.width),
      height: Math.round(mergedPreview.height),
      price : mergedPrice,

      preview: mergedPreview.preview,           // tablo için birleşik preview
      preview_global: mergedPreview.preview,    // global preview
      parts: selected
    };
    setTotalPrice(totalPrice - selected.reduce((sum, o) => sum + o.price, 0) + mergedPrice);
    setObjects([...rest, merged]);
    setSelectedIds([]);
  };

  return (
    <div className="app-container">
      <h1 className="page-title">North Metal – Fiyat Hesaplama Aracı</h1>
      <br />

      {/* MÜŞTERİ ADI */}
      <div className="customer-row">
        <label>
          <strong>Mağaza İsmi</strong>
        </label>
        <input
          type="text"
          placeholder="Mağaza ismi giriniz"
          value={customer}
          onChange={(e) => setCustomer(e.target.value)}
          required
          style={{ borderColor: !customer ? "red" : "initial", marginTop: 4 }}
        />
      </div>

      <br />

      <div className="info-box">
        <h3>Önemli Bilgilendirme</h3>
        <ol>
          <li>Lütfen önce mağaza ismini yazınız.</li>
          <li>
            Her seferinde <strong>tek dosya</strong> yükleyiniz ve <strong>SVG formatında</strong> yükleyiniz. 
            AI formatından SVG'ye çeviriyorsanız, çevirme işlemi sırasında <strong>responsive özelliğini kapalı</strong> bırakınız. Çalışma dosyanıza bilgilendirme amaçlı text objeleri yazmayınız.
          </li>
          <li>
            Dosya analiz edildikten sonra birleştirilecek objeleri seçerek, tablonun altında bulunan 
            <strong>"Seçilenleri Tek Ürün Yap"</strong> butonuna tıklayınız. Birleştirilecek parçalar çalışma dosyanızda  birbirine temas etmeden en az alan kaplayacak şekilde yerleştirilmelidir. Tabloda birleştirme işlemi yapıldıktan sonra tek parça olarak fiyatlandırılacaktır.
          </li>
          <li>
            Tek ürün yapılacak objeler bir seferde seçilip birleştirilmelidir, parça parça birleştirmeye çalışmayınız.  
            Hata olması durumunda dosyayı tekrar yükleyip devam ediniz.
          </li>
          <li>
            Daha sonra <strong>Renk, Müşteri İsmi</strong>(barkod üzerindeki isimle aynı olmalıdır)<strong> ve Açıklama</strong> kısımlarını doldurunuz.  
            Açıklama kısmı zorunlu değildir, ancak ürünü tarif eden veya görselde tam okunamayan yazıları yazmanız faydalı olacaktır.
          </li>
          <li>
            Tablo doldurulduktan sonra <strong>"Kaydet ve PDF İndir"</strong> butonu ile kendi bilgisayarınıza bilgi amaçlı indirebilirsiniz.  
            Daha sonra <strong>"Üretime Gönder"</strong> butonu ile kesim işlemi için gönderiniz.  
            Üretime Gönder butonuna basmazsanız siparişleriniz kesime girmemiş olur.
          </li>
        </ol>
      </div>

      {/* DOSYA SEÇ */}
      {/* Drag & Drop */}
      <div
        className="drop-area"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onClick={() => fileInputRef.current.click()}
      >
        {file
          ? `Seçilen Dosya: ${file.name}`
          : "Dosyayı sürükleyip bırakın veya tıklayın"}
      </div>
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileSelect}
        style={{ display: "none" }}
      />
      <br />
      <br />

      {/* ANALYZE BUTONU */}
      <button className="primary-button" onClick={analyzeFile} disabled={!file || !customer || analyzing}>
        {/* {analyzing ? "Analiz ediliyor..." : "Analiz Et"} */}
        {analyzing ? <span className="spinner" /> : "Analiz Et"}
      </button>

      {objects.length > 0 && (
        <>
          <h2>Objeler</h2>

          <table border="1" cellPadding="6">
            <thead>
              <tr>
                <th>Seç</th>
                <th>#</th>
                <th>Önizleme</th>
                <th>Renk</th>
                <th>Müşteri İsmi</th>
                <th>Açıklama</th>
                <th>En (mm)</th>
                <th>Boy (mm)</th>
                <th>Fiyat</th>
              </tr>
            </thead>
            <tbody>
              {objects.map((o, i) => (
                <tr key={i}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(o.id)}
                      onChange={() => toggleSelect(o.id)}
                    />
                  </td>
                  <td>{i + 1}</td>
                  <td style={{ textAlign: "center" }}>
                    <img
                      src={o.preview}
                      alt="preview"
                      className="preview-img"
                    />
                  </td>
                  <td>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 8,
                      }}
                    >
                      {/* Renk kutucuğu */}
                      <div
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: 4,
                          backgroundColor:
                            COLORS.find((c) => c.name === o.color)?.hex || "#000000",
                          border: "1px solid #999",
                        }}
                      />
                      {/* Select */}
                      <select
                        value={o.color || "Siyah"}
                        onChange={(e) => updateColor(i, e.target.value)}
                        style={{
                          padding: "4px 6px",
                          borderRadius: 4,
                        }}
                      >
                        <option value="">Renk seçiniz</option>
                        {COLORS.map((c) => (
                          <option key={c.name} value={c.name}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </td>
                  <td>
                    <input
                      type="text"
                      placeholder="Alıcı İsmi"
                      value={o.name}
                      onChange={(e) => updateName(i, e.target.value)}
                      style={{ width: "100%", boxSizing: "border-box" }}
                    />
                  </td>
                  <td>
                    <textarea
                      placeholder="Açıklama girin"
                      value={o.description}
                      onChange={(e) => updateDescription(i, e.target.value)}
                      rows={3}
                      style={{
                        width: "100%",
                        resize: "none",
                        padding: "4px",
                        fontSize: "12px",
                        boxSizing: "border-box",
                      }}
                    />
                  </td>
                  <td>{o.width}</td>
                  <td>{o.height}</td>
                  <td>{o.price}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2 className="total-price">
            Toplam Fiyat: {totalPrice} TL
          </h2>

          {/* PDF BUTONU */}
          <button
            className="primary-button"
            disabled={!allFieldsFilled || !customer || pdfLoading}
            onClick={generatePDF}
          >
            {pdfLoading ? "PDF hazırlanıyor..." : "Kaydet ve PDF İndir"}
          </button>
          <button className="primary-button" onClick={submitFile} disabled={isSubmitting || !file || !customer}>
            {isSubmitting ? <span className="spinner" /> : "Üretime Gönder"}
          </button>
          {toast && (
            <div className={`toast toast-${toast.type}`}>{toast.message}</div>
          )}
        </>
      )}
      {selectedIds.length > 0 && (
        <button
          className="merge-floating-btn"
          disabled={selectedIds.length < 2}
          onClick={mergeSelected}
        >
          {`Seçilenleri Birleştir (${selectedIds.length})`}
        </button>
      )}
    </div>
  );
}

export default App;
