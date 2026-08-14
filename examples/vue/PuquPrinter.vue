<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { PuquWebBluetoothPrinter } from 'puquprintjs'

const printer = new PuquWebBluetoothPrinter()
const canvas = ref<HTMLCanvasElement>()
const state = ref(printer.getSnapshot())
const unsubscribe = printer.subscribe(snapshot => { state.value = snapshot })
onBeforeUnmount(() => unsubscribe())
</script>

<template>
  <button :disabled="state.connecting" @click="printer.connect()">连接璞趣打印机</button>
  <button :disabled="!state.connected || state.printing" @click="canvas && printer.printCanvas(canvas)">打印</button>
  <canvas ref="canvas" width="400" height="240" />
  <span>{{ state.error || state.statusText }}</span>
</template>
