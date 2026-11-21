//! 临时目录与「解包安装」的磁盘语义。
//!
//! 安装系列时先解到同父目录下的隐藏 staging 目录，成功后一次 `rename` 到目标名：
//! 要么完整出现，要么什么都不留下，不会出现「半个系列」。

use std::path::{Path, PathBuf};

use super::archive;

/// 临时目录名前缀；清理守卫据此确认「这是我们自己建的」。
const TEMP_PREFIX: &str = "prismwright-bundle-";

fn unique_suffix() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{}-{nanos}", std::process::id())
}

/// 在系统临时目录下新建一个本次导入专用的目录。
pub fn make_temp_dir() -> Result<PathBuf, String> {
    let dir = std::env::temp_dir().join(format!("{TEMP_PREFIX}{}", unique_suffix()));
    std::fs::create_dir(&dir).map_err(|e| format!("创建临时目录失败：{e}"))?;
    Ok(dir)
}

/// 把明文 ZIP 解到一个**尚不存在**的目标目录。
///
/// 目标已存在时直接拒绝（导入绝不覆盖）；解压先落到同父目录的 staging，成功后再
/// `rename`，任一步失败都会清掉 staging。
pub fn extract_to_new_dir(plaintext: &[u8], dest: &Path) -> Result<Vec<String>, String> {
    if dest.exists() {
        return Err(format!("目标目录已存在：{}", dest.display()));
    }
    let parent = dest
        .parent()
        .ok_or_else(|| format!("目标目录没有父目录：{}", dest.display()))?;
    std::fs::create_dir_all(parent).map_err(|e| format!("建目录失败：{e}"))?;
    let name = dest
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("bundle");
    let staging = parent.join(format!(".{name}.importing-{}", unique_suffix()));

    match archive::extract_zip(plaintext, &staging) {
        Ok(entries) => {
            if let Err(e) = std::fs::rename(&staging, dest) {
                let _ = std::fs::remove_dir_all(&staging);
                return Err(format!("安装工程失败：{e}"));
            }
            Ok(entries)
        }
        Err(e) => {
            let _ = std::fs::remove_dir_all(&staging);
            Err(e)
        }
    }
}

/// 删除本模块创建的临时目录。
///
/// 只接受「直接位于系统临时目录下、且名字以 `prismwright-bundle-` 开头」的路径，
/// 防止别处传入任意目录把用户数据删掉。
pub fn cleanup_temp_dir(dir: &Path) -> Result<(), String> {
    let denied = || "拒绝删除非临时工程目录".to_string();
    let canon = std::fs::canonicalize(dir).map_err(|e| format!("目录不存在：{e}"))?;
    let temp_root = std::fs::canonicalize(std::env::temp_dir())
        .map_err(|e| format!("无法定位临时目录：{e}"))?;
    if canon.parent() != Some(temp_root.as_path()) {
        return Err(denied());
    }
    let name = canon
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(denied)?;
    if !name.starts_with(TEMP_PREFIX) {
        return Err(denied());
    }
    std::fs::remove_dir_all(&canon).map_err(|e| format!("清理临时目录失败：{e}"))
}

/// 删除一次**安装失败**的目标目录（[`extract_to_new_dir`] 的产物）。
///
/// 守卫：目录里必须同时有 `manifest.json` 与 `pack.json`。安装包必然带清单，而普通系列
/// 目录里没有 `manifest.json`，因此误传用户目录不会被递归删掉。
pub fn discard_install(dir: &Path) -> Result<(), String> {
    if !dir.join("manifest.json").is_file() || !dir.join("pack.json").is_file() {
        return Err("拒绝删除非安装产物目录".to_string());
    }
    std::fs::remove_dir_all(dir).map_err(|e| format!("清理安装目录失败：{e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("prismwright-install-test-{tag}-{}", unique_suffix()));
        std::fs::create_dir(&dir).unwrap();
        dir
    }

    #[test]
    fn discard_removes_install_output() {
        let dir = temp_dir("ok");
        std::fs::write(dir.join("manifest.json"), "{}").unwrap();
        std::fs::write(dir.join("pack.json"), "{}").unwrap();
        discard_install(&dir).unwrap();
        assert!(!dir.exists());
    }

    #[test]
    fn discard_refuses_normal_directory() {
        let dir = temp_dir("refuse");
        std::fs::write(dir.join("pack.json"), "{}").unwrap();
        assert!(discard_install(&dir).is_err());
        assert!(dir.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
