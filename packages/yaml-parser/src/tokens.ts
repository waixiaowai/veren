import { defineToken } from "@veren/core";
/** YAML 解析服务接口 / the YAML parser service interface */
export interface YamlParser {
    /**
     * 解析单个 YAML 文档；空文档解析为 null。
     * Parses a single YAML document; an empty document parses to null.
     */
    parse<T = unknown>(text: string): T;
}

export const name = defineToken<YamlParser>('verenYamlParser');
