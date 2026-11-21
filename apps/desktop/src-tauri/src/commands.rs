//! Tauri 文件系统命令集：前端与本地磁盘之间的唯一通道。
//!
//! 架构位置：位于 Rust 宿主与 React 前端的边界，所有对文件系统的读写都经由这里的
//! `#[tauri::command]` 暴露给前端（前端封装见 `apps/desktop/src/tauri/pack-fs.ts`，
//! 二者一一对应）。命令本身保持「薄」——只做 IO 与错误转换，业务语义留在前端。
//!
//! 关键约定：
//! - **原子写入**：`pack.json` 这类核心文件用「临时文件 + 重命名」落盘，避免写到
//!   一半崩溃导致文件损坏（见 [`write_text_file_atomic`]）。
//! - **回收站**：删除不走 `fs::remove_file`，而是把文件挪进系列内的 `.trash/<token>/`，
//!   支持撤销（见 [`move_to_trash`] / [`restore_from_trash`]）。
//! - **路径安全**：任何系列内相对路径都经 [`safe_join`] 解析，拒绝 `..` 越界。

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

use crate::fs_util::{safe_join, write_atomic_at};

/// 原生文件选择框的过滤器：一个显示名 + 一组扩展名。
///
/// 与前端 `pack-fs.ts` 的 `FileFilter` 对应；由前端传入、经 serde 反序列化。
#[derive(Deserialize)]
pub struct FileFilter {
    /// 过滤器在对话框中显示的名称（如 "Card Series"）。
    pub name: String,
    /// 允许的扩展名列表，**不含前导点**（如 `["json", "zip"]`）。
    pub extensions: Vec<String>,
}

/// 弹出原生目录选择框，返回用户选中的绝对路径；取消则返回 `None`。
///
/// **必须为 `async`**：`blocking_pick_folder` 会在当前线程上 `recv` 等待对话框回调，
/// 而该回调由主线程驱动。Tauri 的**同步**命令运行在主线程上，若在此同步阻塞，主线程
/// 便无法派发对话框事件，导致调用永久挂起（表现为点「选择目录」后界面卡死）。
/// 改为 `async` 后命令被派发到异步运行时线程，主线程得以空闲处理对话框事件。
#[tauri::command]
pub async fn pick_directory(app: AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .blocking_pick_folder()
        .map(|p| p.to_string())
}

/// 弹出原生文件选择框，返回用户选中的绝对路径；取消则返回 `None`。
///
/// 同 [`pick_directory`]：命令须为 `async`，否则 `blocking_pick_file` 会阻塞主线程而卡死。
///
/// # 参数
/// - `filters`：可选的文件类型过滤器；传入多个时在对话框中并列显示。
#[tauri::command]
pub async fn pick_file(app: AppHandle, filters: Option<Vec<FileFilter>>) -> Option<String> {
    let mut dialog = app.dialog().file();
    if let Some(list) = filters {
        for f in list {
            let exts: Vec<&str> = f.extensions.iter().map(|s| s.as_str()).collect();
            dialog = dialog.add_filter(&f.name, &exts);
        }
    }
    dialog.blocking_pick_file().map(|p| p.to_string())
}

/// 弹出原生「另存为」对话框，返回用户选定的绝对路径；取消则返回 `None`。
///
/// 与 [`pick_file`] 同为 `async`（`blocking_*` 会 `recv` 等待主线程派发的对话框事件，同步阻塞会卡死）。
///
/// # 参数
/// - `default_name`：预填的文件名（如 `card-星辰之约.gif`）。
/// - `filters`：可选的文件类型过滤器。
#[tauri::command]
pub async fn pick_save_file(
    app: AppHandle,
    default_name: String,
    filters: Option<Vec<FileFilter>>,
) -> Option<String> {
    let mut dialog = app.dialog().file().set_file_name(&default_name);
    if let Some(list) = filters {
        for f in list {
            let exts: Vec<&str> = f.extensions.iter().map(|s| s.as_str()).collect();
            dialog = dialog.add_filter(&f.name, &exts);
        }
    }
    dialog.blocking_save_file().map(|p| p.to_string())
}

/// 以 UTF-8 读取文本文件；失败时把路径拼进错误信息，便于定位。
///
/// # 参数
/// - `path`：要读取的文件绝对路径。
///
/// # 返回
/// - `Ok`：文件的完整文本内容。
///
/// # 错误
/// - 文件不存在 / 无权限 / 内容非 UTF-8 时返回带路径的错误信息。
#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("读取失败 {path}: {e}"))
}

/// 原子地写入文本文件（核心保证见 [`write_atomic_at`]）。
///
/// # 参数
/// - `path`：目标文件绝对路径。
/// - `contents`：要写入的完整文本内容。
///
/// # 返回
/// - `Ok`：内容已原子落盘。
///
/// # 错误
/// - 建目录 / 写临时文件 / 重命名失败时返回对应错误信息。
#[tauri::command]
pub fn write_text_file_atomic(path: String, contents: String) -> Result<(), String> {
    write_atomic_at(Path::new(&path), contents.as_bytes())
}

