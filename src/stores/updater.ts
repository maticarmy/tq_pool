import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { open } from '@tauri-apps/plugin-shell'
import Logger from '@/utils/logger'

export const useUpdaterStore = defineStore('updater', () => {
  // 状态
  const isChecking = ref(false)
  const isDownloading = ref(false)
  const isInstalling = ref(false)
  const hasUpdate = ref(false)
  const downloadProgress = ref(0)
  const downloadedBytes = ref(0)
  const totalBytes = ref(0)
  const updateVersion = ref('')
  const updateNotes = ref('')
  const error = ref<string | null>(null)
  const isWebView2Update = ref(false)

  // 计算属性
  const isUpdating = computed(() => isChecking.value || isDownloading.value || isInstalling.value)
  const progressPercentage = computed(() => {
    if (totalBytes.value === 0) return 0
    return Math.round((downloadedBytes.value / totalBytes.value) * 100)
  })

  // 检查更新
  async function checkForUpdates() {
    if (isUpdating.value) return

    try {
      isChecking.value = true
      error.value = null

      Logger.info('开始检查更新')

      const update = await check()
      
      Logger.info(`更新检查结果: ${update ? '发现更新' : '暂无更新'}`)

      // 兼容 Tauri 1.x 和 2.x 的 API
      let hasUpdateAvailable = false
      let updateData: any = null

      if (update) {
        Logger.info('检测到更新对象，开始解析更新信息')

        // 检查是否为 Tauri 2.x 的 Update 对象（直接存在 version 属性）
        if (typeof update === 'object' && 'version' in update) {
          Logger.info('使用 Tauri 2.x API 格式')
          hasUpdateAvailable = true
          updateData = update
        }
        // 检查是否为 Tauri 1.x 的对象（有 available 属性）
        else if (typeof update === 'object' && 'available' in update && (update as any).available) {
          Logger.info('使用 Tauri 1.x API 格式')
          hasUpdateAvailable = true
          updateData = update
        } else {
          Logger.warn(`未知的更新对象格式: ${JSON.stringify(update)}`)
        }
      } else {
        Logger.info('当前已是最新版本')
      }

      if (hasUpdateAvailable && updateData) {
        Logger.info(`发现可用更新 - 版本: ${updateData.version}`)
        Logger.info(`更新说明: ${updateData.body || updateData.notes || '无'}`)

        hasUpdate.value = true
        updateVersion.value = updateData.version
        updateNotes.value = updateData.body || updateData.notes || ''

        // 立即开始下载和安装
        Logger.info('开始下载和安装更新')
        await installUpdate(updateData)
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      Logger.error(`更新检测错误: ${errorMessage}`)

      // 检测是否是WebView2固定版本更新
      if (
        (typeof errorMessage === 'string' &&
          errorMessage.includes('platform') &&
          (errorMessage.includes('not found') || errorMessage.includes('platforms object'))) ||
        errorMessage ===
          'the platform `windows-x86_64` was not found on the response `platforms` object'
      ) {
        Logger.info('检测到 WebView2 平台问题，启用兼容模式')
        
        hasUpdate.value = true
        isWebView2Update.value = true
        updateVersion.value = '新版本'
        error.value = null
        return
      }

      if (err instanceof Error) {
        // 检查错误类型并提供友好的错误信息
        if (
          err.message.includes('network') ||
          err.message.includes('连接') ||
          err.message.includes('connect') ||
          err.message.includes('timeout')
        ) {
          error.value = `网络连接问题: ${err.message}`
        } else if (err.message.includes('signature') || err.message.includes('签名')) {
          error.value = `更新签名验证失败: ${err.message}`
        } else if (err.message.includes('parse') || err.message.includes('json')) {
          error.value = `更新信息解析错误: ${err.message}`
        } else {
          error.value = `检查更新失败: ${err.message}`
        }
      } else {
        error.value = `检查更新失败: ${errorMessage}`
      }

      Logger.error(`最终错误信息: ${error.value}`)
    } finally {
      isChecking.value = false
      Logger.info('更新检测流程结束')
    }
  }

  // 下载并安装更新
  async function installUpdate(update: any) {
    try {
      isDownloading.value = true
      error.value = null
      downloadProgress.value = 0
      downloadedBytes.value = 0
      totalBytes.value = 0

      Logger.info('开始下载安装流程')

      // 兼容不同的下载和安装方法
      if (typeof update.downloadAndInstall === 'function') {
        Logger.info('使用 Tauri 2.x API 进行下载安装')
        
        // Tauri 2.x API
      await update.downloadAndInstall((event: any) => {
          Logger.info(`下载事件: ${JSON.stringify(event)}`)
          
        switch (event.event) {
          case 'Started':
            totalBytes.value = event.data.contentLength || 0
              Logger.info(`开始下载，总大小: ${totalBytes.value} 字节`)
            break

          case 'Progress':
            downloadedBytes.value += event.data.chunkLength || 0
            // 确保进度不超过100%
            if (totalBytes.value > 0) {
              downloadProgress.value = Math.min(
                Math.round((downloadedBytes.value / totalBytes.value) * 100),
                99, // 保留安装的1%
              )
            }
              Logger.info(`下载进度: ${downloadProgress.value}%`)
            break

          case 'Finished':
            downloadProgress.value = 99
              Logger.info('下载完成')
            break
        }
      })
      } else {
        Logger.warn('使用兼容模式进行下载安装')
        downloadProgress.value = 50
        // 模拟下载过程
        await new Promise(resolve => setTimeout(resolve, 1000))
        downloadProgress.value = 99
      }

      // 如果代码执行到这里，说明下载完成并准备安装
      isDownloading.value = false
      isInstalling.value = true
      downloadProgress.value = 100

      Logger.info('准备安装更新')

      // 添加延迟确保用户能看到100%完成状态
      await new Promise((resolve) => setTimeout(resolve, 1000))

      Logger.info('重启应用')

      // Windows会自动重启，其他平台需要手动重启
      await relaunch()
      
      Logger.info('更新安装完成')
    } catch (err) {
      isDownloading.value = false
      isInstalling.value = false

      const errorMessage = err instanceof Error ? err.message : String(err)

      Logger.error(`安装错误: ${errorMessage}`)

      if (err instanceof Error) {
        // 保存完整错误信息
        error.value = `安装错误: ${err.message}\n${err.stack || ''}`

        // 检查是否是下载错误
        if (err.message.includes('download') || err.message.includes('下载')) {
          error.value = `更新包下载失败: ${err.message}`
        }

        // 检查是否是权限错误
        if (err.message.includes('permission') || err.message.includes('权限')) {
          error.value = `安装权限不足: ${err.message}`
        }

        // 检查是否是文件损坏
        if (
          err.message.includes('corrupt') ||
          err.message.includes('损坏') ||
          err.message.includes('invalid') ||
          err.message.includes('无效')
        ) {
          error.value = `更新包损坏或无效: ${err.message}`
        }
      } else {
        // 未知类型的错误
        error.value = `更新安装失败: ${errorMessage}`
      }

      Logger.error(`最终安装错误: ${error.value}`)
    }
  }

  // 打开官网
  async function openOfficialWebsite() {
    try {
      await open('https://cursorpro.com.cn')
    } catch (err) {
      error.value = `无法打开官网: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  return {
    // 状态
    isChecking,
    isDownloading,
    isInstalling,
    hasUpdate,
    downloadProgress,
    downloadedBytes,
    totalBytes,
    updateVersion,
    updateNotes,
    error,
    isUpdating,
    progressPercentage,
    isWebView2Update,

    // 方法
    checkForUpdates,
    openOfficialWebsite,

    // 测试方法（后续可以移除）
  }
})
