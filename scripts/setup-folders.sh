#!/bin/bash
# scripts/setup-assets.sh

echo "🎨 Setting up OFFIN Healthcare assets..."
echo "========================================"

# Create directories
mkdir -p ../public/{css,js,img}
mkdir -p ../drop-folder/{quarantine}
mkdir -p ../backups
mkdir -p ../data
mkdir -p ../backups

# Install npm packages for asset generation
npm install --save-dev sharp canvas

# Generate favicons
echo "📸 Generating favicons..."
node scripts/generate-favicon.js

# Copy CSS files
echo "🎨 Copying CSS files..."
cp src/public/css/style.css src/public/css/style.css
cp src/public/css/auth.css src/public/css/auth.css

# Copy JS files
echo "📝 Copying JavaScript files..."
cp src/public/js/main.js src/public/js/main.js
cp src/public/js/service-worker.js src/public/js/service-worker.js

# Copy logo files
echo "🖼️ Copying logo files..."
cp src/public/img/logo.svg src/public/img/logo.svg
cp src/public/img/logo-small.svg src/public/img/logo-small.svg

# Copy manifest
echo "📋 Copying manifest..."
cp src/public/manifest.json src/public/manifest.json
cp src/public/browserconfig.xml src/public/browserconfig.xml

echo ""
echo "✅ Asset setup complete!"
echo ""
echo "📊 Generated files:"
ls -la src/public/
echo ""
echo "🔧 Next steps:"
echo "1. Update your layout files to include the new assets"
echo "2. Test the PWA functionality"
echo "3. Customize colors in CSS files if needed"