/// 百分号解码（`encodeURIComponent` 的逆运算），用于从 IPC 请求头还原路径。
///
/// 请求头值只能是 ASCII，而系列路径可能含非 ASCII（如中文用户名下的目录），故发送端用
/// `encodeURIComponent` 编码、此处还原：`%XX` 解成对应字节，其余原样。非法转义按字面保留——
/// 宁可拼出一个不存在的路径交给 [`safe_join`] / IO 报错，也不在此处做额外的容错猜测。
fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (
                (bytes[i + 1] as char).to_digit(16),
                (bytes[i + 2] as char).to_digit(16),
            ) {
                out.push((hi * 16 + lo) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// 从请求头读取一个百分号编码的字符串型参数，解码后返回。
fn header_str(request: &tauri::ipc::Request<'_>, name: &str) -> Result<String, String> {
    request
        .headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(percent_decode)
        .ok_or_else(|| format!("缺少或非法的请求头 {name}"))
}

/// 把原始字节原子写入系列内的文件（核心保证见 [`write_atomic_at`]）。
///
/// 与 [`write_text_file_atomic`] 共用同一套原子策略，区别只在数据来源与传输通道：预览资产
/// （PNG / WebM 帧）是**二进制且体积较大**，故走 Tauri 的原始请求体通道——前端
/// `invoke(cmd, bytes, { headers })` 把整段字节作为 body 发送，避免 `Vec<u8>` 被序列化成 JSON
/// 数字数组（一张百 KB 的 PNG 会膨胀数倍，60 帧更甚）。原始体通道下没有具名参数，故
/// `pack_root` 与 `rel` 经请求头传入（`encodeURIComponent` 编码以承载非 ASCII 路径），此处
/// 解码后仍走 [`safe_join`] 做越界校验，安全不变量与其它命令保持一致。
///
/// # 请求头
/// - `x-pack-root`：系列根目录绝对路径（百分号编码）。
/// - `x-rel`：系列内目标相对路径（百分号编码）。
///
/// # 请求体
/// - 要写入的原始字节。
///
/// # 错误
/// - 请求体不是原始字节、缺少请求头、路径越界、写盘失败时返回对应错误信息。
#[tauri::command]
pub fn write_bytes_atomic(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("write_bytes_atomic 需要原始字节请求体".into());
    };
    let pack_root = header_str(&request, "x-pack-root")?;
    let rel = header_str(&request, "x-rel")?;
    let dest = safe_join(Path::new(&pack_root), &rel)?;
    write_atomic_at(&dest, data)
}

/// 把原始字节原子写入**任意绝对路径**（供导出产物落到用户经「另存为」选定的位置）。
///
/// 与 [`write_bytes_atomic`] 的唯一区别是**不做 `safe_join`**：那条只允许写进系列之内，本条面向
/// 系列之外的绝对路径。与 [`write_text_file_atomic`] 同属开放写入口——那条早已接受任意绝对路径，
/// 本条不新增权限面；信任边界落在前端（只传系统保存对话框的返回值，Rust 侧无从校验）。故直接按
/// 绝对路径写入，不再拼接根目录。
///
/// 走原始请求体通道（同 `write_bytes_atomic`）：导出 PNG 可能上百 KB，避免被序列化成 JSON 数字数组。
///
/// # 请求头
/// - `x-path`：目标绝对路径（百分号编码）。
///
/// # 请求体
/// - 要写入的原始字节。
#[tauri::command]
pub fn write_file_at(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("write_file_at 需要原始字节请求体".into());
    };
    let path = header_str(&request, "x-path")?;
    write_atomic_at(Path::new(&path), data)
}

/// 用系统 ffmpeg 把一串 PNG 帧编码成带透明通道的 WebM（VP9 / yuva420p）。
///
/// 之所以在 Rust 侧组装 ffmpeg 的参数、而不是从前端传整条命令行：命令与参数完全由本程序
/// 决定，前端只给「帧目录 / 输出路径 / 帧率」三个语义参数——避免把「任意进程执行」的口子
/// 开给前端。`pack_root` 与两个相对路径经 [`safe_join`] 校验，帧与产物都落在系列之内。
///
/// ffmpeg 的定位：先看 `CARDBARA_FFMPEG` 环境变量，缺省用 PATH 上的 `ffmpeg`。之所以留这个
/// 变量——macOS 上由 Finder 启动的 GUI 进程其 PATH 往往不含 Homebrew，届时用绝对路径兜底。
///
/// 编码参数里 `-pix_fmt yuva420p` 与 `-auto-alt-ref 0` 是透明通道的关键：VP9 的 alpha 平面
/// 会被 alternate reference 帧破坏，必须关掉。`-y` 允许覆盖既有产物。
///
/// 帧只是编码的中间产物：编码结束后（无论成败）尽力删除帧目录，不在系列里留残留。
///
/// # 参数
/// - `pack_root`：系列根目录。
/// - `frames_rel`：帧目录在系列内的相对路径（帧按 `frame_0001.png`… 递增命名）。
/// - `output_rel`：产物 WebM 在系列内的相对路径。
/// - `framerate`：帧率（本工程用 24）。
///
/// # 错误
/// - 路径越界、ffmpeg 不存在或返回非零、产物父目录不可建时返回对应错误信息。
#[tauri::command]
pub async fn encode_webm(
    pack_root: String,
    frames_rel: String,
    output_rel: String,
    framerate: u32,
) -> Result<(), String> {
    // ffmpeg 是阻塞的外部进程，放到阻塞线程池上跑，免得占住异步运行时的工作线程。
    tauri::async_runtime::spawn_blocking(move || {
        let root = Path::new(&pack_root);
        let frames_dir = safe_join(root, &frames_rel)?;
        let output = safe_join(root, &output_rel)?;
        let result = encode_webm_blocking(&frames_dir, &output, framerate);
        // 帧为中间产物，编码结束后一并清掉（尽力而为，失败只记日志不影响结果）。
        if let Err(e) = fs::remove_dir_all(&frames_dir) {
            eprintln!("清理帧目录失败 {}: {e}", frames_dir.display());
        }
        result
    })
    .await
    .map_err(|e| format!("ffmpeg 任务异常: {e}"))?
}

/// 内置 ffmpeg 相对资源根的位置（`tauri.conf.json` 的 `bundle.resources` 把它映射到 `ffmpeg/`）。
#[cfg(windows)]
const BUNDLED_FFMPEG_REL: &str = "ffmpeg/ffmpeg.exe";
#[cfg(not(windows))]
const BUNDLED_FFMPEG_REL: &str = "ffmpeg/ffmpeg";

/// 启动时解析出的内置 ffmpeg 路径（没有则为 `None`）。只初始化一次，全部编码共用。
static BUNDLED_FFMPEG: std::sync::OnceLock<Option<PathBuf>> = std::sync::OnceLock::new();

