/**
 * 把用户拍的照片压成"刚好够模型看清小字"的样子。
 *
 * 为什么非要压：
 *  - 官方限制单图 ≤32MiB、请求体 ≤48MiB，且**每图只算 ≤1024 token**
 *    （超了自动缩到约 1300×1300 等效）。手机原图动辄 4~8MB，直接传
 *    除了多花上传时间，模型那边反正也要缩，一点信息量都不多拿。
 *  - 本层把长边压到 1600px —— 比模型自己的 1300 略留一点余量，
 *    营养成分表的小字在这个尺度下仍读得清，而体积能掉到几百 KB。
 *
 * 三条刻意的选择：
 *
 * 1) **不引入任何新依赖。** 全程 `createImageBitmap` + `canvas` + `toDataURL`，
 *    都是浏览器自带的。多加一个 sharp/browser-image-compression 只会让
 *    这个纯静态导出的包更大。
 *
 * 2) **方向交给 `imageOrientation: "from-image"`。** 手机竖拍的照片在文件里
 *    常带一个 EXIF orientation 标记，原始像素其实是横的。"from-image" 让
 *    浏览器在解码时就按 EXIF 摆正，我们拿到的 bitmap 已经是正的 ——
 *    比手写 EXIF 解析可靠得多（各家手机的 EXIF 写法并不统一）。
 *
 * 3) **不确定就抛错、让上层说人话。** 这里不返回 null 之类的软失败：
 *    上层要区分"用户没选图"和"这张图解不开"，返回 null 会让两种情况糊在一起。
 */

/**
 * 长边上限。1600 是拿"模型会缩到 1300"倒推的：留一点余量，
 * 又不至于让 base64 字符串大到拖慢请求。
 */
const MAX_EDGE = 1600;

/** JPEG 质量。0.85 是文字照片的常用甜点：再高体积涨得快，再低小字开始发毛 */
const JPEG_QUALITY = 0.85;

/**
 * 兜底：浏览器**解不开这张图**时抛这个。
 * 单独一个错误类型，是为了让上层能把它和"用户没给图""Key 不对"分开说。
 */
export class ImageDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageDecodeError";
  }
}

/** 按长边等比缩放。已经够小就不放大（放大只会虚胖） */
function fitSize(width: number, height: number): { w: number; h: number; scale: number } {
  const longest = Math.max(width, height);
  if (longest <= MAX_EDGE) return { w: width, h: height, scale: 1 };
  const scale = MAX_EDGE / longest;
  return { w: Math.round(width * scale), h: Math.round(height * scale), scale };
}

/**
 * 把一张图片文件压成 `data:image/jpeg;base64,...`。
 *
 * @param file 用户从 `<input type="file">` 或相机拿到的原始文件
 * @returns 可直接塞进 `image_url` 块的数据 URL
 * @throws {ImageDecodeError} 无法解码（不是图片 / 格式不支持 / 文件截断）
 */
export async function fileToDataUrl(file: File | Blob): Promise<string> {
  // createImageBitmap 的第二个参数里 from-image 是"按 EXIF 摆正"。
  // Safari 也支持这一项（iOS 上正是最需要它的地方）。
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new ImageDecodeError(
      "这张图读不出来（可能不是图片，或者文件传坏了）。换一张再试，或者直接手输数值。",
    );
  }

  const { w, h } = fitSize(bitmap.width, bitmap.height);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new ImageDecodeError("这台设备的浏览器给不出画布，压不了图。请直接手输数值。");
  }

  // 缩小时开平滑，字边不会出现锯齿；放大走不到这里（fitSize 不放大）。
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);
  // bitmap 是显存里的一张图，用完要主动放掉，不然连拍几张会攒着不放。
  bitmap.close();

  const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);

  // toDataURL 在极端情况下会返回 "data:,"（画布被污染或尺寸为 0）。
  if (!dataUrl.startsWith("data:image/jpeg")) {
    throw new ImageDecodeError("这张图压完是空的，可能已经损坏了。换一张再试。");
  }
  return dataUrl;
}

/** 给测试与调试用：把压缩参数暴露出来，省得测试里抄一遍魔数 */
export const IMAGE_INPUT_LIMITS = { MAX_EDGE, JPEG_QUALITY } as const;
