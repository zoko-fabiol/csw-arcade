Add-Type -AssemblyName System.Drawing

$src = "C:\Users\Claus\Desktop\CSW-Arcade\8ab346a0-2134-4a7e-937d-b6c51faac729.jpeg"
$destDir = "C:\Users\Claus\Desktop\CSW-Arcade\public\icons"
if (-not (Test-Path $destDir)) {
    New-Item -ItemType Directory -Path $destDir | Out-Null
}

$origImg = [System.Drawing.Image]::FromFile($src)

function Resize-And-Save($width, $height, $outPath) {
    $bmp = New-Object System.Drawing.Bitmap $width, $height
    $graph = [System.Drawing.Graphics]::FromImage($bmp)
    $graph.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graph.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graph.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graph.DrawImage($origImg, 0, 0, $width, $height)
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $graph.Dispose()
    $bmp.Dispose()
    Write-Host "Created $outPath ($width x $height)"
}

Resize-And-Save 192 192 "$destDir\icon-192.png"
Resize-And-Save 512 512 "$destDir\icon-512.png"
Resize-And-Save 192 192 "$destDir\icon-maskable-192.png"
Resize-And-Save 512 512 "$destDir\icon-maskable-512.png"
Resize-And-Save 180 180 "$destDir\apple-touch-icon.png"
Resize-And-Save 64 64 "C:\Users\Claus\Desktop\CSW-Arcade\public\favicon.png"

$origImg.Dispose()
Write-Host "All PWA icons generated successfully!"
