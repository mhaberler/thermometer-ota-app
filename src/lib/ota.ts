import { OTA_CONTROL_CHAR, OTA_DATA_CHAR, OTA_SVC } from './uuids'

// OTA control characteristic commands
const OTA_START = 0x00
const OTA_END = 0x03

const ATT_WRITE_OVERHEAD = 3
const APPLOADER_SCAN_TIMEOUT_MS = 20000

// BLE operations the OTA procedure needs. Kept abstract so the procedure
// can be tested without a phone.
export interface OtaTransport {
  connect(deviceId: string): Promise<void>
  disconnect(deviceId: string): Promise<void>
  mtu(deviceId: string): Promise<number>
  // Write with response
  write(deviceId: string, service: string, characteristic: string, data: Uint8Array): Promise<void>
  // Scan until the device shows up in Apploader mode; resolves with its device id.
  findApploader(appDeviceId: string | null, timeoutMs: number): Promise<string>
}

export type OtaPhase = 'rebooting' | 'connecting' | 'uploading' | 'finishing' | 'done'

export interface OtaOptions {
  // Device id of the connected application, or null if the device is already in Apploader mode.
  appDeviceId: string | null
  // Device id in Apploader mode, if already known (recovery of a stuck device).
  apploaderDeviceId?: string
  image: Uint8Array
  onPhase?: (phase: OtaPhase) => void
  onProgress?: (sent: number, total: number) => void
}

// Run a Silicon Labs in-place OTA update. Leaves the device disconnected and rebooting
// into the new application.
export async function runOta(t: OtaTransport, opts: OtaOptions): Promise<void> {
  const { image, onPhase, onProgress } = opts
  let apploaderId = opts.apploaderDeviceId

  if (!apploaderId) {
    if (!opts.appDeviceId) throw new Error('no device to update')
    onPhase?.('rebooting')
    // Ask the application to reboot into the Apploader.
    await t.write(opts.appDeviceId, OTA_SVC, OTA_CONTROL_CHAR, Uint8Array.of(OTA_START))
    await t.disconnect(opts.appDeviceId).catch(() => {})
    apploaderId = await t.findApploader(opts.appDeviceId, APPLOADER_SCAN_TIMEOUT_MS)
  }

  onPhase?.('connecting')
  await t.connect(apploaderId)
  try {
    // Chunks are kept a multiple of 4 bytes.
    const chunk = Math.floor((await t.mtu(apploaderId) - ATT_WRITE_OVERHEAD) / 4) * 4
    if (chunk <= 0) throw new Error('MTU too small')

    await t.write(apploaderId, OTA_SVC, OTA_CONTROL_CHAR, Uint8Array.of(OTA_START))

    onPhase?.('uploading')
    onProgress?.(0, image.length)
    for (let offset = 0; offset < image.length; offset += chunk) {
      const end = Math.min(offset + chunk, image.length)
      await t.write(apploaderId, OTA_SVC, OTA_DATA_CHAR, image.subarray(offset, end))
      onProgress?.(end, image.length)
    }

    onPhase?.('finishing')
    await t.write(apploaderId, OTA_SVC, OTA_CONTROL_CHAR, Uint8Array.of(OTA_END))
  } finally {
    // Closing the connection makes the Apploader reboot.
    await t.disconnect(apploaderId).catch(() => {})
  }
  onPhase?.('done')
}
