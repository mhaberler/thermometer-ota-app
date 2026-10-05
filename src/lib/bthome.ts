export interface BthomeData {
  // Degrees Celsius
  temperature?: number
  firmware?: string
}

const DEVICE_INFO_ENCRYPTED = 0x01
const BTHOME_VERSION_2 = 2

const OBJECT_TEMPERATURE = 0x02
const OBJECT_FIRMWARE_VERSION = 0xf2

// Decode BTHome v2 service data (UUID 0xFCD2), as far as this app uses it:
// temperature and firmware version. Decoding stops at any other object, because
// its length is not known here.
export function parseBthome(dv: DataView): BthomeData | null {
  if (dv.byteLength < 1) return null
  const info = dv.getUint8(0)
  if (info >> 5 !== BTHOME_VERSION_2 || info & DEVICE_INFO_ENCRYPTED) return null

  const data: BthomeData = {}
  let i = 1
  while (i < dv.byteLength) {
    const id = dv.getUint8(i)
    if (id === OBJECT_TEMPERATURE && i + 3 <= dv.byteLength) {
      data.temperature = dv.getInt16(i + 1, true) / 100
      i += 3
    } else if (id === OBJECT_FIRMWARE_VERSION && i + 4 <= dv.byteLength) {
      // patch, minor, major
      data.firmware = `${dv.getUint8(i + 3)}.${dv.getUint8(i + 2)}.${dv.getUint8(i + 1)}`
      i += 4
    } else {
      break
    }
  }
  return data
}
