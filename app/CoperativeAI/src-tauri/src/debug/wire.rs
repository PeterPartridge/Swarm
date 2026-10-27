//! The Debug Adapter Protocol's wire format.
//!
//! DAP is JSON in an HTTP-ish envelope: a `Content-Length` header, a blank
//! line, then exactly that many **bytes** of JSON body.
//!
//! ```text
//! Content-Length: 119\r\n
//! \r\n
//! {"seq":1,"type":"request","command":"initialize", ... }
//! ```
//!
//! **Bytes, not characters.** A body with a non-ASCII character in a file path
//! — which is most of the reason this is worth a module of its own — has a
//! byte length larger than its character count, and reading by characters
//! desynchronises the stream permanently: every message after the first bad one
//! is garbage. The decoder below works in bytes throughout.
//!
//! **A read is not a message.** A pipe hands over whatever has arrived: half a
//! message, or three of them, or a header split across two reads. So decoding
//! is written as "take one whole message out of a buffer if there is one in
//! there", and the caller keeps feeding the buffer. Anything that assumed one
//! read equals one message would work in testing and fail under load, which is
//! the worst way for this to break.

/// Wraps a JSON body in the header the protocol expects.
pub fn frame(body: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(body.len() + 32);
    out.extend_from_slice(format!("Content-Length: {}\r\n\r\n", body.len()).as_bytes());
    out.extend_from_slice(body.as_bytes());
    out
}

/// What came out of a buffer.
#[derive(Debug, PartialEq, Eq)]
pub enum Decoded {
    /// One whole message, and how many bytes of the buffer it used.
    Message { body: String, used: usize },
    /// Not all here yet — keep reading.
    Incomplete,
    /// The stream is not DAP, and no amount of further reading will fix it.
    Bad(String),
}

/// Takes the first whole message out of `buf`, if there is one.
///
/// The caller drains `used` bytes and calls again — several messages can arrive
/// in a single read, and dropping the rest is a hang that looks like the adapter
/// went quiet.
pub fn decode(buf: &[u8]) -> Decoded {
    // The header block ends at the first blank line. `\r\n\r\n` is what the
    // spec says; `\n\n` is accepted too because more than one adapter emits it
    // and refusing would be pedantry that breaks real debuggers.
    let (head_end, body_at) = match find_header_end(buf) {
        Some(pair) => pair,
        None => {
            // A header this long is not a header. Without this an adapter that
            // never sends a blank line grows the buffer until the app dies.
            if buf.len() > MAX_HEADER {
                return Decoded::Bad("the adapter sent no DAP header".into());
            }
            return Decoded::Incomplete;
        }
    };

    let head = match std::str::from_utf8(&buf[..head_end]) {
        Ok(text) => text,
        Err(_) => return Decoded::Bad("the adapter's header was not text".into()),
    };

    let mut length: Option<usize> = None;
    for line in head.split("\r\n").flat_map(|l| l.split('\n')) {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Some((name, value)) = line.split_once(':') else {
            return Decoded::Bad(format!("a DAP header line had no colon: {line}"));
        };
        // Case-insensitive: the spec capitalises it, but this is the one place
        // where being strict buys nothing and costs a debugger.
        if name.trim().eq_ignore_ascii_case("Content-Length") {
            match value.trim().parse::<usize>() {
                Ok(n) => length = Some(n),
                Err(_) => return Decoded::Bad(format!("Content-Length was not a number: {value}")),
            }
        }
    }

    let Some(length) = length else {
        return Decoded::Bad("a DAP message arrived with no Content-Length".into());
    };
    if length > MAX_BODY {
        return Decoded::Bad(format!("a DAP message claimed to be {length} bytes"));
    }

    let end = body_at + length;
    if buf.len() < end {
        return Decoded::Incomplete;
    }
    match std::str::from_utf8(&buf[body_at..end]) {
        Ok(body) => Decoded::Message {
            body: body.to_string(),
            used: end,
        },
        Err(_) => Decoded::Bad("a DAP message body was not UTF-8".into()),
    }
}

/// A header block longer than this is a stream that is not DAP.
const MAX_HEADER: usize = 8 * 1024;
/// And a body longer than this is a bug somewhere, not a stack frame. Delve
/// will happily send a large `variables` response, so this is generous.
const MAX_BODY: usize = 64 * 1024 * 1024;

