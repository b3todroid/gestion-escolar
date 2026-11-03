"""Plantillas de importación de catálogos y archivos de prueba (todo ficticio).

Uso: python3 -I scripts/generar_plantillas_catalogos.py
"""
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill


def libro(encabezados, filas, instrucciones, titulo=None, hoja='Datos', extra=None):
    wb = Workbook()
    ws = wb.active
    ws.title = hoja
    if titulo:
        ws.append([titulo])
        ws.append([])
    ws.append(encabezados)
    fila_enc = ws.max_row
    for c in ws[fila_enc]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="1F4D3A")
    for f in filas:
        ws.append(f)
    for i in range(len(encabezados)):
        ws.column_dimensions[chr(65 + i)].width = 22
    if instrucciones:
        ins = wb.create_sheet("Instrucciones")
        for l in instrucciones:
            ins.append([l])
        ins.column_dimensions["A"].width = 110
    if extra:
        nombre, filas_extra = extra
        e = wb.create_sheet(nombre)
        for f in filas_extra:
            e.append(f)
    return wb


COMUN = [
    "Una fila por registro. Escribe los encabezados en la primera fila (puedes cambiar su orden).",
    "Antes de guardar, la aplicación muestra cada fila como NUEVO, ACTUALIZABLE, POSIBLE DUPLICADO, CONFLICTO, ERROR u OMITIDO.",
    "Nada se guarda hasta que confirmes. Las personas con el mismo nombre nunca se fusionan automáticamente.",
    "Usa sólo datos necesarios. No incluyas información médica ni otros datos sensibles.",
]

# ---------------- Plantillas (con una fila de ejemplo ficticia) ----------------
libro(["Primer apellido", "Segundo apellido", "Nombre(s)", "Grado", "Grupo", "Turno", "Número de lista", "Matrícula", "CURP"],
      [["Apellido", "Ejemplo", "Nombre Ficticio", 1, "A", "Matutino", 1, "M-0001", ""]],
      ["ALUMNOS"] + COMUN + [
          "Grado y grupo deben existir en el ciclo (créalos primero). Sin grupo: deja Grupo vacío.",
          "Turno: sólo si hay grupos con el mismo nombre en varios turnos.",
          "Matrícula y CURP son opcionales; si existen, sirven para reconocer a quien ya está registrado. La CURP no es obligatoria.",
          "Si sólo tienes el nombre completo en una columna, usa el formato «Apellidos, Nombre(s)»; con más de dos apellidos, sepáralos en columnas.",
      ]).save("public/plantilla-alumnos.xlsx")
libro(["Primer apellido", "Segundo apellido", "Nombre(s)", "Identificador", "Materias", "Turnos", "Observaciones"],
      [["Apellido", "Ejemplo", "Docente Ficticio", "D-001", "Matemáticas, Física", "Matutino", ""]],
      ["DOCENTES"] + COMUN + [
          "Identificador: clave interna única (opcional, recomendada).",
          "Materias: las que PUEDE impartir, separadas por comas; deben existir en el catálogo del ciclo. No crea asignaciones a grupos.",
          "Turnos: separados por comas; deben existir en el ciclo.",
      ]).save("public/plantilla-docentes.xlsx")
libro(["Primer apellido", "Segundo apellido", "Nombre(s)", "Identificador", "Funciones", "Turnos", "Observaciones"],
      [["Apellido", "Ejemplo", "Persona Ficticia", "P-001", "Prefectura, Orientación", "Matutino", ""]],
      ["PERSONAL"] + COMUN + [
          "Funciones (separadas por comas): Docente, Prefectura, Dirección, Subdirección académica, Subdirección de gestión, Orientación,",
          "Trabajo social, UDEI, Secretaría, Asistencia escolar, Biblioteca, Otro. Una persona puede tener varias.",
      ]).save("public/plantilla-personal.xlsx")
libro(["Materia", "Tipo", "Abreviatura"],
      [["Matemáticas", "Materia", "MAT"], ["Horas de servicio (SE)", "Servicio", "SE"]],
      ["MATERIAS Y ACTIVIDADES"] + COMUN + [
          "Tipo: Materia, Campo formativo, Taller, Tutoría, Actividad especial o Servicio (SE). Si se deja vacío: Materia.",
          "Las horas de servicio (SE) son un tipo de actividad: no se asignan a grupos.",
      ]).save("public/plantilla-materias.xlsx")
