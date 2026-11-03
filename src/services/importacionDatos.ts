import type { Alumno, FuncionPersonal, Personal, RegistroImportacion, TipoMateria } from '../models';
import { FUNCIONES_VIGENTES } from '../models';
import { esquemaAlumno, esquemaPersonal } from '../validators/esquemas';
import { ErrorDominio } from '../domain/errores';
import { normalizarTexto } from '../domain/texto';
import { CAMPOS, problemasMapeo, separarNombreCompleto, valor, type Mapeo, type TipoImportacion } from '../domain/importacion/mapeo';
import { type Contexto, cicloEditable, metadatosNuevos } from './contexto';
import { ServicioAlumnos, claveNombre } from './alumnos';
import { ServicioPersonal, ETIQUETA_FUNCION, nombreCompleto } from './personal';
import { ServicioMaterias } from './materias';
import { ServicioGrados } from './grados';

export type EstadoFilaDatos = 'nuevo' | 'actualizable' | 'posible_duplicado' | 'conflicto' | 'error' | 'omitido';
export type Decision = 'crear' | 'actualizar' | 'omitir';

export const ETIQUETA_ESTADO_FILA: Record<EstadoFilaDatos, string> = {
  nuevo: 'NUEVO', actualizable: 'ACTUALIZABLE', posible_duplicado: 'POSIBLE DUPLICADO', conflicto: 'CONFLICTO', error: 'ERROR', omitido: 'OMITIDO',
};

export interface FilaAnalizada {
  fila: number; // renglón del archivo (1 = primera fila de la hoja)
  resumen: string;
  estado: EstadoFilaDatos;
  mensajes: string[];
  cambios: string[]; // qué se actualizaría
  existenteId: string | null;
  existente: string | null; // descripción del registro que ya existe
  opciones: Decision[];
  decision: Decision; // propuesta (la persona puede cambiarla entre «opciones»)
  datos: Record<string, unknown>;
}

export interface AnalisisDatos {
  tipo: TipoImportacion;
  filas: FilaAnalizada[];
  totales: Record<EstadoFilaDatos | 'total' | 'validos', number>;
  advertencias: string[];
}

const TIPO_MATERIA: Record<string, TipoMateria> = {
  materia: 'materia', asignatura: 'materia', 'campo formativo': 'campo_formativo', campo: 'campo_formativo', taller: 'taller',
  tutoria: 'tutoria', 'actividad especial': 'actividad_especial', actividad: 'actividad_especial', servicio: 'servicio', se: 'servicio', 'horas de servicio': 'servicio',
};

const ALIAS_FUNCION: Record<string, FuncionPersonal> = {
  docente: 'docente', profesor: 'docente', profesora: 'docente', maestro: 'docente', maestra: 'docente',
  prefectura: 'prefectura', prefecto: 'prefectura', prefecta: 'prefectura',
  direccion: 'direccion', director: 'direccion', directora: 'direccion',
  'subdireccion academica': 'subdireccion_academica', 'subdirector academico': 'subdireccion_academica', 'subdirectora academica': 'subdireccion_academica',
  'subdireccion de gestion': 'subdireccion_gestion', 'subdirector de gestion': 'subdireccion_gestion', 'subdirectora de gestion': 'subdireccion_gestion',
  orientacion: 'orientacion', orientador: 'orientacion', orientadora: 'orientacion',
  'trabajo social': 'trabajo_social', 'trabajador social': 'trabajo_social', 'trabajadora social': 'trabajo_social',
  udei: 'udei', secretaria: 'secretaria', secretario: 'secretaria',
  'asistencia escolar': 'asistencia_escolar', 'asistente escolar': 'asistencia_escolar',
  biblioteca: 'biblioteca', bibliotecario: 'biblioteca', bibliotecaria: 'biblioteca', otro: 'otro', otra: 'otro',
};
for (const f of FUNCIONES_VIGENTES) ALIAS_FUNCION[normalizarTexto(ETIQUETA_FUNCION[f])] = f;

const lista = (t: string) => t.split(/[,;/]/).map((x) => x.trim()).filter(Boolean);
const numero = (t: string) => { const v = t.replace(/[°º]/g, '').trim(); return /^\d+$/.test(v) ? Number(v) : null; };

