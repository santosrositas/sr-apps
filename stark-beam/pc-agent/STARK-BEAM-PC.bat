@echo off
chcp 65001 >nul
title STARK BEAM — Agente Invisible de Monitores (Windows)
set "STARK_CHANNEL=SR1"
if not "%~1"=="" set "STARK_CHANNEL=%~1"
set "PS1=%TEMP%\stark_beam_pc_agent.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$lines = Get-Content -LiteralPath '%~f0' -Encoding UTF8; $idx = [Array]::IndexOf($lines, '###PS_START###'); Set-Content -LiteralPath '%PS1%' -Value ($lines[($idx+1)..($lines.Length-1)]) -Encoding UTF8"
echo.
echo ============================================================
echo   STARK BEAM // AGENTE INVISIBLE PARA MONITORES WINDOWS
echo   Canal activo: %STARK_CHANNEL%  (Minimiza esta ventana)
echo   Ahora puedes usar Canva o cualquier app normalmente.
echo   Solo enfoca tu monitor con el celular y desliza arriba!
echo ============================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -STA -File "%PS1%" "%STARK_CHANNEL%"
exit /b
###PS_START###
param([string]$Channel = "SR1")

$ErrorActionPreference = "Continue"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$Room = ($Channel.ToLower() -replace '[^a-z0-9]', '')
if ([string]::IsNullOrWhiteSpace($Room)) { $Room = "sr1" }
$TopicRoot = "sr-sb-v7/$Room"
$HostName = $env:COMPUTERNAME
$MediaDir = Join-Path $env:TEMP "stark-beam-media"
$EdgeProfile = Join-Path $env:TEMP "stark-beam-edge-profile"
New-Item -ItemType Directory -Force -Path $MediaDir | Out-Null

# Enumerate all physical monitors attached to this Windows PC
$Screens = [System.Windows.Forms.Screen]::AllScreens
$MonitorMap = @{}
for ($i = 0; $i -lt $Screens.Length; $i++) {
    $s = $Screens[$i]
    $num = $i + 1
    $id = ("win-" + ($HostName.ToLower() -replace '[^a-z0-9]', '') + "-m" + $num)
    $label = "Monitor $num ($($s.Bounds.Width)x$($s.Bounds.Height))"
    if ($s.Primary) { $label = "Monitor $num Principal ($($s.Bounds.Width)x$($s.Bounds.Height))" }
    $MonitorMap[$id] = @{
        Id = $id
        Name = $label
        Resolution = "$($s.Bounds.Width)x$($s.Bounds.Height)"
        Bounds = $s.Bounds
    }
    Write-Host "[OK] Detectado $label -> ID: $id"
}

$script:PlayerProc = $null
$script:Transfer = $null

function Encode-MqttRemLen([int]$len) {
    $out = New-Object System.Collections.Generic.List[byte]
    do {
        $digit = $len % 128
        $len = [math]::Floor($len / 128)
        if ($len -gt 0) { $digit = $digit -bor 128 }
        $out.Add([byte]$digit)
    } while ($len -gt 0)
    return $out.ToArray()
}

function Encode-MqttUtf8([string]$str) {
    $b = [System.Text.Encoding]::UTF8.GetBytes($str)
    $out = New-Object byte[] ($b.Length + 2)
    $out[0] = [byte](($b.Length -shr 8) -band 0xFF)
    $out[1] = [byte]($b.Length -band 0xFF)
    [Array]::Copy($b, 0, $out, 2, $b.Length)
    return $out
}

function Build-MqttConnect([string]$clientId) {
    $vh = [byte[]]@(0x00, 0x04, 0x4D, 0x51, 0x54, 0x54, 0x04, 0x02, 0x00, 0x28)
    $pl = Encode-MqttUtf8 $clientId
    $bodyLen = $vh.Length + $pl.Length
    $rl = Encode-MqttRemLen $bodyLen
    $pkt = New-Object byte[] (1 + $rl.Length + $bodyLen)
    $pkt[0] = 0x10
    [Array]::Copy($rl, 0, $pkt, 1, $rl.Length)
    [Array]::Copy($vh, 0, $pkt, 1 + $rl.Length, $vh.Length)
    [Array]::Copy($pl, 0, $pkt, 1 + $rl.Length + $vh.Length, $pl.Length)
    return $pkt
}

