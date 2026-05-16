#!/bin/bash
# ZenPass 部署腳本
# 用法: bash deploy.sh

echo "🚀 ZenPass 部署開始"
echo ""

# 1. Sync frontend files to root
echo "1️⃣  Sync frontend files..."
cp frontend/*.html . 2>/dev/null
cp frontend/sw.js . 2>/dev/null
cp frontend/api.js . 2>/dev/null
cp frontend/favicon.png . 2>/dev/null
cp -r frontend/css . 2>/dev/null
cp -r frontend/icons . 2>/dev/null
cp -r frontend/assets . 2>/dev/null
echo "   ✅ Done"

# 2. Run tests
echo "2️⃣  Running tests..."
cd backend && npm test 2>/dev/null && cd .. && echo "   ✅ Tests passed" || { echo "   ❌ Tests failed"; exit 1; }

# 3. Git commit & push
echo "3️⃣  Committing and pushing..."
git add -A
git diff --cached --quiet || {
  git commit -m "deploy: auto-sync $(date +%Y-%m-%d_%H%M)"
  git push origin main && echo "   ✅ Pushed" || echo "   ❌ Push failed"
}
echo "   ✅ Up to date"

# 4. Restart server
echo "4️⃣  Restarting server..."
kill $(lsof -t -i :3001) 2>/dev/null
cd backend && node src/index.js &
sleep 2
echo "   ✅ Server restarted"

echo ""
echo "🎉 Deploy complete!"
