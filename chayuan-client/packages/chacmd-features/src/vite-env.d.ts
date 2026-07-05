/// <reference types="vite/client" />

// 本包 typecheck 会跟随 @chayuan/app 源码（workspace:* 指向 src），
// 基座里有 `import x from './y.svg?raw'` 之类的 vite 资产导入，需要下面的模块声明。
declare module '*?raw' {
  const src: string;
  export default src;
}
declare module '*.svg?raw' {
  const src: string;
  export default src;
}
