//! veren-core：Veren Rust workspace 的共享核心库。
//! veren-core: shared core library of the Veren Rust workspace.

/// 返回占位问候语，供产品与示例调用。
/// Returns the placeholder greeting used by products and examples.
pub fn greeting() -> &'static str {
    "Hello, world!"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn greeting_is_hello_world() {
        assert_eq!(greeting(), "Hello, world!");
    }
}