libro(["Grado", "Grupo", "Turno", "Capacidad"], [[1, "D", "Matutino", 35]],
      ["GRUPOS"] + COMUN + ["El grado y el turno deben existir en el ciclo; la importación no los inventa."]).save("public/plantilla-grupos.xlsx")

libro(["Grupo", "Día", "Periodo", "Materia", "Docente"],
      [["1A", "Lunes", 1, "Matemáticas", "Nombre Apellido Ejemplo"], ["1A", "Lunes", 2, "Español", "P-001"]],
      ["HORARIOS (una fila por clase)"] + COMUN + [
          "Grupo: «1A», «1° A», o usa columnas separadas Grado y Grupo. Turno: sólo si hay grupos con el mismo nombre en varios turnos.",
          "Periodo: número (1, 2, 3…), nombre del periodo o, en su lugar, una columna «Hora de inicio» (07:00).",
          "Docente: nombre completo o identificador interno. Grupos, materias y docentes deben existir; la importación no los crea.",
          "No se reemplazan clases existentes ni se modifican horarios confirmados. Con un solo error o conflicto no se importa nada.",
      ]).save("public/plantilla-horarios.xlsx")

# ---------------- Archivos de prueba ----------------
# Horario con encabezados equivalentes, una fila de título y periodo por número.
libro(["Gpo", "Día de la semana", "Módulo", "Asignatura", "Profesor"],
      [["1A", "Lunes", 1, "Matemáticas", "Docente Ficticio Uno"],
       ["1° A", "Martes", "2", "Español", "Docente Ficticia Dos"],
       ["1B", "Lunes", "1", "Español", "Docente Ficticia Dos"]],
      None, titulo="HORARIO FICTICIO 2026", hoja="Horario").save("tests/fixtures/horario-sinonimos.xlsx")
# Encabezados equivalentes (sinónimos), con títulos antes y una segunda hoja.
libro(["Apellido paterno", "Apellido materno", "Nombre", "Gr.", "Gpo", "No. lista", "Matrícula"],
      [["Ficticia", "Prueba", "Ana", 1, "A", 1, "M-100"],
       ["Ficticio", "", "Beto", 1, "A", 2, "M-101"],
       ["Ejemplo", "Uno", "Carla", 1, "B", 1, ""],
       ["", "", "", "", "", "", ""],
       ["Sin", "Grupo", "Dani", 1, "", "", "M-103"],
       ["Ficticio", "", "Eva", 9, "Z", "", ""]],
      None, titulo="ESCUELA SECUNDARIA FICTICIA — LISTA DE ALUMNOS", hoja="Lista 2026",
      extra=("Notas", [["Esta hoja no contiene alumnos"]])).save("tests/fixtures/alumnos-sinonimos.xlsx")
# Encabezados desconocidos: el mapeo debe hacerse a mano.
libro(["Col A", "Col B", "Dato 3", "Dato 4"],
      [["Ficticia", "Ana", 1, "A"], ["Ficticio", "Beto", 1, "B"]], None).save("tests/fixtures/alumnos-desconocidos.xlsx")

with open("tests/fixtures/personal.csv", "w", encoding="utf-8", newline="") as f:
    f.write('﻿Primer apellido;Segundo apellido;Nombre;Identificador;Funciones;Observaciones\r\n')
    f.write('Ficticia;Prueba;Laura;P-001;"Prefectura; Orientación";"Turno matutino,\r\napoyo en recreo"\r\n')
    f.write('Ficticio;;Mario;P-002;Docente, UDEI;\r\n')
    f.write('Ejemplo;Dos;Rosa;P-003;Astronauta;\r\n')
with open("tests/fixtures/materias-1252.csv", "w", encoding="cp1252", newline="") as f:
    f.write('Materia,Tipo,Abreviatura\r\nEspañol,Materia,ESP\r\nMatemáticas,,MAT\r\nTutoría,Tutoría,TUT\r\nHoras de servicio,SE,SE\r\n')
with open("tests/fixtures/horario-conflicto.csv", "w", encoding="utf-8", newline="") as f:
    f.write('Grupo;Dia;Periodo;Materia;Docente\r\n1A;Miércoles;3;Matemáticas;Docente Ficticio Uno\r\n1B;Miércoles;3;Matemáticas;Docente Ficticio Uno\r\n1A;Sábado;1;Matemáticas;Docente Ficticio Uno\r\n1A;Jueves;9;Matemáticas;Docente Ficticio Uno\r\n')
print("ok")
