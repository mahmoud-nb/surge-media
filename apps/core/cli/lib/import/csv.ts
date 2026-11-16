/**
 * CSV (RFC 4180) du manifeste et de la table de correspondance de `surge-media import` : séparateur `,`,
 * champs entre guillemets si besoin (`""` pour un guillemet), fins de ligne LF ou CRLF, UTF-8 avec ou
 * sans BOM. Lecture stricte : un guillemet mal fermé est une erreur, jamais une ligne avalée en silence.
 */

export class CsvError extends Error {
  constructor(readonly line: number, readonly reason: 'unterminatedQuote' | 'strayQuote') {
    super(`CSV line ${line}: ${reason}`)
    this.name = 'CsvError'
  }
}

export interface CsvRecord {
  /** Numéro (à partir de 1) de la ligne du fichier où commence l'enregistrement. */
  line: number
  fields: string[]
}

/** Enregistrements d'un texte CSV ; les lignes entièrement vides sont ignorées. */
export function parseCsv(text: string): CsvRecord[] {
  const input = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text
  const records: CsvRecord[] = []
  let fields: string[] = []
  let field = ''
  let quoted = false
  /** Le champ en cours a été ouvert par un guillemet (même vide : `""`). */
  let wasQuoted = false
  let line = 1
  let recordLine = 1

  const endRecord = () => {
    fields.push(field)
    if (fields.length > 1 || fields[0] !== '' || wasQuoted) records.push({ line: recordLine, fields })
    fields = []
    field = ''
    wasQuoted = false
  }

  for (let index = 0; index < input.length; index++) {
    const char = input[index]!
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"'
          index++
        }
        else {
          quoted = false
        }
      }
      else {
        if (char === '\n') line++
        field += char
      }
      continue
    }
    if (char === '"') {
      if (field !== '' || wasQuoted) throw new CsvError(line, 'strayQuote')
      quoted = true
      wasQuoted = true
    }
    else if (char === ',') {
      fields.push(field)
      field = ''
      wasQuoted = false
    }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[index + 1] === '\n') index++
      endRecord()
      line++
      recordLine = line
    }
    else {
      if (wasQuoted) throw new CsvError(line, 'strayQuote')
      field += char
    }
  }
  if (quoted) throw new CsvError(recordLine, 'unterminatedQuote')
  if (field !== '' || fields.length > 0 || wasQuoted) endRecord()
  return records
}

/**
 * Champ prêt à écrire, valeur inchangée : ces fichiers sont relus par l'outil ou chargés dans une base
 * (réécriture des URL du client). Aucune apostrophe n'est donc ajoutée devant `=`, `+`, `-` ou `@` ; qui
 * les ouvre dans un tableur les importe en texte.
 */
export function csvField(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\r\n]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text
}

export function csvLine(values: readonly (string | number | null | undefined)[]): string {
  return `${values.map(value => csvField(value)).join(',')}\n`
}