/// 解析内置 ffmpeg 的位置：应用资源目录优先，其次开发时的 `src-tauri/binaries/ffmpeg/`。
///
/// 装好的应用里资源目录一定在；`tauri dev` 下资源未必被拷进 target，故用编译期目录兜底。
/// 已经存在的那份会被记进 [`BUNDLED_FFMPEG`]；两份都没有就保持 `None`，运行期回退 PATH。
///
/// 由 `lib.rs` 的 `.setup(...)` 在启动时调用一次。
pub fn init_bundled_ffmpeg(app: &AppHandle) {
    let installed = app
        .path()
        .resource_dir()
        .ok()
        .map(|dir| dir.join(BUNDLED_FFMPEG_REL));
    let dev = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join("ffmpeg")
        .join(if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" });
    let found = [installed, Some(dev)]
        .into_iter()
        .flatten()
        .find(|p| p.is_file());
    let _ = BUNDLED_FFMPEG.set(found);
}

/// 在「环境变量 → 内置二进制 → PATH」之间选一个 ffmpeg 可执行名。
///
/// 抽成纯函数是为了能单测优先级：`exists` 由调用方给（真实实现是 `Path::is_file`），
/// 都不命中时返回 `"ffmpeg"`，让 `Command` 去 PATH 上找——与引入内置前的行为一致。
fn pick_ffmpeg(env: Option<&str>, candidates: &[PathBuf], exists: impl Fn(&Path) -> bool) -> String {
    if let Some(p) = env.map(str::trim).filter(|p| !p.is_empty()) {
        return p.to_string();
    }
    for c in candidates {
        if exists(c) {
            return c.to_string_lossy().into_owned();
        }
    }
    "ffmpeg".to_string()
}

/// ffmpeg 的可执行路径/名：`CARDBARA_FFMPEG` → 内置二进制 → PATH 上的 `ffmpeg`。
///
/// 内置二进制是随安装包带出来的 LGPL 构建（见 `scripts/fetch-ffmpeg.mjs`），用户不必自己装；
/// `CARDBARA_FFMPEG` 仍保留最高优先级，方便临时换成别的构建（取舍见 [`encode_webm`]）。
fn ffmpeg_program() -> String {
    let env = std::env::var("CARDBARA_FFMPEG").ok();
    let bundled: Vec<PathBuf> = BUNDLED_FFMPEG
        .get()
        .and_then(|p| p.clone())
        .into_iter()
        .collect();
    pick_ffmpeg(env.as_deref(), &bundled, |p| p.is_file())
}

/// 让子进程不出控制台窗口。
///
/// Windows 上从 GUI 程序（本项目是 Tauri）起一个控制台程序（`ffmpeg.exe` / `node.exe`），
/// 默认会新建一个黑框控制台窗口——GIF 两遍编码就弹两次。加 `CREATE_NO_WINDOW` 创建标志后
/// 子进程照常运行，只是没有窗口。其它平台没有这个概念，这里什么都不做。
fn hide_console(_cmd: &mut std::process::Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        /// 不创建控制台窗口（Win32 `CREATE_NO_WINDOW`）。
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        _cmd.creation_flags(CREATE_NO_WINDOW);
    }
}

/// 起一次 ffmpeg 进程并检查退出码；参数已是完整列表（本工程不做 shell，避免注入面）。
///
/// # 错误
/// - 进程起不来（未安装 / 路径错）或返回非零时，返回带 stderr 摘要的错误信息。
fn run_ffmpeg(program: &str, args: &[String]) -> Result<(), String> {
    let mut cmd = std::process::Command::new(program);
    cmd.args(args);
    hide_console(&mut cmd);
    let out = cmd.output().map_err(|e| {
        format!("无法启动 ffmpeg（{program}）：{e}。请确认已安装 ffmpeg，或用 CARDBARA_FFMPEG 指定其绝对路径。")
    })?;
    if !out.status.success() {
        return Err(format!(
            "ffmpeg 编码失败: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(())
}

/// [`encode_webm`] 的阻塞实现：拼好 ffmpeg 的参数列表并交给 [`run_ffmpeg`]。
fn encode_webm_blocking(frames_dir: &Path, output: &Path, framerate: u32) -> Result<(), String> {
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("建产物目录失败: {e}"))?;
    }
    let program = ffmpeg_program();
    // 帧名形如 `frame_0001.png`：`%04d` 是 ffmpeg image2 读取器的序号占位。
    let pattern = frames_dir.join("frame_%04d.png");
    run_ffmpeg(
        &program,
        &[
            "-y".into(),
            "-loglevel".into(),
            "error".into(),
            "-framerate".into(),
            framerate.to_string(),
            "-i".into(),
            pattern.to_string_lossy().into_owned(),
            "-c:v".into(),
            "libvpx-vp9".into(),
            "-pix_fmt".into(),
            "yuva420p".into(),
            "-auto-alt-ref".into(),
            "0".into(),
            output.to_string_lossy().into_owned(),
        ],
    )
}

/// 导出编码：把系列内的一串帧编码成 GIF 或 WebM，落到用户经「另存为」选定的绝对路径。
///
/// 与 [`encode_webm`]（后台预览用）并列：那条固定产出透明 VP9 WebM 到**系列内**；本条服务主动
/// 导出，格式 / 帧率 / 质量由前端选择，产物写到**系列之外**的用户自选路径。
///
/// 命令与参数依旧在 Rust 侧组装（前端只传语义参数），不开「任意进程执行」的口子。格式字符串在
/// 此处白名单校验，颜色数 / CRF 在各自的阻塞实现里校验范围。
///
/// 帧是中间产物：编码结束后（无论成败）尽力删除帧目录，不在系列里留残留。删的是 `frames_rel`
/// 解析出的**整个目录**，故调用方必须只传导出专用的帧目录（前端 `EXPORT_FRAMES_DIR`，与按卡派生的
/// 后台预览帧目录分开），否则会误删预览流水线正在用的帧。
///
/// # 参数
/// - `pack_root`：系列根目录（帧目录的相对路径以此为基准，经 [`safe_join`] 校验）。
/// - `frames_rel`：帧目录在系列内的相对路径（帧按 `frame_0001.png`… 命名）。
/// - `out_path`：产物**绝对路径**（来自「另存为」，不做 `safe_join`）。
/// - `format`：`"gif"` | `"webm"`。
/// - `framerate`：帧率。
/// - `quality`：GIF 为调色板色数（2–256），WebM 为 CRF（0–63）。
/// - `dither`：GIF 是否启用抖动（WebM 忽略）。
/// - `transparent`：是否保留透明通道（GIF 用；WebM 恒为 yuva420p）。
#[tauri::command]
pub async fn encode_export(
    pack_root: String,
    frames_rel: String,
    out_path: String,
    format: String,
    framerate: u32,
    quality: i64,
    dither: bool,
    transparent: bool,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = Path::new(&pack_root);
        let frames_dir = safe_join(root, &frames_rel)?;
        let output = Path::new(&out_path);
        let result = match format.as_str() {
            "gif" => {
                encode_gif_blocking(&frames_dir, output, framerate, quality, dither, transparent)
            }
            "webm" => encode_webm_export_blocking(&frames_dir, output, framerate, quality),
            other => Err(format!("不支持的导出格式: {other}")),
        };
        // 帧为中间产物，编码结束后一并清掉（尽力而为，失败只记日志不影响结果）。
        if let Err(e) = fs::remove_dir_all(&frames_dir) {
            eprintln!("清理帧目录失败 {}: {e}", frames_dir.display());
        }
        result
    })
    .await
    .map_err(|e| format!("编码任务异常: {e}"))?
}

