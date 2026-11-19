import sharp from 'sharp';
import { fail } from '../support.js';

/** Coordinates refer to the original image after applying its EXIF orientation. */
export async function cropAvatar(buffer, input = {}) {
  const processor = sharp(buffer, { limitInputPixels: 4096 * 4096 });
  const metadata = await processor.metadata();
  if (!['png', 'jpeg', 'webp'].includes(metadata.format) || metadata.width > 4096 ||
    metadata.height > 4096 || (metadata.pages ?? 1) > 1) {
    fail(422, '圖片寬高不得超過 4096 像素，且需為 PNG、JPEG 或 WebP 靜態圖片。');
  }
  const normalized = await processor.rotate().toBuffer();
  const image = sharp(normalized);
  const { width, height } = await image.metadata();
  const fields = ['crop_x', 'crop_y', 'crop_size'];
  if (!fields.some(field => input[field] !== undefined)) {
    return image.resize(256, 256, { fit: 'cover', position: 'centre' }).png().toBuffer();
  }
  if (!fields.every(field => typeof input[field] === 'string' && /^\d{1,4}$/.test(input[field]))) {
    fail(422, '裁切資料不完整，請重新選擇圖片並調整裁切範圍。');
  }
  const [left, top, size] = fields.map(field => Number(input[field]));
  if (size < 1 || left + size > width || top + size > height) {
    fail(422, '裁切範圍超出圖片，請重新調整。');
  }
  return image.extract({ left, top, width: size, height: size }).resize(256, 256).png().toBuffer();
}
