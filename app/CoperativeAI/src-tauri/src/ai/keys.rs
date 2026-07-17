//! API-key storage in the OS credential store (Windows Credential Manager /
//! Linux Secret Service) via the keyring crate. The database stores only the
//! alias these functions are called with.

const SERVICE: &str = "CoperativeAI";

fn entry(alias: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, alias).map_err(|e| format!("credential store unavailable: {e}"))
}

pub fn store_key(alias: &str, value: &str) -> Result<(), String> {
    entry(alias)?
        .set_password(value)
        .map_err(|e| format!("could not store the API key in the OS credential store: {e}"))
}

pub fn get_key(alias: &str) -> Result<String, String> {
    entry(alias)?.get_password().map_err(|e| match e {
        keyring::Error::NoEntry => {
            "no API key is stored for this provider — re-enter it in AI Settings".to_string()
        }
        other => format!("could not read the API key from the OS credential store: {other}"),
    })
}

pub fn key_stored(alias: &str) -> bool {
    entry(alias).map(|e| e.get_password().is_ok()).unwrap_or(false)
}

/// Removing a provider must also remove its credential-store entry
/// (AIProvider retention rule). Missing entries are fine.
pub fn delete_key(alias: &str) -> Result<(), String> {
    match entry(alias)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!(
            "could not remove the API key from the OS credential store: {e}"
        )),
    }
}
