"""
Paquetes .apkg de ejemplo para las pruebas (Prompt 10), generados con la biblioteca
oficial de Anki para que el formato sea auténtico. Contenido propio, sin derechos.

  pip install anki            # solo en desarrollo; no entra al bundle
  python3 scripts/apkg-fixtures.py

Escribe en tests/fixtures/apkg/:
  nuevo.apkg   formato nuevo (Anki ≥ 2.1.50 por defecto): meta=3, collection.anki21b (zstd,
               esquema v18), media protobuf zstd y collection.anki2 = marcador falso
  compat.apkg  «Compatibilidad con versiones antiguas»: meta=2, collection.anki21 (v11)
  legado.apkg  formato antiguo: solo collection.anki2 (v11) y media JSON
  basura.apkg  texto renombrado a .apkg (debe dar un error claro)
"""
import os, sys, tempfile, zipfile, base64
from anki.collection import Collection, ExportAnkiPackageOptions

OUT = os.path.join(os.path.dirname(__file__), '..', 'tests', 'fixtures', 'apkg')
os.makedirs(OUT, exist_ok=True)
tmp = tempfile.mkdtemp()
col = Collection(os.path.join(tmp, 'c.anki2'))
cardio = col.decks.id('Medicina::Cardio::ECG')
default = 1
basic = col.models.by_name('Basic')
rev = col.models.by_name('Basic (and reversed card)')
cloze = col.models.by_name('Cloze')

# PNG de 1×1 px (gris)
png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=')
open(os.path.join(tmp, 'eje.png'), 'wb').write(png)
img = col.media.add_file(os.path.join(tmp, 'eje.png'))

def add(model, fields, deck, tags=()):
    n = col.new_note(model)
    for i, f in enumerate(fields):
        n.fields[i] = f
    n.tags = list(tags)
    col.add_note(n, deck)

add(basic, ['¿Derivaciones de la pared inferior?', f'II, III y <b>aVF</b><br><img src="{img}">'], cardio, ['ecg', 'urgencias::uci'])
add(cloze, ['La {{c1::fibrilación auricular}} no tiene {{c2::ondas P}}', 'Ritmo irregular'], cardio)
add(rev, ['Taquicardia', 'Más de 100 lpm'], cardio)
add(basic, ['', 'nota con el primer campo vacío'], cardio)
add(basic, ['Pregunta en el mazo por defecto', 'Respuesta'], default)

# un repaso por tarjeta (historial)
for cid in col.find_cards(''):
    c = col.get_card(cid)
    c.start_timer()
    col.sched.answerCard(c, 3)

for legacy, name in [(False, 'nuevo.apkg'), (True, 'compat.apkg')]:
    opts = ExportAnkiPackageOptions(with_scheduling=True, with_deck_configs=False, with_media=True, legacy=legacy)
    col.export_anki_package(out_path=os.path.join(OUT, name), options=opts, limit=None)
col.close()

# legado: la colección v11 de «compat» como collection.anki2, media JSON, sin meta
with zipfile.ZipFile(os.path.join(OUT, 'compat.apkg')) as z, zipfile.ZipFile(os.path.join(OUT, 'legado.apkg'), 'w', zipfile.ZIP_DEFLATED) as o:
    o.writestr('collection.anki2', z.read('collection.anki21'))
    o.writestr('media', z.read('media'))
    for n in z.namelist():
        if n.isdigit():
            o.writestr(n, z.read(n))
# basura: un archivo de texto renombrado a .apkg
open(os.path.join(OUT, 'basura.apkg'), 'wb').write(b'Esto no es un paquete de Anki, solo texto renombrado.\n' * 4)
for n in os.listdir(OUT):
    os.chmod(os.path.join(OUT, n), 0o644)
print('ok:', sorted(os.listdir(OUT)))
