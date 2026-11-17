import type { GetObjectCommandOutput, ListObjectsV2CommandOutput, S3Client } from '@aws-sdk/client-s3'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { SourceError } from './sources'

/**
 * Source `s3://compartiment/clé` d'un import (.claude/architecture-import.md, IM3) : le compartiment où le
 * client garde ses fichiers aujourd'hui, sur AWS S3 ou un service compatible (R2, MinIO, Scaleway, OVHcloud…).
 * Lecture seule : lister un préfixe, lire le début d'un objet (reconnaître son type), le télécharger.
 *
 * Ce compartiment n'est pas le stockage de SurgeMedia : ses identifiants sont à part
 * (`SURGE_MEDIA_IMPORT_S3_ACCESS_KEY_ID`, `SURGE_MEDIA_IMPORT_S3_SECRET_ACCESS_KEY`), lus dans l'environnement
 * seulement, et il leur suffit de pouvoir lister et lire. Le SDK est celui du serveur construit, chargé à la
 * demande (cli/lib/sql-client.ts, `loadServerModule`) : la CLI n'en dépend pas autrement.
 */

export const S3_ACCESS_KEY_VARIABLE = 'SURGE_MEDIA_IMPORT_S3_ACCESS_KEY_ID'
export const S3_SECRET_KEY_VARIABLE = 'SURGE_MEDIA_IMPORT_S3_SECRET_ACCESS_KEY'
export const S3_SESSION_TOKEN_VARIABLE = 'SURGE_MEDIA_IMPORT_S3_SESSION_TOKEN'
/** Région par défaut : celle qu'attendent AWS (compartiments historiques) et la plupart des services compatibles. */
export const S3_DEFAULT_REGION = 'us-east-1'

export interface S3Location {
  bucket: string
  /** Clé de l'objet, ou préfixe à lister ; sans `/` initial. */
  key: string
}

/** `s3://compartiment/chemin/objet.jpg` → compartiment et clé ; null si ce n'est pas une adresse S3 valable. */
export function parseS3Url(url: string): S3Location | null {
  const match = /^s3:\/\/([a-z0-9][a-z0-9.-]{1,61}[a-z0-9])(?:\/(.*))?$/i.exec(url)
  if (!match) return null
  return { bucket: match[1]!, key: match[2] ?? '' }
}

export function s3Url(bucket: string, key: string): string {
  return `s3://${bucket}/${key}`
}

export interface S3Settings {
  /** Point d'accès d'un service compatible ; absent = AWS. */
  endpoint?: string
  region: string
  /** Adresses `https://hôte/compartiment/clé` (MinIO, certains services) plutôt que `https://compartiment.hôte/clé`. */
  forcePathStyle: boolean
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
}

/** Réglages lus dans l'environnement et les options ; null si les identifiants manquent. */
export function s3SettingsFrom(env: Record<string, string | undefined>, options: { endpoint?: string, region?: string, pathStyle?: boolean }): S3Settings | null {
  const accessKeyId = env[S3_ACCESS_KEY_VARIABLE]?.trim()
  const secretAccessKey = env[S3_SECRET_KEY_VARIABLE]?.trim()
  if (!accessKeyId || !secretAccessKey) return null
  const sessionToken = env[S3_SESSION_TOKEN_VARIABLE]?.trim()
  return {
    ...(options.endpoint ? { endpoint: options.endpoint } : {}),
    region: options.region || S3_DEFAULT_REGION,
    forcePathStyle: Boolean(options.pathStyle),
    accessKeyId,
    secretAccessKey,
    ...(sessionToken ? { sessionToken } : {}),
  }
}

export interface S3Object {
  key: string
  size: number
}

