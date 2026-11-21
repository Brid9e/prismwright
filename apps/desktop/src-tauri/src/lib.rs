//! Prismwright 桌面端 Rust 宿主入口。
//!
//! 负责装配 Tauri 应用：注册文件系统相关插件（dialog / fs / opener / store），并把
//! [`commands`] 中的文件系统命令暴露给前端。前端封装见 `apps/desktop/src/tauri/pack-fs.ts`。
//!
//! 由 `main.rs` 通过 `prismwright_lib::run()` 调用。

pub mod bundle;
pub mod commands;
pub mod fs_util;

/// 构建并运行 Tauri 应用（阻塞至窗口关闭）。
///
/// `#[cfg_attr(mobile, tauri::mobile_entry_point)]` 使同一入口在移动端被标记为
/// 平台入口点；桌面端忽略该属性，行为不变。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        // 启动时定位随包带出的 ffmpeg（资源目录 / 开发目录）；没有就回退 PATH。
        .setup(|app| {
            commands::init_bundled_ffmpeg(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::pick_directory,
            commands::pick_file,
            commands::pick_save_file,
            commands::read_text_file,
            commands::write_text_file_atomic,
            commands::write_bytes_atomic,
            commands::write_file_at,
            commands::encode_webm,
            commands::encode_export,
            commands::ensure_dir,
            commands::copy_asset,
            commands::move_to_trash,
            commands::restore_from_trash,
            commands::purge_trash,
            commands::path_exists,
            commands::is_pack_dir,
            commands::read_asset_bytes,
            commands::read_file_bytes,
            commands::list_imported_themes,
            commands::install_theme,
            bundle::bundle_export,
            bundle::bundle_inspect,
            bundle::bundle_extract,
            bundle::bundle_install,
            bundle::bundle_cleanup,
            bundle::bundle_discard_install,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
