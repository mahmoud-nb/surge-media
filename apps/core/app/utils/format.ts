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

/** Durée d'une vidéo : « 1:23 », « 1:02:03 » (affichage compact, identique dans toutes les langues). */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = String(total % 60).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`
}

/** Durée en toutes lettres pour les lecteurs d'écran (« 1 minute et 23 secondes », « 1 minute, 23 seconds »). */
export function formatDuration(seconds: number, locale: string): string {
  const total = Math.max(0, Math.round(seconds))
  const parts = ([['hour', Math.floor(total / 3600)], ['minute', Math.floor((total % 3600) / 60)], ['second', total % 60]] as const)
    .filter(([, value], index, all) => value > 0 || (index === all.length - 1 && total === 0))
    .map(([unit, value]) => new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'long' }).format(value))
  return new Intl.ListFormat(locale, { style: 'long', type: 'unit' }).format(parts)
}

/** Débit moyen (« 4,2 Mbit/s », « 850 kbit/s »). */
export function formatBitrate(bitsPerSecond: number, locale: string): string {
  const mega = bitsPerSecond >= 1_000_000
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: mega ? 'megabit-per-second' : 'kilobit-per-second',
    unitDisplay: 'short',
    maximumFractionDigits: mega && bitsPerSecond < 10_000_000 ? 1 : 0,
  }).format(bitsPerSecond / (mega ? 1_000_000 : 1000))
}