/**
 * Centro de importación de catálogos (alumnos, docentes, personal, materias y grupos).
 * ANALIZAR no escribe nada (área temporal en memoria). APLICAR vuelve a analizar
 * dentro de una transacción y ejecuta sólo las decisiones confirmadas.
 * Nunca fusiona personas por coincidencia de nombre.
 */
export class ServicioImportacionDatos {
  private readonly alumnos: ServicioAlumnos;
  private readonly personal: ServicioPersonal;
  private readonly materias: ServicioMaterias;
  private readonly grados: ServicioGrados;
  constructor(private readonly ctx: Contexto) {
    this.alumnos = new ServicioAlumnos(ctx); this.personal = new ServicioPersonal(ctx);
    this.materias = new ServicioMaterias(ctx); this.grados = new ServicioGrados(ctx);
  }

  async historial(cicloId: string): Promise<RegistroImportacion[]> {
    return (await this.ctx.repos.importaciones.listarPor('cicloEscolarId', cicloId)).sort((a, b) => b.creadoEn.localeCompare(a.creadoEn));
  }

  async analizar(cicloId: string, tipo: TipoImportacion, cuerpo: string[][], mapeo: Mapeo, huella: string | null = null, primeraFila = 2): Promise<AnalisisDatos> {
    if (tipo === 'horarios') throw new ErrorDominio('VALIDACION', 'Los horarios se analizan con el servicio de importación de horarios.');
    const ciclo = await cicloEditable(this.ctx, cicloId);
    const p = problemasMapeo(mapeo, tipo);
    if (p.length) throw new ErrorDominio('VALIDACION', p[0]!);
    const advertencias: string[] = [];
    if (huella) {
      const previa = (await this.ctx.repos.importaciones.listarPor('escuelaId', ciclo.escuelaId)).find((r) => r.huella === huella);
      if (previa) advertencias.push(`Este mismo archivo ya se importó el ${new Date(previa.creadoEn).toLocaleString('es-MX')} (${previa.resultado.nuevos} nuevos, ${previa.resultado.actualizados} actualizados). Revisa antes de importarlo otra vez.`);
    }
    const filasNoVacias = cuerpo.map((f, i) => ({ f, n: primeraFila + i })).filter(({ f }) => f.some((c) => c.trim() !== ''));
    if (!filasNoVacias.length) throw new ErrorDominio('VALIDACION', 'No hay filas de datos debajo de los encabezados.');
    if (filasNoVacias.length > 3000) throw new ErrorDominio('VALIDACION', 'El archivo tiene más de 3000 filas. Divídelo en varios archivos.');

    const contexto = await this.contexto(cicloId, ciclo.escuelaId);
    const filas: FilaAnalizada[] = [];
    const vistos = new Map<string, number>(); // claves fuertes/débiles dentro del archivo → fila
    for (const { f, n } of filasNoVacias) {
      const base = { fila: n, resumen: f.filter(Boolean).slice(0, 6).join(', '), mensajes: [] as string[], cambios: [] as string[], existenteId: null as string | null, existente: null as string | null, datos: {} as Record<string, unknown> };
      const r = tipo === 'alumnos' ? this.filaAlumno(f, mapeo, contexto, vistos, n, base)
        : tipo === 'materias' ? this.filaMateria(f, mapeo, contexto, vistos, n, base)
          : tipo === 'grupos' ? this.filaGrupo(f, mapeo, contexto, vistos, n, base)
            : this.filaPersona(f, mapeo, contexto, vistos, n, base, tipo);
      filas.push(r);
    }
    const totales = { total: filas.length, validos: 0, nuevo: 0, actualizable: 0, posible_duplicado: 0, conflicto: 0, error: 0, omitido: 0 };
    for (const x of filas) totales[x.estado]++;
    totales.validos = totales.nuevo + totales.actualizable + totales.posible_duplicado + totales.omitido;
    return { tipo, filas, totales, advertencias };
  }

  // ---------- Contexto del ciclo (lectura única) ----------

  private async contexto(cicloId: string, escuelaId: string) {
    const r = this.ctx.repos;
    return {
      cicloId, escuelaId,
      grados: await r.grados.listarPor('cicloEscolarId', cicloId),
      grupos: await r.grupos.listarPor('cicloEscolarId', cicloId),
      turnos: await r.turnos.listarPor('cicloEscolarId', cicloId),
      materias: await r.materias.listarPor('cicloEscolarId', cicloId),
      alumnos: await r.alumnos.listarPor('escuelaId', escuelaId),
      inscripciones: await r.inscripciones.listarPor('cicloEscolarId', cicloId),
      personal: await r.personal.listarPor('escuelaId', escuelaId),
      adscripciones: await r.adscripciones.listarPor('cicloEscolarId', cicloId),
    };
  }
  private nombreGrupo(ctx: Awaited<ReturnType<ServicioImportacionDatos['contexto']>>, id: string | null) {
    const g = ctx.grupos.find((x) => x.id === id); const gr = ctx.grados.find((x) => x.id === g?.gradoId);
    return g ? `${gr?.numero ?? ''}° ${g.nombre}` : 'sin grupo';
  }

