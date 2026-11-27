$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$previewRoot = Join-Path $PSScriptRoot '..\previews'
New-Item -ItemType Directory -Force -Path $previewRoot | Out-Null
$bitmap = New-Object System.Drawing.Bitmap(1920, 1080)
$g = [System.Drawing.Graphics]::FromImage($bitmap)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
function Brush([string]$hex) { return New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml($hex)) }
function Rect([float]$x,[float]$y,[float]$w,[float]$h,[string]$color) { $b=Brush $color; $g.FillRectangle($b,$x,$y,$w,$h);$b.Dispose() }
function Text([string]$value,[float]$x,[float]$y,[float]$size,[string]$color,[bool]$bold=$false,[string]$family='Microsoft JhengHei') {
 $style=[System.Drawing.FontStyle]::Regular;if($bold){$style=[System.Drawing.FontStyle]::Bold}
 $font=New-Object System.Drawing.Font($family,$size,$style,[System.Drawing.GraphicsUnit]::Pixel)
 $b=Brush $color;$g.DrawString($value,$font,$b,$x,$y);$b.Dispose();$font.Dispose()
}
function RoundRect([float]$x,[float]$y,[float]$w,[float]$h,[float]$radius,[string]$fill,[string]$edge) {
 $path=New-Object System.Drawing.Drawing2D.GraphicsPath
 $d=$radius*2;$path.AddArc($x,$y,$d,$d,180,90);$path.AddArc($x+$w-$d,$y,$d,$d,270,90);$path.AddArc($x+$w-$d,$y+$h-$d,$d,$d,0,90);$path.AddArc($x,$y+$h-$d,$d,$d,90,90);$path.CloseFigure()
 $b=Brush $fill;$g.FillPath($b,$path);$b.Dispose();$pen=New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml($edge),1.5);$g.DrawPath($pen,$path);$pen.Dispose();$path.Dispose()
}
try {
 Rect 0 0 1920 1080 '#142f29'
 Text '字' 18 6 29 '#f3f3e6' $true
 Text '單字擂台' 60 10 20 '#f3f3e6' $true
 Text 'AI 正式判讀    ● 已連線    ⛶' 1620 14 14 '#c9d7bb'
 Rect 0 47 1920 1 '#315047'
 RoundRect 16 56 1888 92 8 '#1e4137' '#315047'
 Text '第 03 題    │    結果已揭曉' 30 61 12 '#d9c38c' $true
 Text '「□袖善舞」請填入缺少的一字。' 30 78 30 '#f3f3e6' $true
 Text '本題正解：長  ·  完整成語：長袖善舞' 32 116 12 '#b4c9ad'
 Text '第 3 / 10 題  ·  8 秒後進入下一題' 480 116 13 '#f3d497' $true
 Text '✓' 1800 63 43 '#d9bc79' $true 'Segoe UI Symbol'
 Text '結果已揭曉' 1780 112 11 '#b4c9ad'
 Text '房號  007D4E' 18 156 16 '#e0c383' $true
 Text '全班成語挑戰' 170 160 12 '#a7b99a'
 Text '25 / 25 人已交卷     查看排行榜 ↗' 1630 158 13 '#b8c9a9'
 $ids=@();for($i=1410701;$i -le 1410715;$i++){$ids += [string]$i};for($i=1420716;$i -le 1420725;$i++){$ids += [string]$i}
 $wrong=@(3,7,11,16,20,24);$wrongGlyphs=@('張','常','帳','常','張','常')
 $gap=6.0;$cellW=(1888.0-4*$gap)/5;$cellH=(868.0-4*$gap)/5
 for($i=0;$i -lt 25;$i++) {
  $col=$i%5;$row=[math]::Floor($i/5);$x=16+$col*($cellW+$gap);$y=180+$row*($cellH+$gap)
  $bad=$wrong -contains $i;$color='#087451';$edge='#70efbc';$paper='#076548';if($bad){$color='#b41d34';$edge='#ffb1b9';$paper='#a91b30'}
  RoundRect $x $y $cellW $cellH 7 $color $edge
  Text $ids[$i] ($x+9) ($y+5) 13 '#ffffff' $true
  Text ('同學 '+('{0:00}' -f ($i+1))) ($x+91) ($y+6) 12 '#ffffff'
  $score=20+10*($i%3);if($bad){$score=10+10*($i%2)}
  Text ($score.ToString()+' 分') ($x+$cellW-48) ($y+6) 12 '#ffffff' $true
  Rect ($x+8) ($y+26) ($cellW-16) ($cellH-52) $paper
  $glyph='長';if($bad){$glyph=$wrongGlyphs[[array]::IndexOf($wrong,$i)]}
  $font=New-Object System.Drawing.Font('DFKai-SB',112,[System.Drawing.FontStyle]::Regular,[System.Drawing.GraphicsUnit]::Pixel)
  $format=New-Object System.Drawing.StringFormat;$format.Alignment=[System.Drawing.StringAlignment]::Center;$format.LineAlignment=[System.Drawing.StringAlignment]::Center
  $ink=Brush '#ffffff';$bounds=New-Object System.Drawing.RectangleF(($x+8),($y+24),($cellW-16),($cellH-48));$g.DrawString($glyph,$font,$ink,$bounds,$format);$font.Dispose();$ink.Dispose();$format.Dispose()
  $verdict='答對 ＋10 分';$symbol='✓';if($bad){$verdict='答錯 ＋0 分';$symbol='✗'}
  Text $verdict ($x+9) ($y+$cellH-22) 12 '#ffffff' $true
  Text $symbol ($x+$cellW-27) ($y+$cellH-25) 21 '#ffffff' $true 'Segoe UI Symbol'
 }
 Rect 0 1056 1920 1 '#315047'
 Text '排列示意｜25 人 5 × 5；姓名、字跡與分數皆為模擬資料' 18 1060 12 '#b6c4ae'
 Text '點選任一答案，可放大查看' 1710 1060 12 '#b6c4ae'
 $output=Join-Path $previewRoot 'wall-25-preview.png'
 $bitmap.Save($output,[System.Drawing.Imaging.ImageFormat]::Png)
 Write-Output $output
} finally {$g.Dispose();$bitmap.Dispose()}
