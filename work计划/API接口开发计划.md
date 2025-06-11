# 🔧 API接口开发计划

## 📋 概述

基于ThinkAdminV6框架开发CursorPool后端API接口，主要实现版本管理、健康检查和线路测试等功能。

## 🎯 核心接口需求

### 1. 版本信息接口（高优先级）
- **路径**: `GET /api/version`
- **用途**: 客户端线路延迟测试、版本信息获取
- **特性**: 无需认证、快速响应(<100ms)、公共端点

### 2. 健康检查接口（中优先级）
- **路径**: `GET /api/version/health`
- **用途**: 服务健康状态监控
- **特性**: 系统状态、数据库连接、内存使用情况

## 📊 技术架构

### 框架选择: ThinkAdminV6
- **优势**: 基于ThinkPHP6/8，成熟稳定
- **特性**: 标准化API响应、CORS支持、中间件机制
- **响应格式**: 统一JSON格式

### 标准响应格式
```php
{
    "status": 200,
    "msg": "success", 
    "data": {},
    "code": "SUCCESS"
}
```

## 🚀 开发实施计划

### 阶段一：基础架构搭建（1天）

#### 1.1 目录结构创建
```
app/
├── api/
│   ├── controller/
│   │   └── Version.php
│   └── model/
│       └── SystemVersion.php
├── common/
│   └── controller/
│       └── BaseApi.php
└── middleware/
    └── Cors.php
```

#### 1.2 基础控制器
```php
// app/common/controller/BaseApi.php
class BaseApi extends Controller
{
    protected function apiResponse($data = [], $msg = 'success', $code = 200)
    {
        return Response::create([
            'status' => $code,
            'msg' => $msg,
            'data' => $data,
            'code' => $code == 200 ? 'SUCCESS' : 'ERROR'
        ], 'json')->code($code);
    }
}
```

### 阶段二：版本接口开发（1天）

#### 2.1 版本控制器实现
```php
// app/api/controller/Version.php
class Version extends BaseApi
{
    public function index()
    {
        $startTime = microtime(true);
        
        try {
            $versionData = [
                'app_version' => '1.0.0',
                'api_version' => 'v1',
                'build_time' => date('Y-m-d H:i:s'),
                'server_info' => [
                    'environment' => 'production',
                    'php_version' => PHP_VERSION,
                    'framework' => 'ThinkAdminV6'
                ]
            ];
            
            // 记录访问日志
            $this->logAccess('version_check');
            
            return $this->apiResponse($versionData, '版本信息获取成功');
            
        } catch (\Exception $e) {
            return $this->apiResponse([], '获取版本信息失败', 500);
        }
    }
}
```

