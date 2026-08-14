import { Component, ElementRef, OnDestroy, ViewChild } from '@angular/core'
import { PuquWebBluetoothPrinter, type PrinterSnapshot } from 'puquprintjs'

@Component({
  selector: 'app-puqu-printer',
  standalone: true,
  template: `
    <button [disabled]="state.connecting" (click)="connect()">连接璞趣打印机</button>
    <button [disabled]="!state.connected || state.printing" (click)="print()">打印</button>
    <canvas #label width="400" height="240"></canvas>
    <span>{{ state.error || state.statusText }}</span>
  `,
})
export class PuquPrinterComponent implements OnDestroy {
  @ViewChild('label') label?: ElementRef<HTMLCanvasElement>
  readonly printer = new PuquWebBluetoothPrinter()
  state: PrinterSnapshot = this.printer.getSnapshot()
  private readonly unsubscribe = this.printer.subscribe(snapshot => { this.state = snapshot })

  connect() { return this.printer.connect() }
  print() { return this.label && this.printer.printCanvas(this.label.nativeElement) }
  ngOnDestroy() { this.unsubscribe(); this.printer.disconnect() }
}
