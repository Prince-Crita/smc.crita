/**
 * Read-only inspection of the first bytes of an uploaded visit photo.
 *
 *   sniffImageType - what the file REALLY is, from its signature bytes, so a
 *                    file that is merely labelled "image/jpeg" (a renamed PDF,
 *                    a script) is never accepted as a photo.
 *   readJpegGps    - the EXIF GPS latitude/longitude of a JPEG, when the file
 *                    actually carries them. Returns null otherwise.
 *
 * Nothing here modifies the image or invents data: if the GPS tags are absent,
 * incomplete or out of range, the answer is null, never a guess. (Many geotag
 * camera apps print the location onto the picture rather than into EXIF, and
 * phones often strip EXIF location when a photo is shared - null is normal.)
 *
 * Dependency-free on purpose: only the handful of EXIF fields needed for GPS
 * are read, with bounds checks on every offset, so a malformed file can only
 * ever produce "no GPS", never an exception.
 */

export type SniffedImageType = "image/jpeg" | "image/png" | "image/webp";

export interface GpsPoint {
  latitude: number;
  longitude: number;
}

const ascii = (b: Uint8Array, start: number, length: number): string =>
  start + length <= b.length ? String.fromCharCode(...b.subarray(start, start + length)) : "";

/** The image type indicated by the file's signature bytes, or null. */
export function sniffImageType(b: Uint8Array): SniffedImageType | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) return "image/png";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "image/webp";
  return null;
}

/** EXIF GPS coordinates of a JPEG (from its first bytes), or null. */
export function readJpegGps(b: Uint8Array): GpsPoint | null {
  try {
    return findExifGps(b);
  } catch {
    return null;
  }
}

function findExifGps(b: Uint8Array): GpsPoint | null {
  if (sniffImageType(b) !== "image/jpeg") return null;
  let p = 2;
  while (p + 4 <= b.length) {
    if (b[p] !== 0xff) return null;
    const marker = b[p + 1];
    if (marker === 0xff) { p += 1; continue; }                 // fill byte
    if (marker === 0xd9 || marker === 0xda) return null;        // end of image / start of scan
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { p += 2; continue; } // no length
    const length = (b[p + 2] << 8) | b[p + 3];
    if (length < 2) return null;
    const start = p + 4;
    const end = p + 2 + length;
    if (marker === 0xe1 && end <= b.length && ascii(b, start, 6) === "Exif\0\0") {
      return readTiffGps(b.subarray(start + 6, end));
    }
    p = end;
  }
  return null;
}

const TAG_GPS_IFD = 0x8825;
const TAG_LAT_REF = 0x0001;
const TAG_LAT = 0x0002;
const TAG_LNG_REF = 0x0003;
const TAG_LNG = 0x0004;
const TYPE_ASCII = 2;
const TYPE_LONG = 4;
const TYPE_RATIONAL = 5;
const TYPE_SRATIONAL = 10;

interface IfdEntry { type: number; count: number; at: number }

function readTiffGps(t: Uint8Array): GpsPoint | null {
  if (t.length < 8) return null;
  const order = ascii(t, 0, 2);
  const le = order === "II" ? true : order === "MM" ? false : null;
  if (le === null) return null;
  const view = new DataView(t.buffer, t.byteOffset, t.byteLength);
  const u16 = (o: number) => view.getUint16(o, le);
  const u32 = (o: number) => view.getUint32(o, le);
  const i32 = (o: number) => view.getInt32(o, le);
  if (u16(2) !== 42) return null;

  const readIfd = (offset: number): Map<number, IfdEntry> | null => {
    if (offset < 8 || offset + 2 > t.length) return null;
    const count = u16(offset);
    if (count > 512 || offset + 2 + count * 12 > t.length) return null;
    const entries = new Map<number, IfdEntry>();
    for (let i = 0; i < count; i++) {
      const e = offset + 2 + i * 12;
      entries.set(u16(e), { type: u16(e + 2), count: u32(e + 4), at: e + 8 });
    }
    return entries;
  };

  const ifd0 = readIfd(u32(4));
  const gpsPointer = ifd0?.get(TAG_GPS_IFD);
  if (!gpsPointer || gpsPointer.type !== TYPE_LONG) return null;
  const gps = readIfd(u32(gpsPointer.at));
  if (!gps) return null;

  const ref = (tag: number): string | null => {
    const e = gps.get(tag);
    if (!e || e.type !== TYPE_ASCII || e.count < 1 || e.count > 4) return null;
    return String.fromCharCode(t[e.at]).toUpperCase();
  };

  const degrees = (tag: number): number | null => {
    const e = gps.get(tag);
    if (!e || (e.type !== TYPE_RATIONAL && e.type !== TYPE_SRATIONAL) || e.count !== 3) return null;
    const base = u32(e.at);
    if (base + 24 > t.length) return null;
    const part = (i: number) => {
      const num = e.type === TYPE_SRATIONAL ? i32(base + i * 8) : u32(base + i * 8);
      const den = e.type === TYPE_SRATIONAL ? i32(base + i * 8 + 4) : u32(base + i * 8 + 4);
      return den === 0 ? NaN : num / den;
    };
    const value = part(0) + part(1) / 60 + part(2) / 3600;
    return Number.isFinite(value) ? value : null;
  };

  const latRef = ref(TAG_LAT_REF);
  const lngRef = ref(TAG_LNG_REF);
  const lat = degrees(TAG_LAT);
  const lng = degrees(TAG_LNG);
  if (lat === null || lng === null || (latRef !== "N" && latRef !== "S") || (lngRef !== "E" && lngRef !== "W")) {
    return null;
  }

  const latitude = Math.round((latRef === "S" ? -lat : lat) * 1e6) / 1e6;
  const longitude = Math.round((lngRef === "W" ? -lng : lng) * 1e6) / 1e6;
  // Out-of-range values are corrupt; 0,0 is what devices write when they had
  // no satellite fix. Neither is a real location, so neither is reported.
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  if (latitude === 0 && longitude === 0) return null;
  return { latitude, longitude };
}