  private persona(f: string[], mapeo: Mapeo, mensajes: string[]) {
    let nombre = valor(f, mapeo, 'nombre'); let primerApellido = valor(f, mapeo, 'primerApellido'); let segundoApellido = valor(f, mapeo, 'segundoApellido');
    const completo = valor(f, mapeo, 'nombreCompleto');
    if ((!nombre || !primerApellido) && completo) {
      const s = separarNombreCompleto(completo);
      if (s) ({ nombre, primerApellido } = s), (segundoApellido = s.segundoApellido ?? '');
      else mensajes.push(`No se separan nombre y apellidos de «${completo}» automáticamente (puede ser ambiguo). Usa columnas separadas o el formato «Apellidos, Nombre(s)».`);
    }
    return { nombre, primerApellido, segundoApellido };
  }

  private resolver<T extends Omit<FilaAnalizada, 'estado' | 'opciones' | 'decision'>>(base: T, estado: EstadoFilaDatos): FilaAnalizada {
    const opciones: Decision[] = estado === 'nuevo' ? ['crear', 'omitir'] : estado === 'actualizable' ? ['actualizar', 'omitir']
      : estado === 'posible_duplicado' ? (base.existenteId ? ['omitir', 'crear', 'actualizar'] : ['omitir', 'crear']) : ['omitir'];
    // Propuesta: crear lo nuevo, actualizar lo actualizable y omitir todo lo demás (incluidos posibles duplicados).
    const decision: Decision = estado === 'nuevo' ? 'crear' : estado === 'actualizable' ? 'actualizar' : 'omitir';
    return { ...base, estado, opciones, decision };
  }

  // ---------- Alumnos ----------

