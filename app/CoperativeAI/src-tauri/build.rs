use std::time::{SystemTime, UNIX_EPOCH};

fn main() {
    // **When this binary was built, compiled into it.**
    //
    // A desktop app that is installed and then rebuilt from source has two
    // copies of itself on the machine, and nothing on screen says which one is
    // running. A whole afternoon went into "Execute does nothing" that was an
    // eighteen-day-old installed build missing every fix being discussed — a
    // question neither side could answer, because the app could not say.
    //
    // `rerun-if-changed` on nothing at all: this must be re-emitted on every
    // build, which is what "when was this built" means.
    let at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    println!("cargo:rustc-env=BUILD_AT={at}");
    println!("cargo:rerun-if-changed=build.rs");
    tauri_build::build()
}
