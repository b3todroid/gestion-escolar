"""Genera la plantilla de importación de horarios y los archivos de prueba.

Uso: python3 scripts/generar_plantillas.py
Los datos son ficticios. Se usa openpyxl (independiente del lector de la app)
para que las pruebas validen archivos .xlsx reales.
"""
import datetime as dt
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill

ENCABEZADOS = ["Grado", "Grupo", "Turno", "Día", "Inicio", "Materia", "Docente"]


def libro(filas, instrucciones=True):
    wb = Workbook()
    ws = wb.active
    ws.title = "Horario"
    ws.append(ENCABEZADOS)
    for c in ws[1]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="1F4D3A")
    for f in filas:
        ws.append(f)
    for fila in ws.iter_rows(min_row=2, min_col=5, max_col=5):
        for c in fila:
            if isinstance(c.value, dt.time):
                c.number_format = "hh:mm"
    for col, ancho in zip("ABCDEFG", [8, 8, 14, 12, 9, 26, 30]):
        ws.column_dimensions[col].width = ancho
    if instrucciones:
        ins = wb.create_sheet("Instrucciones")
        for linea in [
            "Una fila por clase. Sólo se lee la primera hoja.",
            "Grado: número (1, 2, 3…). Grupo: letra (A, B…).",
            "Turno: nombre como en la app (Matutino…). Puede omitirse si el grupo existe en un solo turno.",
            "Día: Lunes a Domingo (o 1 a 7).",
            "Inicio: hora de inicio del periodo, como en la app (07:00).",
            "Materia: nombre registrado en el ciclo.",
            "Docente: número de empleado o nombre completo registrado. Vacío = docente pendiente.",
            "Antes de guardar, la app muestra errores y conflictos. Nada se guarda si hay alguno.",
            "Los horarios confirmados no se modifican con la importación.",
        ]:
            ins.append([linea])
        ins.column_dimensions["A"].width = 100
    return wb


t = dt.time
# Plantilla con dos filas de ejemplo (ficticias)
libro([
    [1, "A", "Matutino", "Lunes", t(7, 0), "Matemáticas", "E-001"],
    [1, "A", "Matutino", "Lunes", t(7, 50), "Español", "Docente Ficticia Dos"],
]).save("public/plantilla-horario.xlsx")

# Archivo de prueba: válido
libro([
    [1, "A", "Matutino", "Lunes", t(7, 0), "Matemáticas", "E-001"],
    [1, "A", "Matutino", "Martes", t(7, 0), "Matemáticas", "E-001"],
    [1, "B", "Matutino", "lunes", "07:50", "Matemáticas", "E-001"],
    [1, "A", "Matutino", "Lunes", t(7, 50), "Español", "Docente Ficticia Dos"],
], instrucciones=False).save("tests/fixtures/horario-valido.xlsx")

# Archivo de prueba: conflictos intencionales
libro([
    [1, "A", "Matutino", "Lunes", t(7, 0), "Matemáticas", "E-001"],
    [1, "B", "Matutino", "Lunes", t(7, 0), "Matemáticas", "E-001"],      # docente simultáneo
    [1, "A", "Matutino", "Lunes", t(7, 0), "Español", "Docente Ficticia Dos"],  # grupo con dos clases
    [1, "A", "Matutino", "Sábado", t(7, 0), "Español", "Docente Ficticia Dos"],  # día no laborable
    [1, "A", "Matutino", "Lunes", t(9, 15), "Español", "Docente Ficticia Dos"],  # no hay periodo
    [1, "A", "Matutino", "Lunes", t(10, 0), "Química", "E-001"],         # materia inexistente
    [9, "Z", "Matutino", "Lunes", t(7, 0), "Español", "Nadie"],          # grupo y docente inexistentes
], instrucciones=False).save("tests/fixtures/horario-conflictos.xlsx")
print("ok")
