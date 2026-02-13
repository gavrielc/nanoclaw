#[cfg(feature = "esp")]
fn main() {
    embuild::espidf::sysenv::output();
}

#[cfg(not(feature = "esp"))]
fn main() {}
