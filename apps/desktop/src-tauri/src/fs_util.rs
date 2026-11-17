//! 系列内相对路径的安全拼接工具。
//!
//! 系列目录结构约定为「一个根目录 + 若干相对路径引用的资源文件」（见 `pack.json`
//! 里的 `front` / 图层 `mask` 等字段）。这些相对路径可能来自磁盘上被手工编辑过的
//! 数据，或前端传入的参数，因此视为**不可信输入**。本模块提供 [`safe_join`]，把相对
//! 路径解析到系列根目录之下，并拒绝任何 `..` 越界、绝对/带前缀写法，从源头防止读写到
//! 系列目录之外的文件。

use std::fs;
use std::path::{Component, Path, PathBuf};

/// 是否为 Windows 保留设备名（传入值需已去掉扩展名并转为大写）。
fn is_reserved_device_name(stem_upper: &str) -> bool {
    matches!(
        stem_upper,
        "CON" | "PRN" | "AUX" | "NUL"
            | "COM1" | "COM2" | "COM3" | "COM4" | "COM5" | "COM6" | "COM7" | "COM8" | "COM9"
            | "LPT1" | "LPT2" | "LPT3" | "LPT4" | "LPT5" | "LPT6" | "LPT7" | "LPT8" | "LPT9"
    )
}

/// 把系列内的相对路径安全地拼到根目录下。
///
/// 保证（词法层面）：返回值在 `root` 之下，不会逃逸出根目录。为此逐个解析路径段，
/// 拒绝下列任何一段：
/// - `..`：唯一的向上逃逸手段，直接拒绝而非「规范化后再校验前缀」；
/// - 绝对/带前缀段：`Path::new(comp).is_absolute()` 为真，或首组件是 `Component::Prefix`
///   （如 Windows 盘符 `C:`）或 `Component::RootDir`。否则在 Windows 上 `push("C:")`
///   会**替换**整个路径，使 `safe_join("D:\\root", "C:\\evil")` 逃出根目录；
/// - 任何含 `:` 的段：可移植地兜底 Windows 盘符与 NTFS 备用数据流（ADS）分隔符。
///   在类 Unix 上 `:` 是合法文件名字符，这里一并拒绝以换取跨平台一致的安全保证；
/// - 段尾为 `.` 或空格：Windows 打开文件时会静默去除，使校验期与实际落盘不一致；
/// - Windows 保留设备名（`CON` / `NUL` 等，含带扩展名形式）：会被重定向到设备而非普通文件。
///
/// 处理规则：
/// - 先把 Windows 反斜杠统一为 `/`，使跨平台存储的相对路径都能正确分段；
/// - 逐段解析，跳过空段与 `.`（兼容前导斜杠、`a//b` 等冗余写法）；
/// - 其余段一律 `push` 到根目录之下，因此绝对路径的前导 `/` 会被降级为相对段。
///
/// # 参数
/// - `root`：系列根目录（可信，由宿主选择）。
/// - `rel`：系列内相对路径（不可信，可能来自磁盘数据或前端）。
///
/// # 返回
/// - `Ok`：拼接并清洗后的路径（沿用 `root` 自身的形态，通常为绝对路径）。
/// - `Err`：当 `rel` 含越界段（`..` / 绝对 / 带前缀 / 含 `:`）时返回描述性错误信息。
pub fn safe_join(root: &Path, rel: &str) -> Result<PathBuf, String> {
    // 统一分隔符：Windows 上 `\` 是路径分隔符，但在类 Unix 上是合法文件名字符。
    // 系列相对路径在磁盘上以 `/` 存储，这里把两者归一，避免平台差异导致越界判定失效。
    let normalized = rel.replace('\\', "/");
    let mut out = root.to_path_buf();
    for comp in normalized.split('/') {
        // 跳过空段（前导/尾随/连续斜杠产生）与当前目录段，它们不影响最终路径。
        if comp.is_empty() || comp == "." {
            continue;
        }
        // `..` 是唯一能向上逃逸的手段：直接拒绝，不做宽松的「先规范化再看前缀」处理。
        if comp == ".." {
            return Err(format!("路径越界: {rel}"));
        }
        // 盘符 / ADS 分隔符：可移植地拒绝（Unix 上 `:` 通常合法，但跨平台保证优先）。
        if comp.contains(':') {
            return Err(format!("非法路径段 {comp:?}: {rel}"));
        }
        // Windows 打开文件时会静默去除段尾的 `.` 与空格，使校验期看到的段与实际落盘的段
        // 不一致（如 `".. "` 会被规范化为 `..` 从而完成越界）。故直接拒绝尾随点/空格。
        if comp.ends_with('.') || comp.ends_with(' ') {
            return Err(format!("非法路径段 {comp:?}: {rel}"));
        }
        // Windows 保留设备名（含带扩展名的形式，如 `CON.txt`）会重定向到设备而非普通文件，
        // 使写入落到意外目标。去掉扩展名后按大写比对，命中即拒绝。
        let stem = comp.split('.').next().unwrap_or(comp).to_ascii_uppercase();
        if is_reserved_device_name(&stem) {
            return Err(format!("保留设备名 {comp:?}: {rel}"));
        }
        // 绝对路径或带前缀段：Windows 上 `PathBuf::push` 遇到盘符会替换整个路径，必须拦截。
        let comp_path = Path::new(comp);
        if comp_path.is_absolute()
            || matches!(
                comp_path.components().next(),
                Some(Component::Prefix(_)) | Some(Component::RootDir)
            )
        {
            return Err(format!("非法路径段 {comp:?}: {rel}"));
        }
        out.push(comp);
    }
    Ok(out)
}

