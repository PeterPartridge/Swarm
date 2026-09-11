//! The device-policy settings this app's sandbox wants, as something an
//! administrator can actually apply.
//!
//! **Exported, never installed.** An application cannot deploy an Intune
//! policy: policies come from an organisation's tenant to enrolled devices over
//! MDM, and this app is not in that path. The one thing it *could* do locally is
//! write `HKLM\SOFTWARE\Policies\WSL` itself — which would make the machine read
//! as managed to this app's own detection, so the app would be manufacturing the
//! evidence it then reports back. That is the exact failure this whole area
//! exists to prevent, so what is offered here is a file a person takes to their
//! tenant, and the applying is done by somebody with the rights to do it.
//!
//! **No Settings Catalog `.json` is offered, and that is a limitation with a
//! reason rather than an oversight.** Intune imports Settings Catalog profiles
//! as JSON, but every setting in such a file is addressed by a
//! `settingDefinitionId` that Microsoft assigns, and those identifiers are not
//! published anywhere this app could read. Generating them by guesswork would
//! produce a file that fails on import — worse than offering nothing, because it
//! fails in somebody else's tenant, at the point they were relying on it. What
//! *is* published is the ADMX, and every value below comes from it.
//!
//! **`AllowWSL` is deliberately absent from what this exports.** Microsoft's
//! recommended hardening does not include it either, and for this app it is the
//! one setting that must stay permitted — an export that turned WSL off would
//! disable the very sandbox it was meant to harden.

/// One setting, as the ADMX names it and as Intune shows it.
pub struct Setting {
    /// The value name under the policy key. From WSL's own ADMX.
    pub name: &'static str,
    /// What Intune's Settings Catalog calls it, for somebody typing it in.
    pub shown: &'static str,
    /// 0 disables, 1 allows — every one of these policies is binary.
    pub value: u32,
    /// What it means **for this app's sandbox**, which is the part a generic
    /// hardening list cannot tell you.
    pub why: &'static str,
}

// The policy key is deliberately *not* declared again here. Detection owns it
// as `sandbox_detect::WSL_POLICY_KEY`, and a second copy would be free to drift
// from the one the app actually reads — so an export could harden a key nothing
// ever looks at. The two spellings below are regedit's and PowerShell's, and a
// test checks both against detection's single definition.

/// What this app asks for, and why each one matters to the sandbox.
///
/// **Microsoft's recommended set, annotated rather than replaced.** Every entry
/// here is one Microsoft recommends disabling for an enterprise, and the value
/// matches theirs. What this app adds is the second question an administrator
/// actually has: what does this do to the thing I am trying to run? Two of them
/// are not merely compatible with the sandbox but wanted by it, and saying so is
/// the difference between a list somebody applies and a list somebody argues
/// with.
pub const RECOMMENDED: &[Setting] = &[
    Setting {
        name: "AllowInboxWSL",
        shown: "Allow the Inbox version of the Windows Subsystem for Linux",
        value: 0,
        why: "Wanted by this app, not merely tolerated. It needs WSL 2.4.4 or newer to give \
              itself a distribution of its own, and that is the Store version — so forcing Store \
              WSL removes a configuration this app cannot work on anyway.",
    },
    Setting {
        name: "AllowWSL1",
        shown: "Allow WSL1",
        value: 0,
        why: "No effect here: this app is WSL 2 only. Safe to apply.",
    },
    Setting {
        name: "AllowDebugShell",
        shown: "Allow the debug shell",
        value: 0,
        why: "Worth having. `wsl --debug-shell` opens a root shell inside a distribution, \
              bypassing the ordinary user this app runs an agent as. An agent cannot reach it \
              today — it is a Windows command, and this app turns interop off — so this is a \
              second lock on a door already shut, which is the kind worth having.",
    },
    Setting {
        name: "AllowDiskMount",
        shown: "Allow passthrough disk mount",
        value: 0,
        why: "Worth having, for the same reason: `wsl --mount` attaches a physical disk to a \
              distribution, and nothing this app does needs it.",
    },
    Setting {
        name: "AllowKernelUserSetting",
        shown: "Allow custom kernel configuration",
        value: 0,
        why: "No effect here. This app configures `/etc/wsl.conf` inside the distribution, which \
              is a different file from the `.wslconfig` these settings govern.",
    },
    Setting {
        name: "AllowKernelCommandLineUserSetting",
        shown: "Allow kernel command line configuration",
        value: 0,
        why: "No effect here — `.wslconfig`, not `/etc/wsl.conf`.",
    },
    Setting {
        name: "AllowSystemDistroUserSetting",
        shown: "Allow custom system distribution configuration",
        value: 0,
        why: "No effect here — `.wslconfig`, not `/etc/wsl.conf`.",
    },
    Setting {
        name: "AllowNetworkingModeUserSetting",
        shown: "Allow custom networking configuration",
        value: 0,
        why: "No effect here. The agent's distribution reaches the network as this machine does, \
              which the capability table says plainly; this setting does not change that.",
    },
    Setting {
        name: "AllowFirewallUserSetting",
        shown: "Allow user setting firewall configuration",
        value: 0,
        why: "No effect here — `.wslconfig`, not `/etc/wsl.conf`.",
    },
    Setting {
        name: "AllowNestedVirtualization",
        shown: "Allow nested virtualization",
        value: 0,
        why: "No effect on the WSL sandbox. Note it is Docker Desktop's concern rather than \
              this app's, so check that before applying it on a machine running containers.",
    },
    Setting {
        name: "AllowKernelDebugUserSetting",
        shown: "Allow kernel debugging",
        value: 0,
        why: "No effect here — `.wslconfig`, not `/etc/wsl.conf`.",
    },
];

