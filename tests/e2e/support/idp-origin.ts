const PRODUCTION_IDP_ORIGIN = 'https://id.bbm.academy'
const HOST_WITH_OPTIONAL_PORT = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{1,5})?$/

export function isAllowedE2EIdpOrigin(currentUrl: string, configuredHost?: string): boolean {
  let url: URL
  try {
    url = new URL(currentUrl)
  } catch {
    return false
  }

  if (url.origin === PRODUCTION_IDP_ORIGIN) return true
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false

  const explicitHost = configuredHost?.trim().toLowerCase()
  if (!explicitHost || !HOST_WITH_OPTIONAL_PORT.test(explicitHost)) return false
  return url.host.toLowerCase() === explicitHost
}
