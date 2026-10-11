<script setup lang="ts">
/**
 * Documentation interactive de l'API v1 (permission api:docs : ADMIN, DEVELOPER).
 * La spécification est générée depuis le code des routes (GET /api/v1/openapi.json, dans la langue
 * de l'interface) puis enrichie des données réelles de l'utilisateur : serveur de cette
 * installation, ses projets comme exemples de `projectId`, une clé publique injectée dans les
 * requêtes d'essai, et les variables d'environnement de son application.
 * Les valeurs des clés secrètes et des jetons personnels ne sont jamais relisibles (ni injectables :
 * refusés depuis un navigateur) ; seules les clés publiques, non secrètes par nature, le sont.
 */
import { FileJson, KeyRound } from '@lucide/vue'
import { OPENAPI_DEFAULT_LANG, OPENAPI_LANGS, type OpenApiLang } from '#shared/utils/api'

// Le contenu principal de la page est la référence, dont Scalar rend lui-même l'élément <main>.
definePageMeta({ layout: 'admin', permission: 'api:docs', providesMain: true })

const { t, locale } = useI18n()
const { environmentLabel, compareEnvironments } = useCredentialLabels()

useSeoMeta({ title: () => t('apiDocs.meta.title') })

const { data: context, error, refresh } = await useApiFetch('/api/admin/api-docs')
type DocsProject = NonNullable<typeof context.value>['projects'][number]

// ─── Spécification, dans la langue de l'interface (chargée par le navigateur) ─

const specLang = computed<OpenApiLang>(() =>
  (OPENAPI_LANGS as readonly string[]).includes(locale.value) ? locale.value as OpenApiLang : OPENAPI_DEFAULT_LANG)
const specUrl = computed(() => `${context.value?.specUrl ?? '/api/v1/openapi.json'}?lang=${specLang.value}`)
const { data: spec, error: specError, refresh: refreshSpec } = useFetch<Record<string, unknown>>(specUrl, { server: false })

// ─── Clé publique injectée dans les requêtes d'essai ─────────────────────────

const publishableKeys = computed(() => (context.value?.projects ?? []).flatMap(project =>
  (project.keys ?? [])
    .filter(key => key.type === 'PUBLISHABLE' && key.publicValue)
    .map(key => ({ ...key, project }))))

const selectedKeyId = ref('')
watch(publishableKeys, (keys) => {
  if (!keys.some(key => key.id === selectedKeyId.value)) selectedKeyId.value = keys[0]?.id ?? ''
}, { immediate: true })
const selectedKey = computed(() => publishableKeys.value.find(key => key.id === selectedKeyId.value) ?? null)

const keyOptions = computed(() => [
  ...publishableKeys.value.map(key => ({
    value: key.id,
    label: t('apiDocs.credential.option', { project: key.project.name, name: key.name, environment: environmentLabel(key.environment) }),
  })),
  { value: '', label: t('apiDocs.credential.none') },
])

// ─── Documents passés à la référence ─────────────────────────────────────────

/** Projets de l'utilisateur, celui de la clé injectée en premier (exemple proposé par défaut). */
const orderedProjects = computed(() => {
  const projects = context.value?.projects ?? []
  const first = selectedKey.value?.project.id
  return first ? [...projects].sort((a, b) => Number(b.id === first) - Number(a.id === first)) : projects
})

const document = computed(() => {
  if (!spec.value) return null
  const copy = structuredClone(toRaw(spec.value)) as { components?: { parameters?: Record<string, Record<string, unknown>> } }
  const parameter = copy.components?.parameters?.projectId
  if (parameter && orderedProjects.value.length > 0) {
    parameter.examples = Object.fromEntries(orderedProjects.value.map(project => [project.slug, { summary: project.name, value: project.id }]))
  }
  return copy as Record<string, unknown>
})

/** Serveur des requêtes d'essai : cette origine (même origine, sans CORS), puis l'URL publique si elle diffère. */
const servers = computed(() => {
  if (!import.meta.client || !context.value) return []
  const local = `${window.location.origin}/api/v1`
  return [
    { url: local, description: t('apiDocs.reference.server') },
    ...(context.value.apiBaseUrl !== local ? [{ url: context.value.apiBaseUrl, description: t('apiDocs.reference.publicServer') }] : []),
  ]
})

