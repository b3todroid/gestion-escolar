"""Genera documentos PDF FICTICIOS para probar la importación de horarios (Fase 6).
Ningún dato es real. Uso: python3 scripts/generar_pdf_prueba.py
Salida: tests/fixtures/pdf/*.pdf
"""
import os
from reportlab.lib.pagesizes import letter, landscape
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT = 'tests/fixtures/pdf'
os.makedirs(OUT, exist_ok=True)
pdfmetrics.registerFont(TTFont('DejaVu', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'))
pdfmetrics.registerFont(TTFont('DejaVuB', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'))
DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes']
HORAS = ['07:00-07:50', '07:50-08:40', '08:40-09:30', '09:30-10:00', '10:00-10:50', '10:50-11:40', '11:40-12:30']


def tabla_pdf(nombre, titulo, subtitulo, encabezados, filas, anchos):
    """Tabla con líneas; celdas con 1 o 2 renglones (separados por \\n)."""
    c = canvas.Canvas(os.path.join(OUT, nombre), pagesize=landscape(letter))
    c.setTitle(titulo)
    w, h = landscape(letter)
    c.setFont('DejaVuB', 14); c.drawString(40, h - 40, titulo)
    c.setFont('DejaVu', 10); c.drawString(40, h - 58, subtitulo)
    x0, y = 40, h - 90
    alto = 30
    xs = [x0]
    for a in anchos: xs.append(xs[-1] + a)
    def fila(celdas, negrita=False):
        nonlocal y
        c.setLineWidth(0.5)
        c.rect(x0, y - alto, xs[-1] - x0, alto)
        for i, t in enumerate(celdas):
            c.line(xs[i], y, xs[i], y - alto)
            lineas = str(t).split('\n') if t else []
            c.setFont('DejaVuB' if negrita else 'DejaVu', 8.5)
            for j, l in enumerate(lineas):
                c.drawString(xs[i] + 4, y - 12 - j * 11, l)
        y -= alto
    fila(encabezados, True)
    for f in filas: fila(f)
    c.showPage(); c.save()


# 1. Sábana por grupo (PDF digital): celdas «Materia» + «Docente» en dos renglones; huecos vacíos.
grupoA = [
    [HORAS[0], 'Matemáticas\nDocente Ficticio Uno', 'Español\nDocente Ficticia Dos', '', 'Matemáticas\nDocente Ficticio Uno', ''],
    [HORAS[1], 'Español\nDocente Ficticia Dos', '', 'Matemáticas\nDocente Ficticio Uno', '', ''],
    [HORAS[2], '', '', '', '', 'Español\nDocente Ficticia Dos'],
    [HORAS[3], 'RECESO', 'RECESO', 'RECESO', 'RECESO', 'RECESO'],
    [HORAS[4], '', '', '', '', ''],
]
tabla_pdf('horario-grupo-1A.pdf', 'Escuela Secundaria Ficticia', 'Horario del grupo 1° A · Turno Matutino · Ciclo 2026-2027',
          ['Hora'] + DIAS, grupoA, [90] + [130] * 5)

# 2. Sábana por docente: celdas «Grupo Materia» en un renglón; incluye un choque con el grupo 1° A
#    (lunes 07:00 en 1° B) y un grupo inexistente (3° Z).
docente = [
    [HORAS[0], '1° B Matemáticas', '', '', '', ''],
    [HORAS[1], '', '1° B Matemáticas', '', '', ''],
    [HORAS[2], '', '', '', '3° Z Matemáticas', ''],
]
tabla_pdf('horario-docente-uno.pdf', 'Escuela Secundaria Ficticia', 'Horario del docente: Docente Ficticio Uno · Ciclo 2026-2027',
          ['Hora'] + DIAS, docente, [90] + [130] * 5)

# 3. Tabla con encabezados (una fila por clase), con una celda ambigua y un docente desconocido.
lista = [
    ['1° B', 'Martes', '3', 'Español', 'Docente Ficticia Dos'],
    ['1° B', 'Jueves', '1', 'Matemáticas Español', 'Docente Ficticio Uno'],
    ['1° B', 'Viernes', '2', 'Español', 'Docente Inexistente'],
]
tabla_pdf('horario-lista.pdf', 'Escuela Secundaria Ficticia', 'Clases del ciclo 2026-2027 (lista)',
          ['Grupo', 'Día', 'Periodo', 'Materia', 'Docente'], lista, [70, 90, 70, 160, 200])


# 4. PDF escaneado (sólo imagen, sin texto digital): sábana del grupo 1° B.
def escaneado(nombre, titulo, encabezados, filas, anchos):
    escala = 3
    W, H = int(792 * escala), int(612 * escala)
    img = Image.new('L', (W, H), 255)
    d = ImageDraw.Draw(img)
    f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 11 * escala)
    fb = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 15 * escala)
    d.text((40 * escala, 30 * escala), titulo, font=fb, fill=0)
    x0, y, alto = 40 * escala, 80 * escala, 34 * escala
    xs = [x0]
    for a in anchos: xs.append(xs[-1] + a * escala)
    for k, celdas in enumerate([encabezados] + filas):
        d.rectangle([x0, y, xs[-1], y + alto], outline=0, width=2)
        for i, t in enumerate(celdas):
            d.line([xs[i], y, xs[i], y + alto], fill=0, width=2)
            for j, l in enumerate(str(t).split('\n') if t else []):
                d.text((xs[i] + 5 * escala, y + 4 * escala + j * 13 * escala), l, font=f, fill=0)
        y += alto
    img = img.rotate(0.4, fillcolor=255, expand=False).filter(ImageFilter.GaussianBlur(0.6))
    img.save(os.path.join(OUT, nombre), 'PDF', resolution=72 * escala)
    img.save(os.path.join(OUT, nombre.replace('.pdf', '.png')))  # misma imagen, para probar el OCR en Node


grupoB = [
    [HORAS[0], 'Español\nDocente Ficticia Dos', '', '', '', ''],
    [HORAS[2], '', '', 'Español\nDocente Ficticia Dos', '', ''],
]
escaneado('horario-escaneado-1B.pdf', 'Horario del grupo 1° B (copia escaneada)', ['Hora'] + DIAS, grupoB, [100] + [125] * 5)

# 5. Archivo dañado (PDF truncado)
datos = open(os.path.join(OUT, 'horario-grupo-1A.pdf'), 'rb').read()
open(os.path.join(OUT, 'danado.pdf'), 'wb').write(datos[: len(datos) // 3])
print('ok')
