//! Where a Hive from outside keeps its code: one file in the app's data
//! folder, named by its checksum. Never in the repository.
//!
//! `<extensions>/hive/<id>/<sha256>.js`
//!
//! **The checksum is checked on the way in and on every read.** On the way in,
//! so a download that is not the file the list named is never stored; on the
//! way out, so a file changed on disk after install is refused rather than
//! run. Naming it by its checksum means a replaced file can never be mistaken
//! for the one it replaced.

use std::path::{Path, PathBuf};

/// Largest Hive accepted. One built JavaScript file; five megabytes is far
/// beyond a sensible one, and small enough that a URL serving something else
/// costs no more than that.
pub const MAX_CODE_BYTES: usize = 5 * 1024 * 1024;

/// The SHA-256 of some bytes, as lower-case hex — the same digest the agent
/// policy uses.
pub fn digest(bytes: &[u8]) -> String {
    crate::tooling::sandbox_policy::digest(bytes)
}

fn folder(dir: &Path, id: &str) -> PathBuf {
    dir.join("hive").join(id)
}

pub fn file_for(dir: &Path, id: &str, sha256: &str) -> PathBuf {
    folder(dir, id).join(format!("{sha256}.js"))
}

/// Stores a Hive's code, if it is the file the checksum names, and deletes
/// any older file of the same Hive. Ids and checksums are checked first, so
/// neither can name a path outside the folder.
pub fn store(dir: &Path, id: &str, sha256: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    check_names(id, sha256)?;
    if digest(bytes) != sha256 {
        return Err("The downloaded file does not match its sha256, so it was not installed.".into());
    }
    let folder = folder(dir, id);
    std::fs::create_dir_all(&folder).map_err(|e| format!("Could not make {}: {e}", folder.display()))?;
    let path = file_for(dir, id, sha256);
    // Written beside it and renamed, so a half-written file is never there to
    // be read under the checksum's name.
    let partial = folder.join(format!("{sha256}.partial"));
    std::fs::write(&partial, bytes).map_err(|e| format!("Could not write {}: {e}", partial.display()))?;
    std::fs::rename(&partial, &path).map_err(|e| format!("Could not store {}: {e}", path.display()))?;
    for old in std::fs::read_dir(&folder).map_err(|e| e.to_string())?.flatten() {
        if old.path() != path {
            let _ = std::fs::remove_file(old.path());
        }
    }
    Ok(path)
}

/// A stored Hive's code, refused if it no longer matches its checksum.
pub fn read_verified(dir: &Path, id: &str, sha256: &str) -> Result<Vec<u8>, String> {
    check_names(id, sha256)?;
    let bytes = std::fs::read(file_for(dir, id, sha256))
        .map_err(|_| format!("The code for {id} is not on this machine. Install it again."))?;
    if digest(&bytes) != sha256 {
        return Err(format!(
            "The code for {id} has changed since it was installed, so it will not run. Install it again."
        ));
    }
    Ok(bytes)
}

/// Deletes everything stored for a Hive. Nothing there is not an error.
pub fn remove_all(dir: &Path, id: &str) -> Result<(), String> {
    if !super::catalogue::is_id(id) {
        return Err(format!("{id:?} is not an id"));
    }
    match std::fs::remove_dir_all(folder(dir, id)) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

fn check_names(id: &str, sha256: &str) -> Result<(), String> {
    if !super::catalogue::is_id(id) {
        return Err(format!("{id:?} is not an id"));
    }
    if sha256.len() != 64 || !sha256.chars().all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c)) {
        return Err(format!("{sha256:?} is not a sha256"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const CODE: &[u8] = b"export default 1;";

    #[test]
    fn stores_a_file_that_matches_and_reads_it_back() {
        let dir = crate::testing::scratch("store", "matches");
        let sha = digest(CODE);
        let path = store(&dir, "studio", &sha, CODE).expect("stored");
        assert_eq!(path, file_for(&dir, "studio", &sha));
        assert_eq!(read_verified(&dir, "studio", &sha).unwrap(), CODE);
    }

    #[test]
    fn a_mismatch_stores_nothing() {
        let dir = crate::testing::scratch("store", "mismatch");
        let wrong = digest(b"something else");
        assert!(store(&dir, "studio", &wrong, CODE).unwrap_err().contains("does not match"));
        assert!(!dir.join("hive").join("studio").exists());
    }

    /// Replacing keeps only the new file — the old one cannot be run by
    /// anything that still names it.
    #[test]
    fn replacing_deletes_the_old_file() {
        let dir = crate::testing::scratch("store", "replace");
        let old = digest(CODE);
        store(&dir, "studio", &old, CODE).unwrap();
        let new = digest(b"export default 2;");
        store(&dir, "studio", &new, b"export default 2;").unwrap();
        assert!(!file_for(&dir, "studio", &old).exists());
        assert!(file_for(&dir, "studio", &new).exists());
    }

    #[test]
    fn a_file_changed_after_install_is_refused() {
        let dir = crate::testing::scratch("store", "tampered");
        let sha = digest(CODE);
        let path = store(&dir, "studio", &sha, CODE).unwrap();
        std::fs::write(&path, b"fetch('https://example.com')").unwrap();
        assert!(read_verified(&dir, "studio", &sha).unwrap_err().contains("changed"));
    }

    #[test]
    fn removing_deletes_the_hives_folder_and_is_fine_twice() {
        let dir = crate::testing::scratch("store", "remove");
        let sha = digest(CODE);
        store(&dir, "studio", &sha, CODE).unwrap();
        remove_all(&dir, "studio").unwrap();
        assert!(!dir.join("hive").join("studio").exists());
        remove_all(&dir, "studio").expect("nothing there is not an error");
    }

    /// Neither an id nor a checksum can walk out of the folder.
    #[test]
    fn names_that_could_escape_are_refused() {
        let dir = crate::testing::scratch("store", "escape");
        let sha = digest(CODE);
        assert!(store(&dir, "../x", &sha, CODE).is_err());
        assert!(store(&dir, "studio", "../../../../etc/passwd", CODE).is_err());
        assert!(read_verified(&dir, "studio", &"A".repeat(64)).is_err());
        assert!(remove_all(&dir, "..").is_err());
    }
}
