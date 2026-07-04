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

  function drawToCanvas(imgLike, maxDim) {
    const { width, height } = getSize(imgLike);
    const scale = Math.min(1, maxDim / Math.max(width, height));
    const targetW = Math.max(1, Math.round(width * scale));
    const targetH = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(imgLike, 0, 0, targetW, targetH);
    return canvas;
  }

  function resizeAndCompress(imgLike) {
    const canvas = drawToCanvas(imgLike, CONFIG.IMAGE_MAX_DIMENSION);
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

  // 履歴一覧表示用の小さなサムネイル（低解像度でよい）をdata URLとして生成する
  function makeThumbnailDataUrl(imgLike) {
    const canvas = drawToCanvas(imgLike, CONFIG.THUMBNAIL_MAX_DIMENSION);
    return canvas.toDataURL("image/jpeg", CONFIG.THUMBNAIL_QUALITY);
  }

  // file: 端末で選択された元ファイル(File)。戻り値: { blob, mimeType, extension, thumbnailDataUrl }
  async function processFile(file) {
    const jpegSourceBlob = await toJpegBlobIfHeic(file);
    const imgLike = await loadImageBitmapOrElement(jpegSourceBlob);
    try {
      const compressedBlob = await resizeAndCompress(imgLike);
      const thumbnailDataUrl = makeThumbnailDataUrl(imgLike);
      return {
        blob: compressedBlob,
        mimeType: "image/jpeg",
        extension: "jpg",
        originalName: file.name,
        originalSize: file.size,
        compressedSize: compressedBlob.size,
        thumbnailDataUrl,
      };
    } finally {
      // ImageBitmapの場合は明示的にリソースを解放する
      if (imgLike && typeof imgLike.close === "function") {
        imgLike.close();
      }
    }
  }

  return { processFile, isHeic };
})();

window.Compress = Compress;
