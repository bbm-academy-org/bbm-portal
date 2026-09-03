// Any setup scripts you might need go here

// Load .env files
import 'dotenv/config'

// jsdom ships no `matchMedia`, and any component that asks the OS for a colour
// preference — sonner's `Toaster`, the kit's `use-mobile` — throws on mount
// without it (#434). The stub answers «no preference», so a suite that asserts
// on a theme is asserting on what the APP decided, never on an ambient default.
if (typeof window !== 'undefined') {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}
