param([string]$Name = 'X-RAG-企业知识库-1.0.0')
$ErrorActionPreference = 'Stop'
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$release = [IO.Path]::GetFullPath((Join-Path $project 'release'))
if (-not $release.StartsWith($project + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid release directory.' }
if ($Name -match '[\\/:*?"<>|]') { throw 'Invalid package name.' }
[IO.Directory]::CreateDirectory($release) | Out-Null
$archivePath = Join-Path $release ($Name + '.zip')
if (Test-Path -LiteralPath $archivePath) { $archivePath = Join-Path $release ($Name + '-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.zip') }
$relative = New-Object 'System.Collections.Generic.List[string]'
foreach ($file in @('README.md','IMPLEMENTATION.md','package.json','package-lock.json','index.html','tsconfig.json','tsconfig.node.json','vite.config.ts','postcss.config.js','tailwind.config.ts','Dockerfile','compose.yaml','.env.example','.gitignore','.dockerignore')) {
  if (-not (Test-Path -LiteralPath (Join-Path $project $file) -PathType Leaf)) { throw "Required file missing: $file" }
  $relative.Add($file)
}
foreach ($dir in @('src','server','scripts','dist','tests','models')) {
  Get-ChildItem -LiteralPath (Join-Path $project $dir) -Recurse -File | ForEach-Object { $relative.Add($_.FullName.Substring($project.Length + 1).Replace('\','/')) }
}
Get-ChildItem -LiteralPath (Join-Path $project 'docs') -File -Filter '*.md' | ForEach-Object { $relative.Add('docs/' + $_.Name) }
$relative.Add('knowledge-sources/.gitkeep')
$relative.Add('output/qa/check-20260907.txt')
$evidenceDir = Join-Path $project 'output/playwright/acceptance'
if (Test-Path -LiteralPath $evidenceDir) { Get-ChildItem -LiteralPath $evidenceDir -File -Filter '*.png' | ForEach-Object { $relative.Add('output/playwright/acceptance/' + $_.Name) } }
$records = @()
foreach ($file in ($relative | Sort-Object -Unique)) {
  if ($file -match '(^|/)\.env(?:$|\.(?!example$)[^/]+$)' -or $file -match '(^|/)(\.encryption-key|knowledge\.sqlite|node_modules|\.runtime|\.git|\.codex|\.agents)(/|$)' -or $file -match '^data(/|$)' -or $file -match '\.(log|tsbuildinfo)$') { throw "Disallowed package entry: $file" }
  $absolute = Join-Path $project $file
  if ($file -match '\.(mjs|js|jsx|ts|tsx|md|json|html|css|yaml|ps1)$') {
    $text = [IO.File]::ReadAllText($absolute)
    if ($text -match 'sk-[a-zA-Z0-9_-]{24,}') { throw "Possible credential in package source: $file" }
  }
  $records += [ordered]@{ path = $file; bytes = (Get-Item -LiteralPath $absolute).Length; sha256 = (Get-FileHash -LiteralPath $absolute -Algorithm SHA256).Hash.ToLowerInvariant() }
}
$utf8 = New-Object Text.UTF8Encoding($false)
$manifest = [ordered]@{ name = $Name; createdAt = [DateTime]::UtcNow.ToString('o'); credentialFilesExcluded = $true; businessDataExcluded = $true; includesOfflineChineseModel = $true; files = $records }
$manifestText = $manifest | ConvertTo-Json -Depth 8
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$stream = [IO.File]::Open($archivePath, [IO.FileMode]::CreateNew)
$zip = New-Object IO.Compression.ZipArchive($stream, [IO.Compression.ZipArchiveMode]::Create, $false, $utf8)
try {
  foreach ($record in $records) { [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $project $record.path), ('x-rag-enterprise/' + $record.path), [IO.Compression.CompressionLevel]::Optimal) | Out-Null }
  $entry = $zip.CreateEntry('x-rag-enterprise/PACKAGE-MANIFEST.json')
  $writer = New-Object IO.StreamWriter($entry.Open(), $utf8)
  try { $writer.Write($manifestText) } finally { $writer.Dispose() }
} finally { $zip.Dispose(); $stream.Dispose() }
$verify = [IO.Compression.ZipFile]::OpenRead($archivePath)
try {
  if ($verify.Entries.Count -ne $records.Count + 1) { throw 'Archive entry count mismatch.' }
  foreach ($record in $records) {
    $entry = $verify.GetEntry('x-rag-enterprise/' + $record.path)
    if (-not $entry -or $entry.Length -ne $record.bytes) { throw "Archive entry mismatch: $($record.path)" }
    $inputStream = $entry.Open()
    $hash = [Security.Cryptography.SHA256]::Create()
    try { $digest = ([BitConverter]::ToString($hash.ComputeHash($inputStream))).Replace('-','').ToLowerInvariant() } finally { $inputStream.Dispose(); $hash.Dispose() }
    if ($digest -ne $record.sha256) { throw "Archive hash mismatch: $($record.path)" }
  }
} finally { $verify.Dispose() }
$archiveHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText($archivePath + '.sha256', $archiveHash + '  ' + [IO.Path]::GetFileName($archivePath) + [Environment]::NewLine, $utf8)
[IO.File]::WriteAllText((Join-Path $release 'package-verification.json'), (([ordered]@{ archive = [IO.Path]::GetFileName($archivePath); sha256 = $archiveHash; filesVerified = $records.Count; utf8Names = $true; credentialFilesExcluded = $true; businessDataExcluded = $true; verifiedAt = [DateTime]::UtcNow.ToString('o') }) | ConvertTo-Json), $utf8)
[ordered]@{ archive = $archivePath; sha256 = $archiveHash; filesVerified = $records.Count; bytes = (Get-Item -LiteralPath $archivePath).Length; status = 'verified' } | ConvertTo-Json
