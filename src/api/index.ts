import { invoke } from '@tauri-apps/api/core'
import type {
  ApiResponse,
  LoginResponse,
  UserInfo,
  AccountPoolInfo,
  UsageInfo,
  PublicInfo,
  MachineInfo,
  HistoryRecord,
  HistoryAccountRecord,
  Article,
  CheckUserResponse,
  RegisterResponse,
  ActivateResponse,
} from './types'
import Logger from '../utils/logger'
import { apiClient } from '@/utils/apiClient'

// 错误处理
function handleApiResponse<T>(response: ApiResponse<T>): T {
  if (response.status === 200) {
    // 成功时返回 data
    if (response.data) {
      return response.data
    }
    // 如果没有data，返回空对象
    return {} as T
  }

  // 状态码不为200时抛出错误，优先使用服务器返回的消息
  throw new ApiError(response.msg || '链接服务器失败，请稍后再试')
}

// API 错误类
export class ApiError extends Error {
  public statusCode?: number

  constructor(message: string, statusCode?: number) {
    super(message)
    this.name = 'ApiError'
    this.statusCode = statusCode
  }
}

// 用户认证相关 API

/**
 * 检查用户登录状态
 * @param email 用户邮箱
 * @returns 用户登录状态信息
 */
export async function checkUser(email?: string): Promise<CheckUserResponse> {
  try {
    const response = await apiClient.request<ApiResponse<CheckUserResponse>>('check_user', {
      email: email || '',
    })
    // 直接返回原始响应中的字段，而不是通过handleApiResponse处理
    if (response.status === 200) {
      return {
        status: response.status,
        msg: response.msg,
        isLoggedIn: response.data?.isLoggedIn || false,
        userInfo: response.data?.userInfo,
      }
    }
    // 对于404状态码（用户不存在），也正常返回而不抛出异常
    if (response.status === 404) {
      return {
        status: response.status,
        msg: response.msg,
        isLoggedIn: false,
        userInfo: undefined,
      }
    }
    return handleApiResponse(response)
  } catch (error) {
    throw new ApiError(error instanceof Error ? error.message : '无法验证用户状态')
  }
}

export async function sendCode(email: string, purpose: string): Promise<void> {
  try {
    const response = await apiClient.request<ApiResponse<void>>('send_code', {
      email,
      type: purpose,
    })
    return handleApiResponse(response)
  } catch (error) {
    throw new ApiError(error instanceof Error ? error.message : '发送验证码失败')
  }
}

export async function register(
  email: string,
  code: string,
  password: string,
  spread: string,
): Promise<RegisterResponse> {
  try {
    const response = await apiClient.request<ApiResponse<RegisterResponse>>('register', {
      email,
      code,
      password,
      spread,
    })
    return handleApiResponse(response)
  } catch (error) {
    throw new ApiError(error instanceof Error ? error.message : '注册失败')
  }
}

export async function login(
  account: string,
  password: string,
  spread: string,
): Promise<LoginResponse> {
  try {
    const response = await apiClient.request<ApiResponse<LoginResponse>>('login', {
      account,
      password,
      spread,
    })
    return handleApiResponse(response)
  } catch (error) {
    await Logger.error('登录失败', { file: 'api/index.ts' })
    throw new ApiError(error instanceof Error ? error.message : '登录失败')
  }
}

// 用户信息相关 API
export async function getUserInfo(): Promise<UserInfo> {
  try {
    const response = await apiClient.request<ApiResponse<UserInfo>>('get_user_info')
    return handleApiResponse(response)
  } catch (error) {
    if (error instanceof ApiError) {
      throw error
    }
    throw new ApiError(error instanceof Error ? error.message : '链接服务器失败')
  }
}

export async function getAccount(account?: string, usageCount?: string): Promise<AccountPoolInfo> {
  try {
    const response = await apiClient.request<ApiResponse<AccountPoolInfo>>('get_account', {
      account,
      usageCount,
    })
    return handleApiResponse(response)
  } catch (error) {
    throw new ApiError(error instanceof Error ? error.message : '获取账户信息失败')
  }
}

// Cursor 平台相关 API
export async function getUsage(token: string): Promise<UsageInfo> {
  try {
    const response = await invoke<ApiResponse<UsageInfo>>('get_usage', {
      token,
    })
    return handleApiResponse(response)
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)

    if (errorMsg === 'cursor_db_error') {
      throw new ApiError('cursor_db_error')
    } else if (errorMsg === 'cursor_network_error') {
      throw new ApiError('cursor_network_error')
    } else if (errorMsg === 'cursor_data_error') {
      throw new ApiError('cursor_data_error')
    } else {
      throw new ApiError('cursor_unknown_error')
    }
  }
}

