# puquprintJS

面向璞趣（PUQU）BLE 标签打印机的框架无关 TypeScript SDK。它把 PartTrace 项目中已经验证的位图压缩、打印指令、设备状态解析和 Web Bluetooth GATT 传输抽离为一个独立包，可直接用于 Angular、React、Vue 或原生 JavaScript。

> 当前仓库不是璞趣官方 SDK。协议实现源自现有项目对厂商小程序 SDK 数据格式的适配，请先用你的具体打印机型号做实机验收。

> **资料来源与适用范围：**本仓库整理的是从 **2026 年 8 月 14 日下载的璞趣 SDK 对接包**中的微信小程序开发实例提取、转换并验证的浏览器端核心功能，目标机型包括 **PQ、AQ、TQ、Q1 等系列标签打印机**。不同型号和固件的 BLE UUID、MTU、状态通知可能存在差异，因此“适用”表示协议具备对接基础，不代表所有机型已经完成实机认证。

> **权利与授权：**本仓库的 MIT 许可证仅适用于仓库贡献者有权许可的内容，不代表璞趣或其他权利人已经授权其 SDK、协议资料、商标或其他材料。计划公开发布、再分发或用于商业项目之前，请通过[璞趣官网联系页面](https://www.puqulabel.com/about/)向厂商确认适用授权，并保留书面许可。详见 [`NOTICE`](./NOTICE)。

## 能力

- 将 RGBA/Canvas 位图转成璞趣打印数据；
- 支持 200 dpi 与 300 dpi 指令头；
- 搜索常见璞趣 BLE GATT 服务和写入/通知特征；
- 自动分包，较大 ATT 写入失败时回退到 20 字节；
- 串行化查询、打印、取消操作，避免并发写入；
- 解析电量、缺纸、开盖、繁忙、打印错误等状态；
- 不依赖 React/Vue/Angular，三种框架示例位于 `examples/`。

## 环境限制

Web Bluetooth 是“有限可用”的实验性浏览器能力，不是所有主流浏览器都支持：

- 页面必须使用 HTTPS（开发时 `http://localhost` 通常被视为安全上下文）；
- `connect()` 必须由按钮点击等短暂用户手势直接触发；
- 打印机必须暴露 BLE/GATT 服务。只支持经典蓝牙 SPP 的机型不能通过 Web Bluetooth 连接；
- 建议使用支持 Web Bluetooth 的桌面或 Android Chromium 浏览器实机验证；
- Safari、Firefox 及 iOS 浏览器不可假定支持，应用必须先调用 `getWebBluetoothCompatibility()`；
- 跨域 iframe 还需要正确配置 `Permissions-Policy: bluetooth=(...)` 和 iframe 的 `allow="bluetooth"`。

参考：[Chrome Web Bluetooth 指南](https://developer.chrome.com/docs/capabilities/bluetooth)、[Web Bluetooth 规范](https://webbluetoothcg.github.io/web-bluetooth/)、[MDN Web Bluetooth](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API)。

## 开发方式

建议使用 Node.js 20 或更高版本。首次拉取仓库后：

```bash
npm ci
npm run test:watch
```

核心实现按协议层（`src/protocol.ts`）与浏览器传输层（`src/web-bluetooth.ts`）分离。开发约定、目录职责、新机型适配要求和测试规范见 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。修改代码后执行：

```bash
npm run validate
```

该命令依次执行 TypeScript 类型检查、Vitest 自动测试和发布构建。

## 仓库代码测试方式

```bash
# 运行一次全部自动测试
npm test

# 开发时监听文件变化
npm run test:watch

# 只做严格类型检查
npm run typecheck

# 生成 dist/ 发布文件
npm run build
```

自动测试无需连接打印机，覆盖位图压缩、200/300 DPI 指令头、透明像素、宽度补齐、状态解析、连接流程和 ATT 大包失败后回退到 20 字节分包。Web Bluetooth 与硬件/固件密切相关，发布兼容性结论前仍需完成下文的实机清单。

在另一个本地项目中测试：

```bash
npm install ../puquprintJS
```

发布到 npm 前，请先确认包名、版本、许可和实机兼容矩阵；本仓库未配置自动发布。执行 `npm pack` 或 `npm publish` 时，`prepack` 会自动运行类型检查、测试和构建，避免发布缺少或过期的 `dist/` 文件。可先用以下命令检查最终包内容：

```bash
npm pack --dry-run
```

## 最小用法

```ts
import { PuquWebBluetoothPrinter, getWebBluetoothCompatibility } from 'puquprintjs'

const compatibility = getWebBluetoothCompatibility()
if (!compatibility.supported || !compatibility.secureContext) {
  throw new Error(compatibility.reason)
}

const printer = new PuquWebBluetoothPrinter()
printer.subscribe(snapshot => console.log(snapshot.statusText, snapshot.error))

connectButton.addEventListener('click', async () => {
  // requestDevice 必须留在用户点击处理函数中。
  await printer.connect()
})

printButton.addEventListener('click', async () => {
  await printer.printCanvas(document.querySelector('canvas')!)
})
```

也可直接传入 RGBA：

```ts
await printer.printBitmap(imageData.data, imageData.width, imageData.height)
// 或明确覆盖设备返回的 dpi：
await printer.printBitmap(imageData.data, imageData.width, imageData.height, 300)
```

## 自定义机型

内置服务 UUID 来自现有适配。如果新机型使用其他公开的 GATT 服务 UUID：

```ts
const printer = new PuquWebBluetoothPrinter({
  namePrefix: 'Q',
  additionalServiceUuids: ['xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'],
  payloadSize: 180,
  chunkDelayMs: 10,
})
```

不要在不知道服务 UUID 的情况下把随机 UUID 加入列表；Web Bluetooth 只能访问设备授权对话框中申明过的可选服务。

## 位图约定

- 输入是每像素 4 字节的 RGBA 数组；
- 透明像素按白色处理；
- 默认灰度阈值是 200；
- 宽度不是 8 的倍数时，右侧自动补白；
- SDK 负责传输像素，不负责排版。建议应用先在 Canvas 上绘制文字、条码或二维码，再调用 `printCanvas()`。

## 测试范围与实机清单

自动测试覆盖协议压缩、指令头、位图补齐、状态解析和坏输入。Web Bluetooth 的完整行为需要真实硬件，交付前至少验证：

1. 浏览器能发现目标型号且 GATT 服务/特征匹配；
2. 200/300 dpi、不同标签宽高的方向和缩放正确；
3. 大面积黑色图像不会因缓存或分包丢行；
4. 缺纸、开盖、低电、取消和断连能正确反馈；
5. 连续打印多张时无串包，并以打印机实际完成状态作为业务审计依据。

## 来源说明

首版核心从私人项目 PartTrace 的以下实现提炼：

- `puquProtocol.ts`：协议、位图压缩与状态解析；
- `webBluetoothPrinter.ts`：Web Bluetooth 连接、分包和队列；
- `puquProtocol.test.ts`：协议基准用例。

业务专属的 50 × 30 mm 产品标签布局、BOM、序列号、打印历史接口和 React 页面没有进入 SDK。

上述来源说明只用于披露实现背景，不构成厂商授权声明。如需公开发布或再分发，请先通过[璞趣官网联系页面](https://www.puqulabel.com/about/)确认相关 SDK、协议资料和商标的使用权限。

<img width="1079" height="1899" alt="3341389e9dbed10d18d261ce70e226ef" src="https://github.com/user-attachments/assets/41073d94-d013-4d31-9124-0a01b47be7f9" />

