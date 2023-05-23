<script setup lang="ts">
import { FormButton } from '@speckle/ui-components'
</script>

<template>
  <div
    id="speckle-home-view"
    class="flex flex-col justify-center items-center h-full w-full bg-primary text-center text-foundation"
  >
    <div class="flex justify-center items-center">
      <img src="../../assets/logo-white.png" alt="Logo" class="w-1/2" />
    </div>
    <p class="heading">Speckle PowerBI 3D Visual</p>
    <p class="">Some subtext here...</p>
    <div class="flex justify-center gap-2">
      <FormButton color="invert">Help</FormButton>
      <FormButton color="invert">Getting started</FormButton>
    </div>
  </div>
</template>

<style scoped></style>
