Add-Type -AssemblyName System.Drawing

$projectRoot = "c:\Users\Justin\OneDrive\Desktop\lmis01 v.1"
$sourcePath = Join-Path $projectRoot "public\logo.png"

if (-not (Test-Path $sourcePath)) {
    Write-Error "Source logo not found at $sourcePath"
    exit 1
}

$sourceImg = [System.Drawing.Bitmap]::new($sourcePath)
Write-Host "Source image loaded: $($sourceImg.Width)x$($sourceImg.Height)"

# Helper function to create high-quality graphics
function Get-HQGraphics($bitmap) {
    $g = [System.Drawing.Graphics]::FromImage($bitmap)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    return $g
}

# 1. PWA & Web Assets
# icon-192.png (transparent)
$bmp192 = [System.Drawing.Bitmap]::new(192, 192, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g192 = Get-HQGraphics $bmp192
$g192.Clear([System.Drawing.Color]::Transparent)
$g192.DrawImage($sourceImg, 0, 0, 192, 192)
$g192.Dispose()
$bmp192.Save((Join-Path $projectRoot "public\icon-192.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$bmp192.Dispose()
Write-Host "Generated public/icon-192.png"

# icon-512.png (transparent)
$bmp512 = [System.Drawing.Bitmap]::new(512, 512, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g512 = Get-HQGraphics $bmp512
$g512.Clear([System.Drawing.Color]::Transparent)
$g512.DrawImage($sourceImg, 0, 0, 512, 512)
$g512.Dispose()
$bmp512.Save((Join-Path $projectRoot "public\icon-512.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$bmp512.Dispose()
Write-Host "Generated public/icon-512.png"

# icon-maskable-512.png (with safe-zone: 80% circle on white background)
$bmpMask = [System.Drawing.Bitmap]::new(512, 512, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$gMask = Get-HQGraphics $bmpMask
$gMask.Clear([System.Drawing.Color]::White)
# Safe zone is center 400x400 (roughly 78% of 512, safe from any mask shape)
$pad = 56
$size = 400
$gMask.DrawImage($sourceImg, $pad, $pad, $size, $size)
$gMask.Dispose()
$bmpMask.Save((Join-Path $projectRoot "public\icon-maskable-512.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$bmpMask.Dispose()
Write-Host "Generated public/icon-maskable-512.png"

# apple-touch-icon.png (180x180 on white background with 16px padding)
$bmpApple = [System.Drawing.Bitmap]::new(180, 180, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$gApple = Get-HQGraphics $bmpApple
$gApple.Clear([System.Drawing.Color]::White)
$gApple.DrawImage($sourceImg, 18, 18, 144, 144)
$gApple.Dispose()
$bmpApple.Save((Join-Path $projectRoot "public\apple-touch-icon.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$bmpApple.Dispose()
Write-Host "Generated public/apple-touch-icon.png"

# logo.jpg (1024x1024 on white background)
$bmpJpg = [System.Drawing.Bitmap]::new(1024, 1024, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$gJpg = Get-HQGraphics $bmpJpg
$gJpg.Clear([System.Drawing.Color]::White)
$gJpg.DrawImage($sourceImg, 0, 0, 1024, 1024)
$gJpg.Dispose()
$bmpJpg.Save((Join-Path $projectRoot "public\logo.jpg"), [System.Drawing.Imaging.ImageFormat]::Jpeg)
$bmpJpg.Dispose()
Write-Host "Generated public/logo.jpg"

# 2. Android Mipmap Icons
$mipmapDensities = @(
    @{ Name = "mipmap-mdpi"; Size = 48; ForeSize = 108; SafeSize = 72 },
    @{ Name = "mipmap-hdpi"; Size = 72; ForeSize = 162; SafeSize = 108 },
    @{ Name = "mipmap-xhdpi"; Size = 96; ForeSize = 216; SafeSize = 144 },
    @{ Name = "mipmap-xxhdpi"; Size = 144; ForeSize = 324; SafeSize = 216 },
    @{ Name = "mipmap-xxxhdpi"; Size = 192; ForeSize = 432; SafeSize = 288 }
)

foreach ($density in $mipmapDensities) {
    $dir = Join-Path $projectRoot "android\app\src\main\res\$($density.Name)"
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }

    # ic_launcher.png (Legacy launcher: white rounded squircle with logo)
    $s = $density.Size
    $bmpLegacy = [System.Drawing.Bitmap]::new($s, $s, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $gLegacy = Get-HQGraphics $bmpLegacy
    $gLegacy.Clear([System.Drawing.Color]::White)
    $padding = [int]($s * 0.08)
    $contentSize = $s - ($padding * 2)
    $gLegacy.DrawImage($sourceImg, $padding, $padding, $contentSize, $contentSize)
    $gLegacy.Dispose()
    $bmpLegacy.Save((Join-Path $dir "ic_launcher.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmpLegacy.Dispose()

    # ic_launcher_round.png (Round launcher: circular white background with logo)
    $bmpRound = [System.Drawing.Bitmap]::new($s, $s, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $gRound = Get-HQGraphics $bmpRound
    $gRound.Clear([System.Drawing.Color]::Transparent)
    $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $path.AddEllipse(0, 0, $s - 1, $s - 1)
    $brush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
    $gRound.FillPath($brush, $path)
    $brush.Dispose()
    $path.Dispose()
    $padding = [int]($s * 0.08)
    $contentSize = $s - ($padding * 2)
    $gRound.DrawImage($sourceImg, $padding, $padding, $contentSize, $contentSize)
    $gRound.Dispose()
    $bmpRound.Save((Join-Path $dir "ic_launcher_round.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmpRound.Dispose()

    # ic_launcher_foreground.png (Adaptive icon foreground: transparent background, logo centered within safe zone)
    $fs = $density.ForeSize
    $safe = $density.SafeSize
    $offset = [int](($fs - $safe) / 2)
    $bmpFore = [System.Drawing.Bitmap]::new($fs, $fs, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $gFore = Get-HQGraphics $bmpFore
    $gFore.Clear([System.Drawing.Color]::Transparent)
    $gFore.DrawImage($sourceImg, $offset, $offset, $safe, $safe)
    $gFore.Dispose()
    $bmpFore.Save((Join-Path $dir "ic_launcher_foreground.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmpFore.Dispose()

    Write-Host "Generated $($density.Name) icons (ic_launcher, ic_launcher_round, ic_launcher_foreground)"
}

# 3. Android Splash Screens
$splashes = @(
    @{ Dir = "drawable"; W = 480; H = 320 },
    @{ Dir = "drawable-land-mdpi"; W = 480; H = 320 },
    @{ Dir = "drawable-land-hdpi"; W = 800; H = 480 },
    @{ Dir = "drawable-land-xhdpi"; W = 1280; H = 720 },
    @{ Dir = "drawable-land-xxhdpi"; W = 1600; H = 960 },
    @{ Dir = "drawable-land-xxxhdpi"; W = 1920; H = 1280 },
    @{ Dir = "drawable-port-mdpi"; W = 320; H = 480 },
    @{ Dir = "drawable-port-hdpi"; W = 480; H = 800 },
    @{ Dir = "drawable-port-xhdpi"; W = 720; H = 1280 },
    @{ Dir = "drawable-port-xxhdpi"; W = 960; H = 1600 },
    @{ Dir = "drawable-port-xxxhdpi"; W = 1280; H = 1920 }
)

foreach ($splash in $splashes) {
    $dir = Join-Path $projectRoot "android\app\src\main\res\$($splash.Dir)"
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }

    $w = $splash.W
    $h = $splash.H
    $bmpSplash = [System.Drawing.Bitmap]::new($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $gSplash = Get-HQGraphics $bmpSplash
    
    # White background matching clean theme
    $gSplash.Clear([System.Drawing.Color]::White)
    
    # Center the logo: diameter is ~40-45% of the smaller dimension
    $minDim = [Math]::Min($w, $h)
    $logoSize = [int]($minDim * 0.45)
    $posX = [int](($w - $logoSize) / 2)
    $posY = [int](($h - $logoSize) / 2)
    
    $gSplash.DrawImage($sourceImg, $posX, $posY, $logoSize, $logoSize)
    $gSplash.Dispose()
    
    $bmpSplash.Save((Join-Path $dir "splash.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmpSplash.Dispose()
    
    Write-Host "Generated $($splash.Dir)/splash.png ($w x $h, logo $logoSize x $logoSize)"
}

$sourceImg.Dispose()
Write-Host "All icons and splash screens successfully generated!"
