/* zip.js — minimal STORE-method ZIP writer (no deps) */

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(u8, seed = 0) {
  let c = (seed ^ 0xffffffff) >>> 0;
  for (let i = 0; i < u8.length; i++) c = (crcTable[(c ^ u8[i]) & 255] ^ (c >>> 8)) >>> 0;
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * @param {Array<{name:string, data:Uint8Array|ArrayBuffer|Blob}>} files
 * @returns {Promise<Blob>}
 */
export async function makeZip(files) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;

  for (const f of files) {
    const nameB = enc.encode(f.name);
    let data;
    if (f.data instanceof Blob) data = new Uint8Array(await f.data.arrayBuffer());
    else if (f.data instanceof ArrayBuffer) data = new Uint8Array(f.data);
    else data = f.data;
    const crc = crc32(data);

    const lh = new Uint8Array(30 + nameB.length);
    const v = new DataView(lh.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);         // version needed
    v.setUint16(6, 0x0800, true);     // flags: UTF-8 names
    v.setUint16(8, 0, true);          // method: store
    v.setUint16(10, dosTime, true);
    v.setUint16(12, dosDate, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, data.length, true);
    v.setUint32(22, data.length, true);
    v.setUint16(26, nameB.length, true);
    v.setUint16(28, 0, true);
    lh.set(nameB, 30);

    chunks.push(lh, data);

    const ce = new Uint8Array(46 + nameB.length);
    const cv = new DataView(ce.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameB.length, true);
    // extra/comment/disk/internal attrs = 0
    cv.setUint32(38, 0, true);        // external attrs
    cv.setUint32(42, offset, true);
    ce.set(nameB, 46);
    central.push(ce);

    offset += lh.length + data.length;
  }

  let cdSize = 0;
  for (const ce of central) cdSize += ce.length;
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  return new Blob([...chunks, ...central, eocd], { type: "application/zip" });
}
