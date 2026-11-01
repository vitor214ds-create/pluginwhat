"""Package only the runtime extension and its Portuguese installation guide."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
extension = root / "extension"
output = root / "dist" / "pluginwhat-extension.zip"
output.parent.mkdir(exist_ok=True)
files = ["manifest.json", "background.js", "core.js", "content.js", "content-main.js",
         "whatsapp.js", "panel.html", "panel.css", "panel.js", "README.md"]
with ZipFile(output, "w", ZIP_DEFLATED) as archive:
    for name in files:
        archive.write(extension / name, "pluginwhat-extension/" + name)
with ZipFile(output) as archive:
    assert archive.testzip() is None
print(output)