  private filaAlumno(f: string[], mapeo: Mapeo, c: Awaited<ReturnType<ServicioImportacionDatos['contexto']>>, vistos: Map<string, number>, n: number, base: Omit<FilaAnalizada, 'estado' | 'opciones' | 'decision'>): FilaAnalizada {
    const per = this.persona(f, mapeo, base.mensajes);
    const v = esquemaAlumno.safeParse({ ...per, matricula: valor(f, mapeo, 'matricula'), curp: valor(f, mapeo, 'curp'), observaciones: valor(f, mapeo, 'observaciones') });
    if (!v.success) for (const i of v.error.issues) base.mensajes.push(i.message);
    // Grado, grupo y turno
    const gradoTxt = valor(f, mapeo, 'grado'); const grupoTxt = valor(f, mapeo, 'grupo'); const turnoTxt = valor(f, mapeo, 'turno');
    const listaTxt = valor(f, mapeo, 'numeroLista');
    let grupoId: string | null = null; let gradoId: string | null = null; let turnoId: string | null = null;
    if (turnoTxt) { const t = c.turnos.find((x) => normalizarTexto(x.nombre) === normalizarTexto(turnoTxt)); if (t) turnoId = t.id; else base.mensajes.push(`El turno «${turnoTxt}» no existe en el ciclo.`); }
    if (gradoTxt) {
      const g = c.grados.find((x) => x.numero === numero(gradoTxt) || normalizarTexto(x.nombre) === normalizarTexto(gradoTxt));
      if (g) gradoId = g.id; else base.mensajes.push(`El grado «${gradoTxt}» no existe en el ciclo.`);
    }
    if (grupoTxt) {
      if (!gradoTxt) base.mensajes.push('Indica el grado del grupo.');
      else if (gradoId) {
        let cand = c.grupos.filter((x) => x.gradoId === gradoId && normalizarTexto(x.nombre) === normalizarTexto(grupoTxt));
        if (turnoId) cand = cand.filter((x) => x.turnoId === turnoId);
        if (!cand.length) base.mensajes.push(`No existe el grupo ${gradoTxt}° ${grupoTxt}${turnoTxt ? ` en el turno ${turnoTxt}` : ''}.`);
        else if (cand.length > 1) base.mensajes.push(`Hay varios grupos ${gradoTxt}° ${grupoTxt}; indica el turno.`);
        else if (cand[0]!.activo === false) base.mensajes.push(`El grupo ${gradoTxt}° ${grupoTxt} está desactivado.`);
        else { grupoId = cand[0]!.id; turnoId = cand[0]!.turnoId; }
      }
    }
    const numeroLista = listaTxt ? numero(listaTxt) : null;
    if (listaTxt && (numeroLista === null || numeroLista < 1 || numeroLista > 200)) base.mensajes.push(`El número de lista «${listaTxt}» no es válido.`);
    if (base.mensajes.length || !v.success) return this.resolver(base, 'error');
    const d = v.data;
    base.datos = { identidad: d, destino: { grupoId, gradoId, turnoId }, numeroLista };
    base.resumen = `${nombreAlumno2(d)}${grupoId ? `, ${this.nombreGrupo(c, grupoId)}` : gradoId ? `, ${c.grados.find((x) => x.id === gradoId)?.nombre}, sin grupo` : ', sin grupo'}`;

    // Dentro del archivo
    for (const [k, etiqueta] of [[d.matricula, 'matrícula'], [d.curp, 'CURP']] as const) {
      if (!k) continue;
      const clave = `${etiqueta}:${k}`;
      if (vistos.has(clave)) { base.mensajes.push(`La ${etiqueta} ${k} también aparece en la fila ${vistos.get(clave)}.`); return this.resolver(base, 'conflicto'); }
      vistos.set(clave, n);
    }
    // Contra lo registrado: identificadores fuertes
    const porMat = d.matricula ? c.alumnos.find((a) => a.matricula === d.matricula) : undefined;
    const porCurp = d.curp ? c.alumnos.find((a) => a.curp === d.curp) : undefined;
    if (porMat && porCurp && porMat.id !== porCurp.id) {
      base.mensajes.push(`La matrícula corresponde a ${nombreAlumno2(porMat)} y la CURP a ${nombreAlumno2(porCurp)}.`);
      return this.resolver(base, 'conflicto');
    }
    const existente = porMat ?? porCurp;
    if (existente) {
      base.existenteId = existente.id; base.existente = nombreAlumno2(existente);
      for (const [campo, etiqueta] of [['nombre', 'nombre'], ['primerApellido', 'primer apellido'], ['segundoApellido', 'segundo apellido'], ['matricula', 'matrícula'], ['curp', 'CURP'], ['observaciones', 'observaciones']] as const) {
        const nuevo = d[campo]; const viejo = existente[campo];
        if (nuevo && nuevo !== viejo) base.cambios.push(`${etiqueta}: «${viejo ?? ''}» → «${nuevo}»`);
      }
      const ins = c.inscripciones.find((i) => i.alumnoId === existente.id);
      if (!ins) base.cambios.push(`se inscribirá en el ciclo (${grupoId ? this.nombreGrupo(c, grupoId) : 'sin grupo'})`);
      else {
        if (grupoId && ins.grupoId !== grupoId) base.cambios.push(`grupo: ${this.nombreGrupo(c, ins.grupoId)} → ${this.nombreGrupo(c, grupoId)}`);
        if (numeroLista && ins.numeroLista !== numeroLista) base.cambios.push(`número de lista: ${ins.numeroLista ?? '—'} → ${numeroLista}`);
        if (ins.estado === 'baja') base.mensajes.push('Su inscripción está dada de baja; reactívala a mano si corresponde.');
      }
      if (!base.cambios.length) { base.mensajes.push('Ya está registrado sin cambios.'); return this.resolver(base, 'omitido'); }
      return this.resolver(base, 'actualizable');
    }
    // Coincidencia sólo por nombre: posible duplicado (nunca se fusiona automáticamente)
    const clave = `nombre:${claveNombre(d)}|${grupoId ?? gradoId ?? ''}`;
    if (vistos.has(clave)) { base.mensajes.push(`Mismo nombre y grupo que la fila ${vistos.get(clave)}.`); return this.resolver(base, 'posible_duplicado'); }
    vistos.set(clave, n);
    const mismoNombre = c.alumnos.find((a) => claveNombre(a) === claveNombre(d));
    if (mismoNombre) {
      const ins = c.inscripciones.find((i) => i.alumnoId === mismoNombre.id);
      base.existenteId = mismoNombre.id;
      base.existente = `${nombreAlumno2(mismoNombre)}${ins ? `, ${this.nombreGrupo(c, ins.grupoId)}` : ', sin inscripción en este ciclo'}`;
      base.mensajes.push('Ya hay un alumno con el mismo nombre. Puede ser la misma persona u otra: decide si crear, actualizar u omitir.');
      return this.resolver(base, 'posible_duplicado');
    }
    return this.resolver(base, 'nuevo');
  }

