# 🚀 Tauri打包部署完整方案

## 📋 方案概述

本文档详细说明如何完全复刻现有的Tauri自动更新和打包部署系统，包括密钥生成、GitHub Actions配置、多端点部署等完整流程。

## 🔑 第一步：密钥生成和管理

### 1.1 生成Minisign密钥对

```bash
# 确保已安装Tauri CLI
npm install -g @tauri-apps/cli

# 生成密钥对
tauri signer generate -w ~/.tauri/yourapp.key

# 输出示例：
# Private key saved to ~/.tauri/yourapp.key
# Public key: dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6...
```

### 1.2 密钥安全管理

```bash
# 私钥备份（重要！）
cp ~/.tauri/yourapp.key ~/backup/yourapp.key.backup
cp ~/.tauri/yourapp.key /secure/location/yourapp.key.safe

# 设置权限
chmod 600 ~/.tauri/yourapp.key
```

### 1.3 GitHub Secrets配置

在GitHub仓库设置中添加以下Secrets：

```
TAURI_SIGNING_PRIVATE_KEY: 私钥文件的完整内容
TAURI_SIGNING_PRIVATE_KEY_PASSWORD: 私钥密码（如果设置了）
CDN_UPLOAD_TOKEN: CDN上传令牌（如果使用CDN）
```

## ⚙️ 第二步：项目配置更新

### 2.1 更新tauri.conf.json

```json
{
  "productName": "YourApp",
  "version": "1.0.0",
  "bundle": {
    "createUpdaterArtifacts": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  },
  "plugins": {
    "updater": {
      "active": true,
      "pubkey": "您的新公钥（替换这里）",
      "endpoints": [
        "https://your-cdn.com/yourapp/updater/latest.json",
        "https://github.com/yourusername/yourrepo/releases/latest/download/latest.json",
        "https://your-proxy.com/github.com/yourusername/yourrepo/releases/latest/download/latest.json"
      ],
      "windows": {
        "installMode": "passive"
      },
      "dangerousInsecureTransportProtocol": false
    }
  }
}
```

### 2.2 更新package.json版本管理

```json
{
  "name": "your-app",
  "version": "1.0.0",
  "scripts": {
    "tauri": "tauri",
    "tauri:build": "tauri build",
    "tauri:dev": "tauri dev",
    "version:patch": "npm version patch && git push --tags",
    "version:minor": "npm version minor && git push --tags",
    "version:major": "npm version major && git push --tags"
  }
}
```

## 🔄 第三步：GitHub Actions工作流

### 3.1 主要工作流文件：.github/workflows/release.yml

```yaml
name: Release Application

on:
  release:
    types: [published]

jobs:
  release:
    permissions:
      contents: write
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: 'macos-latest'
            args: '--target universal-apple-darwin'
          - platform: 'ubuntu-22.04'
            args: ''
          - platform: 'windows-latest'
            args: ''

    runs-on: ${{ matrix.platform }}
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Install dependencies (ubuntu only)
        if: matrix.platform == 'ubuntu-22.04'
        run: |
          sudo apt-get update
          sudo apt-get install -y \
            libwebkit2gtk-4.0-dev \
            libwebkit2gtk-4.1-dev \
            libappindicator3-dev \
            librsvg2-dev \
            patchelf

      - name: Rust setup
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.platform == 'macos-latest' && 'aarch64-apple-darwin,x86_64-apple-darwin' || '' }}

      - name: Rust cache
        uses: swatinem/rust-cache@v2
        with:
          workspaces: './src-tauri -> target'

      - name: Node.js setup
        uses: actions/setup-node@v4
        with:
          node-version: '18'

      - name: Install pnpm
        uses: pnpm/action-setup@v2
        with:
          version: 8

      - name: Install frontend dependencies
        run: pnpm install

      - name: Build application
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          tagName: v__VERSION__
          releaseName: 'Release v__VERSION__'
          releaseBody: |
            ## 更新内容
            
            查看完整更新日志请访问 [CHANGELOG.md](https://github.com/yourusername/yourrepo/blob/main/CHANGELOG.md)
            
            ## 下载说明
            
            - **Windows**: 下载 `.msi` 文件
            - **macOS**: 下载 `.dmg` 文件  
            - **Linux**: 下载 `.AppImage` 文件
            
            ## 自动更新
            
            现有用户会自动收到更新通知，可选择立即更新或稍后更新。
          releaseDraft: false
          prerelease: false
          includeUpdaterJson: true
          args: ${{ matrix.args }}

      - name: Upload to CDN (if configured)
        if: matrix.platform == 'ubuntu-22.04'
        run: |
          # 仅在Linux构建中执行一次CDN上传
          if [ -f "src-tauri/target/release/bundle/updater/latest.json" ]; then
            echo "Uploading latest.json to CDN..."
            curl -X POST "https://your-cdn-api.com/upload" \
              -H "Authorization: Bearer ${{ secrets.CDN_UPLOAD_TOKEN }}" \
              -F "file=@src-tauri/target/release/bundle/updater/latest.json" \
              -F "path=/yourapp/updater/latest.json"
          fi
```

