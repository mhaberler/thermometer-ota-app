import { BleClient, ConnectionPriority, type ScanResult } from '@capacitor-community/bluetooth-le'
import type { OtaTransport } from './ota'
import { APPLOADER_NAME, HEALTH_THERMOMETER_SVC, OTA_SVC } from './uuids'

export type DeviceMode = 'app' | 'apploader'

// Classify an advertisement: running thermometer application, Apploader, or unrelated.
export function deviceMode(result: ScanResult): DeviceMode | null {
  const uuids = (result.uuids ?? []).map(u => u.toLowerCase())
  if (uuids.includes(HEALTH_THERMOMETER_SVC)) return 'app'
  if (uuids.includes(OTA_SVC) || result.localName === APPLOADER_NAME) return 'apploader'
  return null
}

// Scan until an advertisement matches; resolves with its device id.
export async function scanFor(match: (result: ScanResult) => boolean, timeoutMs: number): Promise<string> {
  await BleClient.stopLEScan().catch(() => {})
  try {
    return await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('device not found')), timeoutMs)
      BleClient.requestLEScan({ allowDuplicates: true }, (result) => {
        if (match(result)) {
          clearTimeout(timer)
          resolve(result.device.deviceId)
        }
      }).catch((err) => { clearTimeout(timer); reject(err) })
    })
  } finally {
    await BleClient.stopLEScan().catch(() => {})
  }
}

export function toDataView(data: Uint8Array): DataView {
  return new DataView(data.buffer, data.byteOffset, data.byteLength)
}

export const otaTransport: OtaTransport = {
  async connect(deviceId) {
    await BleClient.connect(deviceId)
    // Android only: shorter connection interval speeds up the upload.
    await BleClient.requestConnectionPriority(deviceId, ConnectionPriority.CONNECTION_PRIORITY_HIGH)
      .catch(() => {})
  },
  disconnect: deviceId => BleClient.disconnect(deviceId),
  mtu: deviceId => BleClient.getMtu(deviceId),
  write: (deviceId, service, characteristic, data) =>
    BleClient.write(deviceId, service, characteristic, toDataView(data)),
  // The Apploader keeps the address of the application; where the platform hides the
  // address, any Apploader in range is taken.
  findApploader: (_appDeviceId, timeoutMs) =>
    scanFor(result => deviceMode(result) === 'apploader', timeoutMs),
}
