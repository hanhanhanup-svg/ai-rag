param([string]$ConfigPath = '.env.local', [string]$DataPath = './data')
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$configTarget = [IO.Path]::GetFullPath((Join-Path $projectRoot $ConfigPath))
$dataTarget = [IO.Path]::GetFullPath((Join-Path $projectRoot $DataPath))
foreach ($target in @($configTarget, $dataTarget)) {
  if (-not $target.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Only paths inside this project may be protected by this helper.' }
}
if (-not (Test-Path -LiteralPath $configTarget -PathType Leaf)) { throw 'Create .env.local before protecting it.' }
if (-not (Test-Path -LiteralPath $dataTarget)) { [IO.Directory]::CreateDirectory($dataTarget) | Out-Null }
$currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$systemSid = New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
$fileAcl = New-Object Security.AccessControl.FileSecurity
$fileAcl.SetAccessRuleProtection($true, $false)
foreach ($sid in @($currentSid, $systemSid)) { $fileAcl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'Allow'))) }
Set-Acl -LiteralPath $configTarget -AclObject $fileAcl
$folderAcl = New-Object Security.AccessControl.DirectorySecurity
$folderAcl.SetAccessRuleProtection($true, $false)
foreach ($sid in @($currentSid, $systemSid)) { $folderAcl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))) }
Set-Acl -LiteralPath $dataTarget -AclObject $folderAcl
Write-Output 'Local configuration and data directory are restricted to the current service user and SYSTEM.'