function Build-MqttSubscribe([int]$pktId, [string]$topic) {
    $tBytes = Encode-MqttUtf8 $topic
    $bodyLen = 2 + $tBytes.Length + 1
    $rl = Encode-MqttRemLen $bodyLen
    $pkt = New-Object byte[] (1 + $rl.Length + $bodyLen)
    $pkt[0] = 0x82
    [Array]::Copy($rl, 0, $pkt, 1, $rl.Length)
    $off = 1 + $rl.Length
    $pkt[$off] = [byte](($pktId -shr 8) -band 0xFF)
    $pkt[$off + 1] = [byte]($pktId -band 0xFF)
    [Array]::Copy($tBytes, 0, $pkt, $off + 2, $tBytes.Length)
    $pkt[$off + 2 + $tBytes.Length] = 0x00
    return $pkt
}

function Build-MqttPublish([string]$topic, [string]$payload, [bool]$retain = $false) {
    $tBytes = Encode-MqttUtf8 $topic
    $pBytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
    $bodyLen = $tBytes.Length + $pBytes.Length
    $rl = Encode-MqttRemLen $bodyLen
    $pkt = New-Object byte[] (1 + $rl.Length + $bodyLen)
    $pkt[0] = if ($retain) { 0x31 } else { 0x30 }
    [Array]::Copy($rl, 0, $pkt, 1, $rl.Length)
    $off = 1 + $rl.Length
    [Array]::Copy($tBytes, 0, $pkt, $off, $tBytes.Length)
    [Array]::Copy($pBytes, 0, $pkt, $off + $tBytes.Length, $pBytes.Length)
    return $pkt
}

