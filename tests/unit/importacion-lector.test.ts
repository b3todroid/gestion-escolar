/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { leerCsv, leerTabla, leerXlsx } from '../../src/domain/importacion/tabla';

const leer = (n: string) => { const b = readFileSync(`tests/fixtures/${n}`); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };

describe('lector de Excel (.xlsx real generado con openpyxl)', () => {
  it('lee la primera hoja: textos con acento, números y horas de Excel', async () => {
    const filas = await leerXlsx(leer('horario-valido.xlsx'));
    expect(filas[0]).toEqual(['Grado', 'Grupo', 'Turno', 'Día', 'Inicio', 'Materia', 'Docente']);
    expect(filas[1]).toEqual(['1', 'A', 'Matutino', 'Lunes', '07:00', 'Matemáticas', 'E-001']);
    expect(filas[3]).toEqual(['1', 'B', 'Matutino', 'lunes', '07:50', 'Matemáticas', 'E-001']); // hora escrita como texto
    expect(filas[4]?.[4]).toBe('07:50'); // hora guardada como hora de Excel
    expect(filas).toHaveLength(5);
  });

  it('lee la plantilla (sólo la primera hoja, no las instrucciones)', async () => {
    const b = readFileSync('public/plantilla-horario.xlsx');
    const filas = await leerXlsx(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
    expect(filas).toHaveLength(3);
  });

  it('rechaza archivos que no son Excel y formatos no compatibles', async () => {
    await expect(leerXlsx(new TextEncoder().encode('no soy un zip').buffer as ArrayBuffer)).rejects.toThrow('no es un libro de Excel');
    await expect(leerTabla('viejo.xls', new ArrayBuffer(10))).rejects.toThrow('.xls');
    await expect(leerTabla('foto.png', new ArrayBuffer(10))).rejects.toThrow('.xlsx o .csv');
    await expect(leerXlsx(new ArrayBuffer(6 * 1024 * 1024))).rejects.toThrow('5 MB');
  });
});

describe('lector de CSV', () => {
  it('detecta «;» o «,», respeta comillas y quita el BOM', () => {
    expect(leerCsv('﻿Grado;Grupo\r\n1;"A; B"\r\n')).toEqual([['Grado', 'Grupo'], ['1', 'A; B']]);
    expect(leerCsv('Materia,Docente\n"Español, lectura","Persona ""Ficticia"""\n\n')).toEqual([['Materia', 'Docente'], ['Español, lectura', 'Persona "Ficticia"']]);
  });
});
