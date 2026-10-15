$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
& .venv\Scripts\python.exe scripts\prepare-models.py
if ($LASTEXITCODE -ne 0) { throw 'Model preparation failed' }
& .venv\Scripts\python.exe -m PyInstaller --noconfirm --onedir --name invoice-worker --distpath python-dist --workpath python-build --collect-all rapidocr --collect-all onnxruntime --collect-all pypdfium2 --add-data 'python/models;models' python\worker.py
if ($LASTEXITCODE -ne 0) { throw 'Worker packaging failed' }
