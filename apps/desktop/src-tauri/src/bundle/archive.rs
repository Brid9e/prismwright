//! 工程文件的 ZIP 层：打包、清单读取与受限解压。
//!
//! 明文是一个普通 ZIP；本模块负责生成与消费它，并在这里集中所有路径安全与体积上限的
//! 校验——`container` 只管加密，不重复这些规则。

use std::collections::HashSet;
use std::fs::File;
use std::io::{Cursor, Read, Write};
use std::path::Path;

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use super::container::E_INVALID;

/// `manifest.json` 的最大读取长度；正常清单只有几百字节。
const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;

/// 解压条目数上限。
pub const MAX_ENTRIES: usize = 10_000;
/// 解压后总字节上限（2 GiB）。
pub const MAX_TOTAL_BYTES: u64 = 2 * 1024 * 1024 * 1024;

/// 打包条目的内容来源。
pub enum ZipSource {
    /// 系列根目录内的相对路径（用 `safe_join` 解析）。
    File(String),
    /// 直接给出的字节内容。
    Bytes(Vec<u8>),
}

/// 一个待写入 ZIP 的条目。
pub struct ZipEntry {
    /// ZIP 内的条目名，以 `/` 分隔的相对路径。
    pub name: String,
    /// 条目内容。
    pub source: ZipSource,
}

/// 校验 ZIP 条目名是否可安全落盘。
///
/// 拒绝绝对路径、盘符、`..`、空段与含 `:` 的段——与 `fs_util::safe_join` 的目标一致，
/// 这里先做一遍是为了在**打包**阶段就 fail-fast（解压阶段还会再经 `safe_join`）。
pub fn validate_entry_name(name: &str) -> Result<(), String> {
    let illegal = || format!("非法条目名：{name:?}");
    if name.is_empty()
        || name.contains('\0')
        || name.starts_with('/')
        || name.starts_with('\\')
        || name.as_bytes().get(1) == Some(&b':')
    {
        return Err(illegal());
    }
    for segment in name.split(['/', '\\']) {
        if segment.is_empty() || segment == "." || segment == ".." || segment.contains(':') {
            return Err(illegal());
        }
    }
    Ok(())
}

/// 按扩展名选择压缩方式：已是压缩格式的图片不再 deflate。
fn compression_for(name: &str) -> CompressionMethod {
    let ext = Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "png" | "jpg" | "jpeg" | "webp" | "gif" => CompressionMethod::Stored,
        _ => CompressionMethod::Deflated,
    }
}

/// 把条目打成 ZIP 字节流。`ZipSource::File` 的相对路径以 `root` 为根解析。
pub fn build_zip(root: &Path, entries: &[ZipEntry]) -> Result<Vec<u8>, String> {
    let mut seen = HashSet::new();
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    for entry in entries {
        validate_entry_name(&entry.name)?;
        if !seen.insert(entry.name.as_str()) {
            return Err(format!("条目名重复：{}", entry.name));
        }
        let options = SimpleFileOptions::default()
            .compression_method(compression_for(&entry.name))
            .unix_permissions(0o644);
        writer
            .start_file(entry.name.as_str(), options)
            .map_err(|e| format!("写入条目失败：{e}"))?;
        match &entry.source {
            ZipSource::Bytes(bytes) => writer
                .write_all(bytes)
                .map_err(|e| format!("写入条目失败：{e}"))?,
            ZipSource::File(rel) => {
                let path = crate::fs_util::safe_join(root, rel)?;
                let mut file =
                    File::open(&path).map_err(|e| format!("读取素材失败 {rel}：{e}"))?;
                std::io::copy(&mut file, &mut writer)
                    .map_err(|e| format!("写入条目失败 {rel}：{e}"))?;
            }
        }
    }
    let cursor = writer
        .finish()
        .map_err(|e| format!("完成压缩失败：{e}"))?;
    Ok(cursor.into_inner())
}

