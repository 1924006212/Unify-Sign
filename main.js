/*
 * @Author: TonyJiangWJ
 * @Last Modified by: TonyJiangWJ
 * @Last Modified time: 2025-01-25 10:03:21
 * @Description: 
 */
require('./modules/init_if_needed.js')(runtime, this)
let { config } = require('./config.js')(runtime, this)
const resolver = require('./lib/AutoJSRemoveDexResolver.js')
let singletonRequire = require('./lib/SingletonRequirer.js')(runtime, this)
let runningQueueDispatcher = singletonRequire('RunningQueueDispatcher')


let { logInfo, errorInfo, warnInfo, debugInfo, infoLog, debugForDev, flushAllLogs } = singletonRequire('LogUtils')
    // 不管其他脚本是否在运行 清除任务队列 适合只使用蚂蚁森林的用户
if (config.single_script) {
    logInfo('======单脚本运行直接清空任务队列=======')
    runningQueueDispatcher.clearAll()
}
let FloatyInstance = singletonRequire('FloatyUtil')
let commonFunctions = singletonRequire('CommonFunction')
let automator = singletonRequire('Automator')
config.not_lingering_float_window = true
commonFunctions.delayIfBatteryLow()
logInfo('======加入任务队列，并关闭重复运行的脚本=======')
runningQueueDispatcher.addRunningTask()
let callStateListener = !config.is_pro && config.enable_call_state_control ? singletonRequire('CallStateListener') : { exitIfNotIdle: () => {} }
    // 用于代理图片资源，请勿移除 否则需要手动添加recycle代码
let resourceMonitor = require('./lib/ResourceMonitor.js')(runtime, this)
let unlocker = require('./lib/Unlock.js')
let mainExecutor = require('./core/MainExecutor.js')
callStateListener.exitIfNotIdle()

let localOcrUtil = require('./lib/LocalOcrUtil.js')
commonFunctions.killDuplicateScript()
logInfo('======初始化SQLite=======')
let signTaskService = singletonRequire('SignTaskService')
let signTaskManager = singletonRequire('SignTaskManager')
    // 初始化数据库连接
try {
    signTaskService.init()
} catch (e) {
    errorInfo('初始化数据库连接失败，五分钟后重试' + e)
    commonFunctions.setUpAutoStart(5)
    exit()
}
// debugInfo(['任务分组数据：{}', JSON.stringify(signTaskService.listGroupScheduleConfig())])
logInfo('======初始化SQLite成功=======')

logInfo('======初始化任务数据=======')
signTaskManager.init()
    .generateDefaultScheduleConfig()
    .generateTaskSchedules()
    .exitIfNoTaskToExecute()
logInfo('======初始化任务数据成功=======')
    // 注册自动移除运行中任务
commonFunctions.registerOnEngineRemoved(function() {
        config.resetBrightness && config.resetBrightness()
        events.removeAllListeners()
        events.recycle()
        debugInfo('校验并移除已加载的dex')
        resolver()
        flushAllLogs()
            // 针对免费版内存主动释放，Pro版不需要
        commonFunctions.reduceConsoleLogs()
            // 移除运行中任务
        runningQueueDispatcher.removeRunningTask(true, true,
            () => {
                // 保存是否需要重新锁屏
                unlocker.saveNeedRelock()
                config.isRunning = false
            }
        )
    }, 'main')
    /***********************
     * 初始化
     ***********************/
logInfo('======校验无障碍功能======')
    // 检查手机是否开启无障碍服务
    // 当无障碍经常莫名消失时  可以传递true 强制开启无障碍
    // if (!commonFunctions.ensureAccessibilityEnabled(true)) {
if (!commonFunctions.ensureAccessibilityEnabled()) {
    errorInfo('获取无障碍权限失败')
    exit()
}
commonFunctions.markExtendSuccess()
logInfo('---前置校验完成;启动系统--->>>>')
logInfo(['脚本版本：{}', config.code_version])
logInfo(['AutoJS version: {}', app.autojs.versionName])
logInfo(['device info: {} {} {}', device.brand, device.product, device.release])

logInfo(['设备分辨率：[{}, {}]', config.device_width, config.device_height])
logInfo('======解锁并校验截图权限======')
try {
    unlocker.exec()
} catch (e) {
    if (!config.forceStop) {
        errorInfo('解锁发生异常, 三分钟后重新开始' + e)
        commonFunctions.printExceptionStack(e)
        commonFunctions.setUpAutoStart(3)
        runningQueueDispatcher.removeRunningTask()
        exit()
    }
}
commonFunctions.forceCheckForcegroundPermission()
logInfo('解锁成功')

// 请求截图权限
let executeArguments = engines.myEngine().execArgv
debugInfo(['启动参数：{}', JSON.stringify(executeArguments)])
    // 定时启动的任务, 将截图权限滞后请求
if (!executeArguments.intent || executeArguments.executeByDispatcher) {
    commonFunctions.requestScreenCaptureOrRestart()
    commonFunctions.ensureDeviceSizeValid()
}
// 初始化悬浮窗
if (!FloatyInstance.init()) {
    runningQueueDispatcher.removeRunningTask()
        // 悬浮窗初始化失败，6秒后重试
    sleep(6000)
    runningQueueDispatcher.executeTargetScript(FileUtils.getRealMainScriptPath())
    exit()
}
FloatyInstance.enableLog()
    // 自动设置刘海偏移量
commonFunctions.autoSetUpBangOffset()
    // 开启websocket监控
require('./lib/WebsocketCaptureHijack.js')()
    /************************
     * 主程序
     ***********************/
commonFunctions.showDialogAndWait(true)
commonFunctions.listenDelayStart()

// 开发模式不包裹异常捕捉，方便查看错误信息
if (config.develop_mode) {
    mainExecutor.exec()
} else {
    try {
        mainExecutor.exec()
    } catch (e) {
        commonFunctions.setUpAutoStart(1)
        errorInfo('执行异常, 1分钟后重新开始' + e)
        commonFunctions.printExceptionStack(e)
    }
}

if (config.auto_lock === true && unlocker.needRelock() === true) {
    debugInfo('重新锁定屏幕')
    automator.lockScreen()
    unlocker.saveNeedRelock(true)
}
// 关闭悬浮窗
FloatyInstance.close()
flushAllLogs()
runningQueueDispatcher.removeRunningTask(true)

exit()