#### 2.2 数据库设计
```sql
-- 系统版本表
CREATE TABLE `system_version` (
    `id` int(11) unsigned NOT NULL AUTO_INCREMENT,
    `app_version` varchar(50) NOT NULL COMMENT '应用版本',
    `api_version` varchar(50) NOT NULL COMMENT 'API版本',
    `build_time` datetime NOT NULL COMMENT '构建时间',
    `environment` varchar(20) DEFAULT 'production' COMMENT '环境',
    `is_active` tinyint(1) DEFAULT 1 COMMENT '是否激活',
    `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
    `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='系统版本管理';

-- 访问日志表
CREATE TABLE `system_version_log` (
    `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
    `client_ip` varchar(45) NOT NULL COMMENT '客户端IP',
    `user_agent` varchar(500) DEFAULT NULL COMMENT '用户代理',
    `request_time` datetime NOT NULL COMMENT '请求时间',
    `response_time` int(11) DEFAULT NULL COMMENT '响应时间(ms)',
    `access_type` varchar(20) DEFAULT 'version_check' COMMENT '访问类型',
    PRIMARY KEY (`id`),
    KEY `idx_client_ip` (`client_ip`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='版本访问日志';
```

### 阶段三：健康检查接口（1天）

#### 3.1 健康检查实现
```php
public function health()
{
    try {
        $health = [
            'status' => 'healthy',
            'timestamp' => time(),
            'uptime' => $this->getUptime(),
            'database' => $this->checkDatabase(),
            'memory_usage' => $this->getMemoryUsage(),
            'disk_usage' => $this->getDiskUsage()
        ];
        
        return $this->apiResponse($health, '服务健康');
        
    } catch (\Exception $e) {
        return $this->apiResponse(['status' => 'unhealthy'], '服务异常', 500);
    }
}

private function checkDatabase()
{
    try {
        Db::query('SELECT 1');
        return 'connected';
    } catch (\Exception $e) {
        return 'disconnected';
    }
}
```

### 阶段四：路由和中间件配置（0.5天）

#### 4.1 路由配置
```php
// route/api.php
use think\facade\Route;

Route::group('api', function () {
    Route::get('version', 'api/Version/index');
    Route::get('version/health', 'api/Version/health');
})->middleware(['cors']);
```

#### 4.2 CORS中间件
```php
// app/middleware/Cors.php
class Cors
{
    public function handle($request, \Closure $next)
    {
        header('Access-Control-Allow-Origin: *');
        header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
        
        if ($request->method() == 'OPTIONS') {
            return response('', 200);
        }
        
        return $next($request);
    }
}
```

## 📈 性能优化策略

### 1. 缓存机制
```php
// 版本信息缓存
public function index()
{
    $cacheKey = 'api_version_info';
    $cached = Cache::get($cacheKey);
    
    if ($cached) {
        return $this->apiResponse($cached, '版本信息获取成功');
    }
    
    $versionData = $this->getVersionData();
    Cache::set($cacheKey, $versionData, 300); // 缓存5分钟
    
    return $this->apiResponse($versionData, '版本信息获取成功');
}
```

### 2. 响应时间监控
```php
protected function logAccess($type = 'api_access')
{
    $startTime = microtime(true);
    
    try {
        $responseTime = intval((microtime(true) - $startTime) * 1000);
        
        Db::name('system_version_log')->insert([
            'client_ip' => request()->ip(),
            'user_agent' => request()->header('user-agent'),
            'request_time' => date('Y-m-d H:i:s'),
            'response_time' => $responseTime,
            'access_type' => $type
        ]);
    } catch (\Exception $e) {
        // 日志记录失败不影响主流程
    }
}
```

## 🧪 测试计划

### 1. 单元测试
```php
// tests/api/VersionTest.php
class VersionTest extends TestCase
{
    public function testVersionApi()
    {
        $response = $this->get('/api/version');
        
        $response->assertStatus(200)
                ->assertJsonStructure([
                    'status',
                    'msg',
                    'data' => [
                        'app_version',
                        'api_version',
                        'build_time'
                    ]
                ]);
    }
    
    public function testHealthApi()
    {
        $response = $this->get('/api/version/health');
        
        $response->assertStatus(200)
                ->assertJsonPath('data.status', 'healthy');
    }
}
```

### 2. 性能测试
```bash
# 使用ab进行压力测试
ab -n 1000 -c 10 http://localhost/api/version

# 使用wrk进行性能测试  
wrk -t10 -c100 -d30s http://localhost/api/version
```

### 3. 接口文档测试
```yaml
# api-test.yml (Postman/Insomnia)
- name: Version API Test
  request:
    method: GET
    url: "{{base_url}}/api/version"
  tests:
    - response.status == 200
    - response.data.app_version exists
    - response.time < 100
```

## 🔍 监控和日志

### 1. 访问统计
```php
// 定时任务：统计API访问情况
public function statisticsCommand()
{
    $stats = Db::name('system_version_log')
        ->where('request_time', '>=', date('Y-m-d 00:00:00'))
        ->group('access_type')
        ->field('access_type, count(*) as count, avg(response_time) as avg_time')
        ->select();
        
    foreach ($stats as $stat) {
        echo "API: {$stat['access_type']}, 访问次数: {$stat['count']}, 平均响应时间: {$stat['avg_time']}ms\n";
    }
}
```

### 2. 错误监控
```php
// 错误日志记录
protected function logError($error, $context = [])
{
    Log::error('API Error: ' . $error, [
        'ip' => request()->ip(),
        'url' => request()->url(),
        'method' => request()->method(),
        'context' => $context,
        'timestamp' => date('Y-m-d H:i:s')
    ]);
}
```

## 📋 部署检查清单

### 开发环境部署
- [ ] ThinkAdminV6框架安装
- [ ] 数据库表创建
- [ ] 路由配置完成
- [ ] CORS中间件配置
- [ ] 基础接口功能测试

### 生产环境部署
- [ ] 服务器环境配置
- [ ] SSL证书配置
- [ ] 数据库优化
- [ ] 缓存配置
- [ ] 监控系统部署
- [ ] 日志系统配置
- [ ] 性能测试通过

### 接口文档
- [ ] API文档编写
- [ ] 接口示例提供
- [ ] 错误码说明
- [ ] 使用指南完成

## 🔧 故障排查

### 常见问题
1. **响应时间过长**
   - 检查数据库连接
   - 优化SQL查询
   - 启用缓存机制

2. **CORS跨域问题**
   - 检查中间件配置
   - 验证预检请求处理
   - 确认响应头设置

3. **500错误**
   - 查看错误日志
   - 检查数据库连接
   - 验证配置文件

### 调试工具
```php
// 调试模式配置
// config/app.php
'debug' => true,
'trace' => [
    'type' => 'Html',
],

// 开发环境日志配置
'log' => [
    'default' => 'file',
    'channels' => [
        'file' => [
            'type' => 'File',
            'path' => '',
            'level' => 'debug',
        ],
    ],
],
```

## 📅 开发时间表

| 阶段 | 任务 | 时间 | 负责人 |
|------|------|------|--------|
| 1 | 基础架构搭建 | 1天 | 后端开发 |
| 2 | 版本接口开发 | 1天 | 后端开发 |
| 3 | 健康检查接口 | 1天 | 后端开发 |
| 4 | 路由中间件配置 | 0.5天 | 后端开发 |
| 5 | 测试和优化 | 1天 | 全员 |
| 6 | 文档编写 | 0.5天 | 后端开发 |

**总计：5天**

## 🎯 成功指标

### 功能指标
- [ ] API响应时间 < 100ms
- [ ] 接口可用性 > 99.9%
- [ ] 并发处理 > 100 QPS
- [ ] 错误率 < 0.1%

### 代码质量
- [ ] 单元测试覆盖率 > 80%
- [ ] 代码规范检查通过
- [ ] 接口文档完整性 100%
- [ ] 安全测试通过

---

*本文档详细规划了API接口开发的完整流程，请按计划逐步实施。* 