// ─── Variables d'environnement de l'application ──────────────────────────────

const envProjectId = ref('')
const envEnvironment = ref('')
const envProject = computed<DocsProject | null>(() => context.value?.projects.find(project => project.id === envProjectId.value) ?? null)
const environments = computed(() => [...new Set((envProject.value?.keys ?? []).map(key => key.environment))].sort(compareEnvironments))

watch([() => context.value?.projects, selectedKey], ([projects]) => {
  if (!projects?.some(project => project.id === envProjectId.value)) envProjectId.value = selectedKey.value?.project.id ?? projects?.[0]?.id ?? ''
}, { immediate: true })
watch(environments, (list) => {
  if (!list.includes(envEnvironment.value)) {
    const preferred = selectedKey.value?.project.id === envProjectId.value ? selectedKey.value.environment : undefined
    envEnvironment.value = preferred && list.includes(preferred) ? preferred : list[0] ?? ''
  }
}, { immediate: true })

const projectOptions = computed(() => (context.value?.projects ?? []).map(project => ({ value: project.id, label: project.name })))
const environmentOptions = computed(() => environments.value.map(environment => ({ value: environment, label: environmentLabel(environment) })))

const envFile = computed(() => {
  const project = envProject.value
  if (!project || !context.value) return ''
  const environment = envEnvironment.value
  const keys = (project.keys ?? []).filter(key => key.environment === environment)
  const publishable = keys.find(key => key.type === 'PUBLISHABLE')
  const secret = keys.find(key => key.type === 'SECRET')
  const lines = [
    `# ${environment
      ? t('apiDocs.env.header', { project: project.name, environment: environmentLabel(environment) })
      : t('apiDocs.env.headerNoEnvironment', { project: project.name })}`,
    `SURGE_MEDIA_API_URL=${context.value.apiBaseUrl}`,
    `SURGE_MEDIA_PROJECT_ID=${project.id}`,
  ]
  if (project.keys === null) {
    lines.push('', `# ${t('apiDocs.env.noKeys')}`)
  }
  else {
    lines.push(
      '',
      `# ${publishable ? t('apiDocs.env.publishable', { name: publishable.name }) : t('apiDocs.env.noPublishable')}`,
      `SURGE_MEDIA_PUBLISHABLE_KEY=${publishable?.publicValue ?? ''}`,
      '',
      `# ${secret ? t('apiDocs.env.secret', { name: secret.name, prefix: secret.prefix }) : t('apiDocs.env.noSecret')}`,
      'SURGE_MEDIA_SECRET_KEY=',
    )
  }
  return lines.join('\n')
})
</script>

