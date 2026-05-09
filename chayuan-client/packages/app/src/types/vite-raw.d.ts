// Vite 的 `import xxx from './foo.md?raw'` 把文件作为字符串静态打包。
// 没有这条声明 TypeScript 不认识 `.md?raw` 这种 query 后缀的 module。
declare module '*.md?raw' {
  const content: string;
  export default content;
}