  // ---------- Personal y docentes ----------

  private filaPersona(f: string[], mapeo: Mapeo, c: Awaited<ReturnType<ServicioImportacionDatos['contexto']>>, vistos: Map<string, number>, n: number, base: Omit<FilaAnalizada, 'estado' | 'opciones' | 'decision'>, tipo: TipoImportacion): FilaAnalizada {
    const per = this.persona(f, mapeo, base.mensajes);
    const funciones: FuncionPersonal[] = tipo === 'docentes' ? ['docente'] : [];
    for (const t of lista(valor(f, mapeo, 'funciones'))) {
      const fn = ALIAS_FUNCION[normalizarTexto(t)];
      if (fn) funciones.push(fn); else base.mensajes.push(`Función desconocida «${t}».`);
    }
    const turnoIds: string[] = [];
    for (const t of lista(valor(f, mapeo, 'turnos'))) {
      const tu = c.turnos.find((x) => normalizarTexto(x.nombre) === normalizarTexto(t));
      if (tu) turnoIds.push(tu.id); else base.mensajes.push(`El turno «${t}» no existe en el ciclo.`);
    }
    const materiaIds: string[] = [];
    for (const t of lista(valor(f, mapeo, 'materias'))) {
      const m = c.materias.find((x) => normalizarTexto(x.nombre) === normalizarTexto(t) || (x.abreviatura && normalizarTexto(x.abreviatura) === normalizarTexto(t)));
      if (m) materiaIds.push(m.id); else base.mensajes.push(`La materia «${t}» no está registrada en el ciclo.`);
    }
    const v = esquemaPersonal.safeParse({ ...per, numeroEmpleado: valor(f, mapeo, 'numeroEmpleado'), funciones, observaciones: valor(f, mapeo, 'observaciones') });
    if (!v.success) for (const i of v.error.issues) base.mensajes.push(i.message);
    if (base.mensajes.length || !v.success) return this.resolver(base, 'error');
    const d = v.data;
    base.datos = { persona: d, turnoIds, materiaIds };
    base.resumen = `${nombreCompleto(d)}${d.numeroEmpleado ? ` (${d.numeroEmpleado})` : ''}, ${d.funciones.map((x) => ETIQUETA_FUNCION[x]).join(', ')}`;
    if (d.numeroEmpleado) {
      const k = `id:${d.numeroEmpleado}`;
      if (vistos.has(k)) { base.mensajes.push(`El identificador ${d.numeroEmpleado} también aparece en la fila ${vistos.get(k)}.`); return this.resolver(base, 'conflicto'); }
      vistos.set(k, n);
      const ex = c.personal.find((p) => p.numeroEmpleado === d.numeroEmpleado);
      if (ex) {
        base.existenteId = ex.id; base.existente = nombreCompleto(ex);
        if (normalizarTexto(nombreCompleto(ex)) !== normalizarTexto(nombreCompleto(d))) base.cambios.push(`nombre: «${nombreCompleto(ex)}» → «${nombreCompleto(d)}»`);
        const nuevasF = d.funciones.filter((x) => !ex.funciones.includes(x));
        if (nuevasF.length) base.cambios.push(`agrega funciones: ${nuevasF.map((x) => ETIQUETA_FUNCION[x]).join(', ')}`);
        const ads = c.adscripciones.find((a) => a.personalId === ex.id);
        const nuevosT = turnoIds.filter((t) => !ads?.turnoIds.includes(t));
        if (nuevosT.length) base.cambios.push(`agrega turnos: ${nuevosT.map((t) => c.turnos.find((x) => x.id === t)?.nombre).join(', ')}`);
        const nuevasM = materiaIds.filter((m) => !ads?.materiaIds.includes(m));
        if (nuevasM.length) base.cambios.push(`agrega materias: ${nuevasM.map((m) => c.materias.find((x) => x.id === m)?.nombre).join(', ')}`);
        if (d.observaciones && d.observaciones !== ex.observaciones) base.cambios.push('actualiza observaciones');
        if (!ex.activo) base.mensajes.push('Esta persona está dada de baja; la importación no la reactiva.');
        if (!base.cambios.length) { base.mensajes.push('Ya está registrada sin cambios.'); return this.resolver(base, 'omitido'); }
        return this.resolver(base, 'actualizable');
      }
    }
    const k = `nombre:${normalizarTexto(nombreCompleto(d))}`;
    if (vistos.has(k)) { base.mensajes.push(`Mismo nombre que la fila ${vistos.get(k)}.`); return this.resolver(base, 'posible_duplicado'); }
    vistos.set(k, n);
    const mismo = c.personal.find((p) => normalizarTexto(nombreCompleto(p)) === normalizarTexto(nombreCompleto(d)));
    if (mismo) {
      base.existenteId = mismo.id; base.existente = `${nombreCompleto(mismo)}${mismo.numeroEmpleado ? ` (${mismo.numeroEmpleado})` : ''}`;
      base.mensajes.push('Ya hay una persona con el mismo nombre. Decide si es la misma (actualizar) o es otra (crear).');
      return this.resolver(base, 'posible_duplicado');
    }
    return this.resolver(base, 'nuevo');
  }