// 系统信息相关 API
export async function getPublicInfo(): Promise<PublicInfo> {
  try {
    const response = await apiClient.request<ApiResponse<PublicInfo>>('get_public_info')
    return handleApiResponse(response)
  } catch (error) {
    throw new ApiError(error instanceof Error ? error.message : '获取公共信息失败')
  }
}

export async function refreshInbound(): Promise<boolean> {
  try {
    return await invoke<boolean>('refresh_inbound')
  } catch (error) {
    await Logger.error('刷新线路失败', { file: 'api/index.ts' })
    throw new ApiError(error instanceof Error ? error.message : '刷新线路失败')
  }
}

// 账户管理相关 API
export async function activate(code: string): Promise<ActivateResponse> {
  try {
    const response = await apiClient.request<ActivateResponse>('activate', { code })
    return response // 直接返回完整响应，包含可能的effects
  } catch (error) {
    throw new ApiError(error instanceof Error ? error.message : '激活失败')
  }
}

export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  try {
    const response = await apiClient.request<ApiResponse<void>>('change_password', {
      oldPassword,
      newPassword,
    })
    handleApiResponse(response)
  } catch (error) {
    throw new ApiError(error instanceof Error ? error.message : '修改密码失败')
  }
}

// 机器码和账户切换相关 API
export async function resetMachineId(
  params: {
    forceKill?: boolean
    machineId?: string
  } = {},
): Promise<boolean> {
  try {
    return await invoke<boolean>('reset_machine_id', {
      forceKill: params.forceKill || false,
      machineId: params.machineId,
    })
  } catch (error) {
    await Logger.error('重置机器码失败', { file: 'api/index.ts' })
    throw new ApiError(error instanceof Error ? error.message : '重置机器码失败')
  }
}

export async function switchAccount(
  email: string,
  token: string,
  forceKill: boolean = false,
): Promise<void> {
  try {
    const result = await invoke<boolean>('switch_account', {
      email,
      token,
      forceKill,
    })
    if (result !== true) {
      await Logger.error(`切换账户失败: ${email}`, { file: 'api/index.ts' })
      throw new Error('切换账户失败')
    }
  } catch (error) {
    await Logger.error(`切换账户失败: ${email}, ${error}`, {
      file: 'api/index.ts',
    })
    const errorMsg = error instanceof Error ? error.message : '切换账户失败'
    if (errorMsg.includes('Cursor进程正在运行')) {
      throw new Error('请先关闭 Cursor 或选择强制终止进程')
    }
    throw error
  }
}

export async function getMachineIds(): Promise<MachineInfo> {
  try {
    return await invoke<MachineInfo>('get_machine_ids')
  } catch (error) {
    await Logger.error('获取机器码失败', { file: 'api/index.ts' })
    throw new ApiError(error instanceof Error ? error.message : '获取机器码失败')
  }
}

export async function checkCursorRunning(): Promise<boolean> {
  try {
    return await invoke<boolean>('check_cursor_running')
  } catch (error) {
    await Logger.error('检查Cursor状态失败', { file: 'api/index.ts' })
    throw new ApiError(error instanceof Error ? error.message : '检查Cursor状态失败')
  }
}

// 管理员权限相关 API
export async function checkAdminPrivileges(): Promise<boolean> {
  try {
    return await invoke<boolean>('check_admin_privileges')
  } catch (error) {
    throw new ApiError(error instanceof Error ? error.message : '检查管理员权限失败')
  }
}

// Hook 相关 API
export async function checkHookStatus(): Promise<boolean> {
  try {
    return await invoke<boolean>('is_hook', {})
  } catch (error) {
    Logger.error(`检查hook状态错误: ${error}`)

    const errorMsg = error instanceof Error ? error.message : String(error)
    if (
      errorMsg.includes('MAIN_JS_NOT_FOUND') ||
      errorMsg.includes('创建应用路径失败') ||
      errorMsg.includes('main.js 路径不存在')
    ) {
      Logger.warn('找不到main.js，默认返回hook状态为false')
      return false
    }

    throw error
  }
}

export async function applyHook(forceKill: boolean = false): Promise<void> {
  try {
    await invoke<void>('hook_main_js', {
      forceKill,
    })
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    await Logger.error(`应用hook失败: ${errorMsg}`, { file: 'api/index.ts' })

    if (errorMsg.includes('Cursor进程正在运行')) {
      throw new Error('请先关闭 Cursor 或选择强制终止进程')
    }

    throw error
  }
}

export async function findCursorPath(selectedPath: string): Promise<boolean> {
  try {
    return await invoke<boolean>('find_cursor_path', { selectedPath })
  } catch (error) {
    Logger.error(`查找Cursor路径错误: ${error}`)
    throw error
  }
}

