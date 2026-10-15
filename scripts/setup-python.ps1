$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path '.venv\Scripts\python.exe')) {
  uv venv --python 3.12 .venv
  if ($LASTEXITCODE -ne 0) { throw 'Python environment creation failed' }
}
uv pip install --python .venv\Scripts\python.exe -r python\requirements.lock.txt
if ($LASTEXITCODE -ne 0) { throw 'Python dependency installation failed' }
& .venv\Scripts\python.exe scripts\prepare-models.py
if ($LASTEXITCODE -ne 0) { throw 'Model preparation failed' }