/// Which export somebody wants.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// A `.reg` file: local machine, or Group Policy preferences.
    Registry,
    /// A script to deploy through Intune's own device-scripts feature.
    Script,
}

impl Kind {
    pub fn from_name(name: &str) -> Option<Self> {
        match name.trim() {
            "registry" => Some(Kind::Registry),
            "script" => Some(Kind::Script),
            _ => None,
        }
    }

    /// What the file should be called. Used for the saved name, so it carries
    /// the extension that makes Windows treat it correctly.
    pub fn file_name(self) -> &'static str {
        match self {
            Kind::Registry => "coperativeai-wsl-policy.reg",
            Kind::Script => "coperativeai-wsl-policy.ps1",
        }
    }
}

/// The export, as text to be read before it is used.
pub fn render(kind: Kind) -> String {
    match kind {
        Kind::Registry => registry(),
        Kind::Script => script(),
    }
}

/// Typographic punctuation flattened to ASCII.
///
/// **Because neither of these formats has a safe way to be non-ASCII.** A
/// `.reg` file is UTF-16 when regedit writes one, and a UTF-8 file with no BOM
/// is read as ANSI instead — so an em dash in a comment arrives as mojibake.
/// Windows PowerShell 5.1 does the same to a `.ps1`. Writing a BOM would solve
/// one and complicate the other; staying inside ASCII solves both and cannot
/// rot. The prose in this module is written with proper punctuation because it
/// is read here too — this is the one-way door on the way out.
fn plain(text: &str) -> String {
    text.chars()
        .map(|c| match c {
            '\u{2014}' => "--".to_string(),   // em dash
            '\u{2013}' => "-".to_string(),    // en dash
            '\u{2018}' | '\u{2019}' => "'".to_string(),
            '\u{201c}' | '\u{201d}' => "\"".to_string(),
            '\u{2026}' => "...".to_string(),
            '\u{00a0}' => " ".to_string(),
            other if other.is_ascii() => other.to_string(),
            // Anything else is dropped rather than guessed at: a replacement
            // character in a file somebody is about to apply looks like damage.
            _ => String::new(),
        })
        .collect()
}

