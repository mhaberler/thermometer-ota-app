<script setup lang="ts">
import { computed } from 'vue'
import { useThermometerStore } from '@/stores/thermometer'

const store = useThermometerStore()

const phaseText: Record<string, string> = {
  rebooting: 'Rebooting device into update mode…',
  connecting: 'Connecting to update mode…',
  uploading: 'Uploading firmware…',
  finishing: 'Finishing…',
  done: 'Waiting for device to restart…',
}

const percent = computed(() => Math.round(store.progress * 100))
const temperatureText = computed(() => {
  const t = store.temperature
  return t ? `${t.value.toFixed(1)} °${t.unit}` : '–'
})
</script>

<template>
  <div class="screen">
    <header><h1>Thermometer OTA</h1></header>

    <div class="scroll-body">
      <p v-if="store.error" class="error">{{ store.error }}</p>

      <!-- Scan -->
      <section v-if="!store.device">
        <button :disabled="store.scanning || store.busy" @click="store.scan()">
          {{ store.scanning ? 'Scanning…' : 'Scan' }}
        </button>
        <ul class="devices">
          <li v-for="d in store.devices" :key="d.deviceId" @click="store.select(d)">
            <span>
              <strong>{{ d.name || 'unnamed' }}</strong>
              <small>{{ d.deviceId }}</small>
            </span>
            <span class="meta">
              <em v-if="d.mode === 'apploader'">update mode</em>
              <small v-if="d.rssi !== null">{{ d.rssi }} dBm</small>
            </span>
          </li>
        </ul>
        <p v-if="!store.scanning && !store.devices.length" class="hint">No devices found yet.</p>
      </section>

      <!-- Selected device -->
      <template v-else>
        <section>
          <h2>{{ store.device.name || 'Device' }}</h2>
          <template v-if="store.device.mode === 'app'">
            <p class="temperature">{{ temperatureText }}</p>
            <p>
              Firmware: <strong>{{ store.firmware || '–' }}</strong>
              <span v-if="store.previousFirmware"> (was {{ store.previousFirmware }})</span>
            </p>
          </template>
          <p v-else class="hint">Device is in update mode and has no running application.</p>
          <button class="secondary" :disabled="store.busy" @click="store.disconnect()">Disconnect</button>
        </section>

        <section>
          <h2>Firmware update</h2>
          <template v-if="store.updateAvailable">
            <p>Update to <strong>{{ store.release?.version }}</strong> available.</p>
            <button :disabled="store.busy" @click="store.updateFromRelease()">
              Update to {{ store.release?.version }}
            </button>
          </template>
          <p v-else-if="store.release" class="hint">Firmware is up to date.</p>
          <p v-if="store.releaseNote" class="hint">{{ store.releaseNote }}</p>

          <h3>From URL</h3>
          <input
            v-model="store.url" type="url" inputmode="url" autocapitalize="off" autocorrect="off"
            placeholder="http://host:8000/firmware.gbl" :disabled="store.busy"
          >
          <button :disabled="store.busy || !store.url.trim()" @click="store.download()">Download</button>
          <p v-if="store.image" class="hint">GBL loaded, {{ store.image.length }} bytes.</p>

          <button :disabled="store.busy || !store.image" @click="store.update()">Update device</button>

          <template v-if="store.otaPhase">
            <p>{{ phaseText[store.otaPhase] }}</p>
            <progress :value="percent" max="100" />
            <p class="hint">{{ percent }} %</p>
          </template>
        </section>
      </template>
    </div>
  </div>
</template>