function Send-WsBytes($ws, [byte[]]$bytes) {
    if ($ws.State -ne [System.Net.WebSockets.WebSocketState]::Open) { return }
    $seg = New-Object System.ArraySegment[byte] -ArgumentList (,$bytes)
    $ws.SendAsync($seg, [System.Net.WebSockets.WebSocketMessageType]::Binary, $true, [System.Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null
}

function Flash-Monitor($bounds, [int]$darkMs, [int]$brightMs) {
    $form = New-Object System.Windows.Forms.Form
    $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
    $form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
    $form.Bounds = $bounds
    $form.TopMost = $true
    $form.ShowInTaskbar = $false
    $form.BackColor = [System.Drawing.Color]::Black
    $form.Opacity = 0.96
    $form.Show()
    $form.Refresh()
    [System.Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds ([math]::Max(150, [math]::Min(400, $darkMs)))

    $form.BackColor = [System.Drawing.Color]::FromArgb(0, 245, 255)
    $form.Refresh()
    [System.Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds ([math]::Max(200, [math]::Min(500, $brightMs)))

    $form.Close()
    $form.Dispose()
}

function Stop-OverlayPlayer {
    if ($script:PlayerProc -and -not $script:PlayerProc.HasExited) {
        try { $script:PlayerProc.Kill() } catch {}
    }
    $script:PlayerProc = $null
}

function Launch-FullscreenOverlay($bounds, [string]$filePath, [string]$kind, [string]$fileName) {
    Stop-OverlayPlayer
    $fileUri = (New-Object System.Uri($filePath)).AbsoluteUri
    $safeTitle = ($fileName -replace '[<>&"]', '')
    $htmlPath = Join-Path $MediaDir "override.html"

    $mediaTag = ""
    if ($kind -eq "image") {
        $mediaTag = "<img src='$fileUri' style='width:100%;height:100%;object-fit:contain;display:block' />"
    } elseif ($kind -eq "audio") {
        $mediaTag = "<div style='text-align:center;color:#00e5ff;font-family:monospace'><div style='width:150px;height:150px;border-radius:50%;border:4px solid #00e5ff;margin:0 auto 24px;box-shadow:0 0 40px #00e5ff'></div><div style='font-size:28px;letter-spacing:4px'>$safeTitle</div><audio src='$fileUri' autoplay controls style='margin-top:24px;width:360px'></audio></div>"
    } else {
        $mediaTag = "<video src='$fileUri' autoplay playsinline loop style='width:100%;height:100%;object-fit:contain;background:#000'></video>"
    }

    $html = @"
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>STARK OVERRIDE</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;background:#000;overflow:hidden;display:flex;align-items:center;justify-content:center;font-family:monospace}
#banner{position:fixed;inset:0;background:rgba(2,10,18,0.95);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:20;animation:fadeOut .25s ease .75s forwards}
.box{border:3px solid #ffb300;padding:28px 48px;background:rgba(255,179,0,0.1);box-shadow:0 0 60px rgba(255,179,0,0.35);text-align:center}
.t1{color:#ffb300;font-size:46px;font-weight:800;letter-spacing:8px}
.t2{color:#00e5ff;font-size:16px;letter-spacing:4px;margin-top:10px}
@keyframes fadeOut{to{opacity:0;pointer-events:none;visibility:hidden}}
</style>
</head>
<body>
<div id="banner"><div class="box"><div class="t1">SIGNAL OVERRIDE</div><div class="t2">STARK BEAM // $safeTitle</div></div></div>
$mediaTag
<script>
window.addEventListener('keydown', e => { if (e.key === 'Escape') window.close(); });
</script>
</body>
</html>
"@
    Set-Content -LiteralPath $htmlPath -Value $html -Encoding UTF8
    $htmlUri = (New-Object System.Uri($htmlPath)).AbsoluteUri

    $edgePaths = @(
        "$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "$env:ProgramFiles(x86)\Google\Chrome\Application\chrome.exe"
    )
    $browser = $edgePaths | Where-Object { Test-Path $_ } | Select-Object -First 1

    if ($browser) {
        $args = @(
            "--user-data-dir=`"$EdgeProfile`"",
            "--new-window",
            "--kiosk",
            "--edge-kiosk-type=fullscreen",
            "--no-first-run",
            "--autoplay-policy=no-user-gesture-required",
            "--window-position=$($bounds.X),$($bounds.Y)",
            "--window-size=$($bounds.Width),$($bounds.Height)",
            "`"$htmlUri`""
        ) -join " "
        $script:PlayerProc = Start-Process -FilePath $browser -ArgumentList $args -PassThru
    } else {
        Start-Process -FilePath $filePath
    }
}

function Publish-AllMonitors($ws) {
    foreach ($id in $MonitorMap.Keys) {
        $mon = $MonitorMap[$id]
        $presJson = (@{
            id = $id
            name = $mon.Name
            resolution = $mon.Resolution
            kind = "win"
            online = $true
            ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        } | ConvertTo-Json -Compress)
        Send-WsBytes $ws (Build-MqttPublish "$TopicRoot/presence" $presJson $false)
    }
}

function Handle-IncomingMessage($ws, [string]$topic, [string]$payloadStr) {
    if ($topic -eq "$TopicRoot/discover") {
        Publish-AllMonitors $ws
        return
    }
    try { $msg = $payloadStr | ConvertFrom-Json } catch { return }
    $parts = $topic.Split("/")
    $screenId = $parts[$parts.Length - 1]
    if (-not $MonitorMap.ContainsKey($screenId)) { return }
    $mon = $MonitorMap[$screenId]

    switch ($msg.type) {
        "opt_flash" {
            if ($msg.from) {
                $ackTopic = "$TopicRoot/ack/$($msg.from)"
                $ackJson = (@{ type = "opt_flash_started"; screenId = $screenId; token = $msg.token } | ConvertTo-Json -Compress)
                Send-WsBytes $ws (Build-MqttPublish $ackTopic $ackJson $false)
            }
            Write-Host "[OPTICAL] Pulso en $($mon.Name)"
            Flash-Monitor $mon.Bounds ([int]$msg.darkMs) ([int]$msg.brightMs)
        }
        "file_start" {
            if ($script:Transfer -and $script:Transfer.Stream) {
                try { $script:Transfer.Stream.Close() } catch {}
            }
            $ext = [System.IO.Path]::GetExtension($msg.name)
            if ([string]::IsNullOrWhiteSpace($ext)) { $ext = ".bin" }
            $outPath = Join-Path $MediaDir ("media_" + $msg.id + $ext)
            $fs = [System.IO.File]::Open($outPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
            $script:Transfer = @{
                Id = $msg.id
                Name = $msg.name
                Kind = $msg.kind
                Path = $outPath
                Stream = $fs
                Bounds = $mon.Bounds
            }
            Write-Host "[BEAM] Recibiendo $($msg.name) en $($mon.Name)..."
        }
        "file_chunk" {
            if ($script:Transfer -and $script:Transfer.Id -eq $msg.id -and $msg.b64) {
                $raw = [Convert]::FromBase64String($msg.b64)
                $script:Transfer.Stream.Write($raw, 0, $raw.Length)
            }
        }
        "file_end" {
            if ($script:Transfer -and $script:Transfer.Id -eq $msg.id) {
                $script:Transfer.Stream.Flush()
                $script:Transfer.Stream.Close()
                $t = $script:Transfer
                $script:Transfer = $null
                Write-Host "[OVERRIDE] Proyectando $($t.Name) en pantalla completa!"
                Launch-FullscreenOverlay $t.Bounds $t.Path $t.Kind $t.Name
            }
        }
        "control" {
            if ($msg.action -eq "restore") {
                Write-Host "[LIBERAR] Cerrando proyeccion -> volviendo a tus ventanas"
                Stop-OverlayPlayer
            }
        }
    }
}

# Main resilient WSS MQTT loop
while ($true) {
    $ws = New-Object System.Net.WebSockets.ClientWebSocket
    $ws.Options.AddSubProtocol("mqtt")
    try {
        Write-Host "[NET] Conectando a wss://broker.emqx.io:8084/mqtt (Canal: $Room)..."
        $uri = New-Object System.Uri("wss://broker.emqx.io:8084/mqtt")
        $ws.ConnectAsync($uri, [System.Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null

        $cid = "sr-win-" + [Guid]::NewGuid().ToString("N").Substring(0, 8)
        Send-WsBytes $ws (Build-MqttConnect $cid)
        Start-Sleep -Milliseconds 350

        $pktId = 1
        Send-WsBytes $ws (Build-MqttSubscribe $pktId "$TopicRoot/discover")
        $pktId++
        foreach ($id in $MonitorMap.Keys) {
            Send-WsBytes $ws (Build-MqttSubscribe $pktId "$TopicRoot/cmd/$id")
            $pktId++
        }
        Publish-AllMonitors $ws
        Write-Host "[LISTO] Monitores activos en segundo plano. Enfoca tu pantalla con el celular!"

        $recvBuf = New-Object byte[] 131072
        $ms = New-Object System.IO.MemoryStream
        $lastPing = [DateTime]::UtcNow
        $cts = New-Object System.Threading.CancellationTokenSource

        while ($ws.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
            $seg = New-Object System.ArraySegment[byte] -ArgumentList (,$recvBuf)
            $task = $ws.ReceiveAsync($seg, $cts.Token)

            while (-not $task.IsCompleted) {
                [System.Windows.Forms.Application]::DoEvents()
                if (([DateTime]::UtcNow - $lastPing).TotalSeconds -ge 20) {
                    Send-WsBytes $ws ([byte[]]@(0xC0, 0x00))
                    $lastPing = [DateTime]::UtcNow
                }
                Start-Sleep -Milliseconds 15
            }

            $res = $task.GetAwaiter().GetResult()
            if ($res.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) { break }
            $ms.Write($recvBuf, 0, $res.Count)
            if (-not $res.EndOfMessage) { continue }

            $all = $ms.ToArray()
            $ms.SetLength(0)

            # Parse 1 or more MQTT packets in buffer
            $pos = 0
            while ($pos -lt $all.Length) {
                $header = $all[$pos]
                $ptype = ($header -shr 4) -band 0x0F
                $pos++
                $mult = 1
                $remLen = 0
                do {
                    if ($pos -ge $all.Length) { break }
                    $enc = $all[$pos]
                    $pos++
                    $remLen += ($enc -band 127) * $mult
                    $mult *= 128
                } while (($enc -band 128) -ne 0)

                if ($pos + $remLen -gt $all.Length) { break }
                if ($ptype -eq 3 -and $remLen -ge 2) {
                    $tLen = ([int]$all[$pos] -shl 8) -bor [int]$all[$pos + 1]
                    $topicStr = [System.Text.Encoding]::UTF8.GetString($all, $pos + 2, $tLen)
                    $qos = ($header -shr 1) -band 0x03
                    $pOff = $pos + 2 + $tLen + ($(if ($qos -gt 0) { 2 } else { 0 }))
                    $pLen = ($pos + $remLen) - $pOff
                    if ($pLen -gt 0) {
                        $payloadStr = [System.Text.Encoding]::UTF8.GetString($all, $pOff, $pLen)
                        Handle-IncomingMessage $ws $topicStr $payloadStr
                    }
                }
                $pos += $remLen
            }
        }
    } catch {
        Write-Host "[RECONECTANDO] $($_.Exception.Message)"
    } finally {
        try { $ws.Dispose() } catch {}
    }
    Start-Sleep -Seconds 3
}
