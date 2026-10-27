//! Reading UI mockups off disk so a model that can see them actually can.
//!
//! Images are the most expensive thing this platform can put in a prompt — a
//! screenshot costs far more than the paragraph describing it — so the limits
//! here are deliberate rather than defensive: a few pictures, each a sane size,
//! and a clear refusal otherwise instead of a surprise bill or a provider error.

use base64::Engine;

/// What one image costs to send, once read.
#[derive(Debug, Clone, PartialEq)]
pub struct LoadedImage {
    /// The file it came from, so the prompt can name it.
    pub name: String,
    pub media_type: String,
    pub base64: String,
}

/// Anthropic accepts these; Ollama's vision models are fed raw base64 and do
/// not care, so one list serves both.
const SUPPORTED: &[(&str, &str)] = &[
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("gif", "image/gif"),
    ("webp", "image/webp"),
];

/// Per-image ceiling. Anthropic rejects images over 5 MB; stopping short of
/// that means the refusal comes from here, where it can explain itself, rather
/// than from an API error nobody can act on.
pub const MAX_IMAGE_BYTES: u64 = 4 * 1024 * 1024;

/// How many pictures travel with one generation. Past a handful the cost stops
/// being worth what the extra pictures add.
pub const MAX_IMAGES: usize = 4;

/// The media type for a path, or `None` if it is not an image this can send.
pub fn media_type_for(path: &str) -> Option<&'static str> {
    let ext = path.rsplit('.').next()?.to_lowercase();
    SUPPORTED
        .iter()
        .find(|(e, _)| *e == ext)
        .map(|(_, media)| *media)
}

/// Reads the mockups a model will actually be shown.
///
/// Returns what loaded and, separately, why anything was left out — the caller
/// tells the user, because a picture silently dropped is a picture they think
/// the AI looked at.
pub fn load_images(paths: &[String]) -> (Vec<LoadedImage>, Vec<String>) {
    let mut loaded = Vec::new();
    let mut skipped = Vec::new();

    for path in paths {
        if loaded.len() >= MAX_IMAGES {
            skipped.push(format!(
                "{path} (only the first {MAX_IMAGES} pictures are sent)"
            ));
            continue;
        }
        let Some(media_type) = media_type_for(path) else {
            skipped.push(format!("{path} (not an image type that can be sent)"));
            continue;
        };
        let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
        if size > MAX_IMAGE_BYTES {
            skipped.push(format!(
                "{path} ({} KB — over the {} KB limit)",
                size / 1024,
                MAX_IMAGE_BYTES / 1024
            ));
            continue;
        }
        match std::fs::read(path) {
            Ok(bytes) => loaded.push(LoadedImage {
                name: path
                    .rsplit(['/', '\\'])
                    .next()
                    .unwrap_or(path)
                    .to_string(),
                media_type: media_type.to_string(),
                base64: base64::engine::general_purpose::STANDARD.encode(&bytes),
            }),
            Err(e) => skipped.push(format!("{path} (could not be read: {e})")),
        }
    }
    (loaded, skipped)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "coperativeai-vision-{name}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create");
        dir
    }

    #[test]
    fn only_image_types_that_can_be_sent_are_recognised() {
        assert_eq!(media_type_for("a/b/shot.png"), Some("image/png"));
        assert_eq!(media_type_for("SHOT.JPG"), Some("image/jpeg"));
        assert_eq!(media_type_for("x.jpeg"), Some("image/jpeg"));
        assert_eq!(media_type_for("x.webp"), Some("image/webp"));
        assert_eq!(media_type_for("notes.pdf"), None);
        assert_eq!(media_type_for("noextension"), None);
    }

    #[test]
    fn an_image_loads_as_base64_with_its_own_name() {
        let dir = temp_dir("load");
        let path = dir.join("basket.png");
        fs::write(&path, [1u8, 2, 3, 4]).expect("write");

        let (loaded, skipped) = load_images(&[path.to_string_lossy().to_string()]);
        assert!(skipped.is_empty());
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].name, "basket.png");
        assert_eq!(loaded[0].media_type, "image/png");
        assert_eq!(loaded[0].base64, "AQIDBA==");
        let _ = fs::remove_dir_all(&dir);
    }

    /// A picture silently dropped is a picture the user thinks the AI saw, so
    /// every omission comes back with a reason.
    #[test]
    fn anything_left_out_says_why() {
        let dir = temp_dir("skips");
        let notes = dir.join("notes.pdf");
        fs::write(&notes, [0u8; 4]).expect("write");
        let missing = dir.join("gone.png");

        let (loaded, skipped) = load_images(&[
            notes.to_string_lossy().to_string(),
            missing.to_string_lossy().to_string(),
        ]);
        assert!(loaded.is_empty());
        assert_eq!(skipped.len(), 2);
        assert!(skipped[0].contains("not an image type"));
        assert!(skipped[1].contains("could not be read"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_oversized_image_is_refused_here_rather_than_by_the_provider() {
        let dir = temp_dir("big");
        let path = dir.join("huge.png");
        fs::write(&path, vec![0u8; (MAX_IMAGE_BYTES + 1) as usize]).expect("write");

        let (loaded, skipped) = load_images(&[path.to_string_lossy().to_string()]);
        assert!(loaded.is_empty());
        assert!(skipped[0].contains("over the"), "got: {:?}", skipped);
        let _ = fs::remove_dir_all(&dir);
    }

    /// Past a handful the cost stops being worth what the extra pictures add.
    #[test]
    fn only_the_first_few_pictures_are_sent_and_the_rest_are_named() {
        let dir = temp_dir("many");
        let paths: Vec<String> = (0..MAX_IMAGES + 2)
            .map(|i| {
                let p = dir.join(format!("shot{i}.png"));
                fs::write(&p, [1u8]).expect("write");
                p.to_string_lossy().to_string()
            })
            .collect();

        let (loaded, skipped) = load_images(&paths);
        assert_eq!(loaded.len(), MAX_IMAGES);
        assert_eq!(skipped.len(), 2);
        assert!(skipped[0].contains("only the first"));
        let _ = fs::remove_dir_all(&dir);
    }
}
