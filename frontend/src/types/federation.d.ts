// Ambient declaration for the virtual module exposed by
// @originjs/vite-plugin-federation at build/runtime. These helpers are injected
// by the federation plugin and have no shipped type declarations.
declare module 'virtual:__federation__' {
  export interface FederationRemoteInfo {
    url: string
    format?: 'esm' | 'systemjs' | 'var'
    from?: 'vite' | 'webpack'
  }

  export function __federation_method_setRemote(
    name: string,
    remote: FederationRemoteInfo
  ): void

  export function __federation_method_getRemote(
    name: string,
    exposedPath: string
  ): Promise<unknown>

  export function __federation_method_unwrapDefault(
    module: unknown
  ): Promise<any>
}
