param(
  [int]$Port = 8787,
  [int]$EnginePid = 0,
  [string]$ExePath = "",
  [string]$SessionToken = "",
  [string]$FrontendUrl = ""
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Prefer env (engine-main passes it this way) so the token is not required on the command line.
if (-not $SessionToken) {
  $SessionToken = [string]$env:NEXUSHUB_TRAY_TOKEN
}
if (-not $FrontendUrl) {
  $FrontendUrl = [string]$env:NEXUSHUB_FRONTEND_URL
}
if (-not $FrontendUrl) {
  $FrontendUrl = "http://localhost:3000/"
}

$script:trayBmp = $null
$script:trayBrush = $null
$script:trayFont = $null
$script:trayIconHandle = [IntPtr]::Zero
$script:ownIcon = $false
$script:quitRequested = $false

Add-Type -Namespace NexusTray -Name Native -MemberDefinition @"
  [System.Runtime.InteropServices.DllImport("user32.dll", SetLastError=true)]
  public static extern bool DestroyIcon(System.IntPtr hIcon);
"@

function New-NexusTrayIcon {
  $script:trayBmp = New-Object System.Drawing.Bitmap 16, 16
  $g = [System.Drawing.Graphics]::FromImage($script:trayBmp)
  try {
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::FromArgb(255, 12, 16, 28))
    $script:trayBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 255, 143, 0))
    $g.FillEllipse($script:trayBrush, 1, 1, 14, 14)
    $script:trayFont = New-Object System.Drawing.Font "Segoe UI", 7, ([System.Drawing.FontStyle]::Bold)
    $g.DrawString("N", $script:trayFont, [System.Drawing.Brushes]::Black, 2.5, 1.2)
  } finally {
    $g.Dispose()
  }
  $script:trayIconHandle = $script:trayBmp.GetHicon()
  $script:ownIcon = $true
  return [System.Drawing.Icon]::FromHandle($script:trayIconHandle)
}

function Set-TrayStatus([string]$Text) {
  $status.Text = $Text
  $notify.Text = "NexusHub Engine - $Text"
}

function Open-NexusHubFrontend {
  # Convenience only — not a trust boundary.
  try {
    $u = [Uri]$FrontendUrl
    if ($u.Scheme -ne "http" -and $u.Scheme -ne "https") { return }
    Start-Process $u.AbsoluteUri
  } catch {}
}

function Test-EngineAlive {
  # Fail closed: require /health?json=1 identity (no plain-text fallback).
  try {
    $r = Invoke-RestMethod -Uri "$base/health?json=1" -TimeoutSec 2 -ErrorAction Stop
    if ($null -eq $r) { return $false }
    if ($r.ok -ne $true) { return $false }
    if ([string]$r.name -ne "NexusHub Desktop Engine") { return $false }
    if ($EnginePid -gt 0 -and [int]$r.pid -ne $EnginePid) { return $false }
    return $true
  } catch {
    return $false
  }
}

function Stop-EngineViaQuit {
  if (-not $SessionToken) {
    throw "Missing session token — cannot quit securely"
  }
  $headers = @{ "X-NexusHub-Token" = $SessionToken }
  Invoke-WebRequest `
    -Uri "$base/quit" `
    -Method POST `
    -Headers $headers `
    -UseBasicParsing `
    -TimeoutSec 2 | Out-Null
}

$base = "http://127.0.0.1:$Port"
$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Visible = $true

try {
  if ($ExePath -and (Test-Path -LiteralPath $ExePath)) {
    $notify.Icon = [System.Drawing.Icon]::ExtractAssociatedIcon($ExePath)
  }
} catch {}
if (-not $notify.Icon) { $notify.Icon = New-NexusTrayIcon }

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$status = $menu.Items.Add("Desktop Engine: Checking…")
$status.Enabled = $false
Set-TrayStatus "Checking… (:$Port)"
[void]$menu.Items.Add("-")

$open = $menu.Items.Add("Open NexusHub")
$open.Add_Click({ Open-NexusHubFrontend })

$quit = $menu.Items.Add("Quit Engine")
$quit.Add_Click({
  try {
    Stop-EngineViaQuit
    $script:quitRequested = $true
    Set-TrayStatus "Shutdown requested…"
  } catch {
    [System.Windows.Forms.MessageBox]::Show(
      "Could not stop NexusHub Engine. It may still be running.`r`n`r`n$($_.Exception.Message)",
      "NexusHub Engine",
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Warning
    ) | Out-Null
    return
  }
  # Timer confirms process/health exit before closing the tray.
})

$notify.ContextMenuStrip = $menu
$notify.Add_DoubleClick({ Open-NexusHubFrontend })

try {
  $notify.BalloonTipTitle = "NexusHub Desktop Engine"
  $notify.BalloonTipText = "Starting on 127.0.0.1:$Port — right-click tray icon to quit"
  $notify.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
  $notify.ShowBalloonTip(2500)
} catch {}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 2000
$timer.Add_Tick({
  if ($EnginePid -gt 0) {
    try {
      Get-Process -Id $EnginePid -ErrorAction Stop | Out-Null
    } catch {
      Set-TrayStatus "Stopped (process exited)"
      try { $timer.Stop() } catch {}
      $notify.Visible = $false
      [System.Windows.Forms.Application]::Exit()
      return
    }
  }
  if (Test-EngineAlive) {
    if (-not $script:quitRequested) {
      Set-TrayStatus "Running (:$Port)"
    }
  } else {
    Set-TrayStatus $(if ($script:quitRequested) { "Stopped" } else { "Stopped (health failed)" })
    try { $timer.Stop() } catch {}
    $notify.Visible = $false
    [System.Windows.Forms.Application]::Exit()
  }
})
$timer.Start()

try {
  [System.Windows.Forms.Application]::Run()
} finally {
  try { $timer.Stop(); $timer.Dispose() } catch {}
  $notify.Visible = $false
  try { $notify.Dispose() } catch {}
  if ($script:ownIcon -and $script:trayIconHandle -ne [IntPtr]::Zero) {
    try { [void][NexusTray.Native]::DestroyIcon($script:trayIconHandle) } catch {}
    $script:trayIconHandle = [IntPtr]::Zero
  }
  try { if ($script:trayFont) { $script:trayFont.Dispose() } } catch {}
  try { if ($script:trayBrush) { $script:trayBrush.Dispose() } } catch {}
  try { if ($script:trayBmp) { $script:trayBmp.Dispose() } } catch {}
}