export interface S3Reader {
  /** Objets d'un préfixe, page après page, dans l'ordre des clés. */
  list: (bucket: string, prefix: string) => AsyncGenerator<S3Object>
  /** Premiers octets d'un objet (reconnaissance du type). */
  head: (bucket: string, key: string, bytes: number) => Promise<Buffer>
  /** Télécharge un objet dans `path` ; arrêt au-delà de `maxBytes`. */
  download: (bucket: string, key: string, path: string, options: { maxBytes: number, signal?: AbortSignal }) => Promise<{ size: number }>
}

/** Ce que le lecteur utilise du SDK (remplaçable dans les tests). */
export interface S3Sdk {
  S3Client: new (config: Record<string, unknown>) => Pick<S3Client, 'send'>
  ListObjectsV2Command: new (input: Record<string, unknown>) => unknown
  GetObjectCommand: new (input: Record<string, unknown>) => unknown
}

/**
 * Erreur du SDK → erreur de source. Objet ou compartiment absent : à corriger dans le manifeste ; accès refusé :
 * dans les droits des identifiants ; le reste (réseau, service) se retente.
 */
export function s3SourceError(error: unknown): SourceError {
  if (error instanceof SourceError) return error
  const raw = error as S3RawError | null
  // Erreur du service : son code (`NoSuchKey`…). Erreur du réseau : le code du système (`ENOTFOUND`…), plus parlant
  // que le nom générique `Error`.
  const name = raw?.name && raw.name !== 'Error' ? raw.name : raw?.Code ?? raw?.code ?? raw?.cause?.code ?? raw?.name ?? 'Error'
  const status = raw?.$metadata?.httpStatusCode
  if (name === 'NoSuchKey' || name === 'NoSuchBucket' || name === 'NotFound' || status === 404) return new SourceError('SOURCE_NOT_FOUND', name)
  if (S3_REFUSALS.has(name) || status === 403) {
    const extra = S3_REGION_ERRORS().includes(name) ? bucketRegion(raw) : name === 'AccessDenied' ? deniedAction(raw) : null
    return new SourceError('SOURCE_UNREADABLE', extra ? `${name} (${extra})` : name)
  }
  return new SourceError('DOWNLOAD_FAILED', name)
}

interface S3RawError {
  name?: string
  Code?: string
  code?: string
  message?: string
  Region?: string
  Endpoint?: string
  cause?: { code?: string }
  $metadata?: { httpStatusCode?: number }
  $response?: { headers?: Record<string, string | undefined> }
}

const REGION_PATTERN = /^[a-z]{2}(?:-[a-z]+)+-\d$/

/**
 * Région réelle du compartiment, quand le service la donne : en-tête `x-amz-bucket-region` (AWS), champ `Region`
 * (AuthorizationHeaderMalformed) ou hôte de `Endpoint` (PermanentRedirect). Rien d'autre n'est repris du message.
 */
function bucketRegion(raw: S3RawError | null): string | null {
  const candidates = [
    raw?.$response?.headers?.['x-amz-bucket-region'],
    raw?.Region,
    /\.s3[.-]([a-z0-9-]+)\.amazonaws\.com$/.exec(raw?.Endpoint ?? '')?.[1],
  ]
  return candidates.find((value): value is string => typeof value === 'string' && REGION_PATTERN.test(value)) ?? null
}

/** Action refusée (`s3:ListBucket`…) tirée du message d'AWS, sans l'ARN de l'utilisateur ni le numéro de compte. */
function deniedAction(raw: S3RawError | null): string | null {
  return /perform: (s3:[A-Za-z]+)/.exec(raw?.message ?? '')?.[1] ?? null
}

/** Région du compartiment notée dans le détail d'une erreur de région (`PermanentRedirect (eu-north-1)`), sinon null. */
export function s3BucketRegion(detail: string | null): string | null {
  const match = /^(\w+) \(([a-z0-9-]+)\)$/.exec(detail ?? '')
  return match && S3_REGION_ERRORS().includes(match[1]!) && REGION_PATTERN.test(match[2]!) ? match[2]! : null
}

