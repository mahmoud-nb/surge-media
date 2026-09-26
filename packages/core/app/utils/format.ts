const BYTE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const

/** Taille lisible dans la langue active (« 31 ko », « 2,4 Mo », « 31 kB »…), en base 1024. */
export function formatBytes(bytes: number, locale: string): string {
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024
    unit++
  }
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: BYTE_UNITS[unit],
    unitDisplay: 'short',
    maximumFractionDigits: unit > 0 && value < 10 ? 1 : 0,
  }).format(value)
}

/** Pourcentage (0 à 100) dans la langue active (« 45 % », « 45% »). */
export function formatPercent(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(value / 100)
}
