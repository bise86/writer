"""Rebuild the offline PDF font (development only; requires fonttools 4.60.1)."""
import base64
import hashlib
import io
import json
from pathlib import Path
import urllib.request
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

URL = 'https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/Variable/TTF/Subset/NotoSansSC-VF.ttf'
SHA256 = 'd68bafcb48a2707749396aa12bbbd833cb70401f3a9a689fd2902c7e0d295964'
data = urllib.request.urlopen(URL, timeout=60).read()
if hashlib.sha256(data).hexdigest() != SHA256:
    raise ValueError('Upstream font changed; review the source before updating the checksum')
font = instantiateVariableFont(TTFont(io.BytesIO(data)), {'wght': 400}, inplace=True)
# Fontkit's subset writer can select short loca offsets. Align glyph bytes so
# halving those offsets never truncates an odd offset and corrupts CJK glyphs.
font['glyf'].padding = 4
for glyph in font['glyf'].glyphs.values():
    glyph.expand(font['glyf'])
output = io.BytesIO()
font.save(output)
resource = Path(__file__).resolve().parent.parent / 'src/assets/fonts/noto-sans-sc.json'
resource.write_text(json.dumps(base64.b64encode(output.getvalue()).decode()), encoding='utf-8')