export async function restoreHook(forceKill: boolean = false): Promise<void> {
  try {
    await invoke<void>('restore_hook', {
      forceKill,
    })
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    await Logger.error(`恢复hook失败: ${errorMsg}`, { file: 'api/index.ts' })

    if (errorMsg.includes('Cursor进程正在运行')) {
      throw new Error('请先关闭 Cursor 或选择强制终止进程')
    }

    throw error
  }
}

export async function resetPassword(email: string, code: string, password: string): Promise<void> {
  try {
    const response = await apiClient.request<ApiResponse<void>>('reset_password', {
      email,
      code,
      password,
    })
    return handleApiResponse(response)
  } catch (error) {
    throw new ApiError(error instanceof Error ? error.message : '重置密码失败')
  }
}

// 添加关闭和启动Cursor的API
export async function closeCursor(): Promise<boolean> {
  return await invoke('close_cursor')
}

export async function launchCursor(): Promise<boolean> {
  return await invoke('launch_cursor')
}

// 登出
export async function logout(): Promise<void> {
  try {
    const response = await apiClient.request<ApiResponse<void>>('logout')
    return handleApiResponse(response)
  } catch (error) {
    throw new ApiError(error instanceof Error ? error.message : '登出失败')
  }
}

// 使用键值存储实现历史记录功能

/**
 * 保存历史记录
 * @param record 历史记录
 */
export async function saveHistoryRecord(record: HistoryRecord): Promise<void> {
  try {
    const records = await getHistoryRecords()

    records.push(record)

    await setUserData('user.history', JSON.stringify(records))
  } catch (error) {
    Logger.error(`保存历史记录失败: ${error}`)
    throw new ApiError(error instanceof Error ? error.message : '保存历史记录失败')
  }
}

/**
 * 批量保存历史记录
 * @param records 历史记录数组
 */
export async function saveHistoryRecords(records: HistoryRecord[]): Promise<void> {
  try {
    let existingRecords = await getHistoryRecords()

    existingRecords = [...existingRecords, ...records]

    await setUserData('user.history', JSON.stringify(existingRecords))
  } catch (error) {
    Logger.error(`批量保存历史记录失败: ${error}`)
    throw new ApiError(error instanceof Error ? error.message : '保存历史记录失败')
  }
}

/**
 * 获取所有历史记录
 * @returns 历史记录数组
 */
export async function getHistoryRecords(): Promise<HistoryRecord[]> {
  try {
    const data = await getUserData('user.history')
    if (!data) {
      return []
    }

    try {
      return JSON.parse(data) as HistoryRecord[]
    } catch (e) {
      Logger.error(`历史记录解析失败: ${e}`)
      return []
    }
  } catch (error) {
    Logger.error(`获取历史记录失败: ${error}`)
    throw new ApiError(error instanceof Error ? error.message : '获取历史记录失败')
  }
}

/**
 * 清除所有历史记录
 */
export async function clearHistoryRecords(): Promise<void> {
  try {
    await delUserData('user.history')
  } catch (error) {
    Logger.error(`清除历史记录失败: ${error}`)
    throw new ApiError(error instanceof Error ? error.message : '清除历史记录失败')
  }
}

/**
 * 获取历史账户列表
 */
export async function getHistoryAccounts(): Promise<HistoryAccountRecord[]> {
  try {
    const data = await getUserData('user.history.accounts')
    if (!data) {
      return []
    }

    try {
      return JSON.parse(data) as HistoryAccountRecord[]
    } catch (e) {
      Logger.error(`历史账户解析失败: ${e}`)
      return []
    }
  } catch (error) {
    throw new ApiError(error instanceof Error ? error.message : '获取历史账户失败')
  }
}

/**
 * 删除历史账户
 * @param email 要删除的账户邮箱
 */
export async function removeHistoryAccount(email: string): Promise<void> {
  try {
    let accounts = await getHistoryAccounts()

    accounts = accounts.filter((a) => a.email !== email)

    await setUserData('user.history.accounts', JSON.stringify(accounts))
  } catch (error) {
    throw new ApiError(error instanceof Error ? error.message : '删除历史账户失败')
  }
}

/**
 * 清除所有历史账户
 */
export async function clearHistoryAccounts(): Promise<void> {
  try {
    await delUserData('user.history.accounts')
  } catch (error) {
    Logger.error(`清除历史账户失败: ${error}`)
    throw new ApiError(error instanceof Error ? error.message : '清除历史账户失败')
  }
}

/**
 * 保存用户API Token
 * @param token API Token
 */
export async function saveUserApiToken(token: string): Promise<void> {
  try {
    await setUserData('user.info.token', token)
  } catch (error) {
    Logger.error(`保存API Token失败: ${error}`)
    throw new ApiError(error instanceof Error ? error.message : '保存API Token失败')
  }
}

