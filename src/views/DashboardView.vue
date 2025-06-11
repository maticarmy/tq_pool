<script setup lang="ts">
  import {
    NCard,
    NSpace,
    NButton,
    NProgress,
    NNumberAnimation,
    NGrid,
    NGridItem,
    NTag,
    NDivider,
    NModal,
    NScrollbar,
    useMessage,
  } from 'naive-ui'
  import { ref, onMounted, computed, watch } from 'vue'
  import { useI18n } from '../locales'
  import { checkCursorRunning } from '@/api'
  import type { UserInfo, CursorUserInfo, CursorUsageInfo } from '@/api/types'
  import { Window } from '@tauri-apps/api/window'
  import DashboardTourComponent from '../components/DashboardTour.vue'
  import MarkdownRenderComponent from '../components/MarkdownRender.vue'
  import ArticleList from '../components/ArticleList.vue'
  import { useRouter } from 'vue-router'
  import { useUserStore, useCursorStore, useAppStore, useArticleStore } from '@/stores'
  import CursorRunningModal from '../components/CursorRunningModal.vue'
  import { open } from '@tauri-apps/plugin-shell'
  import {
    checkFullDiskAccessPermission,
    requestFullDiskAccessPermission,
  } from 'tauri-plugin-macos-permissions-api'
  import Logger from '@/utils/logger'

  interface DeviceInfoState {
    machineCode: string
    currentAccount: string
    cursorToken: string
    userInfo: UserInfo | null
    cursorInfo: {
      userInfo: CursorUserInfo | null
      usage: CursorUsageInfo | null
      errorType: string | null
    }
    hookStatus: boolean | null
  }

  // 格式化日期
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  }

  // 计算并格式化剩余时间
  const formatTimeRemaining = (expireTimeStr: string) => {
    if (!expireTimeStr) return i18n.value.common.timeUnknown

    // 解析过期时间
    const expireTime = new Date(expireTimeStr.replace(/-/g, '/'))
    const now = new Date()

    // 如果已过期，返回已过期提示
    if (expireTime <= now) return i18n.value.common.timeExpired

    // 计算剩余毫秒数
    const remainingMs = expireTime.getTime() - now.getTime()

    // 转换为天、小时、分钟
    const days = Math.floor(remainingMs / (1000 * 60 * 60 * 24))
    const hours = Math.floor((remainingMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
    const minutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60))

    // 只显示最大的时间单位，精简信息量
    if (days > 0) {
      return `${days}${i18n.value.common.timeDays}`
    } else if (hours > 0) {
      return `${hours}${i18n.value.common.timeHours}`
    } else {
      return `${minutes}${i18n.value.common.timeMinutes}`
    }
  }

  const deviceInfo = ref<DeviceInfoState>({
    machineCode: '',
    currentAccount: '',
    cursorToken: '',
    userInfo: null,
    cursorInfo: {
      userInfo: null,
      usage: null,
      errorType: null,
    },
    hookStatus: null,
  })

  const loading = ref(true)

  const message = useMessage()
  const { i18n } = useI18n()

  // 在组件中初始化 Store
  const userStore = useUserStore()
  const cursorStore = useCursorStore()
  const appStore = useAppStore()
  const articleStore = useArticleStore()

  // 添加路由对象
  const router = useRouter()

  // 更新本地视图状态
  const updateLocalViewState = () => {
    deviceInfo.value = {
      machineCode: cursorStore.machineCode,
      currentAccount: cursorStore.currentAccount,
      cursorToken: cursorStore.cursorToken,
      userInfo: userStore.userInfo,
      cursorInfo: {
        userInfo: cursorStore.cursorInfo.userInfo,
        usage: cursorStore.cursorInfo.usage,
        errorType: cursorStore.cursorInfo.errorType,
      },
      hookStatus: cursorStore.hookStatus,
    }
  }

  // 计算使用量百分比
  const getUsagePercentage = (used: number, total: number) => {
    if (!total) return 0
    return Math.min(100, Math.round((used / total) * 100))
  }

  // 会员等级映射
  const levelMap: Record<
    number,
    {
      name: string
      type: 'default' | 'info' | 'success' | 'warning' | 'error'
    }
  > = {
    1: {
      name: i18n.value.dashboard.memberLevel[1],
      type: 'default',
    },
    2: {
      name: i18n.value.dashboard.memberLevel[2],
      type: 'info',
    },
    3: {
      name: i18n.value.dashboard.memberLevel[3],
      type: 'success',
    },
    4: {
      name: i18n.value.dashboard.memberLevel[4],
      type: 'warning',
    },
    5: {
      name: i18n.value.dashboard.memberLevel[5],
      type: 'error',
    },
  }

  const getMemberLevelName = (level: number) => {
    const validLevel = level >= 1 && level <= 5 ? level : 1
    return i18n.value.dashboard.memberLevel[validLevel as 1 | 2 | 3 | 4 | 5]
  }

  // 普通账户使用量百分比
  const accountUsagePercentage = computed(() => {
    if (!userStore.userInfo?.totalCount) return 0
    // 总数量大于等于9999 无限制 进度条显示为0
    if (userStore.userInfo.totalCount >= 9999) return 0
    return getUsagePercentage(userStore.userInfo.usedCount, userStore.userInfo.totalCount)
  })

  // Cursor高级模型使用量百分比
  const cursorGpt4Percentage = computed(() => {
    return cursorStore.gpt4Usage.percentage
  })

  // Cursor普通模型使用量百分比
  const cursorGpt35Percentage = computed(() => {
    // 如果没有设置maxRequestUsage或者maxRequestUsage为0，视为无限制，进度条显示为100%
    if (!deviceInfo.value.cursorInfo.usage?.['gpt-3.5-turbo']?.maxRequestUsage) return 100
    return cursorStore.gpt35Usage.percentage
  })

  // 获取用户信息
  const fetchUserInfo = async () => {
    try {
      await userStore.checkLoginStatus()
      updateLocalViewState()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '链接服务器失败，请检查网络连接')
    }
  }

  // 添加新的 ref
  const showCursorRunningModal = ref(false)
  const pendingForceKillAction = ref<{
    type: 'machine' | 'account' | 'quick'
    params?: any
  } | null>(null)

  const checkHookAndRedirect = () => {
    if (!deviceInfo.value.hookStatus) {
      message.info('需要先注入客户端才能使用这个功能')
      router.push('/settings')
      return false
    }
    return true
  }

  // 修改机器码更换处理函数
  const handleMachineCodeChange = async (force_kill: boolean = false) => {
    try {
      await cursorStore.resetMachine({
        forceKill: force_kill,
      })
      message.success(i18n.value.dashboard.machineChangeSuccess)

      await fetchUserInfo()
      updateLocalViewState()
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      if (errorMsg === 'Cursor进程正在运行, 请先关闭Cursor') {
        showCursorRunningModal.value = true
        pendingForceKillAction.value = { type: 'machine' }
        return
      }
      message.error(i18n.value.dashboard.machineChangeFailed)
    }
  }

  // 修改账户切换处理函数
  const handleAccountSwitch = async () => {
    try {
      if (!checkHookAndRedirect()) {
        return
      }

      accountSwitchLoading.value = true

      // 检查积分是否足够
      if (!userStore.checkCredits(50)) {
        message.error(i18n.value.dashboard.insufficientCredits)
        router.push('/settings')
        return
      }

      // 检查 Cursor 是否在运行
      const isRunning = await checkCursorRunning()

      if (isRunning) {
        showCursorRunningModal.value = true
        pendingForceKillAction.value = { type: 'account' }
        return
      }

      await executeAccountSwitch()
    } catch (error) {
      Logger.error(`账户切换失败: ${error}`)
      message.error('操作失败: ' + (error instanceof Error ? error.message : String(error)))
    } finally {
      accountSwitchLoading.value = false
    }
  }

  // 修改一键切换处理函数
  const handleQuickChange = async () => {
    try {
      if (!checkHookAndRedirect()) {
        return
      }

      quickChangeLoading.value = true

      // 检查积分是否足够
      if (!userStore.checkCredits(50)) {
        message.error(i18n.value.dashboard.insufficientCredits)
        router.push('/settings')
        return
      }

      // 检查 Cursor 是否在运行
      const isRunning = await checkCursorRunning()

      if (isRunning) {
        showCursorRunningModal.value = true
        pendingForceKillAction.value = { type: 'quick' }
        return
      }

      await executeQuickChange()
    } catch (error) {
      Logger.error(`一键切换失败: ${error}`)
      message.error('操作失败: ' + (error instanceof Error ? error.message : String(error)))
    } finally {
      quickChangeLoading.value = false
    }
  }

  // 修改账户切换执行函数
  const executeAccountSwitch = async (force_kill: boolean = false): Promise<boolean> => {
    try {
      const result = await cursorStore.switchCursorAccount(undefined, undefined, force_kill)

      // 只有当操作成功时才显示成功消息和刷新数据
      if (result === true) {
        message.success(i18n.value.dashboard.accountChangeSuccess)

        await fetchUserInfo()
        updateLocalViewState()
        return true
      }
      return false
    } catch (error) {
      Logger.error(`账户切换失败: ${error}`)
      message.error(
        error instanceof Error ? error.message : i18n.value.dashboard.accountChangeFailed,
      )
      return false
    }
  }

  // 修改一键切换执行函数
  const executeQuickChange = async (force_kill: boolean = false): Promise<boolean> => {
    try {
      const result = await cursorStore.quickChange(undefined, undefined, force_kill)

      // 只有当操作成功时才显示成功消息和刷新数据
      if (result === true) {
        message.success(i18n.value.dashboard.changeSuccess)

        await fetchUserInfo()
        updateLocalViewState()
        return true
      }
      return false
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      if (errorMsg === 'Cursor进程正在运行, 请先关闭Cursor') {
        showCursorRunningModal.value = true
        pendingForceKillAction.value = {
          type: 'quick',
        }
        return false
      }
      message.error(error instanceof Error ? error.message : i18n.value.dashboard.changeFailed)
      return false
    }
  }

  // 修改强制关闭处理函数
  const handleForceKill = async () => {
    showCursorRunningModal.value = false
    if (!pendingForceKillAction.value) return

    try {
      if (!checkHookAndRedirect()) {
        return
      }

      loading.value = true
      message.loading('正在关闭 Cursor...', { duration: 0 })

      // 关闭Cursor
      await cursorStore.closeCursorApp()

      // 等待一段时间确保进程完全关闭
      await new Promise((resolve) => setTimeout(resolve, 1000))

      message.destroyAll() // 清除 loading 消息

      // 根据类型执行相应操作
      let operationSuccess = false
      let operationMessage = ''

      // 根据类型执行具体操作
      if (pendingForceKillAction.value.type === 'machine') {
        message.loading('正在更换机器码...', { duration: 0 })
        await handleMachineCodeChange(true)
        operationSuccess = true
        operationMessage = i18n.value.dashboard.machineChangeSuccess
      } else if (pendingForceKillAction.value.type === 'account') {
        message.loading('正在切换账户...', { duration: 0 })
        try {
          const success = await executeAccountSwitch(true)
          if (success) {
            operationSuccess = true
            operationMessage = i18n.value.dashboard.accountChangeSuccess
          }
        } catch (error) {
          Logger.error(`强制切换账户失败: ${error}`)
          message.destroyAll()
          message.error(error instanceof Error ? error.message : String(error))
          return
        }
      } else if (pendingForceKillAction.value.type === 'quick') {
        message.loading('正在一键切换...', { duration: 0 })
        try {
          const success = await executeQuickChange(true)
          if (success) {
            operationSuccess = true
            operationMessage = i18n.value.dashboard.changeSuccess
          }
        } catch (error) {
          Logger.error(`强制一键切换失败: ${error}`)
          message.destroyAll()
          message.error(error instanceof Error ? error.message : String(error))
          return
        }
      }

      message.destroyAll() // 清除操作中的loading消息

      if (operationSuccess) {
        message.success(operationMessage)

        // 等待一小段时间确保所有后端操作完成
        await new Promise((resolve) => setTimeout(resolve, 500))

        // 直接启动Cursor，不再询问
        message.loading('正在启动 Cursor...', { duration: 0 })
        try {
          await cursorStore.launchCursorApp()
          message.destroyAll()
          message.success('Cursor 已启动')
        } catch (launchError) {
          message.destroyAll()
          message.error(
            '启动 Cursor 失败: ' +
              (launchError instanceof Error ? launchError.message : String(launchError)),
          )
        }
      }
    } catch (error) {
      message.destroyAll()
      message.error('操作失败: ' + (error instanceof Error ? error.message : String(error)))
    } finally {
      loading.value = false
      pendingForceKillAction.value = null
    }
  }

  const copyText = (text: string) => {
    if (!text) return
    navigator.clipboard
      .writeText(text)
      .then(() => {
        message.success(i18n.value.common.copySuccess)
      })
      .catch(() => {
        message.error(i18n.value.common.copyFailed)
      })
  }

  // 添加新的 ref
  const showAdminPrivilegeModal = ref(false)

  // 检查管理员权限
  const checkPrivileges = async () => {
    try {
      await userStore.checkIsAdmin()
      if (userStore.isAdmin === false) {
        showAdminPrivilegeModal.value = true
      }
    } catch (error) {
      Logger.error(`检查管理员权限失败: ${error}`)
      message.error('检查管理员权限失败')
    }
  }

  // 退出程序
  const handleExit = async () => {
    const appWindow = new Window('main')
    await appWindow.close()
  }

  // 添加macOS权限检查功能
  const checkMacOSPermissions = async () => {
    if (appStore.currentPlatform === 'macos') {
      try {
        // 检查完全磁盘访问权限
        const checkPermission = async () => {
          const hasDiskAccess = await checkFullDiskAccessPermission()
          if (hasDiskAccess) {
            // 如果已获得权限，关闭弹窗
            showAdminPrivilegeModal.value = false
            return true
          }
          return false
        }

        // 首次检查
        const initialCheck = await checkPermission()

        if (!initialCheck) {
          // 显示权限弹窗
          showAdminPrivilegeModal.value = true
        }
      } catch (error) {
        Logger.error(`检查macOS权限失败: ${error}`)
      }
    }
  }

  // 添加处理权限请求的函数
  const handleRequestFullDiskAccess = async () => {
    try {
      // 请求完全磁盘访问权限
      await requestFullDiskAccessPermission()

      // 权限请求后开始循环检查权限状态
      const checkLoop = async () => {
        const hasDiskAccess = await checkFullDiskAccessPermission()
        if (hasDiskAccess) {
          // 如果已获得权限，关闭弹窗
          showAdminPrivilegeModal.value = false
          return
        }
        // 如果未获得权限，1秒后再次检查
        setTimeout(checkLoop, 1000)
      }

      // 开始检查循环
      checkLoop()
    } catch (error) {
      Logger.error(`请求完全磁盘访问权限失败: ${error}`)
      message.error('请求权限失败')
    }
  }

  // 在组件挂载时获取所有信息
  onMounted(async () => {
    try {
      loading.value = true

      // 检查权限
      if (appStore.currentPlatform === 'macos') {
        await checkMacOSPermissions()
      } else if (appStore.currentPlatform === 'windows') {
        await checkPrivileges()
      }

      // 初始化按钮显示状态
      await appStore.initButtonSettings()

      // 检查是否需要强制刷新数据
      const needRefresh = localStorage.getItem('need_refresh_dashboard')
      if (needRefresh === 'true' || !userStore.userInfo || !cursorStore.cursorInfo.userInfo) {
        // 清除刷新标记
        localStorage.removeItem('need_refresh_dashboard')

        // 初始化应用设置
        appStore.initAppSettings()

        // 获取用户信息
        await fetchUserInfo()

        // 获取Cursor信息
        try {
          await cursorStore.fetchMachineIds()
        } catch (error) {
          Logger.warn(`获取机器码信息失败，但继续执行: ${error}`)
        }

        try {
          await cursorStore.fetchCursorUsage()
        } catch (error) {
          Logger.warn(`获取Cursor使用量失败，但继续执行: ${error}`)
        }

        try {
          await cursorStore.checkHook()
        } catch (error) {
          Logger.warn(`检查Hook状态失败，但继续执行: ${error}`)
        }

        // 更新视图状态
        updateLocalViewState()

        // 检查免责声明
        await appStore.fetchDisclaimer()

        try {
          // 只在免责声明已接受的情况下显示引导
          if (!appStore.showDisclaimerModal) {
            // 使用appStore的方法获取引导状态
            await appStore.fetchTourStatus()

            // 使用store中的计算属性
            const isLoggedIn = userStore.userInfo !== null

            // 只有当用户已登录且引导状态不为true时才显示引导
            if (isLoggedIn && appStore.shouldShowTour) {
              setTimeout(() => {
                startTour()
              }, 500)
            }
          }
        } catch (error) {
          Logger.error(`获取引导状态失败: ${error}`)
        }
      } else {
        // 更新视图状态
        updateLocalViewState()
      }
    } catch (error) {
      Logger.error(`Dashboard初始化错误: ${error}`)
      message.error('初始化失败，请刷新页面重试')
    } finally {
      loading.value = false
    }

    // 添加事件监听器
    window.addEventListener('refresh_dashboard_data', async () => {
      try {
        loading.value = true
        await userStore.checkLoginStatus()
        await cursorStore.refreshAllCursorData()
        updateLocalViewState()
      } catch (error) {
        Logger.error(`刷新数据失败: ${error}`)
        message.error('刷新数据失败')
      } finally {
        loading.value = false
      }
    })
  })

  // 添加引导相关状态
  const shouldShowTour = ref(false)

  // 添加加载状态
  const machineCodeLoading = ref(false)
  const accountSwitchLoading = ref(false)
  const quickChangeLoading = ref(false)

  // 修改免责声明确认处理函数
  const handleConfirmDisclaimer = async () => {
    // 确认免责声明，会自动检查引导状态
    const success = await appStore.confirmDisclaimer()

    if (success) {
      // 检查是否需要显示引导
      const isLoggedIn = userStore.userInfo !== null

      // 只有当用户已登录且引导状态不为true时才显示引导
      if (isLoggedIn && appStore.shouldShowTour) {
        setTimeout(() => {
          startTour()
        }, 500)
      }
    }
  }

  // 开始引导
  const startTour = () => {
    // 检查是否有公告正在显示
    if (articleStore.hasUnreadArticles) {
      // 添加一个事件监听，当公告全部已读时再显示引导
      const checkInterval = setInterval(() => {
        if (!articleStore.hasUnreadArticles) {
          shouldShowTour.value = true
          clearInterval(checkInterval)
        }
      }, 1000)
    } else {
      // 没有公告，直接显示引导
      shouldShowTour.value = true
    }
  }

  // 处理引导完成
  const handleTourComplete = () => {
    shouldShowTour.value = false
  }

  // 同步 store 的状态到本地视图状态
  watch(
    [
      () => cursorStore.machineCode,
      () => cursorStore.currentAccount,
      () => cursorStore.hookStatus,
      () => cursorStore.cursorInfo,
      () => userStore.userInfo,
    ],
    () => {
      updateLocalViewState()
    },
  )

  // 监听模态框状态变化，如果有模态框显示，则隐藏引导
  watch(
    [
      () => showAdminPrivilegeModal,
      () => showCursorRunningModal,
      () => appStore.showDisclaimerModal,
    ],
    ([adminModal, cursorModal, disclaimerModal]) => {
      if (adminModal || cursorModal || disclaimerModal) {
        shouldShowTour.value = false
      }
    },
  )

  // 修改机器码处理函数
  const handleMachineCodeClick = async () => {
    try {
      if (!checkHookAndRedirect()) {
        return
      }

      machineCodeLoading.value = true

      // 检查 Cursor 是否在运行
      const isRunning = await checkCursorRunning()
      if (isRunning) {
        showCursorRunningModal.value = true
        pendingForceKillAction.value = { type: 'machine' }
        return
      }

      await handleMachineCodeChange(false)
    } catch (error) {
      Logger.error(`机器码更换失败: ${error}`)
      message.error('操作失败: ' + (error instanceof Error ? error.message : String(error)))
    } finally {
      machineCodeLoading.value = false
    }
  }

  // 监听登录状态变化
  watch(
    () => userStore.isLoggedIn,
    (newVal, oldVal) => {
      // 只在从未登录变为已登录时触发
      if (newVal === true && oldVal === false) {
        // 延迟检查，确保所有数据都已加载
        setTimeout(async () => {
          if (!appStore.showDisclaimerModal) {
            await appStore.fetchTourStatus()

            if (appStore.shouldShowTour) {
              startTour()
            }
          }
        }, 500)
      }
    },
  )

  // 获取会员状态文本
  const getMemberStatusText = (codeStatus: number, expireTime: string) => {
    // 如果状态是1(已使用)，显示剩余时间
    if (codeStatus === 1) {
      return formatTimeRemaining(expireTime)
    }

    // 不同状态对应的文本
    const statusMap: Record<number, string> = {
      0: i18n.value.dashboard.codeUnused,
      2: i18n.value.dashboard.codeExpired,
      3: i18n.value.dashboard.codeRefunded,
      4: i18n.value.dashboard.codeEnded,
    }

    // 返回状态对应的文本，如果没有对应的状态，返回未知
    return statusMap[codeStatus] || i18n.value.common.statusUnknown
  }

  // 获取会员状态标签类型
  const getMemberStatusTagType = (codeStatus: number) => {
    const typeMap: Record<number, 'default' | 'info' | 'success' | 'warning' | 'error'> = {
      0: 'info', // 未使用
      1: 'success', // 已使用(正常)
      2: 'error', // 已过期
      3: 'warning', // 已退款
      4: 'error', // 已结束
    }

    return typeMap[codeStatus] || 'default'
  }

  // 添加获取错误消息的函数
  const getCursorErrorMessage = (errorType: string | null) => {
    if (!errorType) return i18n.value.dashboard.cannotGetUsage

    switch (errorType) {
      case 'cursor_db_error':
        return i18n.value.dashboard.cursorDbError
      case 'cursor_network_error':
        return i18n.value.dashboard.cursorNetworkError
      case 'cursor_data_error':
        return i18n.value.dashboard.cursorDataError
      case 'cursor_unknown_error':
      default:
        return i18n.value.dashboard.cursorUnknownError
    }
  }

  // 添加官方链接点击处理函数
  const openOfficialWebsite = async () => {
    try {
      await open('https://cursorpro.com.cn')
    } catch (error) {
      Logger.error(`打开官网失败: ${error}`)
      message.error('打开链接失败')
    }
  }

  const openPurchaseLink = async () => {
    try {
      await open('https://cursorpro.com.cn/pricing')
    } catch (error) {
      Logger.error(`打开购买页面失败: ${error}`)
      message.error('打开链接失败')
    }
  }

  const openSupportLink = async () => {
    try {
      await open('https://cursorpro.com.cn/support')
    } catch (error) {
      Logger.error(`打开技术支持页面失败: ${error}`)
      message.error('打开链接失败')
    }
  }
