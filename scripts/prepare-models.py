import importlib.metadata
import shutil
from pathlib import Path
import rapidocr

root = Path(__file__).resolve().parent.parent
package = Path(rapidocr.__file__).parent
target = root / "python" / "models"
target.mkdir(exist_ok=True)
for model in (package / "models").glob("*"):
    if model.is_file():
        shutil.copy2(model, target / model.name)
models = list(target.glob("*.onnx"))
if len(models) < 3:
    raise RuntimeError("Expected bundled detection, classification and recognition models")
licenses = root / "python" / "licenses"
licenses.mkdir(exist_ok=True)
for dist in importlib.metadata.distributions():
    name = dist.metadata["Name"]
    for file in dist.files or []:
        if any(key in str(file).upper() for key in ("LICENSE", "NOTICE", "COPYING")):
            source = Path(dist.locate_file(file))
            if source.is_file():
                dest = licenses / name / str(file).replace("..", "_")
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, dest)
print("Models ready:", ", ".join(m.name for m in models))