### 3.2 自动版本更新工作流：.github/workflows/version-bump.yml

```yaml
name: Version Bump

on:
  workflow_dispatch:
    inputs:
      version_type:
        description: 'Version bump type'
        required: true
        default: 'patch'
        type: choice
        options:
          - patch
          - minor
          - major

jobs:
  bump_version:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          token: ${{ secrets.GITHUB_TOKEN }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'

      - name: Configure git
        run: |
          git config --local user.email "action@github.com"
          git config --local user.name "GitHub Action"

      - name: Bump version and create tag
        run: |
          npm version ${{ github.event.inputs.version_type }}
          NEW_VERSION=$(node -p "require('./package.json').version")
          echo "NEW_VERSION=v$NEW_VERSION" >> $GITHUB_ENV

      - name: Push changes and tags
        run: |
          git push origin main
          git push origin ${{ env.NEW_VERSION }}

      - name: Create GitHub release
        uses: actions/create-release@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tag_name: ${{ env.NEW_VERSION }}
          release_name: Release ${{ env.NEW_VERSION }}
          body: |
            Automated release for version ${{ env.NEW_VERSION }}
            
            Changes in this version:
            - Auto-generated release from version bump
          draft: false
          prerelease: false
```

## 🌐 第四步：多端点部署配置

### 4.1 主CDN端点配置

```nginx
# Nginx配置示例
server {
    listen 443 ssl http2;
    server_name your-cdn.com;
    
    # SSL配置
    ssl_certificate /path/to/ssl/cert.pem;
    ssl_certificate_key /path/to/ssl/private.key;
    
    # 更新文件位置
    location /yourapp/updater/ {
        root /var/www/cdn;
        add_header Access-Control-Allow-Origin *;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        expires -1;
    }
    
    # 发布文件位置
    location /yourapp/releases/ {
        root /var/www/cdn;
        add_header Access-Control-Allow-Origin *;
    }
}
```

### 4.2 CDN自动上传脚本

```bash
#!/bin/bash
# scripts/upload-to-cdn.sh

VERSION=$1
if [ -z "$VERSION" ]; then
    echo "Usage: $0 <version>"
    exit 1
fi

# 上传latest.json
curl -X POST "https://your-cdn-api.com/upload" \
  -H "Authorization: Bearer $CDN_UPLOAD_TOKEN" \
  -F "file=@src-tauri/target/release/bundle/updater/latest.json" \
  -F "path=/yourapp/updater/latest.json"

# 上传发布文件
for file in src-tauri/target/release/bundle/*/*; do
    if [[ $file == *.msi ]] || [[ $file == *.dmg ]] || [[ $file == *.AppImage ]] || [[ $file == *.tar.gz ]]; then
        filename=$(basename "$file")
        curl -X POST "https://your-cdn-api.com/upload" \
          -H "Authorization: Bearer $CDN_UPLOAD_TOKEN" \
          -F "file=@$file" \
          -F "path=/yourapp/releases/$VERSION/$filename"
    fi
done

echo "Upload completed for version $VERSION"
```

### 4.3 代理服务器配置

```javascript
// proxy-server.js (Node.js Express示例)
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();

// GitHub代理
app.use('/github.com', createProxyMiddleware({
  target: 'https://github.com',
  changeOrigin: true,
  pathRewrite: {
    '^/github.com': '', // 移除路径前缀
  },
  onProxyRes: function (proxyRes, req, res) {
    // 添加CORS头
    proxyRes.headers['Access-Control-Allow-Origin'] = '*';
  }
}));

app.listen(3000, () => {
  console.log('Proxy server running on port 3000');
});
```

## 📊 第五步：监控和日志

### 5.1 更新监控脚本

```bash
#!/bin/bash
# scripts/monitor-updates.sh

# 检查所有端点可用性
ENDPOINTS=(
  "https://your-cdn.com/yourapp/updater/latest.json"
  "https://github.com/yourusername/yourrepo/releases/latest/download/latest.json"
  "https://your-proxy.com/github.com/yourusername/yourrepo/releases/latest/download/latest.json"
)

for endpoint in "${ENDPOINTS[@]}"; do
  echo "Checking $endpoint"
  response=$(curl -s -w "%{http_code}" -o /dev/null "$endpoint")
  if [ "$response" = "200" ]; then
    echo "✅ $endpoint is healthy"
  else
    echo "❌ $endpoint returned $response"
    # 发送告警通知
    curl -X POST "https://your-notification-service.com/alert" \
      -d "endpoint=$endpoint&status=$response"
  fi
done
```

### 5.2 日志收集配置

