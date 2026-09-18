$ProgressPreference = 'SilentlyContinue'
$dest = "c:\Users\Claus\Desktop\CSW-Arcade\public\roms\neogeo.zip"

$sources = @(
    "https://archive.org/download/mame-0.225-roms-merged/neogeo.zip",
    "https://archive.org/download/mame-merged/mame-merged/neogeo.zip",
    "https://github.com/libretro/libretro-database/raw/master/metadat/mame/neogeo.zip"
)

foreach ($src in $sources) {
    Write-Host "Tentative de telechargement depuis $src ..."
    try {
        Invoke-WebRequest -Uri $src -OutFile $dest -UserAgent "Mozilla/5.0" -TimeoutSec 20
        if (Test-Path $dest) {
            $len = (Get-Item $dest).Length
            if ($len -gt 50000) {
                Write-Host "[OK] BIOS neogeo.zip telecharge avec succes ! Taille : $len octets"
                exit 0
            }
        }
    } catch {
        Write-Host "Echec sur $src : $($_.Exception.Message)"
    }
}

Write-Host "[WARN] Aucune source n'a abouti directement."
exit 1
