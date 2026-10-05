import { CapacitorHttp } from '@capacitor/core'

// GitHub repository publishing the firmware releases
export const FIRMWARE_REPO = 'mhaberler/bt_soc_thermometer_mock'

export interface Release {
  version: string
  url: string
}

// Extract version and GBL download URL from a GitHub release object.
export function pickRelease(json: unknown): Release | null {
  const release = json as { tag_name?: unknown, assets?: unknown } | null
  if (typeof release?.tag_name !== 'string' || !Array.isArray(release.assets)) return null
  const gbl = release.assets.find(a => typeof a?.name === 'string' && a.name.endsWith('.gbl'))
  if (typeof gbl?.browser_download_url !== 'string') return null
  return { version: release.tag_name.replace(/^v/, ''), url: gbl.browser_download_url }
}

// Latest published release (drafts and prereleases excluded), or null if there is none.
export async function fetchLatestRelease(): Promise<Release | null> {
  const res = await CapacitorHttp.get({
    url: `https://api.github.com/repos/${FIRMWARE_REPO}/releases/latest`,
    headers: { Accept: 'application/vnd.github+json' },
  })
  if (res.status === 404) return null
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`)
  return pickRelease(typeof res.data === 'string' ? JSON.parse(res.data) : res.data)
}
