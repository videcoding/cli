declare module '*.md' {
  const content: string
  export default content
}

declare namespace JSX {
  interface IntrinsicElements {
    [elemName: string]: any
  }
}

export {}
