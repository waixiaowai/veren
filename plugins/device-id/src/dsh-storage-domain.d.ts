/**
 * Ambient type surface for the @deepseek-ai/dsh-storage-domain rc.1 package
 * (its published bundle ships no .d.ts files yet).
 * @deepseek-ai/dsh-storage-domain rc.1 发布包尚未携带 .d.ts，这里声明本插件
 * 用到的最小类型面。
 */

declare module '@deepseek-ai/dsh-storage-domain' {
  import type { ZodType } from 'zod';

  export interface DomainGlobalSpec<G> {
    readonly schema: ZodType<G>;
    readonly initial: G;
  }
  export interface DomainTableSpec {
    readonly valueSchema: ZodType<unknown>;
  }
  export interface DomainSpec {
    readonly name: string;
    readonly version: number;
    readonly tables: Record<string, DomainTableSpec>;
    readonly global?: DomainGlobalSpec<unknown>;
  }
  export interface DomainGlobal<G> {
    get(): G;
    set(value: G): Promise<void>;
  }
  export interface Domain<S extends DomainSpec> {
    readonly name: S['name'];
    readonly global: S extends { readonly global: DomainGlobalSpec<infer G> } ? DomainGlobal<G> : never;
    close(): Promise<void>;
  }
  export declare function defineDomain<S extends DomainSpec>(spec: S): S;
  export declare function domainTable<V>(valueSchema: ZodType<V>): DomainTableSpec;
  export class DomainFacility {
    open<S extends DomainSpec>(spec: S): Promise<Domain<S>>;
    closeAll(): Promise<void>;
  }
}