/// 原子写入的核心：先写同目录临时文件再重命名。
///
/// 之所以采用「temp + rename」：重命名在同一文件系统内是原子操作，因此无论进程在写入过程中
/// 何时崩溃，目标路径要么是旧内容、要么是新内容，不会出现损坏的 `pack.json`。临时文件与目标
/// 同目录（保证同一文件系统），文件名在扩展名后附加 pid + 纳秒，保证并发写同一目标时互不
/// 覆盖；任一步失败都会尽力删除临时文件，避免残留 `.tmp`。目标文件的父目录不存在时先递归创建。
///
/// 文本写入与二进制写入（[`write_bytes_atomic`]）共用此实现，故「原子性」这层保证只有一处。
///
/// # 参数
/// - `path`：目标文件路径（由调用方保证已在系列根目录之下）。
/// - `bytes`：要写入的完整字节。
///
/// # 错误
/// - 建目录 / 写临时文件 / 重命名失败时返回对应错误信息。
pub(crate) fn write_atomic_at(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("建目录失败: {e}"))?;
    }
    // 保留原扩展名（如 `.json`）再追加 `.<pid>.<nanos>.tmp`：既避免 `pack.json` 被替换成
    // 无扩展名的临时文件，又让并发写同一目标的临时文件名互不相同，不会相互覆盖。
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("bin");
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let tmp = path.with_extension(format!("{ext}.{}.{nanos}.tmp", std::process::id()));
    if let Err(e) = fs::write(&tmp, bytes) {
        let _ = fs::remove_file(&tmp);
        return Err(format!("写入临时文件失败: {e}"));
    }
    if let Err(e) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(format!("原子重命名失败: {e}"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `..` 越界（无论出现在开头还是穿插在中间）都必须被拒绝。
    #[test]
    fn rejects_parent_traversal() {
        assert!(safe_join(Path::new("/root"), "../etc/passwd").is_err());
        assert!(safe_join(Path::new("/root"), "assets/../../x").is_err());
    }

    /// 普通多级相对路径应被正确拼接到根目录之下。
    #[test]
    fn joins_nested_relative_path() {
        let p = safe_join(Path::new("/root"), "assets/cards/c1/front.png").unwrap();
        assert_eq!(p, PathBuf::from("/root/assets/cards/c1/front.png"));
    }

    /// 反斜杠与前导斜杠都应被归一化，结果不逃逸出根目录。
    #[test]
    fn normalizes_backslashes_and_leading_slash() {
        let p = safe_join(Path::new("/root"), "/assets\\back.png").unwrap();
        assert_eq!(p, PathBuf::from("/root/assets/back.png"));
    }

    /// 带盘符前缀的段必须被拒绝（否则 Windows 上 `push("C:")` 会替换整个路径而逃逸）。
    #[test]
    fn rejects_drive_prefixed_component() {
        assert!(safe_join(Path::new("/root"), "C:\\evil").is_err());
        assert!(safe_join(Path::new("/root"), "C:/evil").is_err());
    }

    /// 绝对路径的前导 `/` 应被降级为相对段，结果仍落在根目录内，不逃逸。
    #[test]
    fn neutralizes_absolute_rel() {
        let p = safe_join(Path::new("/root"), "/etc/passwd").unwrap();
        assert_eq!(p, PathBuf::from("/root/etc/passwd"));
    }

    /// 空相对路径返回根目录本身。
    #[test]
    fn empty_rel_returns_root() {
        assert_eq!(
            safe_join(Path::new("/root"), "").unwrap(),
            PathBuf::from("/root")
        );
    }

    /// 段尾的点/空格（Windows 会静默去除，导致校验与实际不一致）必须被拒绝。
    #[test]
    fn rejects_trailing_dot_or_space() {
        assert!(safe_join(Path::new("/root"), "assets/.. /x").is_err());
        assert!(safe_join(Path::new("/root"), "assets/a.").is_err());
    }

    /// Windows 保留设备名（含带扩展名形式）必须被拒绝。
    #[test]
    fn rejects_reserved_device_name() {
        assert!(safe_join(Path::new("/root"), "assets/CON").is_err());
        assert!(safe_join(Path::new("/root"), "NUL.txt").is_err());
    }
}