/// The `.reg` form.
///
/// **`Windows Registry Editor Version 5.00` is not decoration.** A `.reg` file
/// without that exact first line is not imported — regedit refuses it — and a
/// file somebody double-clicks and sees fail is worse than no file.
fn registry() -> String {
    let mut out = String::new();
    out.push_str("Windows Registry Editor Version 5.00\r\n\r\n");
    out.push_str("; WSL device policy recommended by CoperativeAI.\r\n");
    out.push_str("; These are Microsoft's recommended enterprise settings for WSL; the notes\r\n");
    out.push_str("; say what each one does to this app's sandbox specifically.\r\n");
    out.push_str(";\r\n");
    out.push_str("; AllowWSL is deliberately not set here. This app needs WSL permitted, and\r\n");
    out.push_str("; Microsoft does not recommend disabling it either.\r\n");
    out.push_str(";\r\n");
    out.push_str("; Applying this file locally is not the same as an Intune policy: it writes\r\n");
    out.push_str("; the same values, but a managed machine's tenant may overwrite them, and\r\n");
    out.push_str("; nothing here enrols anything. For a fleet, set these in Intune instead --\r\n");
    out.push_str("; Devices > Configuration > Settings catalog > Windows Subsystem for Linux.\r\n\r\n");
    // The key is written as regedit spells it, which is the long hive name.
    out.push_str("[HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\WSL]\r\n");
    for setting in RECOMMENDED {
        out.push_str(&format!("; {} -- {}\r\n", plain(setting.shown), plain(setting.why)));
        out.push_str(&format!("\"{}\"=dword:{:08x}\r\n\r\n", setting.name, setting.value));
    }
    out
}

