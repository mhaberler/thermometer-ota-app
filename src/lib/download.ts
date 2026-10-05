import { CapacitorHttp } from '@capacitor/core'
import { isGbl } from './gbl'

// Fetch a GBL file with native HTTP (no CORS limits).
export async function downloadGbl(url: string): Promise<Uint8Array> {
  const res = await CapacitorHttp.get({ url, responseType: 'arraybuffer' })
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`)
  // Binary responses arrive base64 encoded.
  if (typeof res.data !== 'string') throw new Error('unexpected response type')
  const image = Uint8Array.from(atob(res.data), c => c.charCodeAt(0))
  if (!isGbl(image)) throw new Error('not a GBL file')
  return image
}
