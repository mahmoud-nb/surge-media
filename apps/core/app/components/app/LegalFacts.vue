<script setup lang="ts">
/**
 * Liste d'informations d'une page légale (éditeur, hébergeur) : libellé et valeur, lien facultatif (e-mail,
 * téléphone). Une valeur vide s'affiche « Non renseigné » : l'exploitant voit ce qui manque.
 */
defineProps<{
  rows: Array<{ label: string, value: string, href?: string }>
}>()

const { t } = useI18n()
</script>

<template>
  <dl class="grid gap-x-6 gap-y-2 sm:grid-cols-[12rem_minmax(0,1fr)]">
    <template v-for="row in rows" :key="row.label">
      <dt class="text-muted-foreground">
        {{ row.label }}
      </dt>
      <dd class="whitespace-pre-line wrap-anywhere">
        <a v-if="row.href && row.value" :href="row.href" class="rounded font-medium text-primary underline underline-offset-2 hover:no-underline">{{ row.value }}</a>
        <template v-else-if="row.value">
          {{ row.value }}
        </template>
        <span v-else class="text-muted-foreground italic">{{ t('legal.missing') }}</span>
      </dd>
    </template>
  </dl>
</template>
