/**
 * `.mdx` в этом репо втягивается в бандл ТЕКСТОМ: единственный такой файл —
 * снимок нормативного документа `src/lib/finmodel/snapshot/rules.mdx` (#193),
 * и компилирует его рендерер страницы, а не сборщик.
 *
 * Механика и причина (включая то, почему не `readFileSync` и не `?raw`) —
 * `tools/build/mdx-raw-loader.cjs`. Здесь только тип для TypeScript.
 */
declare module '*.mdx' {
  const content: string
  export default content
}
