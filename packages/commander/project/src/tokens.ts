import { defineToken } from '@veren/core';

/** 解析后的 CLI 配置 / parsed CLI configuration */
export interface Config {
  /** 参与扫描的根目录（绝对路径）/ scan roots (absolute paths) */
  scanRoots: string[];
}

/** 项目信息令牌 / the project info token */
export const Project = defineToken<ProjectInfo>('verenCliProject');

/** 项目信息：项目根与解析后的配置 / project info: the project root and the parsed config */
export interface ProjectInfo {
  /** 项目根（.veren.yaml 所在目录）/ the project root (the directory holding .veren.yaml) */
  root: string;
  /** 解析后的配置 / the parsed config */
  config: Config;
}