/// 读取 ZIP 里的 `manifest.json` 并返回（清单, 条目总数）。
///
/// 只用于 `inspect`（导入前预览），因此同样执行条目数与总字节上限，避免用「预览」绕过
/// 体积检查。
pub fn read_manifest(bytes: &[u8]) -> Result<(serde_json::Value, usize), String> {
    let invalid = || E_INVALID.to_string();
    let mut archive = ZipArchive::new(Cursor::new(bytes)).map_err(|_| invalid())?;
    let count = archive.len();
    if count > MAX_ENTRIES {
        return Err("工程文件条目过多".into());
    }
    let mut total = 0u64;
    let mut manifest = None;
    for index in 0..count {
        let mut file = archive.by_index(index).map_err(|_| invalid())?;
        if file.is_dir() {
            continue;
        }
        total = total.saturating_add(file.size());
        if total > MAX_TOTAL_BYTES {
            return Err("工程文件解压后过大".into());
        }
        if file.name() == "manifest.json" {
            let mut text = String::new();
            (&mut file)
                .take(MAX_MANIFEST_BYTES + 1)
                .read_to_string(&mut text)
                .map_err(|_| invalid())?;
            if text.len() as u64 > MAX_MANIFEST_BYTES {
                return Err(invalid());
            }
            manifest = Some(serde_json::from_str(&text).map_err(|_| invalid())?);
        }
    }
    manifest
        .map(|value| (value, count))
        .ok_or_else(invalid)
}

/// 以默认上限解压。
pub fn extract_zip(bytes: &[u8], dest: &Path) -> Result<Vec<String>, String> {
    extract_zip_with_limits(bytes, dest, MAX_ENTRIES, MAX_TOTAL_BYTES)
}