/// [`encode_export`] 的 GIF 实现：两遍 `palettegen` / `paletteuse`。
///
/// 第一遍统计整段帧的全局调色板（`stats_mode=diff` 偏向帧间差异）；透明背景须开
/// `reserve_transparent`，否则透明像素会占掉一种颜色、把其它颜色挤出调色板。第二遍用该调色板
/// 量化每一帧；抖动开时用 `sierra2_4a`（观感细腻），关时 `none`（色块更硬、体积更小）。
/// `-loop 0` 让 GIF 无限循环。调色板是中间产物，放在帧目录内，随帧目录一并清理。
fn encode_gif_blocking(
    frames_dir: &Path,
    output: &Path,
    framerate: u32,
    colors: i64,
    dither: bool,
    transparent: bool,
) -> Result<(), String> {
    if !(2..=256).contains(&colors) {
        return Err(format!("GIF 色数越界: {colors}（应在 2–256）"));
    }
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("建产物目录失败: {e}"))?;
    }
    let program = ffmpeg_program();
    let pattern = frames_dir.join("frame_%04d.png");
    let palette = frames_dir.join("palette.png");
    let reserve = if transparent { 1 } else { 0 };

    // 第一遍：全局调色板。
    run_ffmpeg(
        &program,
        &[
            "-y".into(),
            "-loglevel".into(),
            "error".into(),
            "-framerate".into(),
            framerate.to_string(),
            "-i".into(),
            pattern.to_string_lossy().into_owned(),
            "-vf".into(),
            format!("palettegen=max_colors={colors}:reserve_transparent={reserve}:stats_mode=diff"),
            palette.to_string_lossy().into_owned(),
        ],
    )?;

    // 第二遍：按调色板量化。透明时加 alpha_threshold，把近透明像素归为全透明（GIF 只有 1 位透明）。
    let use_dither = if dither { "sierra2_4a" } else { "none" };
    let mut filter = format!("paletteuse=dither={use_dither}");
    if transparent {
        filter.push_str(":alpha_threshold=128");
    }
    run_ffmpeg(
        &program,
        &[
            "-y".into(),
            "-loglevel".into(),
            "error".into(),
            "-framerate".into(),
            framerate.to_string(),
            "-i".into(),
            pattern.to_string_lossy().into_owned(),
            "-i".into(),
            palette.to_string_lossy().into_owned(),
            "-lavfi".into(),
            filter,
            "-loop".into(),
            "0".into(),
            output.to_string_lossy().into_owned(),
        ],
    )
}

/// [`encode_export`] 的 WebM 实现：VP9 / yuva420p，`-crf` 取质量。
///
/// `-pix_fmt yuva420p` 与 `-auto-alt-ref 0` 是透明通道的关键（VP9 的 alpha 平面会被 alternate
/// reference 帧破坏，必须关掉），与 [`encode_webm_blocking`] 一致，只是多一个 `-crf`。
fn encode_webm_export_blocking(
    frames_dir: &Path,
    output: &Path,
    framerate: u32,
    crf: i64,
) -> Result<(), String> {
    if !(0..=63).contains(&crf) {
        return Err(format!("WebM CRF 越界: {crf}（应在 0–63）"));
    }
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("建产物目录失败: {e}"))?;
    }
    let program = ffmpeg_program();
    let pattern = frames_dir.join("frame_%04d.png");
    run_ffmpeg(
        &program,
        &[
            "-y".into(),
            "-loglevel".into(),
            "error".into(),
            "-framerate".into(),
            framerate.to_string(),
            "-i".into(),
            pattern.to_string_lossy().into_owned(),
            "-c:v".into(),
            "libvpx-vp9".into(),
            "-pix_fmt".into(),
            "yuva420p".into(),
            "-auto-alt-ref".into(),
            "0".into(),
            "-crf".into(),
            crf.to_string(),
            output.to_string_lossy().into_owned(),
        ],
    )
}

#[tauri::command]
pub fn ensure_dir(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| format!("建目录失败 {path}: {e}"))
}

/// 把外部资源文件拷贝进系列，返回落盘后的绝对路径。
///
/// `rel` 为目标相对路径（相对 `pack_root`），经 [`safe_join`] 清洗以防止越界写入。
///
/// # 参数
/// - `src`：源文件绝对路径（通常来自 [`pick_file`]）。
/// - `pack_root`：系列根目录。
/// - `rel`：资源在系列内的目标相对路径。
#[tauri::command]
pub fn copy_asset(src: String, pack_root: String, rel: String) -> Result<String, String> {
    let dest = safe_join(Path::new(&pack_root), &rel)?;
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("建目录失败: {e}"))?;
    }
    fs::copy(&src, &dest).map_err(|e| format!("拷贝失败 {src} -> {}: {e}", dest.display()))?;
    Ok(dest.to_string_lossy().to_string())
}

