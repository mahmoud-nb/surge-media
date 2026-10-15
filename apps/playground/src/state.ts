import { ref, watchEffect } from 'vue'

/** Langue et thème du bac à sable, gardés dans le navigateur. */
function stored(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback
  }
  catch {
    return fallback
  }
}

export const config = __PLAYGROUND__
export const configured = Boolean(config.baseUrl && config.projectId)
export const locale = ref(stored('playground-locale', 'fr'))
export const theme = ref(stored('playground-theme', 'system'))

watchEffect(() => {
  document.documentElement.lang = locale.value
  document.documentElement.classList.toggle('dark', theme.value === 'dark')
  document.documentElement.classList.toggle('light', theme.value === 'light')
  try {
    localStorage.setItem('playground-locale', locale.value)
    localStorage.setItem('playground-theme', theme.value)
  }
  catch {}
})
