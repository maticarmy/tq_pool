// 更新器测试工具
import { check } from '@tauri-apps/plugin-updater'
import Logger from '@/utils/logger'

export interface UpdateCompatibilityInfo {
  tauriVersion: '1.x' | '2.x' | 'unknown'
  updateAvailable: boolean
  updateData: any
  error?: string
}

export async function testUpdaterCompatibility(): Promise<UpdateCompatibilityInfo> {
  try {
    const update = await check()
    Logger.info(`更新器测试 - 原始响应: ${JSON.stringify(update)}`)

    let tauriVersion: '1.x' | '2.x' | 'unknown' = 'unknown'
    let updateAvailable = false
    let updateData: any = null

    if (update) {
      // 检测 Tauri 版本
      if (typeof update === 'object' && 'version' in update && !('available' in update)) {
        tauriVersion = '2.x'
        updateAvailable = true
        updateData = update
      } else if (typeof update === 'object' && 'available' in update) {
        tauriVersion = '1.x'
        updateAvailable = (update as any).available
        updateData = update
      }
    }

    return {
      tauriVersion,
      updateAvailable,
      updateData,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    Logger.error(`更新器测试失败: ${errorMessage}`)
    
    return {
      tauriVersion: 'unknown',
      updateAvailable: false,
      updateData: null,
      error: errorMessage
    }
  }
}

// 用于调试的详细信息输出
export async function debugUpdaterInfo() {
  console.group('🔍 更新器兼容性测试')
  
  try {
    const result = await testUpdaterCompatibility()
    
    console.log('📊 测试结果:')
    console.log('  Tauri 版本:', result.tauriVersion)
    console.log('  有可用更新:', result.updateAvailable)
    console.log('  更新数据:', result.updateData)
    
    if (result.error) {
      console.error('  错误信息:', result.error)
    }
    
    // 输出详细的数据结构
    if (result.updateData) {
      console.log('📋 更新数据结构:')
      console.log('  类型:', typeof result.updateData)
      console.log('  属性:', Object.keys(result.updateData))
      console.log('  完整数据:', JSON.stringify(result.updateData, null, 2))
    }
    
  } catch (error) {
    console.error('❌ 测试执行失败:', error)
  }
  
  console.groupEnd()
} 