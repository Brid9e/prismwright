//! `.card` / `.cards` 工程文件：容器、ZIP 与面向 Tauri 的命令。
//!
//! 分层：`container` 只管头部与加解密，`archive` 只管 ZIP 与路径/体积校验，本模块
//! 把两者串成「导出 / 检查 / 解包 / 安装」四类命令，并保持薄——schema 校验与 ID 重铸
//! 都在前端完成。

pub mod archive;
pub mod container;
pub mod install;

use std::path::Path;

use serde::{Deserialize, Serialize};

/// 导出时前端给出的一个条目。`source` 与 `contents` 必须恰好给一个。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleEntry {
    /// ZIP 内的条目名（`/` 分隔的相对路径）。
    pub name: String,
    /// 系列根目录内的相对路径；由 Rust 用 `safe_join` 解析。
    pub source: Option<String>,
    /// 直接给出的文本内容（`manifest.json` / `card.json`）。
    pub contents: Option<String>,
}

/// `bundle_export` 的返回值。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleExportResult {
    /// 写出的文件字节数。
    pub bytes: u64,
    /// ZIP 条目数。
    pub entry_count: usize,
}

/// 解包 / 安装命令的返回值。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleExtractResult {
    /// 解包后的目录；`bundle_extract` 是临时目录，`bundle_install` 是目标目录。
    pub dir: String,
    /// 明文 ZIP 里的 `manifest.json`。
    pub manifest: serde_json::Value,
    /// 写出的条目名。
    pub entries: Vec<String>,
}

/// `bundle_inspect` 的返回值。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleInfo {
    /// 容器头里的类型：1 单卡、2 系列。
    pub kind: u8,
    /// 明文 ZIP 里的 `manifest.json`。
    pub manifest: serde_json::Value,
    /// 工程文件本身的字节数。
    pub size: u64,
    /// ZIP 条目数。
    pub entry_count: usize,
}

/// 校验清单的基本结构与类型。失败一律折叠成 [`container::E_INVALID`]。
fn validate_manifest(manifest: &serde_json::Value, kind: u8) -> Result<(), String> {
    let invalid = || container::E_INVALID.to_string();
    if manifest["format"] != "cardbara-bundle" || manifest["version"] != 1 {
        return Err(invalid());
    }
    let expected = if kind == container::KIND_CARD {
        "card"
    } else {
        "series"
    };
    if manifest["kind"] != expected {
        return Err(invalid());
    }
    Ok(())
}

/// 同步导出：条目表 → ZIP → 加密 → 原子落盘。
pub(crate) fn export_bundle(
    kind: u8,
    root_dir: &Path,
    out_path: &str,
    entries: Vec<BundleEntry>,
) -> Result<BundleExportResult, String> {
    if kind != container::KIND_CARD && kind != container::KIND_SERIES {
        return Err("未知的工程文件类型".into());
    }
    let mut manifest_count = 0usize;
    let mut zip_entries = Vec::with_capacity(entries.len());
    for entry in entries {
        if entry.name == "manifest.json" {
            manifest_count += 1;
        }
        let source = match (entry.source, entry.contents) {
            (Some(path), None) => archive::ZipSource::File(path),
            (None, Some(text)) => archive::ZipSource::Bytes(text.into_bytes()),
            _ => {
                return Err(format!(
                    "条目 {} 必须且只能提供 source 或 contents 之一",
                    entry.name
                ))
            }
        };
        zip_entries.push(archive::ZipEntry {
            name: entry.name,
            source,
        });
    }
    if manifest_count != 1 {
        return Err("工程文件必须包含且只包含一个 manifest.json".into());
    }

    let zip = archive::build_zip(root_dir, &zip_entries)?;
    let sealed = container::seal(kind, &zip)?;
    let bytes = sealed.len() as u64;
    crate::fs_util::write_atomic_at(Path::new(out_path), &sealed)?;
    Ok(BundleExportResult {
        bytes,
        entry_count: zip_entries.len(),
    })
}

