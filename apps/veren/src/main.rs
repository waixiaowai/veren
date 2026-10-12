//! Veren 命令行入口：打印核心库的问候语。
//! Veren command-line entry point: prints the greeting from the core library.

fn main() {
    // 转发 veren-core 的问候语到标准输出。
    // Forward the greeting from veren-core to standard output.
    println!("{}", veren_core::greeting());
}
