import { shallowRef, type ShallowRef } from 'vue'
import { parseRoute, type Route } from './route'

const current = shallowRef<Route>(parseRoute(location.hash))

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    current.value = parseRoute(location.hash)
  })
}

export const route: ShallowRef<Route> = current

export function navigate(hash: string): void {
  if (location.hash === hash) return
  location.hash = hash
}
