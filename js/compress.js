// ============================================================
// 画像圧縮・HEIC変換
// - iPhoneのHEIC/HEIF形式はheic2any（CDN）でJPEGに変換してから処理する
// - 全ての画像を長辺CONFIG.IMAGE_MAX_DIMENSION px・品質CONFIG.IMAGE_QUALITYのJPEGに統一する
// ============================================================
const Compress = (() => {
  let heic2anyLoaded = false;

  function loadHeic2any() {
    if (heic2anyLoaded) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/heic2any/0.0.4/heic2any.min.js";
      s.onload = () => {
        heic2anyLoaded = true;
        resolve();
      };
      s.onerror = () => reject(new Error("heic2anyの読み込みに失敗しました"));
      document.head.appendChild(s);
    });
  }

  function isHeic(file) {
    const name = (file.name || "").toLowerCase();
    const type = (file.type || "").toLowerCase();
    return (
      type === "image/heic" ||
      type === "image/heif" ||
      name.endsWith(".heic") ||
      name.endsWith(".heif")
    );
  }

  async function toJpegBlobIfHeic(file) {
    if (!isHeic(file)) return file;
    await loadHeic2any();
    const result = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
    // heic2anyは複数枚(バーストショット等)の場合配列を返すことがあるため先頭のみ使う
    return Array.isArray(result) ? result[0] : result;
  }

  function loadImageBitmapOrElement(blob) {
    if (window.createImageBitmap) {
      return createImageBitmap(blob);
    }
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("画像の読み込みに失敗しました"));
      img.src = URL.createObjectURL(blob);
    });
  }

  function getSize(imgLike) {
    return {
      width: imgLike.width,
      height: imgLike.height,
    };
  }

  async function resizeAndCompress(blob) {
    const imgLike = await loadImageBitmapOrElement(blob);
    const { width, height } = getSize(imgLike);
    const maxDim = CONFIG.IMAGE_MAX_DIMENSION;
    const scale = Math.min(1, maxDim / Math.max(width, height));
    const targetW = Math.round(width * scale);
    const targetH = Math.round(height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(imgLike, 0, 0, targetW, targetH);

    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (outBlob) => {
          if (!outBlob) {
            reject(new Error("画像の圧縮に失敗しました"));
            return;
          }
          resolve(outBlob);
        },
        "image/jpeg",
        CONFIG.IMAGE_QUALITY
      );
    });
  }

  // file: 端末で選択された元ファイル(File)。戻り値: { blob, mimeType, extension }
  async function processFile(file) {
    const jpegSourceBlob = await toJpegBlobIfHeic(file);
    const compressedBlob = await resizeAndCompress(jpegSourceBlob);
    return {
      blob: compressedBlob,
      mimeType: "image/jpeg",
      extension: "jpg",
      originalName: file.name,
      originalSize: file.size,
      compressedSize: compressedBlob.size,
    };
  }

  return { processFile, isHeic };
})();

window.Compress = Compress;