  // ---------- Materias ----------

  private filaMateria(f: string[], mapeo: Mapeo, c: Awaited<ReturnType<ServicioImportacionDatos['contexto']>>, vistos: Map<string, number>, n: number, base: Omit<FilaAnalizada, 'estado' | 'opciones' | 'decision'>): FilaAnalizada {
    const nombre = valor(f, mapeo, 'nombre'); const tipoTxt = valor(f, mapeo, 'tipo'); const abreviatura = valor(f, mapeo, 'abreviatura');
    if (nombre.length < 2) base.mensajes.push('Falta el nombre de la materia.');
    const tipo = tipoTxt ? TIPO_MATERIA[normalizarTexto(tipoTxt)] : 'materia';
    if (!tipo) base.mensajes.push(`Tipo desconocido «${tipoTxt}» (usa: materia, campo formativo, taller, tutoría, actividad especial o servicio).`);
    if (abreviatura.length > 12) base.mensajes.push('La abreviatura admite como máximo 12 caracteres.');
    if (base.mensajes.length) return this.resolver(base, 'error');
    base.datos = { nombre, tipo, abreviatura: abreviatura || null };
    base.resumen = `${nombre}${abreviatura ? ` (${abreviatura})` : ''}`;
    const k = normalizarTexto(nombre);
    if (vistos.has(k)) { base.mensajes.push(`Repetida en el archivo (fila ${vistos.get(k)}).`); return this.resolver(base, 'omitido'); }
    vistos.set(k, n);
    const ex = c.materias.find((m) => normalizarTexto(m.nombre) === k);
    const otraAbrev = abreviatura ? c.materias.find((m) => m.abreviatura && normalizarTexto(m.abreviatura) === normalizarTexto(abreviatura) && m.id !== ex?.id) : undefined;
    if (otraAbrev) { base.mensajes.push(`La abreviatura «${abreviatura}» ya la usa «${otraAbrev.nombre}».`); return this.resolver(base, 'conflicto'); }
    if (ex) {
      base.existenteId = ex.id; base.existente = ex.nombre;
      if (tipoTxt && tipo !== ex.tipo) base.cambios.push(`tipo: ${ex.tipo} → ${tipo}`);
      if (abreviatura && abreviatura !== ex.abreviatura) base.cambios.push(`abreviatura: «${ex.abreviatura ?? ''}» → «${abreviatura}»`);
      if (!base.cambios.length) { base.mensajes.push('Ya está registrada sin cambios.'); return this.resolver(base, 'omitido'); }
      return this.resolver(base, 'actualizable');
    }
    return this.resolver(base, 'nuevo');
  }

  // ---------- Grupos ----------