/// 解压到 `dest` 并返回写出的条目名。
///
/// 三条硬约束：条目数、解压后总字节、条目名不得逃出 `dest`。写入时用
/// `take(remaining + 1)` 流式截断，发现超限立刻删掉半成品并报错，避免先写满磁盘。
pub fn extract_zip_with_limits(
    bytes: &[u8],
    dest: &Path,
    max_entries: usize,
    max_bytes: u64,
) -> Result<Vec<String>, String> {
    std::fs::create_dir_all(dest).map_err(|e| format!("建目录失败：{e}"))?;
    let mut archive = ZipArchive::new(Cursor::new(bytes))
        .map_err(|_| E_INVALID.to_string())?;
    if archive.len() > max_entries {
        return Err("工程文件条目过多".into());
    }

    let mut total = 0u64;
    let mut written = Vec::new();
    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|_| E_INVALID.to_string())?;
        if file.is_dir() {
            continue;
        }
        // 符号链接会把后续写入导向目标目录之外，直接拒绝。
        if file
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err(format!("拒绝符号链接条目：{}", file.name()));
        }
        let name = file.name().to_string();
        validate_entry_name(&name)?;
        // 再经 safe_join 兜底：条目名的校验规则将来若松了口，这里仍不会越界。
        let out_path = crate::fs_util::safe_join(dest, &name)?;
        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("建目录失败：{e}"))?;
        }
        let mut out = File::create(&out_path).map_err(|e| format!("写入条目失败 {name}：{e}"))?;
        let remaining = max_bytes.saturating_sub(total);
        let copied = std::io::copy(&mut (&mut file).take(remaining + 1), &mut out)
            .map_err(|e| format!("写入条目失败 {name}：{e}"))?;
        if copied > remaining {
            drop(out);
            let _ = std::fs::remove_file(&out_path);
            return Err("工程文件解压后过大".into());
        }
        total += copied;
        written.push(name);
    }
    Ok(written)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};
    use zip::write::SimpleFileOptions;

    fn manifest_entry() -> ZipEntry {
        ZipEntry {
            name: "manifest.json".into(),
            source: ZipSource::Bytes(
                br#"{"format":"prismwright-bundle","version":1,"kind":"series"}"#.to_vec(),
            ),
        }
    }

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("prismwright-archive-test-{tag}-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn build_and_extract_roundtrip() {
        let dir = temp_dir("roundtrip");
        let zip = build_zip(
            &dir,
            &[
                manifest_entry(),
                ZipEntry {
                    name: "assets/a.png".into(),
                    source: ZipSource::Bytes(vec![1, 2, 3]),
                },
            ],
        )
        .unwrap();
        let names = extract_zip(&zip, &dir).unwrap();
        assert_eq!(names, vec!["manifest.json", "assets/a.png"]);
        assert_eq!(
            std::fs::read(dir.join("assets/a.png")).unwrap(),
            vec![1, 2, 3]
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_manifest_returns_value_and_count() {
        let zip = build_zip(&temp_dir("manifest"), &[manifest_entry()]).unwrap();
        let (manifest, count) = read_manifest(&zip).unwrap();
        assert_eq!(manifest["kind"], "series");
        assert_eq!(count, 1);
    }

    #[test]
    fn build_zip_rejects_duplicate_names() {
        assert!(
            build_zip(&temp_dir("duplicate"), &[manifest_entry(), manifest_entry()]).is_err()
        );
    }

    #[test]
    fn extract_rejects_parent_traversal() {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        writer
            .start_file("../evil.txt", SimpleFileOptions::default())
            .unwrap();
        writer.write_all(b"x").unwrap();
        let zip = writer.finish().unwrap().into_inner();
        let dir = temp_dir("traversal");
        assert!(extract_zip(&zip, &dir).is_err());
        assert!(!dir.parent().unwrap().join("evil.txt").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn extract_rejects_too_many_entries() {
        let dir = temp_dir("count");
        let zip = build_zip(
            &dir,
            &[
                manifest_entry(),
                ZipEntry {
                    name: "a".into(),
                    source: ZipSource::Bytes(vec![0]),
                },
                ZipEntry {
                    name: "b".into(),
                    source: ZipSource::Bytes(vec![0]),
                },
            ],
        )
        .unwrap();
        assert!(extract_zip_with_limits(&zip, &dir, 2, MAX_TOTAL_BYTES).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn extract_rejects_exceeding_total_bytes() {
        let dir = temp_dir("bytes");
        let zip = build_zip(
            &dir,
            &[
                manifest_entry(),
                ZipEntry {
                    name: "big".into(),
                    source: ZipSource::Bytes(vec![0; 64]),
                },
            ],
        )
        .unwrap();
        assert!(extract_zip_with_limits(&zip, &dir, MAX_ENTRIES, 10).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn build_zip_reads_file_sources_under_root() {
        let dir = temp_dir("file-source");
        std::fs::create_dir_all(dir.join("assets")).unwrap();
        std::fs::write(dir.join("assets/logo.png"), [7u8, 8]).unwrap();
        let zip = build_zip(
            &dir,
            &[
                manifest_entry(),
                ZipEntry {
                    name: "assets/logo.png".into(),
                    source: ZipSource::File("assets/logo.png".into()),
                },
            ],
        )
        .unwrap();
        let out = temp_dir("file-source-out");
        extract_zip(&zip, &out).unwrap();
        assert_eq!(
            std::fs::read(out.join("assets/logo.png")).unwrap(),
            vec![7, 8]
        );
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&out);
    }

    #[test]
    fn build_zip_rejects_source_escaping_root() {
        let dir = temp_dir("escape");
        let err = build_zip(
            &dir,
            &[
                manifest_entry(),
                ZipEntry {
                    name: "evil.txt".into(),
                    source: ZipSource::File("../secret".into()),
                },
            ],
        )
        .unwrap_err();
        assert!(!err.is_empty(), "{err}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn validate_entry_name_rejects_absolute_and_drive_paths() {
        assert!(validate_entry_name("/etc/passwd").is_err());
        assert!(validate_entry_name(r"C:\Windows\win.ini").is_err());
        assert!(validate_entry_name("a/../../b").is_err());
        assert!(validate_entry_name("assets/图 1.png").is_ok());
    }
}
