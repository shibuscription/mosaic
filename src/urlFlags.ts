export const OFFICIAL_SITE_URL = 'https://mosaic.games/'
export const MOBILE_BREAKPOINT_PX = 979

export function isKobalabResearchModeEnabled(search: string): boolean {
  return new URLSearchParams(search).get('kobalab') === '1'
}
