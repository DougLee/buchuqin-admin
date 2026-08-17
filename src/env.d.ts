/// <reference types="vite/client" />

/** 摄像头条码识别（Chrome/Edge 实验特性，Safari/Firefox 无此 API 时降级手工输入）。 */
interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<{ rawValue?: string }[]>;
}
interface Window {
  BarcodeDetector?: new (options: {
    formats: string[];
  }) => BarcodeDetectorLike;
}
