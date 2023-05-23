<script async setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, Ref, ref, watch, watchEffect } from 'vue'
import { useStore } from 'vuex'
import ViewerControls from 'src/components/ViewerControls.vue'
import { SpeckleView } from '@speckle/viewer'
import { CommonLoadingBar } from '@speckle/ui-components'
import ViewerHandler from 'src/handlers/viewerHandler'
import { useClickDragged } from 'src/composables/useClickDragged'
import { isMultiSelect } from 'src/utils/isMultiSelect'
import { selectionHandlerKey, storeKey, tooltipHandlerKey } from 'src/injectionKeys'
import { SpeckleDataInput } from 'src/types'
import { debounce, throttle } from 'lodash'

const selectionHandler = inject(selectionHandlerKey)
const tooltipHandler = inject(tooltipHandlerKey)
const store = useStore(storeKey)
const { dragged } = useClickDragged()

let viewerHandler: ViewerHandler = null
let ac = new AbortController()

const container = ref<HTMLElement>()
let bboxActive = ref(false)
let views: Ref<SpeckleView[]> = ref([])
let updateTask: Ref<Promise<void>> = ref(null)
let setupTask: Promise<void> = null

const isLoading = computed(() => updateTask.value != null)
const input = computed(() => store.state.input)

const onCameraMoved = throttle((_) => {
  const pos = tooltipHandler.currentTooltip?.worldPos
  if (!pos) return
  const screenPos = viewerHandler.getScreenPosition(pos)
  tooltipHandler.move(screenPos)
}, 50)

onMounted(() => {
  viewerHandler = new ViewerHandler(container.value)
  setupTask = viewerHandler
    .init()
    .then(() => viewerHandler.addCameraUpdateEventListener(onCameraMoved))
    .finally(() => {
      if (input.value) cancelAndHandleDataUpdate()
    })
})

onBeforeUnmount(async () => {
  await viewerHandler.dispose()
  viewerHandler = null
})

const debounceUpdate = debounce(cancelAndHandleDataUpdate, 500)
watch(input, debounceUpdate)

watchEffect(() => {
  if (!isLoading.value) viewerHandler?.setSectionBox(bboxActive.value, input.value.objectIds)
})

function handleDataUpdate(input: Ref<SpeckleDataInput>, signal: AbortSignal) {
  updateTask.value = setupTask
    .then(async () => {
      signal.throwIfAborted()
      // Clear previous selection
      await viewerHandler.selectObjects(null)

      // Load
      await viewerHandler.loadObjectsWithAutoUnload(
        input.value.objectsToLoad,
        console.log,
        console.error,
        signal
      )
      signal.throwIfAborted()
      // Color
      await viewerHandler.colorObjectsByGroup(input.value.colorByIds)

      // Select
      await viewerHandler.unIsolateObjects()
      if (input.value.selectedIds.length == 0)
        await viewerHandler.isolateObjects(input.value.objectIds, true)
      else await viewerHandler.isolateObjects(input.value.selectedIds, true)

      signal.throwIfAborted()
      // Update available views
      views.value = viewerHandler.getViews()
    })
    .catch((e: Error) => {
      console.log('Loading operation was aborted', e)
    })
    .finally(() => {
      updateTask.value = null
    })
}

async function cancelAndHandleDataUpdate() {
  console.log('Input has changed', input.value)
  if (updateTask.value) {
    ac.abort()
    console.log('Cancelling previous load job')
    await updateTask
    ac = new AbortController()
  }
  const signal = ac.signal
  handleDataUpdate(input, signal)
}

async function onCanvasClick(ev: MouseEvent) {
  if (dragged.value) return
  const intersectResult = await viewerHandler.intersect({ x: ev.clientX, y: ev.clientY })
  const multi = isMultiSelect(ev)
  const hit = intersectResult?.hit
  if (hit) {
    const id = hit.object.id as string
    if (multi || !selectionHandler.isSelected(id)) await selectionHandler.select(id, multi)
    tooltipHandler.show(hit, { x: ev.clientX, y: ev.clientY })
    const selection = selectionHandler.getCurrentSelection()
    const ids = selection.map((s) => s.id)
    await viewerHandler.selectObjects(ids)
  } else {
    tooltipHandler.hide()
    if (!multi) {
      selectionHandler.clear()
      await viewerHandler.selectObjects(null)
    }
  }
}

async function onCanvasAuxClick(ev: MouseEvent) {
  if (ev.button != 2 || dragged.value) return
  const intersectResult = await viewerHandler.intersect({ x: ev.clientX, y: ev.clientY })
  await selectionHandler.showContextMenu(ev, intersectResult?.hit)
}
</script>

<template>
  <div class="flex flex-col justify-center items-center">
    <div
      ref="container"
      class="fixed h-full w-full z-0"
      @click="onCanvasClick"
      @auxclick="onCanvasAuxClick"
    />
    <div class="z-30 w-1/2 px-10">
      <common-loading-bar :loading="isLoading" />
    </div>
    <viewer-controls
      v-if="!isLoading"
      v-model:section-box="bboxActive"
      :views="views"
      class="fixed bottom-6"
      @view-clicked="(view) => viewerHandler.setView(view)"
    />
  </div>
</template>
<style scoped></style>
