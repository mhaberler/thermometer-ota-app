export interface Temperature {
  value: number
  unit: 'C' | 'F'
}

// Decode a Health Thermometer Temperature Measurement (0x2A1C) value:
// flags (1 byte), then IEEE-11073 32-bit FLOAT (24-bit mantissa, 8-bit exponent).
export function parseTemperature(dv: DataView): Temperature | null {
  if (dv.byteLength < 5) return null

  const flags = dv.getUint8(0)
  const raw = dv.getUint32(1, true)
  const exponent = dv.getInt8(4)
  let mantissa = raw & 0x00ffffff
  if (mantissa & 0x800000) mantissa -= 0x1000000

  // Reserved mantissa values: NaN, NRes, +/-INFINITY, reserved
  if (mantissa >= 0x7ffffe || mantissa <= -0x7ffffe) return null

  return {
    value: mantissa * Math.pow(10, exponent),
    unit: flags & 0x01 ? 'F' : 'C',
  }
}
