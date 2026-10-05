export type Version = [number, number, number]

// Parse MAJOR.MINOR.PATCH, with optional leading "v".
export function parseVersion(s: string): Version | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(s.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

// Is the released version newer than what the device runs?
// A device version that cannot be parsed counts as older.
export function isNewer(release: string, device: string): boolean {
  const r = parseVersion(release)
  if (!r) return false
  const d = parseVersion(device)
  if (!d) return true
  for (let i = 0; i < 3; i++) {
    if (r[i] !== d[i]) return r[i] > d[i]
  }
  return false
}