/// 生成回收站条目标识：`UNIX_EPOCH` 起的纳秒数，零填充到固定 20 位。
///
/// **不变量**：固定宽度 + 纯数字 ⇒ 字典序与时间序一致（[`purge_trash`] 依赖该性质判定
/// 新旧）。纳秒精度配合调用顺序，足以避免「同一毫秒内连续删除」时的 token 冲突。
fn trash_token() -> Result<String, String> {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    Ok(format!("{nanos:020}"))
}

/// 把系列内的文件移入系列自带的 `.trash/<token>/`，返回用于撤销的 `token`。
///
/// 之所以自建回收站而非直接删除：编辑器需要支持「删除后撤销」。每个删除动作分配一个
/// 独立的 `<token>` 目录（token 为固定宽度的纳秒时间戳），原文件挪到 `<token>/payload`，
/// 并在 `<token>/meta.json` 记录原始相对路径，供 [`restore_from_trash`] 还原。
/// **顺序保证**：先落 `meta.json` 再搬 `payload`——若元数据写失败，文件仍在原处，不会出现
/// 「文件已挪走却无记录」的不可恢复状态；反之若搬 payload 失败，则回滚整个回收站目录。
/// 优先用 `rename`（同文件系统内为原子、且不占额外空间）；跨设备失败时回退为「拷贝 + 删源」。
///
/// # 参数
/// - `pack_root`：系列根目录。
/// - `rel`：要删除的文件在系列内的相对路径。
///
/// # 返回
/// - `Ok`：本次删除分配的回收站 `token`，供撤销时传给 [`restore_from_trash`]。
///
/// # 错误
/// - 路径越界、建回收站 / 写元数据 / 搬运文件失败时返回错误；失败时不留半成品回收站目录。
#[tauri::command]
pub fn move_to_trash(pack_root: String, rel: String) -> Result<String, String> {
    let root = Path::new(&pack_root);
    let src = safe_join(root, &rel)?;
    let token = trash_token()?;
    let trash_dir = root.join(".trash").join(&token);
    fs::create_dir_all(&trash_dir).map_err(|e| format!("建回收站失败: {e}"))?;

    // 先写元数据：这是「文件已被移走」的凭证。此步失败则直接放弃，源文件毫发无损。
    let meta = serde_json::json!({ "rel": rel }).to_string();
    if let Err(e) = fs::write(trash_dir.join("meta.json"), meta) {
        let _ = fs::remove_dir_all(&trash_dir);
        return Err(format!("写回收站元数据失败: {e}"));
    }

    // 再搬 payload；任一步失败都回滚回收站目录，返回错误让用户知晓删除未生效。
    let payload = trash_dir.join("payload");
    if let Err(rename_err) = fs::rename(&src, &payload) {
        // 跨文件系统时 rename 会失败，退化为拷贝后删源。
        if let Err(copy_err) = fs::copy(&src, &payload) {
            let _ = fs::remove_dir_all(&trash_dir);
            return Err(format!(
                "移入回收站失败（rename: {rename_err}; copy: {copy_err}）"
            ));
        }
        if let Err(e) = fs::remove_file(&src) {
            let _ = fs::remove_dir_all(&trash_dir);
            return Err(format!("删除原文件失败: {e}"));
        }
    }
    Ok(token)
}

/// 依据 `token` 把先前移入回收站的文件还原到系列内的 `rel` 位置。
///
/// **不覆盖**：若 `dest` 已存在（例如撤销前又新建了同名文件），直接报错而非覆盖——撤销
/// 不得摧毁更新的文件。回收站目录仅在还原成功后清理；失败时保留，便于用户重试。
///
/// # 参数
/// - `pack_root`：系列根目录。
/// - `token`：[`move_to_trash`] 返回的回收站条目标识。
/// - `rel`：还原到系列内的相对路径（经 [`safe_join`] 清洗）。
///
/// # 返回
/// - `Ok`：文件已还原到 `rel` 且回收站目录已清理。
///
/// # 错误
/// - 路径越界、目标已存在、建目录 / 搬运失败时返回错误；失败时回收站目录保持原样以便重试。
#[tauri::command]
pub fn restore_from_trash(pack_root: String, token: String, rel: String) -> Result<(), String> {
    let root = Path::new(&pack_root);
    let trash_dir = root.join(".trash").join(&token);
    let src = trash_dir.join("payload");
    let dest = safe_join(root, &rel)?;
    // 撤销不得覆盖更新的文件：目标已存在即拒绝，交由前端提示用户。
    if dest.exists() {
        return Err(format!("还原失败：目标已存在 {}", dest.display()));
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("建目录失败: {e}"))?;
    }
    match fs::rename(&src, &dest) {
        Ok(_) => {}
        Err(_) => {
            // 同上：跨文件系统时回退为拷贝。
            fs::copy(&src, &dest).map_err(|e| format!("恢复失败: {e}"))?;
        }
    }
    // 仅在成功还原后清理回收站目录；上述任一步失败都已提前返回，目录保持原样。
    let _ = fs::remove_dir_all(&trash_dir);
    Ok(())
}

/// 从回收站条目中挑选应删除的项：保留「最新」的 `keep` 个，返回其余（较旧）项。
///
/// **不变量**：token 为固定宽度零填充数字 ⇒ 按文件名字典序排序即等于时间序，故排序后
/// 末尾 `keep` 个为最新项，前面的是可清理的旧项。纯函数，便于单测。
fn select_purgeable(mut entries: Vec<PathBuf>, keep: usize) -> Vec<PathBuf> {
    if entries.len() <= keep {
        return Vec::new();
    }
    entries.sort();
    let remove_count = entries.len() - keep;
    entries.drain(..remove_count).collect()
}

