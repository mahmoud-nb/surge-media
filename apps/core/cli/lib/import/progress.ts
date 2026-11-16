/**
 * Ligne de progression de `import run` dans un terminal : une seule ligne, réécrite sur place.
 *
 * Pas le `spinner` de @clack/prompts : il passe l'entrée du terminal en mode brut, où Ctrl+C n'est plus un
 * signal mais une touche, qu'il traite en terminant le processus avec le code 0. L'arrêt propre de l'import
 * (envois en cours terminés, table de correspondance écrite, code 2) n'avait alors jamais lieu (essai de
 * charge I-4). Ici l'entrée n'est pas touchée : Ctrl+C reste un SIGINT.
 */

export interface ProgressOutput {
  write: (text: string) => unknown
  /** Largeur du terminal ; la ligne est coupée pour ne jamais passer à la suivante. */
  columns?: number
}

export interface ProgressLine {
  start: (text: string) => void
  message: (text: string) => void
  /** Écrit autre chose (avertissement, question) sans casser la ligne : effacée, puis redessinée. */
  interrupt: (write: () => void) => void
  /** Dernier état, laissé à l'écran ; la ligne n'est plus réécrite ensuite. */
  stop: (text: string) => void
}

export const PROGRESS_FRAMES = ['◒', '◐', '◓', '◑'] as const
const CLEAR_LINE = '\r\x1B[2K'
const DEFAULT_COLUMNS = 80

/** Texte coupé à la largeur donnée (en caractères), avec des points de suspension. */
export function fitLine(text: string, columns: number): string {
  const characters = [...text.replace(/\s*[\r\n]+\s*/g, ' ')]
  return characters.length <= columns ? characters.join('') : `${characters.slice(0, Math.max(0, columns - 1)).join('')}…`
}

export function createProgressLine(output: ProgressOutput, options: { intervalMs?: number } = {}): ProgressLine {
  let text = ''
  let frame = 0
  let timer: ReturnType<typeof setInterval> | null = null

  const draw = () => {
    // Une colonne de moins que le terminal : certains passent à la ligne en écrivant dans la dernière.
    const width = Math.max(10, (output.columns ?? DEFAULT_COLUMNS) - 1)
    output.write(`${CLEAR_LINE}${fitLine(`${PROGRESS_FRAMES[frame % PROGRESS_FRAMES.length]}  ${text}`, width)}`)
  }

  return {
    start(initial) {
      text = initial
      draw()
      timer ??= setInterval(() => {
        frame++
        draw()
      }, options.intervalMs ?? 120)
      // La ligne ne retient jamais le processus : il se termine quand l'import est fini.
      timer.unref?.()
    },
    message(next) {
      text = next
      if (timer) draw()
    },
    interrupt(write) {
      if (!timer) return write()
      output.write(CLEAR_LINE)
      write()
      draw()
    },
    stop(last) {
      if (timer) clearInterval(timer)
      timer = null
      output.write(`${CLEAR_LINE}${fitLine(`◇  ${last}`, Math.max(10, (output.columns ?? DEFAULT_COLUMNS) - 1))}\n`)
    },
  }
}