/** Refus du service qu'un nouvel essai ne changera pas : identifiants, droits, ou région du compartiment. */
const S3_REFUSALS = new Set(['AccessDenied', 'InvalidAccessKeyId', 'SignatureDoesNotMatch', ...S3_REGION_ERRORS()])

/** Codes par lesquels un service dit que la région demandée n'est pas celle du compartiment (`--s3-region`). */
function S3_REGION_ERRORS(): string[] {
  return ['AuthorizationHeaderMalformed', 'PermanentRedirect', 'IllegalLocationConstraintException']
}

/**
 * Piste pour l'exploitant d'après le détail d'un échec : `region` (mauvaise `--s3-region`), `host` (hôte du
 * compartiment introuvable : `--s3-endpoint`, ou `--s3-path-style` pour un service qui n'a pas d'adresses
 * `compartiment.hôte`), sinon null.
 */
export function s3Hint(detail: string | null): 'region' | 'regionKnown' | 'host' | null {
  if (!detail) return null
  if (s3BucketRegion(detail)) return 'regionKnown'
  if (S3_REGION_ERRORS().includes(detail)) return 'region'
  if (detail === 'ENOTFOUND' || detail === 'EAI_AGAIN') return 'host'
  return null
}

export function createS3Reader(sdk: S3Sdk, settings: S3Settings): S3Reader {
  const client = new sdk.S3Client({
    region: settings.region,
    ...(settings.endpoint ? { endpoint: settings.endpoint } : {}),
    forcePathStyle: settings.forcePathStyle,
    credentials: {
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey,
      ...(settings.sessionToken ? { sessionToken: settings.sessionToken } : {}),
    },
    // Comme le stockage du serveur : pas de sommes de contrôle que certains services compatibles refusent.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  })
  const send = <T>(command: unknown, signal?: AbortSignal) =>
    (client.send as (command: unknown, options?: { abortSignal?: AbortSignal }) => Promise<T>)(command, signal ? { abortSignal: signal } : undefined)

  return {
    async* list(bucket, prefix) {
      let token: string | undefined
      do {
        let page: ListObjectsV2CommandOutput
        try {
          page = await send<ListObjectsV2CommandOutput>(new sdk.ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }))
        }
        catch (error) {
          throw s3SourceError(error)
        }
        for (const object of page.Contents ?? []) {
          if (object.Key !== undefined) yield { key: object.Key, size: object.Size ?? 0 }
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined
      } while (token)
    },

    async head(bucket, key, bytes) {
      try {
        const object = await send<GetObjectCommandOutput>(new sdk.GetObjectCommand({ Bucket: bucket, Key: key, Range: `bytes=0-${bytes - 1}` }))
        const chunks: Buffer[] = []
        for await (const chunk of object.Body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk))
        return Buffer.concat(chunks).subarray(0, bytes)
      }
      catch (error) {
        throw s3SourceError(error)
      }
    },

    async download(bucket, key, path, { maxBytes, signal }) {
      try {
        const object = await send<GetObjectCommandOutput>(new sdk.GetObjectCommand({ Bucket: bucket, Key: key }), signal)
        if ((object.ContentLength ?? 0) > maxBytes) {
          (object.Body as { destroy?: () => void } | undefined)?.destroy?.()
          throw new SourceError('DOWNLOAD_TOO_LARGE', String(maxBytes))
        }
        let size = 0
        const body = object.Body as AsyncIterable<Uint8Array>
        await pipeline(
          async function* () {
            for await (const chunk of body) {
              size += chunk.byteLength
              if (size > maxBytes) throw new SourceError('DOWNLOAD_TOO_LARGE', String(maxBytes))
              yield chunk
            }
          },
          createWriteStream(path),
        )
        if (size === 0) throw new SourceError('SOURCE_EMPTY')
        return { size }
      }
      catch (error) {
        // Arrêt demandé par l'appelant (Ctrl+C) : l'erreur d'origine remonte telle quelle.
        if (signal?.aborted) throw error
        throw s3SourceError(error)
      }
    },
  }
}