/// 清理回收站，按目录名排序后仅保留最近的 `keep` 项，其余递归删除。
///
/// **不变量**：目录名是 [`trash_token`] 生成的固定宽度数字 ⇒ 字典序 == 时间序（二者必须
/// 保持同步，改动 token 格式时须同步更新此处）。仅纳入「全为 ASCII 数字」的目录名，避免
/// 杂项条目干扰排序或被误删。单个条目删除失败不阻断整体清理。
///
/// # 参数
/// - `pack_root`：系列根目录。
/// - `keep`：保留的最近条目数量；其余全部清除。
///
/// # 返回
/// - `Ok`：清理完成（单个条目失败会被忽略）。
///
/// # 错误
/// - `.trash` 存在但无法读取时返回错误。
#[tauri::command]
pub fn purge_trash(pack_root: String, keep: usize) -> Result<(), String> {
    let trash = Path::new(&pack_root).join(".trash");
    if !trash.exists() {
        return Ok(());
    }
    let entries: Vec<PathBuf> = fs::read_dir(&trash)
        .map_err(|e| format!("读取回收站失败: {e}"))?
        .filter_map(|e| e.ok().map(|e| e.path()))
        // 只认固定宽度数字 token 目录；其余条目（杂项/半成品）既不参与排序也不被删除。
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
        })
        .collect();
    for path in select_purgeable(entries, keep) {
        let _ = fs::remove_dir_all(&path);
    }
    Ok(())
}

/// 判断给定路径是否存在（文件或目录皆视为存在）。
///
/// # 参数
/// - `path`：待检测的路径。
///
/// # 返回
/// - 路径存在返回 `true`，否则 `false`。
///
/// # 错误
/// - 本命令为纯探测，不返回错误（不存在亦返回 `false`）。
#[tauri::command]
pub fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

/// 判断给定路径是否为系列目录：以其中是否含 `pack.json` 为判据。
///
/// # 参数
/// - `path`：待检测的目录路径。
///
/// # 返回
/// - 该目录下存在 `pack.json` 文件时返回 `true`，否则 `false`。
///
/// # 错误
/// - 本命令为纯探测，不返回错误。
#[tauri::command]
pub fn is_pack_dir(path: String) -> bool {
    Path::new(&path).join("pack.json").is_file()
}

/// 读取系列内某个资源文件的原始字节。
///
/// 与 [`copy_asset`] 对称：`rel` 是不可信的系列内相对路径，必须先经 [`safe_join`]
/// 校验，避免渲染热路径变成任意文件读取的口子。
fn read_asset_at(pack_root: &Path, rel: &str) -> Result<Vec<u8>, String> {
    let path = safe_join(pack_root, rel)?;
    fs::read(&path).map_err(|e| format!("读取资源失败 {rel}: {e}"))
}

/// 读取系列内资源文件，返回裸字节供前端构造纹理。
///
/// 之所以返回 [`tauri::ipc::Response`] 而非 `Vec<u8>`：后者会被序列化成 JSON 数字
/// 数组，一张 2 MB 的 PNG 会膨胀成约 7 MB 文本，而图片读取是导入与切卡时的热路径。
/// `Response` 走二进制通道，前端直接得到 `ArrayBuffer`。
///
/// # 参数
/// - `pack_root`：系列根目录（可信，由宿主选择）。
/// - `rel`：资源在系列内的相对路径（不可信）。
///
/// # 错误
/// - 路径越界、文件不存在或无权限时返回错误。
#[tauri::command]
pub fn read_asset_bytes(pack_root: String, rel: String) -> Result<tauri::ipc::Response, String> {
    read_asset_at(Path::new(&pack_root), &rel).map(tauri::ipc::Response::new)
}

/// 读取**任意绝对路径**文件的原始字节（导入源图在系列之外，无法走 [`read_asset_bytes`]）。
///
/// 与 [`write_file_at`] 对称：不做 `safe_join`，信任边界落在前端（只传系统文件框的返回值）。
/// 走 `Response` 的二进制通道，理由同 [`read_asset_bytes`]。
///
/// # 参数
/// - `path`：源文件绝对路径。
///
/// # 错误
/// - 文件不存在、无权限或超过 256 MB 时返回错误；前端据此退回原样拷贝。
#[tauri::command]
pub fn read_file_bytes(path: String) -> Result<tauri::ipc::Response, String> {
    const MAX_READ_BYTES: u64 = 256 * 1024 * 1024;
    let meta = fs::metadata(&path).map_err(|e| format!("读取失败: {e}"))?;
    if meta.len() > MAX_READ_BYTES {
        return Err(format!("文件过大: {} 字节", meta.len()));
    }
    let bytes = fs::read(&path).map_err(|e| format!("读取失败: {e}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// 一个导入主题文件：文件名 + 原始 JSON 文本。
///
/// `rename_all = "camelCase"`：Tauri 只对**入参**做 camelCase↔snake_case 映射，返回值按
/// serde 字段名原样序列化；此处显式改名为 `fileName`，与前端 `theme-fs.ts` 对齐。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedThemeFile {
    pub file_name: String,
    pub contents: String,
}

/// 由主题 id 派生落盘文件名，并做字符校验。
///
/// id 是**不可信输入**（来自用户导入的 JSON），必须挡在拼接路径之前：只允许 ASCII 小写
/// 字母、数字、连字符，长度 1–64，杜绝 `../`、盘符、空白等越界手段。
fn theme_file_name(id: &str) -> Result<String, String> {
    let ok = !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
    if !ok {
        return Err(format!("主题 id 非法: {id}"));
    }
    Ok(format!("{id}.json"))
}

/// 应用数据目录下的 `themes/` 子目录（**不**创建；写盘时再 `create_dir_all`）。
fn themes_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("取应用数据目录失败: {e}"))?;
    Ok(base.join("themes"))
}

/// 读取一个主题目录下的所有 `*.json`：返回文件名 + 文本，按文件名排序。
///
/// 目录不存在视为空列表；单个文件读不动（权限 / 编码）则跳过——一个坏文件不该瘫掉整个列表。
fn read_theme_dir(dir: &Path) -> Result<Vec<ImportedThemeFile>, String> {
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| format!("读取主题目录失败: {e}"))? {
        let path = match entry {
            Ok(e) => e.path(),
            Err(_) => continue,
        };
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let file_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        if let Ok(contents) = fs::read_to_string(&path) {
            out.push(ImportedThemeFile {
                file_name,
                contents,
            });
        }
    }
    out.sort_by(|a, b| a.file_name.cmp(&b.file_name));
    Ok(out)
}