  private filaGrupo(f: string[], mapeo: Mapeo, c: Awaited<ReturnType<ServicioImportacionDatos['contexto']>>, vistos: Map<string, number>, n: number, base: Omit<FilaAnalizada, 'estado' | 'opciones' | 'decision'>): FilaAnalizada {
    const gradoTxt = valor(f, mapeo, 'grado'); const grupoTxt = valor(f, mapeo, 'grupo').toUpperCase(); const turnoTxt = valor(f, mapeo, 'turno'); const capTxt = valor(f, mapeo, 'capacidad');
    const grado = c.grados.find((x) => x.numero === numero(gradoTxt) || normalizarTexto(x.nombre) === normalizarTexto(gradoTxt));
    if (!gradoTxt) base.mensajes.push('Falta el grado.'); else if (!grado) base.mensajes.push(`El grado «${gradoTxt}» no existe en el ciclo (créalo primero; la importación no inventa grados).`);
    if (!grupoTxt) base.mensajes.push('Falta el nombre del grupo.'); else if (grupoTxt.length > 20) base.mensajes.push('El nombre del grupo admite como máximo 20 caracteres.');
    let turno = turnoTxt ? c.turnos.find((x) => normalizarTexto(x.nombre) === normalizarTexto(turnoTxt)) : c.turnos.length === 1 ? c.turnos[0] : undefined;
    if (turnoTxt && !turno) base.mensajes.push(`El turno «${turnoTxt}» no existe en el ciclo.`);
    if (!turnoTxt && c.turnos.length !== 1) { base.mensajes.push('Indica el turno (el ciclo tiene varios o ninguno).'); turno = undefined; }
    const capacidad = capTxt ? numero(capTxt) : null;
    if (capTxt && (capacidad === null || capacidad < 1 || capacidad > 80)) base.mensajes.push('La capacidad debe ser un número entre 1 y 80.');
    if (base.mensajes.length || !grado || !turno) return this.resolver(base, 'error');
    base.datos = { gradoId: grado.id, turnoId: turno.id, nombre: grupoTxt, capacidad };
    base.resumen = `${grado.numero}° ${grupoTxt}, ${turno.nombre}${capacidad ? `, ${capacidad} lugares` : ''}`;
    const k = `${grado.id}|${turno.id}|${normalizarTexto(grupoTxt)}`;
    if (vistos.has(k)) { base.mensajes.push(`Repetido en el archivo (fila ${vistos.get(k)}).`); return this.resolver(base, 'omitido'); }
    vistos.set(k, n);
    const ex = c.grupos.find((g) => g.gradoId === grado.id && g.turnoId === turno.id && normalizarTexto(g.nombre) === normalizarTexto(grupoTxt));
    if (ex) {
      base.existenteId = ex.id; base.existente = `${grado.numero}° ${ex.nombre}`;
      if (capacidad && capacidad !== ex.capacidad) base.cambios.push(`capacidad: ${ex.capacidad ?? '—'} → ${capacidad}`);
      if (!base.cambios.length) { base.mensajes.push('Ya existe sin cambios.'); return this.resolver(base, 'omitido'); }
      return this.resolver(base, 'actualizable');
    }
    return this.resolver(base, 'nuevo');
  }

  // ---------- Aplicar (todo en una transacción) ----------

  async aplicar(cicloId: string, tipo: TipoImportacion, cuerpo: string[][], mapeo: Mapeo, decisiones: Record<number, Decision>, origen: { archivo: string; hoja: string | null; huella: string | null }, primeraFila = 2): Promise<RegistroImportacion> {
    return this.ctx.uow.ejecutar(async () => {
      const a = await this.analizar(cicloId, tipo, cuerpo, mapeo, null, primeraFila);
      const ciclo = await cicloEditable(this.ctx, cicloId);
      const resultado = { nuevos: 0, actualizados: 0, omitidos: 0 };
      for (const f of a.filas) {
        const d = decisiones[f.fila] ?? f.decision;
        if (!f.opciones.includes(d)) throw new ErrorDominio('VALIDACION', `Los datos cambiaron desde la revisión (fila ${f.fila}). Vuelve a analizar el archivo.`);
        if (d === 'omitir') { resultado.omitidos++; continue; }
        if (d === 'actualizar' && !f.existenteId) throw new ErrorDominio('VALIDACION', `La fila ${f.fila} no tiene un registro para actualizar.`);
        await this.aplicarFila(tipo, ciclo.id, ciclo.escuelaId, f, d);
        if (d === 'crear') resultado.nuevos++; else resultado.actualizados++;
      }
      if (resultado.nuevos + resultado.actualizados === 0) throw new ErrorDominio('VALIDACION', 'No hay filas para crear ni actualizar. No se guardó nada.');
      const reg: RegistroImportacion = { ...metadatosNuevos(this.ctx), escuelaId: ciclo.escuelaId, cicloEscolarId: cicloId, tipo, archivo: origen.archivo.slice(0, 200), hoja: origen.hoja, huella: origen.huella, resultado };
      await this.ctx.repos.importaciones.insertar(reg);
      return reg;
    });
  }

