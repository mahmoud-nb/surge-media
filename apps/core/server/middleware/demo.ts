import type { H3Event } from 'h3'
import type { DemoResource } from '#shared/utils/demo'
import { sendProblem } from '../lib/api/problem'
import { bodyIds, type DemoGuardedRoute, matchDemoRoute } from '../lib/demo/guarded-routes'

/**
 * Mode démo : le contenu de référence (créé au plus tard à la capture de l'instantané) est en lecture seule
 * (architecture : .claude/architecture-demo.md, § 6). Une écriture qui le vise → `403 DEMO_READ_ONLY`
 * (`data.resource`), au format de l'API v1 (RFC 9457) sous `/api/v1`. Élément introuvable : la route répond
 * elle-même. Après le middleware de l'API v1 (identifiant vérifié) et la protection CSRF.
 */
export default defineEventHandler(async (event) => {
  if (!useDemo().enabled || event.method === 'GET' || event.method === 'HEAD' || event.method === 'OPTIONS') return
  const pathname = event.path.split('?')[0]!
  if (!pathname.startsWith('/api/')) return
  const match = matchDemoRoute(event.method, pathname)
  if (!match) return

  const resource = await protectedResource(event, match.route, match.params)
  if (!resource) return
  const error = demoError(403, 'DEMO_READ_ONLY', { resource })
  if (pathname.startsWith('/api/v1/')) return sendProblem(event, error)
  throw error
})

/** Ressource de référence visée par la requête, ou null si l'écriture est permise. */
async function protectedResource(event: H3Event, route: DemoGuardedRoute, params: Record<string, string>): Promise<DemoResource | null> {
  const { target } = route
  switch (target.kind) {
    case 'setting':
      return 'setting'
    case 'project-query': {
      const { project } = getQuery(event)
      if (typeof project !== 'string' || !project) return 'setting'
      const createdAt = await createdAtOf('project', project)
      return createdAt && await isDemoReferenceItem(createdAt) ? 'project' : null
    }
    case 'session': {
      const user = await currentSessionUser(event)
      return user && await isDemoReferenceItem(user.createdAt) ? 'user' : null
    }
    case 'member': {
      const prisma = await usePrisma()
      const member = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId: params.id!, userId: params.userId! } },
        select: { createdAt: true },
      })
      return member && await isDemoReferenceItem(member.createdAt) ? 'member' : null
    }
    case 'body-ids': {
      let ids: string[]
      try {
        ids = bodyIds(await readBody(event))
      }
      catch {
        return null // corps illisible : la route le refusera
      }
      if (!ids.length) return null
      const prisma = await usePrisma()
      const found = await prisma.media.findMany({ where: { id: { in: ids } }, select: { createdAt: true } })
      for (const item of found) {
        if (await isDemoReferenceItem(item.createdAt)) return target.resource
      }
      return null
    }
    case 'param': {
      const createdAt = await createdAtOf(target.resource, params[target.param]!)
      return createdAt && await isDemoReferenceItem(createdAt) ? target.resource : null
    }
  }
}

/** Date de création d'un élément, ou null s'il n'existe pas. */
async function createdAtOf(resource: Exclude<DemoResource, 'member' | 'setting'>, id: string): Promise<Date | null> {
  const prisma = await usePrisma()
  const where = { id }
  const select = { createdAt: true } as const
  switch (resource) {
    case 'media':
      return (await prisma.media.findUnique({ where, select }))?.createdAt ?? null
    case 'folder':
      return (await prisma.folder.findUnique({ where, select }))?.createdAt ?? null
    case 'project':
      return (await prisma.project.findUnique({ where, select }))?.createdAt ?? null
    case 'key':
    case 'token':
      return (await prisma.accessToken.findUnique({ where, select }))?.createdAt ?? null
    case 'preset':
      return (await prisma.transformPreset.findUnique({ where, select }))?.createdAt ?? null
    case 'tag':
      return (await prisma.tag.findUnique({ where, select }))?.createdAt ?? null
    case 'origin':
      return (await prisma.allowedOrigin.findUnique({ where, select }))?.createdAt ?? null
    case 'user':
      return (await prisma.user.findUnique({ where, select }))?.createdAt ?? null
  }
}
