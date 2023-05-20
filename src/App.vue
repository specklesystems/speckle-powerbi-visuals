<script lang="ts">
import { defineComponent } from 'vue'
import { CommonLoadingBar } from '@speckle/ui-components'
export default defineComponent({
  name: 'App',
  components: { CommonLoadingBar },
  props: {
    dataView: Object
  },
  emits: ['speckle'],
  data() {
    return {}
  },
  mounted() {
    this.$emit('speckle', { some: 123, thing: this.dataView })
  },
  methods: {
    testSPECKLE() {
      console.error('THIS IS A TEST')
    }
  }
})
</script>

<template>
  <h1 class="text-3xl font-bold">Hello</h1>
  <p class="text-secondary">Hello there</p>
  <common-loading-bar loading>Loading....</common-loading-bar>
</template>

<style scoped></style>
