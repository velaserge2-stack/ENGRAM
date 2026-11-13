"""Paquete .apkg de 5 000 tarjetas (formato nuevo de Anki) para medir la importación. Uso: vault-gen-apkg.py salida.apkg [semilla]
Requiere `pip install anki` (solo desarrollo)."""
import os, random, sys, tempfile
from anki.collection import Collection, ExportAnkiPackageOptions

out = sys.argv[1]
random.seed(int(sys.argv[2]) if len(sys.argv) > 2 else 1)
W = 'ritmo onda segmento derivacion pared arteria ventriculo auricula bloqueo presion volumen gasto frecuencia farmaco dosis receptor canal'.split()
s = lambda n: ' '.join(random.choice(W) for _ in range(n))
tmp = tempfile.mkdtemp()
col = Collection(os.path.join(tmp, 'c.anki2'))
basic = col.models.by_name('Basic')
for d in range(10):
    did = col.decks.id(f'Perf::Mazo {d + 1}')
    for _ in range(500):
        n = col.new_note(basic)
        n.fields[0] = '¿' + s(6) + '?'
        n.fields[1] = s(10)
        col.add_note(n, did)
col.export_anki_package(out_path=out, options=ExportAnkiPackageOptions(with_scheduling=False, with_media=False, legacy=False), limit=None)
col.close()
print('apkg-5000.apkg: 5000 tarjetas')