/// Where the header block ends, and where the body starts.
///
/// The two differ by the length of the separator, which is why this returns
/// both rather than making the caller guess which spelling was found.
fn find_header_end(buf: &[u8]) -> Option<(usize, usize)> {
    for i in 0..buf.len() {
        if buf[i..].starts_with(b"\r\n\r\n") {
            return Some((i, i + 4));
        }
        if buf[i..].starts_with(b"\n\n") {
            return Some((i, i + 2));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body_of(d: Decoded) -> String {
        match d {
            Decoded::Message { body, .. } => body,
            other => panic!("expected a message, got {other:?}"),
        }
    }

    #[test]
    fn a_message_goes_out_with_its_length_in_bytes() {
        let out = frame(r#"{"seq":1}"#);
        assert_eq!(out, b"Content-Length: 9\r\n\r\n{\"seq\":1}".to_vec());
    }

    #[test]
    fn a_whole_message_comes_back_out() {
        let buf = frame(r#"{"seq":1,"type":"request"}"#);
        let decoded = decode(&buf);
        assert_eq!(
            decoded,
            Decoded::Message {
                body: r#"{"seq":1,"type":"request"}"#.into(),
                used: buf.len(),
            }
        );
    }

    /// **The one that desynchronises the stream for good.** A path with an
    /// accent in it makes the byte length larger than the character count, and
    /// a decoder that counts characters takes the wrong number of bytes — then
    /// every message after it is misaligned.
    #[test]
    fn length_is_counted_in_bytes_not_characters() {
        let body = r#"{"path":"C:/répertoire/naïve.ts"}"#;
        assert!(body.len() > body.chars().count(), "the fixture must be multi-byte");

        let buf = frame(body);
        assert_eq!(body_of(decode(&buf)), body);

        // And the framed length really is the byte count.
        let header = String::from_utf8(buf[..20].to_vec()).unwrap();
        assert!(header.starts_with(&format!("Content-Length: {}", body.len())));
    }

    /// A pipe hands over whatever has arrived. Half a message must be waited
    /// for, not guessed at.
    #[test]
    fn a_partial_message_asks_for_more() {
        let buf = frame(r#"{"seq":1,"type":"event"}"#);
        assert_eq!(decode(&buf[..10]), Decoded::Incomplete, "header split");
        assert_eq!(decode(&buf[..buf.len() - 3]), Decoded::Incomplete, "body split");
    }

    /// **Several messages in one read is normal**, and dropping the extras is a
    /// hang that looks exactly like an adapter that went quiet.
    #[test]
    fn messages_are_taken_one_at_a_time_from_a_shared_buffer() {
        let mut buf = frame(r#"{"seq":1}"#);
        buf.extend(frame(r#"{"seq":2}"#));
        buf.extend(frame(r#"{"seq":3}"#));

        let mut seen = Vec::new();
        let mut rest = &buf[..];
        while let Decoded::Message { body, used } = decode(rest) {
            seen.push(body);
            rest = &rest[used..];
        }
        assert_eq!(seen, vec![r#"{"seq":1}"#, r#"{"seq":2}"#, r#"{"seq":3}"#]);
        assert!(rest.is_empty(), "the buffer should be fully consumed");
    }

    /// Some adapters separate with bare newlines. Refusing would be pedantry
    /// that breaks a real debugger for nothing.
    #[test]
    fn a_bare_newline_separator_is_accepted() {
        let body = r#"{"seq":7}"#;
        let mut buf = format!("Content-Length: {}\n\n", body.len()).into_bytes();
        buf.extend_from_slice(body.as_bytes());
        assert_eq!(body_of(decode(&buf)), body);
    }

    #[test]
    fn the_header_name_is_matched_case_insensitively() {
        let body = r#"{"seq":8}"#;
        let mut buf = format!("content-length: {}\r\n\r\n", body.len()).into_bytes();
        buf.extend_from_slice(body.as_bytes());
        assert_eq!(body_of(decode(&buf)), body);
    }

    /// Extra headers are allowed by the spec and sent in practice.
    #[test]
    fn other_headers_are_ignored_rather_than_refused() {
        let body = r#"{"seq":9}"#;
        let mut buf = format!(
            "Content-Type: application/vscode-jsonrpc; charset=utf-8\r\nContent-Length: {}\r\n\r\n",
            body.len()
        )
        .into_bytes();
        buf.extend_from_slice(body.as_bytes());
        assert_eq!(body_of(decode(&buf)), body);
    }

    /// A stream that is not DAP has to be reported rather than waited on
    /// forever — an adapter that printed a stack trace to stdout instead of
    /// speaking protocol is the common cause, and "it hung" is a useless thing
    /// to tell somebody about it.
    #[test]
    fn a_stream_that_is_not_dap_is_refused_rather_than_waited_on() {
        let noise = vec![b'x'; MAX_HEADER + 1];
        assert!(matches!(decode(&noise), Decoded::Bad(_)));

        let no_length = b"Content-Type: text/plain\r\n\r\n{}";
        assert!(matches!(decode(no_length), Decoded::Bad(_)));

        let nonsense = b"Content-Length: banana\r\n\r\n{}";
        assert!(matches!(decode(nonsense), Decoded::Bad(_)));
    }

    /// Short noise is still only "not yet" — a slow adapter must not be called
    /// broken before it has said anything.
    #[test]
    fn a_little_noise_is_still_only_incomplete() {
        assert_eq!(decode(b"Content-Len"), Decoded::Incomplete);
        assert_eq!(decode(b""), Decoded::Incomplete);
    }
}
