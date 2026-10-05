import { describe, expect, it } from 'vitest'
import { parseBthome } from './bthome'
import { isGbl } from './gbl'
import { runOta, type OtaPhase, type OtaTransport } from './ota'
import { pickRelease } from './release'
import { parseTemperature } from './temperature'
import { OTA_CONTROL_CHAR, OTA_DATA_CHAR } from './uuids'
import { isNewer, parseVersion } from './version'

function measurement(...bytes: number[]) {
  return new DataView(Uint8Array.from(bytes).buffer)
}

describe('parseTemperature', () => {
  it('decodes Celsius', () => {
    // mantissa 2534, exponent -2 -> 25.34
    const t = parseTemperature(measurement(0x00, 0xe6, 0x09, 0x00, 0xfe))
    expect(t?.unit).toBe('C')
    expect(t?.value).toBeCloseTo(25.34)
  })

  it('decodes negative values and Fahrenheit flag', () => {
    // mantissa -105, exponent -1 -> -10.5
    const t = parseTemperature(measurement(0x01, 0x97, 0xff, 0xff, 0xff))
    expect(t?.unit).toBe('F')
    expect(t?.value).toBeCloseTo(-10.5)
  })

  it('rejects NaN and short values', () => {
    expect(parseTemperature(measurement(0x00, 0xff, 0xff, 0x7f, 0x00))).toBeNull()
    expect(parseTemperature(measurement(0x00, 0x01))).toBeNull()
  })
})

describe('isGbl', () => {
  it('accepts the GBL header tag', () => {
    expect(isGbl(Uint8Array.of(0xeb, 0x17, 0xa6, 0x03, 0x08, 0x00, 0x00, 0x00))).toBe(true)
  })

  it('rejects other content', () => {
    expect(isGbl(new TextEncoder().encode('<html>404</html>'))).toBe(false)
    expect(isGbl(new Uint8Array(0))).toBe(false)
  })
})

describe('runOta', () => {
  // Records every transport call as a readable line.
  function mockTransport(mtu: number, failOnDataWrite = -1) {
    const log: string[] = []
    let dataWrites = 0
    const t: OtaTransport = {
      connect: async (id) => { log.push(`connect ${id}`) },
      disconnect: async (id) => { log.push(`disconnect ${id}`) },
      mtu: async () => mtu,
      write: async (id, _service, characteristic, data) => {
        if (characteristic === OTA_CONTROL_CHAR) {
          log.push(`control ${id} ${data[0]}`)
        } else if (characteristic === OTA_DATA_CHAR) {
          if (dataWrites++ === failOnDataWrite) throw new Error('write failed')
          log.push(`data ${id} ${Array.from(data).join(',')}`)
        }
      },
      findApploader: async (id) => { log.push(`find ${id}`); return 'btl' },
    }
    return { t, log }
  }

  const image = Uint8Array.from({ length: 10 }, (_, i) => i)

  it('reboots the application, uploads in 4-byte aligned chunks and finishes', async () => {
    const { t, log } = mockTransport(9) // 9 - 3 = 6 -> chunks of 4
    const phases: OtaPhase[] = []
    const progress: number[] = []

    await runOta(t, {
      appDeviceId: 'app',
      image,
      onPhase: p => phases.push(p),
      onProgress: sent => progress.push(sent),
    })

    expect(log).toEqual([
      'control app 0',
      'disconnect app',
      'find app',
      'connect btl',
      'control btl 0',
      'data btl 0,1,2,3',
      'data btl 4,5,6,7',
      'data btl 8,9',
      'control btl 3',
      'disconnect btl',
    ])
    expect(phases).toEqual(['rebooting', 'connecting', 'uploading', 'finishing', 'done'])
    expect(progress).toEqual([0, 4, 8, 10])
  })

  it('uploads directly to a device already in Apploader mode', async () => {
    const { t, log } = mockTransport(247)

    await runOta(t, { appDeviceId: null, apploaderDeviceId: 'stuck', image })

    expect(log).toEqual([
      'connect stuck',
      'control stuck 0',
      'data stuck 0,1,2,3,4,5,6,7,8,9',
      'control stuck 3',
      'disconnect stuck',
    ])
  })

  it('disconnects and reports the error when a write fails', async () => {
    const { t, log } = mockTransport(9, 1)

    await expect(runOta(t, { appDeviceId: 'app', image })).rejects.toThrow('write failed')

    expect(log.at(-1)).toBe('disconnect btl')
    expect(log).not.toContain('control btl 3')
  })
})

describe('version', () => {
  it('parses MAJOR.MINOR.PATCH with optional v', () => {
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3])
    expect(parseVersion('v10.0.7')).toEqual([10, 0, 7])
    expect(parseVersion('v4')).toBeNull()
    expect(parseVersion('1.2')).toBeNull()
    expect(parseVersion('')).toBeNull()
  })

  it('compares numerically, not as text', () => {
    expect(isNewer('1.0.10', '1.0.9')).toBe(true)
    expect(isNewer('2.0.0', '1.9.9')).toBe(true)
    expect(isNewer('1.0.1', '1.0.1')).toBe(false)
    expect(isNewer('1.0.0', '1.0.1')).toBe(false)
  })

  it('treats an unparseable device version as older', () => {
    expect(isNewer('1.0.0', 'v4')).toBe(true)
    expect(isNewer('1.0.0', '')).toBe(true)
  })

  it('never offers an unparseable release', () => {
    expect(isNewer('nightly', '1.0.0')).toBe(false)
  })
})

describe('pickRelease', () => {
  const asset = (name: string) => ({ name, browser_download_url: `https://example.com/${name}` })

  it('takes the tag and the GBL asset', () => {
    const json = { tag_name: 'v1.0.1', assets: [asset('fw.s37'), asset('fw.gbl')] }
    expect(pickRelease(json)).toEqual({ version: '1.0.1', url: 'https://example.com/fw.gbl' })
  })

  it('returns null without a GBL asset or for unexpected data', () => {
    expect(pickRelease({ tag_name: 'v1.0.1', assets: [asset('fw.s37')] })).toBeNull()
    expect(pickRelease({ message: 'Not Found' })).toBeNull()
    expect(pickRelease(null)).toBeNull()
  })
})

describe('parseBthome', () => {
  const bytes = (hex: string) =>
    new DataView(Uint8Array.from(hex.match(/../g) ?? [], b => parseInt(b, 16)).buffer)

  // Service data as produced by the firmware (bthome.h)
  it('decodes temperature and firmware version', () => {
    expect(parseBthome(bytes('4002c409f2000101'))).toEqual({ temperature: 25, firmware: '1.1.0' })
    expect(parseBthome(bytes('400230f8f20a0001'))).toEqual({ temperature: -20, firmware: '1.0.10' })
  })

  it('decodes what is there', () => {
    expect(parseBthome(bytes('4002c409'))).toEqual({ temperature: 25 })
    expect(parseBthome(bytes('40f2000106'))).toEqual({ firmware: '6.1.0' })
    expect(parseBthome(bytes('40'))).toEqual({})
  })

  it('stops at objects it does not know and at truncated data', () => {
    // 0x03 humidity follows the temperature
    expect(parseBthome(bytes('4002c40903bf13f2000101'))).toEqual({ temperature: 25 })
    expect(parseBthome(bytes('4002c409f20001'))).toEqual({ temperature: 25 })
  })

  it('rejects encrypted data, other versions and empty data', () => {
    expect(parseBthome(bytes('4102c409'))).toBeNull()
    expect(parseBthome(bytes('2002c409'))).toBeNull()
    expect(parseBthome(bytes(''))).toBeNull()
  })
})
