//! Getting a `swarm-extensions.json` from a URL.
//!
//! **HTTPS only, ten seconds, and no more than `catalogue::MAX_BYTES`.** The
//! limit is enforced while reading rather than after, so a URL that serves
//! something enormous costs a quarter of a megabyte and no more. What comes
//! back is text for `catalogue::read`; nothing here interprets it.

use super::catalogue::MAX_BYTES;
use std::time::Duration;

const TIMEOUT: Duration = Duration::from_secs(10);

/// The one URL scheme accepted: anything else could be read or changed on the
/// way, and this file decides what the app offers to install.
pub fn check_url(url: &str) -> Result<(), String> {
    let url = url.trim();
    let scheme = url.get(..8).unwrap_or("");
    if url.len() > scheme.len() && scheme.eq_ignore_ascii_case("https://") {
        Ok(())
    } else {
        Err("The address must start with https://.".into())
    }
}

/// Fetches a source's text after checking its address.
pub async fn read_source(url: &str) -> Result<String, String> {
    check_url(url)?;
    fetch_text(url.trim()).await
}

/// Fetches a Hive's code after checking its address, up to
/// `store::MAX_CODE_BYTES`. Bytes, not text: the checksum is over the file
/// exactly as served.
pub async fn read_code(url: &str) -> Result<Vec<u8>, String> {
    check_url(url)?;
    fetch_bytes(url.trim(), super::store::MAX_CODE_BYTES).await
}

/// A source's text, up to `catalogue::MAX_BYTES`. Separate from the scheme
/// check so a test can serve it from a plain local listener.
pub(crate) async fn fetch_text(url: &str) -> Result<String, String> {
    let body = fetch_bytes(url, MAX_BYTES).await?;
    String::from_utf8(body).map_err(|_| "The file is not text.".into())
}

/// The fetch itself, with a size limit and the timeout.
pub(crate) async fn fetch_bytes(url: &str, limit: usize) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::builder()
        .timeout(TIMEOUT)
        .build()
        .map_err(|e| format!("Could not start a request: {e}"))?;
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Could not reach {url}: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("{url} answered {}.", response.status()));
    }
    let too_large = || format!("The file is larger than {} KB.", limit / 1024);
    if response.content_length().is_some_and(|n| n as usize > limit) {
        return Err(too_large());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("Could not read {url}: {e}"))?
    {
        body.extend_from_slice(&chunk);
        if body.len() > limit {
            return Err(too_large());
        }
    }
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    /// Serves one canned HTTP reply on a local port and returns its URL.
    async fn serve_once(reply: Vec<u8>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("addr");
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.expect("accept");
            let mut request = [0u8; 2048];
            let _ = socket.read(&mut request).await;
            let _ = socket.write_all(&reply).await;
            let _ = socket.shutdown().await;
        });
        format!("http://{addr}/swarm-extensions.json")
    }

    fn reply(status: &str, body: &[u8], with_length: bool) -> Vec<u8> {
        let mut head = format!("HTTP/1.1 {status}\r\nConnection: close\r\n");
        if with_length {
            head.push_str(&format!("Content-Length: {}\r\n", body.len()));
        }
        head.push_str("\r\n");
        let mut bytes = head.into_bytes();
        bytes.extend_from_slice(body);
        bytes
    }

    #[test]
    fn only_https_is_accepted() {
        assert!(check_url("https://raw.githubusercontent.com/a/b/main/swarm-extensions.json").is_ok());
        assert!(check_url("HTTPS://example.com/x.json").is_ok());
        for bad in ["http://example.com/x.json", "file:///etc/passwd", "example.com", "https://", ""] {
            assert!(check_url(bad).is_err(), "{bad:?} should be refused");
        }
    }

    #[tokio::test]
    async fn reads_a_small_reply() {
        let url = serve_once(reply("200 OK", br#"{"format":1}"#, true)).await;
        assert_eq!(fetch_text(&url).await.unwrap(), r#"{"format":1}"#);
    }

    #[tokio::test]
    async fn refuses_a_reply_that_says_it_is_too_large() {
        let body = vec![b'x'; MAX_BYTES + 1];
        let url = serve_once(reply("200 OK", &body, true)).await;
        assert!(fetch_text(&url).await.unwrap_err().contains("larger"));
    }

    /// No Content-Length: the limit still holds, counted as it arrives.
    #[tokio::test]
    async fn refuses_a_reply_that_turns_out_too_large() {
        let body = vec![b'x'; MAX_BYTES + 1];
        let url = serve_once(reply("200 OK", &body, false)).await;
        assert!(fetch_text(&url).await.unwrap_err().contains("larger"));
    }

    /// Code has its own, larger limit — and it holds.
    #[tokio::test]
    async fn code_is_held_to_its_own_limit() {
        let small = vec![b'x'; MAX_BYTES + 1];
        let url = serve_once(reply("200 OK", &small, true)).await;
        assert_eq!(fetch_bytes(&url, crate::extensions::store::MAX_CODE_BYTES).await.unwrap().len(), small.len());

        let big = vec![b'x'; crate::extensions::store::MAX_CODE_BYTES + 1];
        let url = serve_once(reply("200 OK", &big, false)).await;
        assert!(fetch_bytes(&url, crate::extensions::store::MAX_CODE_BYTES)
            .await
            .unwrap_err()
            .contains("larger"));
        assert!(read_code("http://example.com/hive.js").await.unwrap_err().contains("https://"));
    }

    #[tokio::test]
    async fn refuses_a_reply_that_is_not_a_success() {
        let url = serve_once(reply("404 Not Found", b"missing", true)).await;
        assert!(fetch_text(&url).await.unwrap_err().contains("404"));
    }

    /// This repository's own file, over the internet. Run by a person.
    #[tokio::test]
    #[ignore = "live: reaches raw.githubusercontent.com"]
    async fn reads_this_repositorys_file() {
        let text = read_source(
            "https://raw.githubusercontent.com/PeterPartridge/Swarm/main/swarm-extensions.json",
        )
        .await
        .expect("fetch");
        let offers = super::super::catalogue::read(&text, "0.1.0", &super::super::catalogue::built_in())
            .expect("reads");
        assert!(!offers.is_empty());
    }
}
