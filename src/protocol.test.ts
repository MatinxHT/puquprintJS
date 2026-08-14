import { describe, expect, it } from 'vitest'
import { buildBitmapPrintData, compressBitmap, getPrinterStateText, parsePuquNotification } from './protocol.js'

describe('PUQU bitmap protocol', () => {
  it('compresses repeated monochrome rows in vendor format', () => {
    const rgba = solidBitmap(8, 2, 255)
    expect(Array.from(compressBitmap(rgba, 8, 2))).toEqual([60, 2, 0, 0, 1])
    rgba.fill(0)
    for (let offset = 3; offset < rgba.length; offset += 4) rgba[offset] = 255
    expect(Array.from(compressBitmap(rgba, 8, 2))).toEqual([60, 2, 0, 0, 0, 255])
  })

  it('builds the 200 dpi header used by the vendor SDK', () => {
    const result = buildBitmapPrintData(solidBitmap(8, 2, 0), 8, 2, 200)
    expect(Array.from(result.header)).toEqual([58, 1, 2, 0, 6, 0, 0, 5])
    expect(Array.from(result.body)).toEqual([60, 2, 0, 0, 0, 255])
  })

  it('pads bitmap widths to a whole byte', () => {
    const result = buildBitmapPrintData(solidBitmap(9, 1, 255), 9, 1, 200)
    expect(result.width).toBe(16)
  })

  it('parses state notifications and exposes readable state', () => {
    const result = parsePuquNotification(new Uint8Array([58, 0x98, 0, 2, 60, 0, 0x10, 10]).buffer)
    expect(result.type).toBe('state')
    if (result.type === 'state') {
      expect(result.state.isLackOfPaper).toBe(true)
      expect(result.state.isPrinting).toBe(true)
      expect(getPrinterStateText(result.state)).toBe('缺纸')
    }
  })

  it('rejects malformed bitmap input', () => {
    expect(() => compressBitmap(new Uint8Array(1), 8, 1)).toThrow('RGBA 位图数据长度不足')
  })
})

function solidBitmap(width: number, height: number, value: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let offset = 0; offset < rgba.length; offset += 4) {
    rgba[offset] = value
    rgba[offset + 1] = value
    rgba[offset + 2] = value
    rgba[offset + 3] = 255
  }
  return rgba
}