/// 列出应用数据目录 `themes/` 下的所有主题文件。
///
/// # 错误
/// - 取应用数据目录失败、目录存在但不可读时返回错误。
#[tauri::command]
pub fn list_imported_themes(app: AppHandle) -> Result<Vec<ImportedThemeFile>, String> {
    read_theme_dir(&themes_dir(&app)?)
}

/// 把一个主题装入应用数据目录 `themes/<id>.json`（覆盖同名）。
///
/// 先校验 id 字符，再用与 `pack.json` 相同的原子写入策略落盘。
///
/// # 参数
/// - `id`：主题 id（`[a-z0-9-]`）。
/// - `contents`：归一后的主题 JSON 文本。
///
/// # 错误
/// - id 非法、建目录 / 写盘失败时返回错误。
#[tauri::command]
pub fn install_theme(app: AppHandle, id: String, contents: String) -> Result<(), String> {
    let dir = themes_dir(&app)?;
    let name = theme_file_name(&id)?;
    fs::create_dir_all(&dir).map_err(|e| format!("建主题目录失败: {e}"))?;
    write_text_file_atomic(dir.join(name).to_string_lossy().to_string(), contents)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// GIF 色数越界必须被拒（在启动 ffmpeg 之前就返回错误）。
    #[test]
    fn gif_rejects_out_of_range_colors() {
        let root = unique_temp_dir("gif-colors");
        let out = root.join("o.gif");
        assert!(encode_gif_blocking(&root, &out, 24, 1, true, false).is_err());
        assert!(encode_gif_blocking(&root, &out, 24, 300, true, false).is_err());
        let _ = fs::remove_dir_all(&root);
    }

    /// WebM CRF 越界必须被拒。
    #[test]
    fn webm_rejects_out_of_range_crf() {
        let root = unique_temp_dir("webm-crf");
        let out = root.join("o.webm");
        assert!(encode_webm_export_blocking(&root, &out, 24, 64).is_err());
        let _ = fs::remove_dir_all(&root);
    }

    /// ffmpeg 可执行名：`CARDBARA_FFMPEG` 优先，否则回退 PATH 上的 `ffmpeg`。
    #[test]
    fn ffmpeg_program_prefers_env_var() {
        // 不设环境变量时返回默认名（测试进程一般不设 CARDBARA_FFMPEG）。
        if std::env::var("CARDBARA_FFMPEG").is_err() {
            assert_eq!(ffmpeg_program(), "ffmpeg");
        }
    }

    /// 环境变量优先于内置二进制：用户显式指定时不该被包里的那份盖掉。
    #[test]
    fn pick_ffmpeg_env_wins_over_bundled() {
        let bundled = Path::new("/app/ffmpeg").to_path_buf();
        let picked = pick_ffmpeg(Some("/custom/ffmpeg"), &[bundled], |_| true);
        assert_eq!(picked, "/custom/ffmpeg");
    }

    /// 空字符串等同于没设：Windows 上 `set CARDBARA_FFMPEG=` 很常见。
    #[test]
    fn pick_ffmpeg_ignores_blank_env() {
        let bundled = Path::new("/app/ffmpeg").to_path_buf();
        assert_eq!(pick_ffmpeg(Some("  "), &[bundled], |_| true), "/app/ffmpeg");
    }

    /// 候选里只认存在的那个；顺序即优先级（资源目录先于开发目录）。
    #[test]
    fn pick_ffmpeg_takes_first_existing_candidate() {
        let resource = Path::new("/installed/ffmpeg").to_path_buf();
        let dev = Path::new("/repo/ffmpeg").to_path_buf();
        let picked = pick_ffmpeg(None, &[resource, dev], |p| p == Path::new("/repo/ffmpeg"));
        assert_eq!(picked, "/repo/ffmpeg");
    }

    /// 一个都没有时回退 PATH 上的 `ffmpeg`，与改动前的行为一致。
    #[test]
    fn pick_ffmpeg_falls_back_to_path() {
        assert_eq!(pick_ffmpeg(None, &[], |_| false), "ffmpeg");
    }

    /// 回收站测试用的唯一临时目录，避免并行测试相互干扰。
    fn unique_temp_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "holo-trash-test-{tag}-{}-{nanos}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// 构造回收站条目路径，便于喂给 `select_purgeable`。
    fn entry(name: &str) -> PathBuf {
        Path::new("/root/.trash").join(name)
    }

    /// 百分号解码：ASCII、非 ASCII（UTF-8 多字节）、以及非法转义按字面保留。
    #[test]
    fn percent_decode_handles_ascii_utf8_and_invalid() {
        assert_eq!(percent_decode("assets/a.png"), "assets/a.png");
        // `%2F` → `/`；`%20` → 空格。
        assert_eq!(percent_decode("a%2Fb%20c"), "a/b c");
        // 中文「卡」= E5 8D A1，`encodeURIComponent("卡")` 即 `%E5%8D%A1`。
        assert_eq!(percent_decode("%E5%8D%A1"), "卡");
        // 非法转义（非十六进制 / 截断）不 panic，原样保留。
        assert_eq!(percent_decode("100%zz"), "100%zz");
        assert_eq!(percent_decode("trailing%"), "trailing%");
        assert_eq!(percent_decode("%A"), "%A");
    }

    /// 二进制原子写入：落盘内容与输入一致（走与文本写入共用的 [`write_atomic_at`]）。
    #[test]
    fn write_atomic_at_writes_exact_bytes() {
        let root = unique_temp_dir("write-bytes");
        let dest = root.join("nested/dir/out.bin");
        write_atomic_at(&dest, &[0u8, 1, 2, 255]).unwrap();
        assert_eq!(fs::read(&dest).unwrap(), vec![0, 1, 2, 255]);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn trash_token_is_fixed_width_digits() {
        let token = trash_token().unwrap();
        assert_eq!(token.len(), 20, "token 应为固定 20 位以便字典序 == 时间序");
        assert!(token.bytes().all(|b| b.is_ascii_digit()));
    }

    /// 保留最新 `keep` 个：喂入乱序的定宽数字名，应选中较旧者删除。
    #[test]
    fn select_purgeable_keeps_newest() {
        let entries = vec![
            entry("00000000000000000100"),
            entry("00000000000000000002"),
            entry("00000000000000000050"),
            entry("00000000000000000001"),
        ];
        let removed = select_purgeable(entries, 2);
        let mut names: Vec<String> = removed
            .iter()
            .map(|p| p.file_name().unwrap().to_str().unwrap().to_string())
            .collect();
        names.sort();
        assert_eq!(
            names,
            vec![
                "00000000000000000001".to_string(),
                "00000000000000000002".to_string()
            ]
        );
    }

    #[test]
    fn select_purgeable_keeps_all_when_under_limit() {
        let entries = vec![entry("00000000000000000002"), entry("00000000000000000001")];
        assert!(select_purgeable(entries, 5).is_empty());
    }

    /// move_to_trash 落盘后应同时具备 meta.json 与 payload，且源文件已离开原位。
    #[test]
    fn move_to_trash_writes_meta_and_payload() {
        let root = unique_temp_dir("move");
        fs::write(root.join("a.txt"), b"hi").unwrap();
        let token = move_to_trash(root.to_string_lossy().to_string(), "a.txt".into()).unwrap();
        let entry_dir = root.join(".trash").join(&token);
        assert!(entry_dir.join("meta.json").is_file());
        assert!(entry_dir.join("payload").is_file());
        assert!(!root.join("a.txt").exists());
        let _ = fs::remove_dir_all(&root);
    }

    /// restore 不得覆盖已存在（更新）的文件，且失败时回收站条目保持原样。
    #[test]
    fn restore_refuses_to_overwrite_existing() {
        let root = unique_temp_dir("restore-conflict");
        fs::write(root.join("a.txt"), b"old").unwrap();
        let token = move_to_trash(root.to_string_lossy().to_string(), "a.txt".into()).unwrap();
        fs::write(root.join("a.txt"), b"new").unwrap();
        let res = restore_from_trash(
            root.to_string_lossy().to_string(),
            token.clone(),
            "a.txt".into(),
        );
        assert!(res.is_err());
        assert_eq!(fs::read(root.join("a.txt")).unwrap(), b"new");
        assert!(root.join(".trash").join(&token).exists());
        let _ = fs::remove_dir_all(&root);
    }

    /// restore 成功后应把 payload 搬回原相对位置并清空对应回收站条目。
    #[test]
    fn restore_moves_payload_back() {
        let root = unique_temp_dir("restore-ok");
        fs::write(root.join("a.txt"), b"hi").unwrap();
        let token = move_to_trash(root.to_string_lossy().to_string(), "a.txt".into()).unwrap();
        restore_from_trash(
            root.to_string_lossy().to_string(),
            token.clone(),
            "a.txt".into(),
        )
        .unwrap();
        assert_eq!(fs::read(root.join("a.txt")).unwrap(), b"hi");
        assert!(!root.join(".trash").join(&token).exists());
        let _ = fs::remove_dir_all(&root);
    }

    /// purge 保留最新 keep 个，忽略并保留非数字杂项条目。
    #[test]
    fn purge_trash_keeps_newest_and_ignores_stray_entries() {
        let root = unique_temp_dir("purge");
        let trash = root.join(".trash");
        fs::create_dir_all(trash.join("00000000000000000001")).unwrap();
        fs::create_dir_all(trash.join("00000000000000000002")).unwrap();
        fs::create_dir_all(trash.join("00000000000000000003")).unwrap();
        fs::create_dir_all(trash.join("not-a-token")).unwrap();
        purge_trash(root.to_string_lossy().to_string(), 1).unwrap();
        assert!(!trash.join("00000000000000000001").exists());
        assert!(!trash.join("00000000000000000002").exists());
        assert!(trash.join("00000000000000000003").exists());
        assert!(trash.join("not-a-token").exists());
        let _ = fs::remove_dir_all(&root);
    }
}

#[cfg(test)]
mod read_asset_tests {
    use super::*;

    /// 读取系列内的相对路径资源，且越界路径必须被 `safe_join` 拦下。
    #[test]
    fn reads_asset_and_rejects_traversal() {
        let dir = std::env::temp_dir().join(format!("prismwright-read-asset-{}", std::process::id()));
        fs::create_dir_all(dir.join("assets")).unwrap();
        fs::write(dir.join("assets/a.bin"), [0u8, 1, 2]).unwrap();

        assert_eq!(read_asset_at(&dir, "assets/a.bin").unwrap(), vec![0, 1, 2]);
        assert!(read_asset_at(&dir, "../escape.bin").is_err());
        assert!(read_asset_at(&dir, "assets/missing.bin").is_err());

        fs::remove_dir_all(&dir).ok();
    }
}

#[cfg(test)]
mod theme_tests {
    use super::*;

    /// 主题 id 必须是 `[a-z0-9-]`；越界字符、空串、过长一律拒绝。
    #[test]
    fn theme_file_name_validates_id() {
        assert_eq!(theme_file_name("github-dark").unwrap(), "github-dark.json");
        assert_eq!(theme_file_name("a1").unwrap(), "a1.json");
        for bad in ["", "../evil", "Upper", "a/b", "has space", "a.b", "中文"] {
            assert!(theme_file_name(bad).is_err(), "应拒绝 id: {bad}");
        }
        assert!(theme_file_name(&"a".repeat(65)).is_err());
    }

    /// 列目录只收 `*.json`、按文件名排序；目录不存在时为空。
    #[test]
    fn read_theme_dir_reads_only_json_sorted() {
        let dir = std::env::temp_dir().join(format!("prismwright-themes-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);

        assert!(read_theme_dir(&dir).unwrap().is_empty());

        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("b.json"), "{}").unwrap();
        fs::write(dir.join("a.json"), "{}").unwrap();
        fs::write(dir.join("note.txt"), "x").unwrap();

        let files = read_theme_dir(&dir).unwrap();
        let names: Vec<&str> = files.iter().map(|f| f.file_name.as_str()).collect();
        assert_eq!(names, vec!["a.json", "b.json"]);

        fs::remove_dir_all(&dir).ok();
    }
}