/// The PowerShell form, for Intune's device scripts.
fn script() -> String {
    let mut out = String::new();
    out.push_str("# WSL device policy recommended by CoperativeAI.\r\n");
    out.push_str("#\r\n");
    out.push_str("# Deploy through Intune: Devices > Scripts and remediations > Platform\r\n");
    out.push_str("# scripts > Windows 10 and later. Run as system, 64-bit.\r\n");
    out.push_str("#\r\n");
    out.push_str("# A settings-catalog profile is the better route where one exists -- it\r\n");
    out.push_str("# reports compliance and this does not. This is for the case where a script\r\n");
    out.push_str("# is what you already deploy.\r\n");
    out.push_str("#\r\n");
    out.push_str("# AllowWSL is deliberately not set: this app needs WSL permitted.\r\n\r\n");
    out.push_str("$key = 'HKLM:\\SOFTWARE\\Policies\\WSL'\r\n");
    out.push_str("if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }\r\n\r\n");
    for setting in RECOMMENDED {
        out.push_str(&format!("# {} -- {}\r\n", plain(setting.shown), plain(setting.why)));
        out.push_str(&format!(
            "New-ItemProperty -Path $key -Name '{}' -PropertyType DWord -Value {} -Force | \
             Out-Null\r\n\r\n",
            setting.name, setting.value
        ));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// **The one setting that must never be exported.** Turning WSL off would
    /// disable the sandbox this export exists to harden, and a file that did
    /// that would be applied by somebody trusting it.
    #[test]
    fn the_export_never_turns_wsl_off() {
        assert!(
            !RECOMMENDED.iter().any(|s| s.name == "AllowWSL"),
            "AllowWSL must not be in the exported set at all"
        );
        for kind in [Kind::Registry, Kind::Script] {
            let text = render(kind);
            // Named in the prose that explains its absence, never as a value.
            assert!(!text.contains("\"AllowWSL\"="), "{:?} sets AllowWSL", kind);
            assert!(!text.contains("-Name 'AllowWSL'"), "{:?} sets AllowWSL", kind);
        }
    }

    /// A `.reg` file without this exact first line is refused by regedit, and a
    /// file somebody double-clicks and watches fail is worse than none.
    #[test]
    fn a_registry_export_is_one_windows_will_actually_import() {
        let text = registry();
        assert!(text.starts_with("Windows Registry Editor Version 5.00"), "{text}");
        assert!(text.contains("[HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\WSL]"), "{text}");
        // DWORDs are eight hex digits; regedit rejects a bare 0.
        assert!(text.contains("\"AllowWSL1\"=dword:00000000"), "{text}");
    }

    /// Every setting reaches both files, with the value the ADMX defines —
    /// a list that silently dropped one would harden less than it claimed.
    #[test]
    fn every_recommended_setting_reaches_both_exports() {
        let reg = registry();
        let ps = script();
        for setting in RECOMMENDED {
            assert!(
                reg.contains(&format!("\"{}\"=dword:{:08x}", setting.name, setting.value)),
                "{} missing from the registry export",
                setting.name
            );
            assert!(
                ps.contains(&format!("-Name '{}'", setting.name)),
                "{} missing from the script export",
                setting.name
            );
            // The name Intune shows, so somebody can find it in the catalog.
            assert!(reg.contains(setting.shown), "{} is not named for a reader", setting.name);
        }
        assert_eq!(RECOMMENDED.len(), 11);
    }

    /// **Said in the file itself, because a file outlives the panel that made
    /// it.** Somebody opening this a year later has to learn from the file that
    /// applying it locally is not being managed by Intune.
    #[test]
    fn each_export_says_what_it_is_not() {
        let reg = registry();
        assert!(reg.contains("not the same as an Intune policy"), "{reg}");
        assert!(reg.contains("Settings catalog"), "{reg}");
        let ps = script();
        assert!(ps.contains("settings-catalog profile is the better route"), "{ps}");
    }

    /// **Both exports must target the key detection actually reads.** They are
    /// spelled differently — regedit wants the long hive name, PowerShell wants
    /// the `HKLM:` drive — so nothing but a test ties them to the one
    /// definition. Hardening a key the app never looks at would leave the panel
    /// reporting "unmanaged" on a machine somebody had just hardened.
    #[test]
    fn both_exports_target_the_key_detection_reads() {
        let owned = crate::tooling::sandbox_detect::WSL_POLICY_KEY;
        let tail = owned.strip_prefix("HKLM\\").expect("detection's key is under HKLM");

        let reg = registry();
        assert!(
            reg.contains(&format!("[HKEY_LOCAL_MACHINE\\{tail}]")),
            "the registry export must target {owned}: {reg}"
        );
        let ps = script();
        assert!(
            ps.contains(&format!("'HKLM:\\{tail}'")),
            "the script export must target {owned}: {ps}"
        );
    }

    /// **Both files must be pure ASCII, or they are read as ANSI and mangled.**
    /// A `.reg` is UTF-16 when regedit writes one, and a UTF-8 file with no BOM
    /// is taken for ANSI; Windows PowerShell 5.1 treats a `.ps1` the same way.
    /// Staying inside ASCII sidesteps both, and it is not something to leave to
    /// whoever edits the prose above next — hence a test rather than a habit.
    #[test]
    fn nothing_exported_is_outside_ascii() {
        for kind in [Kind::Registry, Kind::Script] {
            let text = render(kind);
            if let Some(bad) = text.chars().find(|c| !c.is_ascii()) {
                panic!("{kind:?} contains {bad:?}, which will not survive being read as ANSI");
            }
        }
        // And the flattening is real rather than incidental: the prose above
        // genuinely contains an em dash, so this proves it was converted.
        assert!(RECOMMENDED.iter().any(|s| s.why.contains('\u{2014}')), "prose uses em dashes");
        assert_eq!(plain("a \u{2014} b \u{2019}c\u{2019}"), "a -- b 'c'");
    }

    #[test]
    fn a_kind_is_read_from_its_name() {
        assert_eq!(Kind::from_name("registry"), Some(Kind::Registry));
        assert_eq!(Kind::from_name(" script "), Some(Kind::Script));
        assert_eq!(Kind::from_name("settings-catalog"), None);
        assert_eq!(Kind::Registry.file_name(), "coperativeai-wsl-policy.reg");
    }

    /// The values come from WSL's own ADMX, where every one of these is binary
    /// and 0 is the disabling value. A 1 in here would harden nothing while
    /// looking as though it had.
    #[test]
    fn every_exported_value_disables_the_setting() {
        assert!(RECOMMENDED.iter().all(|s| s.value == 0), "these all disable");
    }

    /// Prints both exports, so what is actually handed to an administrator can
    /// be looked at rather than inferred from assertions. Ignored because it is
    /// for reading, not for judging.
    #[test]
    #[ignore = "prints the exports for a human to read"]
    fn show_me_what_gets_exported() {
        println!("===== {} =====", Kind::Registry.file_name());
        println!("{}", registry());
        println!("===== {} =====", Kind::Script.file_name());
        println!("{}", script());
    }
}
