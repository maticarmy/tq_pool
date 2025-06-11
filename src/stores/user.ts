import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  getUserInfo,
  login as apiLogin,
  register as apiRegister,
  logout as apiLogout,
  activate as apiActivate,
  changePassword as apiChangePassword,
  resetPassword as apiResetPassword,
  checkAdminPrivileges,
} from '@/api'
import type { UserInfo } from '@/api/types'
import Logger from '@/utils/logger'

export const useUserStore = defineStore('user', () => {
  // Reactive state
  const userInfo = ref<UserInfo | null>(null)
  const isLoggedIn = ref(false)
  const isCheckingLogin = ref(false)
  const isCheckingAdmin = ref(false)
  const isAdmin = ref<boolean | null>(null)
  const loginError = ref('')

  // 激活码相关状态
  const activationCode = ref('')
  const activationLoading = ref(false)
  const activationError = ref('')
  const activationEffects = ref<{
    membership_extended?: string
    credits_gained?: string
    usage_times?: string
    level_upgraded?: string
  } | null>(null)

  // Getters
  const username = computed(() => userInfo.value?.username || '')
  const expiryDate = computed(() => userInfo.value?.expireTime || '')
  const memberLevel = computed(() => userInfo.value?.level || 1)

  // 计算用户积分
  const userCredits = computed(() => {
    if (!userInfo.value) {
      return 0
    }
    return userInfo.value.totalCount - userInfo.value.usedCount
  })

  /**
   * 开发模式：跳过登录验证
   */
  function skipLoginForDev() {
    // 只有明确设置了DEV_SKIP_LOGIN时才跳过登录
    const SKIP_LOGIN = localStorage.getItem('DEV_SKIP_LOGIN') === 'true'
    if (SKIP_LOGIN) {
      // 设置假的用户信息
      userInfo.value = {
        username: 'dev_user',
        level: 3,
        totalCount: 9999,
        usedCount: 0,
        expireTime: '2025-12-31 23:59:59',
        isExpired: false
      }
      isLoggedIn.value = true
      // 设置localStorage中的apiKey
      localStorage.setItem('apiKey', 'dev_token_' + Date.now())
      Logger.info('开发模式：已跳过登录验证')
      return true
    }
    return false
  }

  /**
   * 检查是否以管理员权限运行
   */
  async function checkIsAdmin() {
    try {
      isCheckingAdmin.value = true
      const adminStatus = await checkAdminPrivileges()
      isAdmin.value = adminStatus

      return isAdmin.value
    } catch (error) {
      Logger.error(`检查管理员权限失败: ${error}`)
      isAdmin.value = null
      throw error
    } finally {
      isCheckingAdmin.value = false
    }
  }

  // Actions
  /**
   * 检查用户登录状态
   */
  async function checkLoginStatus() {
    try {
      isCheckingLogin.value = true
      
      // 首先尝试开发模式跳过登录
      if (skipLoginForDev()) {
        return
      }
      
      const info = await getUserInfo()
      userInfo.value = info
      isLoggedIn.value = true
      loginError.value = ''
    } catch (error) {
      Logger.error(`检查登录状态失败: ${error}`)
      
      // 如果真实登录失败，再次尝试开发模式
      if (!skipLoginForDev()) {
      userInfo.value = null
      isLoggedIn.value = false
      }
    } finally {
      isCheckingLogin.value = false
    }
  }

  /**
   * 用户登录
   */
  async function login(account: string, password: string, spread: string = 'web') {
    try {
      const response = await apiLogin(account, password, spread)
      if (response && response.token) {
        await checkLoginStatus()
        return true
      }
      return false
    } catch (error) {
      loginError.value = error instanceof Error ? error.message : '登录失败'
      throw error
    }
  }

  /**
   * 用户注册
   */
  async function register(email: string, code: string, password: string, spread: string = 'web') {
    try {
      const response = await apiRegister(email, code, password, spread)
      if (response && response.token) {
        // 保存token后调用检查登录状态接口获取用户信息
        await checkLoginStatus()

        // 如果获取用户信息失败，尝试直接登录
        if (!isLoggedIn.value) {
          await login(email, password, spread)
        }

        return true
      }
      return false
    } catch (error) {
      loginError.value = error instanceof Error ? error.message : '注册失败'
      throw error
    }
  }

  /**
   * 用户登出
   */
  async function logout() {
    try {
      // 先更新状态，再调用API
      userInfo.value = null
      isLoggedIn.value = false
      loginError.value = ''

      // 调用登出API
      await apiLogout()

      // 触发一个全局事件，通知应用用户已登出
      window.dispatchEvent(new CustomEvent('user-logout'))

      return true
    } catch (error) {
      Logger.error(`登出失败: ${error}`)
      throw error
    }
  }

  /**
   * 激活码兑换
   */
  async function activateCode(code: string) {
    try {
      activationLoading.value = true
      activationError.value = ''
      activationEffects.value = null

      const response = await apiActivate(code)
      
      // 处理激活效果
      if (response.data?.effects) {
        activationEffects.value = response.data.effects
        // 5秒后自动清除效果显示
        setTimeout(() => {
          activationEffects.value = null
        }, 5000)
      }

      // 激活成功后刷新用户信息
      await checkLoginStatus()

      // 重置激活码状态
      activationCode.value = ''

      return true
    } catch (error) {
      activationError.value = error instanceof Error ? error.message : '激活失败'
      Logger.error(`激活失败: ${error}`)
      throw error
    } finally {
      activationLoading.value = false
    }
  }

  /**
   * 修改密码
   */
  async function changePassword(oldPassword: string, newPassword: string) {
    try {
      await apiChangePassword(oldPassword, newPassword)
      // 修改密码成功后登出
      await logout()
      return true
    } catch (error) {
      Logger.error(`修改密码失败: ${error}`)
      throw error
    }
  }

  /**
   * 重置密码
   */
  async function resetPassword(email: string, code: string, password: string) {
    try {
      await apiResetPassword(email, code, password)
      return true
    } catch (error) {
      Logger.error(`重置密码失败: ${error}`)
      throw error
    }
  }

  /**
   * 检查积分是否足够
   */
  function checkCredits(requiredCredits: number = 50) {
    return userCredits.value >= requiredCredits
  }

  // 返回 store 对象
  return {
    // 状态
    isLoggedIn,
    isCheckingLogin,
    userInfo,
    loginError,
    isAdmin,
    isCheckingAdmin,
    activationCode,
    activationLoading,
    activationError,
    activationEffects,

    // Getters
    username,
    expiryDate,
    memberLevel,
    userCredits,

    // Actions
    checkLoginStatus,
    login,
    register,
    logout,
    activateCode,
    changePassword,
    resetPassword,
    checkCredits,
    checkIsAdmin,
    skipLoginForDev,
  }
})
