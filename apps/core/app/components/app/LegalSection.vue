<script setup lang="ts">
/** Section d'une page légale de la démo : titre h2 relié à la section, puis le texte. */
defineProps<{ title: string }>()

const id = useId()
</script>

<template>
  <section :aria-labelledby="id">
    <h2 :id="id" class="text-xl font-semibold text-foreground">
      {{ title }}
    </h2>
    <div class="mt-3 grid gap-3 leading-relaxed text-foreground">
      <slot />
    </div>
  </section>
</template>