/// 同步检查：解密、读清单、校验类型。只读，不落盘。
pub(crate) fn inspect_bundle(path: &str) -> Result<BundleInfo, String> {
    let data = std::fs::read(path).map_err(|e| format!("读取工程文件失败：{e}"))?;
    let opened = container::open(&data)?;
    let (manifest, entry_count) = archive::read_manifest(&opened.plaintext)?;
    validate_manifest(&manifest, opened.kind)?;
    Ok(BundleInfo {
        kind: opened.kind,
        manifest,
        size: data.len() as u64,
        entry_count,
    })
}

/// 同步解包到临时目录；失败时清掉临时目录，不留下半成品。
pub(crate) fn extract_bundle(path: &str) -> Result<BundleExtractResult, String> {
    let data = std::fs::read(path).map_err(|e| format!("读取工程文件失败：{e}"))?;
    let opened = container::open(&data)?;
    let (manifest, _) = archive::read_manifest(&opened.plaintext)?;
    validate_manifest(&manifest, opened.kind)?;

    let temp = install::make_temp_dir()?;
    match archive::extract_zip(&opened.plaintext, &temp) {
        Ok(entries) => Ok(BundleExtractResult {
            dir: temp.to_string_lossy().into_owned(),
            manifest,
            entries,
        }),
        Err(e) => {
            let _ = install::cleanup_temp_dir(&temp);
            Err(e)
        }
    }
}

/// 同步安装到目标目录；目标已存在时**不读文件**直接拒绝。
pub(crate) fn install_bundle(path: &str, dest: &str) -> Result<BundleExtractResult, String> {
    let dest_path = Path::new(dest);
    if dest_path.exists() {
        return Err(format!("目标目录已存在：{dest}"));
    }
    let data = std::fs::read(path).map_err(|e| format!("读取工程文件失败：{e}"))?;
    let opened = container::open(&data)?;
    let (manifest, _) = archive::read_manifest(&opened.plaintext)?;
    validate_manifest(&manifest, opened.kind)?;

    let entries = install::extract_to_new_dir(&opened.plaintext, dest_path)?;
    Ok(BundleExtractResult {
        dir: dest.to_string(),
        manifest,
        entries,
    })
}

/// 同步清理临时目录（只做路径守卫，不要求清单仍可解析）。
pub(crate) fn cleanup_bundle(dir: &str) -> Result<(), String> {
    install::cleanup_temp_dir(Path::new(dir))
}

/// 删除安装失败的目标目录（守卫见 [`install::discard_install`]）。
pub(crate) fn discard_bundle_install(dir: &str) -> Result<(), String> {
    install::discard_install(Path::new(dir))
}

/// 导出工程文件的 Tauri 命令（实现见 [`export_bundle`]）。
#[tauri::command]
pub async fn bundle_export(
    kind: u8,
    root_dir: String,
    out_path: String,
    entries: Vec<BundleEntry>,
) -> Result<BundleExportResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        export_bundle(kind, Path::new(&root_dir), &out_path, entries)
    })
    .await
    .map_err(|e| format!("后台任务失败：{e}"))?
}

/// 检查工程文件的 Tauri 命令（实现见 [`inspect_bundle`]）。
#[tauri::command]
pub async fn bundle_inspect(path: String) -> Result<BundleInfo, String> {
    tauri::async_runtime::spawn_blocking(move || inspect_bundle(&path))
        .await
        .map_err(|e| format!("后台任务失败：{e}"))?
}

/// 解包到临时目录的 Tauri 命令。
#[tauri::command]
pub async fn bundle_extract(path: String) -> Result<BundleExtractResult, String> {
    tauri::async_runtime::spawn_blocking(move || extract_bundle(&path))
        .await
        .map_err(|e| format!("后台任务失败：{e}"))?
}

/// 安装到目标目录的 Tauri 命令。
#[tauri::command]
pub async fn bundle_install(path: String, dest: String) -> Result<BundleExtractResult, String> {
    tauri::async_runtime::spawn_blocking(move || install_bundle(&path, &dest))
        .await
        .map_err(|e| format!("后台任务失败：{e}"))?
}

/// 清理临时目录的 Tauri 命令。
#[tauri::command]
pub async fn bundle_cleanup(dir: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || cleanup_bundle(&dir))
        .await
        .map_err(|e| format!("后台任务失败：{e}"))?
}

