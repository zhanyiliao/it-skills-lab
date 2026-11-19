import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { cropAvatar } from '../src/services/avatars.js';

async function sampleImage() {
  const blue = await sharp({ create: { width: 200, height: 200, channels: 3, background: '#0000ff' } }).png().toBuffer();
  return sharp({ create: { width: 400, height: 200, channels: 3, background: '#ff0000' } })
    .composite([{ input: blue, left: 200, top: 0 }]).png().toBuffer();
}
async function assertBlue(buffer) {
  const image = sharp(buffer), metadata = await image.metadata(), stats = await image.stats();
  assert.equal(metadata.width, 256);
  assert.equal(metadata.height, 256);
  assert.equal(metadata.format, 'png');
  assert.ok(stats.channels[0].mean < 3);
  assert.ok(stats.channels[2].mean > 250);
}
test('avatar crop follows selected position and square size instead of centering', async () => {
  const original = await sampleImage();
  await assertBlue(await cropAvatar(original, { crop_x: '200', crop_y: '0', crop_size: '200' }));
  await assertBlue(await cropAvatar(original, { crop_x: '250', crop_y: '50', crop_size: '100' }));
});
test('avatar cropping uses image coordinates after EXIF rotation', async () => {
  const rotated = await sharp(await sampleImage()).jpeg({ quality: 100 }).withMetadata({ orientation: 6 }).toBuffer();
  await assertBlue(await cropAvatar(rotated, { crop_x: '0', crop_y: '200', crop_size: '200' }));
});
test('avatar crop validates complete integer coordinates and image bounds', async () => {
  const original = await sampleImage();
  for (const invalid of [
    { crop_x: '0' },
    { crop_x: '-1', crop_y: '0', crop_size: '100' },
    { crop_x: '0.5', crop_y: '0', crop_size: '100' },
    { crop_x: '0', crop_y: '0', crop_size: '0' },
    { crop_x: '350', crop_y: '0', crop_size: '100' },
    { crop_x: '0', crop_y: '150', crop_size: '100' },
    { crop_x: ['0'], crop_y: '0', crop_size: '100' },
  ]) {
    await assert.rejects(() => cropAvatar(original, invalid), { status: 422 });
  }
});
test('avatar no-script upload keeps center crop and rejects unsupported or oversized images', async () => {
  const output = await cropAvatar(await sampleImage());
  assert.equal((await sharp(output).metadata()).width, 256);
  const stats = await sharp(output).stats();
  assert.ok(stats.channels[0].mean > 100 && stats.channels[2].mean > 100);
  const oversized = await sharp({ create: { width: 4097, height: 1, channels: 3, background: '#fff' } }).png().toBuffer();
  await assert.rejects(() => cropAvatar(oversized), { status: 422 });
  await assert.rejects(() => cropAvatar(Buffer.from('<svg width="10" height="10"></svg>')), { status: 422 });
});
