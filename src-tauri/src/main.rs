// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use crate::utils::privileges::{check_admin_privileges, request_admin_privileges};
use cursor_pool_lib::*;
use std::env;

fn main() {
    // Windows 平台下检查管理员权限
    #[cfg(target_os = "windows")]
    {
        match check_admin_privileges() {
            Ok(true) => {
                println!("已经拥有管理员权限");
            }
            Ok(false) => {
                println!("检测到需要管理员权限，尝试请求权限...");
                let exe_path = match env::current_exe() {
                    Ok(path) => path.to_string_lossy().to_string(),
                    Err(e) => {
                        eprintln!("获取当前执行文件路径失败: {}", e);
                        std::process::exit(1);
                    }
                };

                match request_admin_privileges(&exe_path) {
                    Ok(true) => {
                        println!("成功请求管理员权限，退出当前进程");
                std::process::exit(0);
                    }
                    Ok(false) => {
                        eprintln!("用户拒绝了管理员权限请求或权限提升失败");
                        eprintln!("应用需要管理员权限才能正常运行");
                        std::process::exit(1);
                    }
                    Err(e) => {
                        eprintln!("请求管理员权限时发生错误: {}", e);
                        eprintln!("尝试继续运行，但某些功能可能无法正常工作");
                    }
                }
            }
            Err(e) => {
                eprintln!("检查管理员权限时发生错误: {}", e);
                eprintln!("尝试继续运行，但某些功能可能无法正常工作");
            }
        }
    }

    cursor_pool_lib::run()
}