/// 删除安装失败的目标目录的 Tauri 命令。
#[tauri::command]
pub async fn bundle_discard_install(dir: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || discard_bundle_install(&dir))
        .await
        .map_err(|e| format!("后台任务失败：{e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_path(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("cardbara-bundle-test-{tag}-{nanos}"))
    }

    fn manifest(kind: &str) -> String {
        format!(
            r#"{{"format":"cardbara-bundle","version":1,"kind":"{kind}","createdAt":"2026-11-06T00:00:00.000Z","appVersion":"0.1.0"}}"#
        )
    }

    fn sample_entries() -> Vec<BundleEntry> {
        vec![
            BundleEntry {
                name: "manifest.json".into(),
                source: None,
                contents: Some(manifest("series")),
            },
            BundleEntry {
                name: "pack.json".into(),
                source: None,
                contents: Some("{}".into()),
            },
        ]
    }

    #[test]
    fn export_then_inspect_roundtrips() {
        let out = temp_path("roundtrip").with_extension("cards");
        let result = export_bundle(
            container::KIND_SERIES,
            std::path::Path::new(""),
            out.to_str().unwrap(),
            sample_entries(),
        )
        .unwrap();
        assert_eq!(result.entry_count, 2);
        let info = inspect_bundle(out.to_str().unwrap()).unwrap();
        assert_eq!(info.kind, container::KIND_SERIES);
        assert_eq!(info.manifest["kind"], "series");
        assert_eq!(info.entry_count, 2);
        let _ = std::fs::remove_file(out);
    }

    #[test]
    fn export_requires_manifest() {
        let mut entries = sample_entries();
        entries.remove(0);
        let out = temp_path("no-manifest").with_extension("cards");
        assert!(export_bundle(
            container::KIND_SERIES,
            std::path::Path::new(""),
            out.to_str().unwrap(),
            entries
        )
        .is_err());
    }

    #[test]
    fn export_rejects_source_outside_root() {
        let out = temp_path("source-escape").with_extension("cards");
        let mut entries = sample_entries();
        entries.push(BundleEntry {
            name: "evil.txt".into(),
            source: Some("../evil.txt".into()),
            contents: None,
        });
        assert!(export_bundle(
            container::KIND_SERIES,
            std::path::Path::new(""),
            out.to_str().unwrap(),
            entries
        )
        .is_err());
    }

    #[test]
    fn extract_then_cleanup_removes_temp_dir() {
        let out = temp_path("extract").with_extension("cards");
        export_bundle(container::KIND_SERIES, std::path::Path::new(""), out.to_str().unwrap(), sample_entries()).unwrap();
        let result = extract_bundle(out.to_str().unwrap()).unwrap();
        assert!(std::path::Path::new(&result.dir).join("pack.json").exists());
        cleanup_bundle(&result.dir).unwrap();
        assert!(!std::path::Path::new(&result.dir).exists());
        let _ = std::fs::remove_file(out);
    }

    #[test]
    fn install_refuses_existing_destination() {
        let out = temp_path("install").with_extension("cards");
        export_bundle(container::KIND_SERIES, std::path::Path::new(""), out.to_str().unwrap(), sample_entries()).unwrap();
        let dest = temp_path("dest");
        std::fs::create_dir_all(&dest).unwrap();
        let err = install_bundle(out.to_str().unwrap(), dest.to_str().unwrap()).unwrap_err();
        assert!(err.contains("已存在"), "{err}");
        let _ = std::fs::remove_dir_all(&dest);
        let _ = std::fs::remove_file(out);
    }

    #[test]
    fn cleanup_refuses_non_bundle_directory() {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        // 故意不用 cardbara-bundle- 前缀，验证守卫不只看父目录。
        let dir = std::env::temp_dir().join(format!("cardbara-keep-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(cleanup_bundle(dir.to_str().unwrap()).is_err());
        assert!(dir.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn inspect_rejects_manifest_kind_mismatch() {
        let out = temp_path("mismatch").with_extension("cards");
        // 头部声明为单卡，清单却写着 series：必须拒绝。
        export_bundle(
            container::KIND_CARD,
            std::path::Path::new(""),
            out.to_str().unwrap(),
            sample_entries(),
        )
        .unwrap();
        let result = inspect_bundle(out.to_str().unwrap());
        assert_eq!(result.unwrap_err(), container::E_INVALID);
        let _ = std::fs::remove_file(out);
    }
}
