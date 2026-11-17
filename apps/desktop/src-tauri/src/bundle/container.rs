//! `.card` / `.cards` 容器头与加解密。
//!
//! 布局固定 20 字节头部 + AES-256-GCM 密文。

use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng, Payload},
    Aes256Gcm, Nonce,
};

const HEADER_LEN: usize = 20;
const NONCE_RANGE: std::ops::Range<usize> = 8..20;
const KEY_ID: u8 = 1;
const FLAG_ENCRYPTED: u8 = 1;
/// GCM 认证标签长度；比这更短的文件连解密尝试都不必做。
const TAG_LEN: usize = 16;

/// 编译期内嵌的 32 字节密钥（见设计文档 §5.1）。
///
/// 它只防「随手解压查看资源」，不承诺抵抗逆向——这一点在文档与界面里都不掩饰。
const KEY: [u8; 32] = [
    0x9e, 0x3b, 0x71, 0xd4, 0x55, 0xa8, 0x0c, 0x1f, 0x6a, 0xc2, 0x47, 0x8b, 0xe0, 0x39, 0x74, 0xda,
    0x12, 0x5f, 0x88, 0xb6, 0x23, 0xcd, 0x41, 0x97, 0x0a, 0xe5, 0x6c, 0x38, 0xbf, 0x52, 0x81, 0x7d,
];

pub const MAGIC: [u8; 4] = *b"BARA";
pub const FORMAT_VERSION: u8 = 1;
pub const KIND_CARD: u8 = 1;
pub const KIND_SERIES: u8 = 2;
pub const E_INVALID: &str = "E_BUNDLE_INVALID";

#[derive(Debug)]
pub struct Opened {
    pub kind: u8,
    pub plaintext: Vec<u8>,
}

/// 构造 AES-256-GCM 实例。密钥长度固定，构造不可能失败。
fn cipher() -> Aes256Gcm {
    Aes256Gcm::new_from_slice(&KEY).expect("32 字节密钥")
}

/// 把明文 ZIP 封装成 `.card` / `.cards` 字节流。
///
/// 每次调用都用新随机 nonce；头部前 8 字节作为 AAD，头部被改动则解密失败。
pub fn seal(kind: u8, plaintext: &[u8]) -> Result<Vec<u8>, String> {
    if kind != KIND_CARD && kind != KIND_SERIES {
        return Err("未知的工程文件类型".into());
    }
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let mut header = Vec::with_capacity(HEADER_LEN);
    header.extend_from_slice(&MAGIC);
    header.push(FORMAT_VERSION);
    header.push(kind);
    header.push(FLAG_ENCRYPTED);
    header.push(KEY_ID);
    header.extend_from_slice(nonce.as_slice());
    debug_assert_eq!(header.len(), HEADER_LEN);

    let ciphertext = cipher()
        .encrypt(
            &nonce,
            Payload {
                msg: plaintext,
                aad: &header[..8],
            },
        )
        .map_err(|_| "加密失败".to_string())?;
    let mut out = header;
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

/// 校验并打开一个工程文件字节流。
///
/// 任何结构或认证失败都返回 [`E_INVALID`]——调用方只需要一个「文件坏了」的信号，
/// 细分失败原因对用户没有意义。
pub fn open(bytes: &[u8]) -> Result<Opened, String> {
    let invalid = || E_INVALID.to_string();
    if bytes.len() < HEADER_LEN + TAG_LEN {
        return Err(invalid());
    }
    if bytes[..4] != MAGIC {
        return Err(invalid());
    }
    if bytes[4] != FORMAT_VERSION {
        return Err(invalid());
    }
    let kind = bytes[5];
    if kind != KIND_CARD && kind != KIND_SERIES {
        return Err(invalid());
    }
    if bytes[6] & FLAG_ENCRYPTED == 0 {
        return Err(invalid());
    }
    if bytes[7] != KEY_ID {
        return Err(invalid());
    }

    let nonce = Nonce::from_slice(&bytes[NONCE_RANGE]);
    let plaintext = cipher()
        .decrypt(
            nonce,
            Payload {
                msg: &bytes[HEADER_LEN..],
                aad: &bytes[..8],
            },
        )
        .map_err(|_| invalid())?;
    Ok(Opened { kind, plaintext })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seal_open_roundtrip() {
        let sealed = seal(KIND_SERIES, b"hello").unwrap();
        let opened = open(&sealed).unwrap();
        assert_eq!(opened.kind, KIND_SERIES);
        assert_eq!(opened.plaintext, b"hello");
    }

    #[test]
    fn seal_rejects_unknown_kind() {
        assert!(seal(9, b"x").is_err());
    }

    #[test]
    fn open_rejects_bad_magic() {
        let mut sealed = seal(KIND_CARD, b"x").unwrap();
        sealed[0] = b'X';
        assert_eq!(open(&sealed).unwrap_err(), E_INVALID);
    }

    #[test]
    fn open_rejects_truncated_file() {
        let sealed = seal(KIND_CARD, b"x").unwrap();
        assert_eq!(open(&sealed[..10]).unwrap_err(), E_INVALID);
    }

    #[test]
    fn open_rejects_tampered_ciphertext() {
        let mut sealed = seal(KIND_CARD, b"x").unwrap();
        let last = sealed.len() - 1;
        sealed[last] ^= 1;
        assert_eq!(open(&sealed).unwrap_err(), E_INVALID);
    }

    #[test]
    fn every_export_uses_a_fresh_nonce() {
        let a = seal(KIND_CARD, b"x").unwrap();
        let b = seal(KIND_CARD, b"x").unwrap();
        assert_ne!(a[8..20], b[8..20]);
    }
}