```yaml
# docker-compose.yml for logging
version: '3.8'
services:
  filebeat:
    image: docker.elastic.co/beats/filebeat:7.15.0
    volumes:
      - ./logs:/usr/share/filebeat/logs:ro
      - ./filebeat.yml:/usr/share/filebeat/filebeat.yml:ro
    command: filebeat -e -strict.perms=false

  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:7.15.0
    environment:
      - discovery.type=single-node
    ports:
      - "9200:9200"

  kibana:
    image: docker.elastic.co/kibana/kibana:7.15.0
    ports:
      - "5601:5601"
    environment:
      - ELASTICSEARCH_HOSTS=http://elasticsearch:9200
```

## 🧪 第六步：测试和验证

### 6.1 本地测试脚本

```bash
#!/bin/bash
# scripts/test-build.sh

echo "🔧 Setting up test environment..."

# 设置测试环境变量
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/yourapp.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""

echo "📦 Building application..."
pnpm tauri build

echo "🔍 Verifying generated files..."

# 检查生成的文件
BUNDLE_DIR="src-tauri/target/release/bundle"

if [ -d "$BUNDLE_DIR" ]; then
  echo "✅ Bundle directory exists"
  
  # 检查各平台文件
  if [ -f "$BUNDLE_DIR/msi"/*.msi ]; then
    echo "✅ Windows MSI generated"
  fi
  
  if [ -f "$BUNDLE_DIR/deb"/*.deb ]; then
    echo "✅ Debian package generated"
  fi
  
  if [ -f "$BUNDLE_DIR/appimage"/*.AppImage ]; then
    echo "✅ AppImage generated"
  fi
  
  # 检查签名文件
  find "$BUNDLE_DIR" -name "*.sig" | while read -r sig_file; do
    echo "✅ Signature file: $sig_file"
  done
  
  # 验证latest.json
  if [ -f "$BUNDLE_DIR/updater/latest.json" ]; then
    echo "✅ latest.json generated"
    echo "📄 Content:"
    cat "$BUNDLE_DIR/updater/latest.json" | jq .
  fi
else
  echo "❌ Bundle directory not found"
  exit 1
fi

echo "🎉 Build test completed successfully!"
```

### 6.2 端到端测试

```javascript
// tests/e2e/updater.test.js
const { test, expect } = require('@playwright/test');

test.describe('Updater System', () => {
  test('should check for updates', async ({ page }) => {
    // 启动应用
    await page.goto('tauri://localhost');
    
    // 触发更新检查
    await page.click('#check-updates');
    
    // 验证更新检查结果
    await expect(page.locator('#update-status')).toContainText('检查完成');
  });
  
  test('should handle update download', async ({ page }) => {
    // 模拟有更新可用的情况
    await page.route('**/latest.json', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          version: '999.0.0',
          notes: 'Test update',
          pub_date: new Date().toISOString(),
          platforms: {
            'windows-x86_64': {
              signature: 'test-signature',
              url: 'https://example.com/test.msi'
            }
          }
        })
      });
    });
    
    await page.goto('tauri://localhost');
    await page.click('#check-updates');
    
    // 验证更新下载流程
    await expect(page.locator('#download-progress')).toBeVisible();
  });
});
```

## 📋 第七步：部署清单

### 7.1 部署前检查清单

- [ ] 密钥对已生成并安全保存
- [ ] GitHub Secrets已正确配置
- [ ] tauri.conf.json已更新为正确的公钥
- [ ] 所有端点URL已更新为您的域名
- [ ] CDN配置已完成并测试
- [ ] 代理服务器已部署并测试
- [ ] 监控和告警系统已配置
- [ ] 测试脚本已验证通过

### 7.2 发布流程

```bash
# 1. 更新版本
npm run version:patch  # 或 minor, major

# 2. 等待GitHub Actions完成构建

# 3. 验证发布
curl -s "https://your-cdn.com/yourapp/updater/latest.json" | jq .

# 4. 测试自动更新
# 安装旧版本应用，验证能否自动更新到新版本
```

## 🔧 故障排查

### 常见问题和解决方案

1. **签名验证失败**
   ```bash
   # 检查私钥格式
   openssl pkey -in ~/.tauri/yourapp.key -text -noout
   
   # 重新生成密钥对
   tauri signer generate -w ~/.tauri/yourapp-new.key
   ```

2. **更新端点无法访问**
   ```bash
   # 测试所有端点
   curl -I "https://your-cdn.com/yourapp/updater/latest.json"
   curl -I "https://github.com/yourusername/yourrepo/releases/latest/download/latest.json"
   ```

3. **构建失败**
   ```bash
   # 清理缓存
   cargo clean
   rm -rf node_modules
   pnpm install
   
   # 重新构建
   pnpm tauri build
   ```

---

*本文档提供了完整的Tauri打包部署方案，请根据实际需求进行调整和优化。* 