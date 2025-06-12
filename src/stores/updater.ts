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

  // 测试端点连接性 - 调试用
  async function testEndpointConnectivity() {
    const endpoints = [
      "https://pool.cursorpro.com.cn/latest.json",
      "https://vip.123pan.cn/1831210026/tq_pool/latest.json", 
      "https://github.com/maticarmy/tq_pool/releases/latest/download/latest.json",
      "https://gh-proxy.com/github.com/maticarmy/tq_pool/releases/latest/download/latest.json"
    ]

    console.group('🔗 [DEBUG] 测试端点连接性')
    Logger.info('开始测试各个更新端点的连接性...')

    for (let i = 0; i < endpoints.length; i++) {
      const endpoint = endpoints[i]
      try {
        console.log(`📡 [DEBUG] 测试端点 ${i + 1}: ${endpoint}`)
        Logger.info(`测试端点 ${i + 1}: ${endpoint}`)
        
        const response = await fetch(endpoint, { 
          method: 'HEAD',
          mode: 'no-cors' // 避免 CORS 问题
        })
        
        console.log(`✅ [DEBUG] 端点 ${i + 1} 连接成功 - 状态: ${response.status}`)
        Logger.info(`端点 ${i + 1} 连接成功 - 状态: ${response.status}`)
      } catch (error) {
        console.log(`❌ [DEBUG] 端点 ${i + 1} 连接失败:`, error)
        Logger.error(`端点 ${i + 1} 连接失败: ${error}`)
      }
    }
    console.groupEnd()
  }

  // 测试 latest.json 获取 - 调试用
  async function testLatestJsonFetch() {
    const endpoints = [
      "https://pool.cursorpro.com.cn/latest.json",
      "https://vip.123pan.cn/1831210026/tq_pool/latest.json", 
      "https://github.com/maticarmy/tq_pool/releases/latest/download/latest.json",
      "https://gh-proxy.com/github.com/maticarmy/tq_pool/releases/latest/download/latest.json"
    ]

    console.group('📄 [DEBUG] 测试 latest.json 获取')
    Logger.info('开始测试 latest.json 文件获取...')

    for (let i = 0; i < endpoints.length; i++) {
      const endpoint = endpoints[i]
      try {
        console.log(`📥 [DEBUG] 从端点 ${i + 1} 获取 latest.json: ${endpoint}`)
        Logger.info(`从端点 ${i + 1} 获取 latest.json: ${endpoint}`)
        
        const response = await fetch(endpoint)
        
        if (response.ok) {
          const jsonData = await response.json()
          console.log(`✅ [DEBUG] 端点 ${i + 1} 获取成功:`, jsonData)
          Logger.info(`端点 ${i + 1} 获取成功: ${JSON.stringify(jsonData)}`)
          
          // 检查必要字段
          if (jsonData.version) {
            console.log(`📋 [DEBUG] 检测到版本: ${jsonData.version}`)
            Logger.info(`检测到版本: ${jsonData.version}`)
          }
          if (jsonData.platforms) {
            console.log(`🖥️ [DEBUG] 支持平台:`, Object.keys(jsonData.platforms))
            Logger.info(`支持平台: ${Object.keys(jsonData.platforms).join(', ')}`)
          }
        } else {
          console.log(`❌ [DEBUG] 端点 ${i + 1} 响应错误: ${response.status} ${response.statusText}`)
          Logger.error(`端点 ${i + 1} 响应错误: ${response.status} ${response.statusText}`)
        }
      } catch (error) {
        console.log(`❌ [DEBUG] 端点 ${i + 1} 获取失败:`, error)
        Logger.error(`端点 ${i + 1} 获取失败: ${error}`)
      }
    }
    console.groupEnd()
  }

  // 检查更新
  async function checkForUpdates() {
    if (isUpdating.value) return

    try {
      isChecking.value = true
      error.value = null

      console.group('🔍 [DEBUG] 开始更新检测流程')
      Logger.info('=== 开始更新检测流程 ===')

      // 测试端点连接性
      await testEndpointConnectivity()

      // 测试 latest.json 获取
      await testLatestJsonFetch()

      console.log('🚀 [DEBUG] 调用 Tauri check() 方法...')
      Logger.info('调用 Tauri check() 方法检查更新')

      const update = await check()
      
      console.log('📨 [DEBUG] check() 返回结果:', update)
      Logger.info(`check() 返回结果: ${JSON.stringify(update)}`)

      // 兼容 Tauri 1.x 和 2.x 的 API
      // 在 Tauri 2.x 中，check() 返回 Update | null
      // 在 Tauri 1.x 中，check() 返回有 available 属性的对象
      let hasUpdateAvailable = false
      let updateData: any = null

      if (update) {
        console.log('✅ [DEBUG] 检测到更新对象，开始解析...')
        Logger.info('检测到更新对象，开始解析更新信息')

        // 检查是否为 Tauri 2.x 的 Update 对象（直接存在 version 属性）
        if (typeof update === 'object' && 'version' in update) {
          console.log('🆕 [DEBUG] 识别为 Tauri 2.x API 格式')
          Logger.info('识别为 Tauri 2.x API 格式')
          hasUpdateAvailable = true
          updateData = update
        }
        // 检查是否为 Tauri 1.x 的对象（有 available 属性）
        else if (typeof update === 'object' && 'available' in update && (update as any).available) {
          console.log('🔄 [DEBUG] 识别为 Tauri 1.x API 格式')
          Logger.info('识别为 Tauri 1.x API 格式')
          hasUpdateAvailable = true
          updateData = update
        } else {
          console.log('⚠️ [DEBUG] 未知的更新对象格式:', update)
          Logger.warn(`未知的更新对象格式: ${JSON.stringify(update)}`)
        }
      } else {
        console.log('📭 [DEBUG] 没有检测到更新')
        Logger.info('没有检测到可用更新')
      }

      if (hasUpdateAvailable && updateData) {
        console.log('🎉 [DEBUG] 确认有可用更新!')
        console.log('📦 [DEBUG] 更新版本:', updateData.version)
        console.log('📝 [DEBUG] 更新说明:', updateData.body || updateData.notes || '')
        
        Logger.info(`确认有可用更新 - 版本: ${updateData.version}`)
        Logger.info(`更新说明: ${updateData.body || updateData.notes || '无'}`)

        hasUpdate.value = true
        updateVersion.value = updateData.version
        updateNotes.value = updateData.body || updateData.notes || ''

        // 立即开始下载和安装，无需用户确认
        console.log('🚀 [DEBUG] 开始下载和安装更新...')
        Logger.info('开始下载和安装更新')
        await installUpdate(updateData)
      } else {
        console.log('ℹ️ [DEBUG] 当前已是最新版本')
        Logger.info('当前已是最新版本')
      }

      console.groupEnd()
    } catch (err) {
      console.groupEnd()
      
      // 获取错误消息，处理不同类型的错误
      const errorMessage = err instanceof Error ? err.message : String(err)

      console.group('❌ [DEBUG] 更新检测错误')
      console.error('[DEBUG] 更新检测发生错误:', err)
      Logger.error(`更新检测错误: ${errorMessage}`)

      // 检测是否是WebView2固定版本更新
      if (
        (typeof errorMessage === 'string' &&
          errorMessage.includes('platform') &&
          (errorMessage.includes('not found') || errorMessage.includes('platforms object'))) ||
        errorMessage ===
          'the platform `windows-x86_64` was not found on the response `platforms` object'
      ) {
        console.log('🔧 [DEBUG] 检测到 WebView2 平台问题，启用兼容模式')
        Logger.info('检测到 WebView2 平台问题，启用兼容模式')
        
        hasUpdate.value = true
        isWebView2Update.value = true
        // 如果是webview2更新 由于返回空platform(cdn费用高) 故设置为固定字符串 此值不会被读取 仅仅作为兼容处理
        updateVersion.value = '新版本'
        error.value = null
        console.groupEnd()
        return
      }

      if (err instanceof Error) {
        // 保存完整错误信息
        error.value = `错误: ${err.message}\n${err.stack || ''}`

        // 检查是否是网络错误
        if (
          err.message.includes('network') ||
          err.message.includes('连接') ||
          err.message.includes('connect') ||
          err.message.includes('timeout')
        ) {
          error.value = `网络连接问题: ${err.message}`
          console.log('🌐 [DEBUG] 网络连接问题:', err.message)
        }

        // 检查是否是签名验证错误
        if (err.message.includes('signature') || err.message.includes('签名')) {
          error.value = `更新签名验证失败: ${err.message}`
          console.log('🔐 [DEBUG] 签名验证失败:', err.message)
        }

        // 检查是否是解析错误
        if (err.message.includes('parse') || err.message.includes('json')) {
          error.value = `更新信息解析错误: ${err.message}`
          console.log('📄 [DEBUG] JSON 解析错误:', err.message)
        }
      } else {
        // 未知类型的错误
        error.value = `检查更新失败: ${errorMessage}`
        console.log('❓ [DEBUG] 未知错误:', errorMessage)
      }

      Logger.error(`最终错误信息: ${error.value}`)
      console.groupEnd()
    } finally {
      isChecking.value = false
      Logger.info('=== 更新检测流程结束 ===')
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

      console.group('📥 [DEBUG] 开始下载安装流程')
      Logger.info('=== 开始下载安装流程 ===')

      // 兼容不同的下载和安装方法
      if (typeof update.downloadAndInstall === 'function') {
        console.log('🔄 [DEBUG] 使用 Tauri 2.x API 下载安装')
        Logger.info('使用 Tauri 2.x API 进行下载安装')
        
        // Tauri 2.x API
      await update.downloadAndInstall((event: any) => {
          console.log('📊 [DEBUG] 下载事件:', event)
          Logger.info(`下载事件: ${JSON.stringify(event)}`)
          
        switch (event.event) {
          case 'Started':
            totalBytes.value = event.data.contentLength || 0
              console.log(`🚀 [DEBUG] 开始下载，总大小: ${totalBytes.value} 字节`)
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
              console.log(`📈 [DEBUG] 下载进度: ${downloadProgress.value}% (${downloadedBytes.value}/${totalBytes.value})`)
              Logger.info(`下载进度: ${downloadProgress.value}%`)
            break

          case 'Finished':
            downloadProgress.value = 99
              console.log('✅ [DEBUG] 下载完成')
              Logger.info('下载完成')
            break
        }
      })
      } else {
        console.log('🔄 [DEBUG] 使用兼容模式下载安装')
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

      console.log('🔧 [DEBUG] 准备安装更新...')
      Logger.info('准备安装更新')

      // 添加延迟确保用户能看到100%完成状态
      await new Promise((resolve) => setTimeout(resolve, 1000))

      console.log('🔄 [DEBUG] 重启应用...')
      Logger.info('重启应用')

      // Windows会自动重启，其他平台需要手动重启
      await relaunch()
      
      console.groupEnd()
    } catch (err) {
      console.groupEnd()
      isDownloading.value = false
      isInstalling.value = false

      // 统一错误消息格式
      const errorMessage = err instanceof Error ? err.message : String(err)

      console.group('❌ [DEBUG] 安装错误')
      console.error('[DEBUG] 安装过程发生错误:', err)
      Logger.error(`安装错误: ${errorMessage}`)

      if (err instanceof Error) {
        // 保存完整错误信息
        error.value = `安装错误: ${err.message}\n${err.stack || ''}`

        // 检查是否是下载错误
        if (err.message.includes('download') || err.message.includes('下载')) {
          error.value = `更新包下载失败: ${err.message}`
          console.log('📥 [DEBUG] 下载失败:', err.message)
        }

        // 检查是否是权限错误
        if (err.message.includes('permission') || err.message.includes('权限')) {
          error.value = `安装权限不足: ${err.message}`
          console.log('🔐 [DEBUG] 权限不足:', err.message)
        }

        // 检查是否是文件损坏
        if (
          err.message.includes('corrupt') ||
          err.message.includes('损坏') ||
          err.message.includes('invalid') ||
          err.message.includes('无效')
        ) {
          error.value = `更新包损坏或无效: ${err.message}`
          console.log('📦 [DEBUG] 文件损坏:', err.message)
        }
      } else {
        // 未知类型的错误
        error.value = `更新安装失败: ${errorMessage}`
        console.log('❓ [DEBUG] 未知安装错误:', errorMessage)
      }

      Logger.error(`最终安装错误: ${error.value}`)
      console.groupEnd()
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
    testEndpointConnectivity,
    testLatestJsonFetch,
  }
})
