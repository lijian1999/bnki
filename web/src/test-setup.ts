// jsdom 缺的浏览器接口
if (!document.elementFromPoint) (document as any).elementFromPoint = () => null;
if (!(window as any).matchMedia) {
  (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
}
if (!(Range.prototype as any).getClientRects) {
  (Range.prototype as any).getClientRects = () => [];
  (Range.prototype as any).getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
}
