declare module 'bun:bundle' {
  export function feature(name: string): boolean
  export function MACRO<T>(fn: () => T): T
}

declare module 'bun:ffi' {
  export const FFIType: {
    i32: number
    u64: number
  }

  export function dlopen<
    T extends Record<string, { args: readonly unknown[]; returns: unknown }>,
  >(
    path: string,
    symbols: T,
  ): {
    symbols: {
      [K in keyof T]: (...args: unknown[]) => unknown
    }
    close(): void
  }
}
