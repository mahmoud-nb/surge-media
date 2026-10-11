<script setup lang="ts">
useAppHead()
</script>

<template>
  <!-- Annonce le titre de la nouvelle page aux lecteurs d'écran après chaque navigation. -->
  <NuxtRouteAnnouncer />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
