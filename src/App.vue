<script setup lang="ts">
import HomeView from './views/HomeView.vue'
import ViewerView from './views/ViewerView.vue'
import { computed } from 'vue'
import { useStore } from 'vuex'
import { storeKey } from 'src/injectionKeys'

let store = useStore(storeKey)
let status = computed(() => {
  console.log('Status from store changed', store.state.status)
  return store.state.status
})
</script>

<template>
  <ViewerView v-if="status == 'valid'" />
  <HomeView v-else />
</template>

<style scoped></style>
