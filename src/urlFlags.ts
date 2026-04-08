export const OFFICIAL_SITE_URL = 'https://mosaic.games/'
export const MOBILE_BREAKPOINT_PX = 979

export function isKobalabResearchModeEnabled(search: string): boolean {
  return new URLSearchParams(search).get('kobalab') === '1'
}

export function isDevCpuModeEnabled(search: string): boolean {
  const params = new URLSearchParams(search)
  return params.get('dev') === '1' || params.get('former') === '1'
}

export function isFormerCpuModeEnabled(search: string): boolean {
  return isDevCpuModeEnabled(search)
}