</script>

<template>
  <n-space
    vertical
    size="large"
  >
    <article-list v-if="userStore.userInfo && !appStore.showDisclaimerModal" />

    <n-grid
      :cols="2"
      :x-gap="24"
      style="display: grid; grid-template-columns: repeat(2, 1fr)"
    >
      <!-- 用户信息卡片 -->
      <n-grid-item style="display: grid">
        <n-card
          :title="i18n.dashboard.userInfo"
          class="user-info-card"
          style="height: 100%; user-select: none"
        >
          <n-space vertical>
            <n-space
              vertical
              :size="12"
              style="user-select: none"
            >
              <n-space
                :size="8"
                style="line-height: 1.2"
                class="user-info-username"
              >
                <span style="width: 70px">{{ i18n.dashboard.username }}</span>
                <n-space
                  :size="4"
                  align="center"
                >
                  <span
                    style="font-size: 14px; cursor: pointer"
                    @click="deviceInfo.userInfo?.username && copyText(deviceInfo.userInfo.username)"
                  >
                    {{ deviceInfo.userInfo?.username }}
                  </span>
                  <n-tag
                    :type="levelMap[deviceInfo.userInfo?.level || 1].type"
                    size="tiny"
                    style="transform: scale(0.9)"
                  >
                    {{ getMemberLevelName(deviceInfo.userInfo?.level || 1) }}
                  </n-tag>
                  <n-tag
                    v-if="deviceInfo.userInfo?.code_status !== undefined"
                    :type="getMemberStatusTagType(deviceInfo.userInfo.code_status)"
                    size="tiny"
                    style="transform: scale(0.9)"
                  >
                    {{
                      getMemberStatusText(
                        deviceInfo.userInfo.code_status,
                        deviceInfo.userInfo?.expireTime || '',
                      )
                    }}
                  </n-tag>
                </n-space>
              </n-space>

              <n-divider style="margin: 0" />

              <n-space
                :size="8"
                style="line-height: 1.2"
                class="user-info-email"
              >
                <span style="width: 70px">{{ i18n.dashboard.email }}</span>
                <n-space
                  :size="4"
                  align="center"
                >
                  <span
                    style="font-size: 14px; cursor: pointer"
                    @click="
                      deviceInfo.cursorInfo.userInfo?.email &&
                      copyText(deviceInfo.cursorInfo.userInfo?.email)
                    "
                  >
                    {{ deviceInfo.cursorInfo.userInfo?.email || '未绑定' }}
                  </span>
                  <n-tag
                    :type="deviceInfo.cursorInfo.userInfo?.email_verified ? 'success' : 'warning'"
                    size="tiny"
                    style="transform: scale(0.9)"
                  >
                    {{
                      deviceInfo.cursorInfo.userInfo?.email_verified
                        ? i18n.systemControl.clientVerified
                        : i18n.systemControl.clientUnverified
                    }}
                  </n-tag>
                </n-space>
              </n-space>
              <n-space
                :size="8"
                style="line-height: 1.2"
                class="user-info-cc-status"
              >
                <span style="width: 70px">{{ i18n.dashboard.ccStatus }}</span>
                <n-tag
                  :type="deviceInfo.hookStatus === true ? 'success' : 'error'"
                  size="tiny"
                >
                  {{
                    deviceInfo.hookStatus === true
                      ? i18n.systemControl.hookApplied
                      : i18n.systemControl.hookNotApplied
                  }}
                </n-tag>
              </n-space>
              <n-space
                :size="8"
                style="line-height: 1.2"
                class="user-info-register-time"
              >
                <span style="width: 70px">{{ i18n.dashboard.registerTime }}</span>
                <span
                  style="font-size: 14px; cursor: pointer"
                  @click="
                    copyText(
                      deviceInfo.cursorInfo.usage?.startOfMonth
                        ? formatDate(deviceInfo.cursorInfo.usage.startOfMonth)
                        : '',
                    )
                  "
                >
                  {{
                    deviceInfo.cursorInfo.usage?.startOfMonth
                      ? formatDate(deviceInfo.cursorInfo.usage.startOfMonth)
                      : '未知'
                  }}
                </span>
              </n-space>
              <span
                style="
                  font-size: 12px;
                  color: #999;
                  word-break: break-all;
                  text-align: center;
                  cursor: pointer;
                "
                class="user-info-machine-code"
                @click="copyText(deviceInfo.machineCode)"
              >
                {{ deviceInfo.machineCode }}
              </span>
            </n-space>
          </n-space>
        </n-card>
      </n-grid-item>

      <!-- 使用统计卡片 -->
      <n-grid-item style="display: grid">
        <n-card
          :title="i18n.dashboard.usageStats"
          style="height: 100%; user-select: none"
        >
          <n-space
            vertical
            :size="24"
            style="height: 100%; justify-content: space-around"
          >
            <!-- 账户使用统计 -->
            <n-space
              vertical
              :size="8"
              class="cursor-pool-usage"
            >
              <n-space justify="space-between">
                <span>{{ i18n.dashboard.cpUsage }}</span>
                <n-space :size="0">
                  <n-number-animation
                    :from="0"
                    :to="deviceInfo.userInfo?.usedCount || 0"
                    :duration="1000"
                  />
                  <span
                    v-if="deviceInfo.userInfo?.totalCount && deviceInfo.userInfo.totalCount >= 9999"
                  >
                    /{{ i18n.dashboard.unlimited }}
                  </span>
                  <span v-else>/{{ deviceInfo.userInfo?.totalCount || 0 }}</span>
                </n-space>
              </n-space>
              <n-progress
                type="line"
                status="success"
                :percentage="accountUsagePercentage"
                :show-indicator="false"
                :height="12"
                :border-radius="6"
                :processing="loading"
              />
            </n-space>

            <!-- Cursor GPT-4 使用统计 -->
            <n-space
              vertical
              :size="8"
              class="advanced-model-usage"
            >
              <n-space justify="space-between">
                <span>{{ i18n.dashboard.advancedModelUsage }}</span>
                <n-space
                  v-if="deviceInfo.cursorInfo.usage"
                  :size="0"
                >
                  <n-number-animation
                    :from="0"
                    :to="deviceInfo.cursorInfo.usage['gpt-4']?.numRequests || 0"
                    :duration="1000"
                  />
                  <span>/{{ deviceInfo.cursorInfo.usage['gpt-4']?.maxRequestUsage || 0 }}</span>
                </n-space>
                <span v-else>{{ getCursorErrorMessage(deviceInfo.cursorInfo.errorType) }}</span>
              </n-space>
              <n-progress
                type="line"
                status="success"
                :percentage="cursorGpt4Percentage"
                :show-indicator="false"
                :height="12"
                :border-radius="6"
                :processing="loading"
              />
            </n-space>

            <!-- Cursor GPT-3.5 使用统计 -->
            <n-space
              vertical
              :size="8"
              class="basic-model-usage"
            >
              <n-space justify="space-between">
                <span>{{ i18n.dashboard.basicModelUsage }}</span>
                <n-space
                  v-if="deviceInfo.cursorInfo.usage"
                  :size="0"
                >
                  <n-number-animation
                    :from="0"
                    :to="deviceInfo.cursorInfo.usage['gpt-3.5-turbo']?.numRequests || 0"
                    :duration="1000"
                  />
                  <span v-if="deviceInfo.cursorInfo.usage['gpt-3.5-turbo']?.maxRequestUsage">
                    /{{ deviceInfo.cursorInfo.usage['gpt-3.5-turbo']?.maxRequestUsage }}
                  </span>
                  <span v-else>/{{ i18n.dashboard.unlimited }}</span>
                </n-space>
                <span v-else>{{ getCursorErrorMessage(deviceInfo.cursorInfo.errorType) }}</span>
              </n-space>
              <n-progress
                type="line"
                status="success"
                :percentage="cursorGpt35Percentage"
                :show-indicator="false"
                :height="12"
                :border-radius="6"
                :processing="loading"
              />
            </n-space>
          </n-space>
        </n-card>
      </n-grid-item>
    </n-grid>

    <!-- 快捷操作卡片 -->
    <n-card
      :title="i18n.dashboard.quickActions"
      class="quick-actions-card"
      style="user-select: none"
    >
      <n-space vertical>
        <n-space :justify="appStore.showAllButtons ? 'space-around' : 'center'">
          <n-button
            type="primary"
            :disabled="!deviceInfo.userInfo"
            :loading="quickChangeLoading"
            :style="!appStore.showAllButtons ? { width: '200px' } : {}"
            @click="handleQuickChange"
          >
            {{ i18n.dashboard.quickChange }}
          </n-button>

          <template v-if="appStore.showAllButtons">
            <n-button
              type="primary"
              :disabled="!deviceInfo.userInfo"
              :loading="accountSwitchLoading"
              class="account-switch-button"
              @click="handleAccountSwitch"
            >
              {{ i18n.dashboard.changeAccount }}
            </n-button>
            <n-button
              type="primary"
              :loading="machineCodeLoading"
              @click="handleMachineCodeClick"
            >
              {{ i18n.dashboard.changeMachineCode }}
            </n-button>
          </template>
        </n-space>
      </n-space>
    </n-card>

    <!-- 官网和购买链接卡片 -->
    <n-card
      title="官方链接"
      class="official-links-card"
      style="user-select: none"
    >
      <n-space
        justify="center"
        :size="24"
      >
        <n-button
          type="info"
          ghost
          style="width: 160px"
          @click="openOfficialWebsite"
        >
          🌐 官方网站
        </n-button>
        <n-button
          type="success"
          style="width: 160px"
          @click="openPurchaseLink"
        >
          💎 购买激活码
        </n-button>
        <n-button
          type="warning"
          ghost
          style="width: 160px"
          @click="openSupportLink"
        >
          💬 技术支持
        </n-button>
      </n-space>
    </n-card>

    <!-- 添加 Cursor 运行提醒模态框 -->
    <cursor-running-modal
      v-model:show="showCursorRunningModal"
      :title="i18n.common.cursorRunning"
      :content="i18n.common.cursorRunningMessage"
      :confirm-button-text="i18n.common.forceClose"
      @confirm="handleForceKill"
    />

    <!-- 添加管理员权限提示模态框 -->
    <n-modal
      v-model:show="showAdminPrivilegeModal"
      preset="dialog"
      title="需要权限"
      :closable="false"
      :mask-closable="false"
      :close-on-esc="false"
      style="width: 500px"
    >
      <template #header>
        <n-space align="center">
          <span>需要权限</span>
        </n-space>
      </template>
      <div style="margin: 24px 0">
        <p>本程序需要足够的文件访问权限才能正常运行。</p>
        <p
          v-if="appStore.currentPlatform === 'windows'"
          style="margin-top: 12px; color: #999"
        >
          请右键点击程序图标，选择"以管理员身份运行"后重新启动程序。
        </p>
        <template v-else-if="appStore.currentPlatform === 'macos'">
          <div
            style="
              margin-top: 12px;
              display: flex;
              justify-content: space-between;
              align-items: center;
            "
          >
            <span style="color: #666">完全磁盘访问权限：</span>
            <n-button
              size="small"
              type="primary"
              @click="handleRequestFullDiskAccess"
              >授予权限</n-button
            >
          </div>
        </template>
        <p
          v-else
          style="margin-top: 12px; color: #999"
        >
          请确保本程序有足够的文件访问权限。
        </p>
      </div>
      <template #action>
        <n-space justify="end">
          <template v-if="appStore.currentPlatform === 'macos'">
            <n-button
              type="info"
              @click="open('https://cursorpro.com.cn/docs')"
              >查看文档</n-button
            >
            <n-button
              type="default"
              @click="handleExit"
              >退出程序</n-button
            >
          </template>
          <template v-else>
            <n-button
              type="error"
              block
              @click="handleExit"
              >退出程序</n-button
            >
          </template>
        </n-space>
      </template>
    </n-modal>

    <!-- 添加免责声明模态框 -->
    <n-modal
      v-model:show="appStore.showDisclaimerModal"
      preset="card"
      style="width: 600px; max-width: 90vw"
      title="免责声明"
      :closable="false"
      :mask-closable="false"
    >
      <n-scrollbar style="height: 60vh; overflow: auto">
        <MarkdownRenderComponent :content="appStore.disclaimerContent" />
      </n-scrollbar>
      <template #footer>
        <n-space justify="end">
          <n-button
            type="primary"
            :disabled="!appStore.canConfirmDisclaimer"
            @click="handleConfirmDisclaimer"
          >
            {{
              appStore.canConfirmDisclaimer
                ? '我已阅读并同意'
                : `请等待 ${appStore.disclaimerCountdown} 秒`
            }}
          </n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 添加引导组件 -->
    <DashboardTourComponent
      :show="shouldShowTour"
      :on-complete="handleTourComplete"
    />
  </n-space>
</template>

<style scoped>
  /* 添加样式确保 grid 项目高度一致 */
  .n-grid {
    grid-auto-rows: 1fr;
  }

  .n-grid-item {
    min-height: 0;
  }
</style>
