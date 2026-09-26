import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Compose des classes Tailwind : conditions (clsx) puis résolution des conflits
 * (tailwind-merge), pour que la prop `class` d'un composant surcharge ses défauts.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
