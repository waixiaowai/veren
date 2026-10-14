/**
 * CSS Module 类型声明:类名映射为 Record<string, string>(构建脚本改写哈希类)。
 * CSS Module type declaration: the class mapping is Record<string, string>
 * (the build script rewrites hashed class names).
 */
declare module '*.module.css' {
  const classes: Record<string, string>;
  export default classes;
}