/**
 * 获取用户API Token
 * @returns API Token，如果不存在则返回null
 */
export async function getUserApiToken(): Promise<string | null> {
  try {
    return await getUserData('user.info.token')
  } catch (error) {
    Logger.error(`获取API Token失败: ${error}`)
    throw new ApiError(error instanceof Error ? error.message : '获取API Token失败')
  }
}

/**
 * 清除用户API Token
 */
export async function clearUserApiToken(): Promise<void> {
  try {
    await delUserData('user.info.token')
  } catch (error) {
    Logger.error(`清除API Token失败: ${error}`)
    throw new ApiError(error instanceof Error ? error.message : '清除API Token失败')
  }
}

// 添加通用的键值存储 API 方法

/**
 * 设置用户数据
 * @param key 键名
 * @param value 值
 */
export async function setUserData(key: string, value: string): Promise<void> {
  try {
    await invoke<ApiResponse<any>>('set_user_data', { key, value })
  } catch (error) {
    throw new ApiError(error instanceof Error ? error.message : '设置用户数据失败')
  }
}

/**
 * 获取用户数据
 * @param key 键名
 * @returns 获取的值，如果不存在则返回 null
 */
export async function getUserData(key: string): Promise<string | null> {
  try {
    const response = await invoke<
      ApiResponse<{
        value: string | null
      }>
    >('get_user_data', { key })
    const result = handleApiResponse(response)
    return result.value
  } catch (error) {
    throw new ApiError(error instanceof Error ? error.message : '获取用户数据失败')
  }
}

/**
 * 删除用户数据
 * @param key 键名
 */
export async function delUserData(key: string): Promise<void> {
  try {
    await invoke<ApiResponse<any>>('del_user_data', { key })
  } catch (error) {
    throw new ApiError(error instanceof Error ? error.message : '删除用户数据失败')
  }
}

// 使用通用 API 实现的特定功能

/**
 * 检查用户是否已接受免责声明
 * @returns 是否已接受
 */
export async function checkDisclaimerAccepted(): Promise<boolean> {
  try {
    const value = await getUserData('user.disclaimer.accepted')
    return value === 'true'
  } catch (error) {
    Logger.error(`检查免责声明失败: ${error}`)
    return false
  }
}

/**
 * 设置用户已接受免责声明
 */
export async function setDisclaimerAccepted(): Promise<void> {
  try {
    await setUserData('user.disclaimer.accepted', 'true')
  } catch (error) {
    Logger.error(`设置免责声明状态失败: ${error}`)
    throw error
  }
}

/**
 * 清除用户的免责声明接受状态
 */
export async function clearDisclaimerAccepted(): Promise<void> {
  try {
    await delUserData('user.disclaimer.accepted')
  } catch (error) {
    Logger.error(`清除免责声明状态失败: ${error}`)
    throw error
  }
}

// 获取公告列表
export async function getArticleList(): Promise<Article[]> {
  try {
    const response = await apiClient.request<ApiResponse<Article[]>>('get_article_list')
    return handleApiResponse(response)
  } catch (error) {
    Logger.error(`获取公告列表失败: ${error}`)
    return []
  }
}

// 检查文章是否已读
export async function isArticleRead(articleId: number): Promise<boolean> {
  try {
    const valueStr = await getUserData('system.articles')
    if (!valueStr) return false

    try {
      const readIds = JSON.parse(valueStr) as number[]

      if (Array.isArray(readIds)) {
        const result = readIds.includes(articleId)
        return result
      } else {
        Logger.error('已读文章ID不是一个数组:', readIds)
        return false
      }
    } catch (parseError) {
      Logger.error(`解析已读文章ID失败: ${parseError}, 原始数据: ${valueStr}`)
      return false
    }
  } catch (error) {
    Logger.error(`获取已读文章状态失败: ${error}`)
    return false
  }
}

// 标记文章为已读
export async function markArticleRead(articleId: number): Promise<void> {
  try {
    const response = await apiClient.request<ApiResponse<void>>('mark_article_read', { articleId })
    handleApiResponse(response)
  } catch (error) {
    throw new ApiError(error instanceof Error ? error.message : '标记文章已读失败')
  }
}

/**
 * 打开开发者工具
 */
export const openDevTools = () => {
  return invoke('open_devtools')
}

// 获取正在运行的Cursor路径
export async function getRunningCursorPath(): Promise<string> {
  try {
    return await invoke<string>('get_running_cursor_path')
  } catch (error) {
    Logger.error(`获取正在运行的Cursor路径失败: ${error}`)
    throw new ApiError(
      error instanceof Error ? error.message : '当前没有正在运行的Cursor, 请打开Cursor',
    )
  }
}