  private async aplicarFila(tipo: TipoImportacion, cicloId: string, escuelaId: string, f: FilaAnalizada, d: Decision) {
    const datos = f.datos;
    if (tipo === 'alumnos') {
      const identidad = datos['identidad'] as Alumno; const destino = datos['destino'] as { grupoId: string | null; gradoId: string | null; turnoId: string | null };
      const numeroLista = datos['numeroLista'] as number | null;
      if (d === 'crear') { await this.alumnos.inscribirNuevo(cicloId, identidad, { ...destino, numeroLista }); return; }
      const ex = await this.alumnos.obtener(f.existenteId!);
      const fusion = { nombre: identidad.nombre || ex.nombre, primerApellido: identidad.primerApellido || ex.primerApellido, segundoApellido: identidad.segundoApellido ?? ex.segundoApellido, matricula: identidad.matricula ?? ex.matricula, curp: identidad.curp ?? ex.curp, observaciones: identidad.observaciones ?? ex.observaciones };
      await this.alumnos.actualizar(ex.id, fusion);
      const ins = (await this.ctx.repos.inscripciones.listarPor('alumnoId', ex.id)).find((i) => i.cicloEscolarId === cicloId);
      if (!ins) await this.alumnos.inscribirExistente(ex.id, cicloId, { ...destino, numeroLista });
      else {
        if (destino.grupoId && ins.grupoId !== destino.grupoId && ins.estado === 'inscrito') await this.alumnos.cambiarGrupo(ins.id, destino.grupoId, 'Importación');
        if (numeroLista && ins.numeroLista !== numeroLista) await this.alumnos.fijarNumeroLista(ins.id, numeroLista);
      }
      return;
    }
    if (tipo === 'docentes' || tipo === 'personal') {
      const persona = datos['persona'] as Personal; const turnoIds = datos['turnoIds'] as string[]; const materiaIds = datos['materiaIds'] as string[];
      let id: string;
      if (d === 'crear') id = (await this.personal.crear(escuelaId, persona)).id;
      else {
        const ex = await this.personal.obtener(f.existenteId!);
        id = ex.id;
        await this.personal.actualizar(ex.id, { ...ex, nombre: persona.nombre, primerApellido: persona.primerApellido, segundoApellido: persona.segundoApellido ?? ex.segundoApellido, numeroEmpleado: ex.numeroEmpleado ?? persona.numeroEmpleado, funciones: [...new Set([...ex.funciones, ...persona.funciones])], observaciones: persona.observaciones ?? ex.observaciones });
      }
      if (turnoIds.length || materiaIds.length) {
        const ads = await this.personal.adscripcion(id, cicloId);
        await this.personal.fijarAdscripcion(id, cicloId, { turnoIds: [...(ads?.turnoIds ?? []), ...turnoIds], materiaIds: [...(ads?.materiaIds ?? []), ...materiaIds] });
      }
      return;
    }
    if (tipo === 'materias') {
      const m = datos as { nombre: string; tipo: TipoMateria; abreviatura: string | null };
      if (d === 'crear') { await this.materias.crear(cicloId, m); return; }
      const ex = (await this.ctx.repos.materias.obtener(f.existenteId!))!;
      await this.materias.actualizar(ex.id, { nombre: ex.nombre, tipo: m.tipo ?? ex.tipo, abreviatura: m.abreviatura ?? ex.abreviatura });
      return;
    }
    const g = datos as { gradoId: string; turnoId: string; nombre: string; capacidad: number | null };
    if (d === 'crear') { await this.grados.crearGrupo(cicloId, g); return; }
    const ex = (await this.ctx.repos.grupos.obtener(f.existenteId!))!;
    await this.grados.actualizarGrupo(ex.id, { gradoId: ex.gradoId, turnoId: ex.turnoId, nombre: ex.nombre, capacidad: g.capacidad ?? ex.capacidad });
  }
}

function nombreAlumno2(a: Pick<Alumno, 'nombre' | 'primerApellido' | 'segundoApellido'>) {
  return [a.primerApellido, a.segundoApellido].filter(Boolean).join(' ') + `, ${a.nombre}`;
}

export { CAMPOS };
