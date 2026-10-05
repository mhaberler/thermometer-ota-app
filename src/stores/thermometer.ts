import { BleClient } from '@capacitor-community/bluetooth-le'
import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { deviceMode, otaTransport, scanFor, type DeviceMode } from '@/lib/ble'
import { parseBthome } from '@/lib/bthome'
import { downloadGbl } from '@/lib/download'
import { runOta, type OtaPhase } from '@/lib/ota'
import { fetchLatestRelease, type Release } from '@/lib/release'
import { parseTemperature, type Temperature } from '@/lib/temperature'
import { isNewer } from '@/lib/version'
import {
  BTHOME_SVC, DEVICE_INFORMATION_SVC, FIRMWARE_REVISION_CHAR,
  HEALTH_THERMOMETER_SVC, TEMPERATURE_MEASUREMENT_CHAR,
} from '@/lib/uuids'

const SCAN_SECONDS = 10
const REBOOT_SCAN_TIMEOUT_MS = 30000

export interface FoundDevice {
  deviceId: string
  name: string
  rssi: number | null
  mode: DeviceMode
  // Broadcast by the device (BTHome), available without connecting
  temperature?: number
  firmware?: string
}

export const useThermometerStore = defineStore('thermometer', () => {
  const devices = ref<FoundDevice[]>([])
  const scanning = ref(false)
  const busy = ref(false)
  const error = ref('')

  // Selected device: connected application, or a device waiting in Apploader mode.
  const device = ref<FoundDevice | null>(null)
  const temperature = ref<Temperature | null>(null)
  const firmware = ref('')
  const previousFirmware = ref('')

  // Latest published firmware release
  const release = ref<Release | null>(null)
  const releaseNote = ref('')
  // A device in Apploader mode has no firmware; any release is an update.
  const updateAvailable = computed(() =>
    release.value !== null && device.value !== null
    && (device.value.mode === 'apploader' || isNewer(release.value.version, firmware.value)))

  const url = ref('')
  const image = shallowRef<Uint8Array | null>(null)
  const otaPhase = ref<OtaPhase | null>(null)
  const progress = ref(0)

  let initialized = false
  async function init() {
    if (initialized) return
    await BleClient.initialize({ androidNeverForLocation: true })
    initialized = true
  }

  // Run an action with busy flag and error reporting.
  async function guarded(action: () => Promise<void>) {
    busy.value = true
    error.value = ''
    try {
      await action()
    } catch (err: unknown) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      busy.value = false
    }
  }

  // Look up the latest release. Failure is reported but does not affect the connection.
  async function checkRelease() {
    releaseNote.value = ''
    try {
      release.value = await fetchLatestRelease()
      if (!release.value) releaseNote.value = 'No firmware release published.'
    } catch (err: unknown) {
      release.value = null
      releaseNote.value = `Release check failed: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  async function scan() {
    error.value = ''
    try {
      await init()
      devices.value = []
      scanning.value = true
      // Duplicates are wanted: every advertisement carries a new temperature.
      await BleClient.requestLEScan({ allowDuplicates: true }, (result) => {
        const mode = deviceMode(result)
        if (!mode) return
        const serviceData = result.serviceData?.[BTHOME_SVC]
        const found: FoundDevice = {
          deviceId: result.device.deviceId,
          name: result.localName ?? result.device.name ?? '',
          rssi: result.rssi ?? null,
          mode,
          ...(serviceData ? parseBthome(serviceData) : null),
        }
        const index = devices.value.findIndex(d => d.deviceId === found.deviceId)
        if (index < 0) {
          devices.value.push(found)
        } else {
          // The name comes with the scan response, which not every result includes.
          devices.value[index] = { ...found, name: found.name || devices.value[index].name }
        }
      })
      setTimeout(stopScan, SCAN_SECONDS * 1000)
    } catch (err: unknown) {
      scanning.value = false
      error.value = err instanceof Error ? err.message : String(err)
    }
  }

  async function stopScan() {
    if (!scanning.value) return
    scanning.value = false
    await BleClient.stopLEScan().catch(() => {})
  }

  async function connectApp(deviceId: string) {
    await BleClient.connect(deviceId, () => {
      // Disconnects during an update are part of the procedure.
      if (otaPhase.value === null) device.value = null
    })
    const fw = await BleClient.read(deviceId, DEVICE_INFORMATION_SVC, FIRMWARE_REVISION_CHAR)
    firmware.value = new TextDecoder().decode(fw)
    temperature.value = null
    await BleClient.startNotifications(
      deviceId, HEALTH_THERMOMETER_SVC, TEMPERATURE_MEASUREMENT_CHAR,
      (value) => { temperature.value = parseTemperature(value) },
    )
    void checkRelease()
  }

  async function select(found: FoundDevice) {
    await stopScan()
    await guarded(async () => {
      previousFirmware.value = ''
      if (found.mode === 'app') await connectApp(found.deviceId)
      else void checkRelease()
      device.value = found
    })
  }

  async function disconnect() {
    const current = device.value
    device.value = null
    if (current?.mode === 'app') await BleClient.disconnect(current.deviceId).catch(() => {})
  }

  async function download() {
    await guarded(async () => {
      image.value = null
      image.value = await downloadGbl(url.value.trim())
    })
  }

  async function update() {
    const current = device.value
    const gbl = image.value
    if (!current || !gbl) return

    await guarded(async () => {
      progress.value = 0
      otaPhase.value = 'rebooting'
      try {
        const inApploader = current.mode === 'apploader'
        previousFirmware.value = inApploader ? '' : firmware.value
        await runOta(otaTransport, {
          appDeviceId: inApploader ? null : current.deviceId,
          apploaderDeviceId: inApploader ? current.deviceId : undefined,
          image: gbl,
          onPhase: (phase) => { otaPhase.value = phase },
          onProgress: (sent, total) => { progress.value = sent / total },
        })

        // Wait for the new application to come up, then reconnect to it.
        const deviceId = await scanFor(r => deviceMode(r) === 'app', REBOOT_SCAN_TIMEOUT_MS)
        await connectApp(deviceId)
        device.value = { ...current, deviceId, mode: 'app' }
      } catch (err) {
        device.value = null
        throw err
      } finally {
        otaPhase.value = null
      }
    })
  }

  async function updateFromRelease() {
    const latest = release.value
    if (!latest) return
    await guarded(async () => {
      image.value = null
      image.value = await downloadGbl(latest.url)
    })
    if (image.value) await update()
  }

  return {
    devices, scanning, busy, error, device, temperature, firmware, previousFirmware,
    release, releaseNote, updateAvailable, url, image, otaPhase, progress,
    scan, stopScan, select, disconnect, download, update, updateFromRelease,
  }
})