<template>
  <div>
    <!-- Repère nommé par le titre de la page ; la référence (Scalar) est le repère « main ». -->
    <section :aria-label="t('apiDocs.title')" class="mx-auto max-w-6xl">
      <AdminPageHeader :title="t('apiDocs.title')" :description="t('apiDocs.description')">
        <template #actions>
          <UiButton variant="outline" :to="specUrl" external>
            <FileJson aria-hidden="true" />
            {{ t('apiDocs.openapi') }}
          </UiButton>
        </template>
      </AdminPageHeader>

      <UiAlert v-if="error" variant="error" live="assertive" :title="t('apiDocs.loadError')" class="mb-8">
        <UiButton variant="outline" size="sm" class="mt-2" @click="refresh()">
          {{ t('common.retry') }}
        </UiButton>
      </UiAlert>

      <section v-else-if="context" aria-labelledby="api-setup-title" class="mb-10">
        <h2 id="api-setup-title" class="sr-only">
          {{ t('apiDocs.setup.title') }}
        </h2>
        <div class="grid gap-6 xl:grid-cols-2">
          <!-- Identifiant injecté -->
          <div class="grid content-start gap-4 rounded-xl border border-border bg-surface p-5">
            <h3 class="flex items-center gap-2 text-base font-semibold text-foreground">
              <KeyRound class="size-4 text-muted-foreground" aria-hidden="true" />
              {{ t('apiDocs.credential.title') }}
            </h3>
            <template v-if="publishableKeys.length > 0">
              <UiFormField v-slot="field" :label="t('apiDocs.credential.label')" :hint="t('apiDocs.credential.hint')">
                <UiSelect v-bind="field" v-model="selectedKeyId" :options="keyOptions" name="credential" />
              </UiFormField>
            </template>
            <p v-else class="text-sm text-muted-foreground">
              {{ t('apiDocs.credential.empty') }}
            </p>
            <UiAlert variant="info">
              {{ t('apiDocs.credential.secretNotice') }}
            </UiAlert>
          </div>

          <!-- Variables d'environnement -->
          <div class="grid min-w-0 content-start gap-4 rounded-xl border border-border bg-surface p-5">
            <div class="grid gap-1">
              <h3 id="api-env-title" class="text-base font-semibold text-foreground">
                {{ t('apiDocs.env.title') }}
              </h3>
              <p class="text-sm text-muted-foreground">
                {{ t('apiDocs.env.description') }}
              </p>
            </div>
            <p v-if="projectOptions.length === 0" class="text-sm text-muted-foreground">
              {{ t('apiDocs.env.noProject') }}
            </p>
            <template v-else>
              <div class="grid gap-4 sm:grid-cols-2">
                <UiFormField v-slot="field" :label="t('apiDocs.env.project')">
                  <UiSelect v-bind="field" v-model="envProjectId" :options="projectOptions" name="env-project" />
                </UiFormField>
                <UiFormField v-if="environmentOptions.length > 0" v-slot="field" :label="t('apiDocs.env.environment')">
                  <UiSelect v-bind="field" v-model="envEnvironment" :options="environmentOptions" name="env-environment" />
                </UiFormField>
              </div>
              <pre
                class="overflow-x-auto rounded-lg border border-border bg-background p-4 font-mono text-xs leading-relaxed text-foreground"
                tabindex="0"
                role="region"
                aria-labelledby="api-env-title"
              ><code>{{ envFile }}</code></pre>
              <div class="flex flex-wrap items-center justify-between gap-3">
                <UiCopyButton :value="envFile" :label="t('apiDocs.env.copy')" />
                <NuxtLink
                  v-if="envProject?.keys"
                  :to="`/admin/projects/${envProject.id}/keys`"
                  class="text-sm font-medium text-primary underline-offset-4 hover:underline"
                >
                  {{ t('apiDocs.env.keysLink') }}
                </NuxtLink>
              </div>
            </template>
          </div>
        </div>
      </section>

      <div class="mb-4 grid gap-1">
        <h2 id="api-reference-title" class="text-lg font-semibold text-foreground">
          {{ t('apiDocs.reference.title') }}
        </h2>
        <p class="text-sm text-muted-foreground">
          {{ t('apiDocs.reference.thirdParty') }}
        </p>
      </div>
    </section>

    <div>
      <UiAlert v-if="specError" variant="error" live="assertive" :title="t('apiDocs.reference.error')" class="mx-auto max-w-6xl">
        <UiButton variant="outline" size="sm" class="mt-2" @click="refreshSpec()">
          {{ t('common.retry') }}
        </UiButton>
      </UiAlert>
      <ClientOnly v-else>
        <div class="rounded-xl border border-border bg-surface">
          <LazyAdminApiReference v-if="document && context" :document="document" :servers="servers" :token="selectedKey?.publicValue ?? null" />
          <p v-else class="flex items-center gap-2 p-6 text-sm text-muted-foreground" role="status">
            {{ t('apiDocs.reference.loading') }}
          </p>
        </div>
        <template #fallback>
          <p class="rounded-xl border border-border bg-surface p-6 text-sm text-muted-foreground" role="status">
            {{ t('apiDocs.reference.loading') }}
          </p>
        </template>
      </ClientOnly>
    </div>
  </div>
</template>
