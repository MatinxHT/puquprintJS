import { useEffect, useState } from 'react'
import { PuquWebBluetoothPrinter, type PrinterSnapshot } from 'puquprintjs'

const printer = new PuquWebBluetoothPrinter()

export function PrinterButton({ canvas }: { canvas: HTMLCanvasElement | null }) {
  const [state, setState] = useState<PrinterSnapshot>(printer.getSnapshot())
  useEffect(() => printer.subscribe(setState), [])

  return <>
    <button onClick={() => void printer.connect()} disabled={state.connecting}>连接璞趣打印机</button>
    <button onClick={() => canvas && void printer.printCanvas(canvas)} disabled={!state.connected || state.printing}>打印</button>
    <span>{state.error || state.statusText}</span>
  </>
}
