import './styles/main.css';
import { Aplicacion } from './app';
import { crearServicios } from './services';
import { paginaInicio } from './pages/inicio';
import { paginaRaiz } from './pages/miDia';
import { paginaPerfil } from './pages/perfil';
import { paginaLista } from './pages/lista';
import { paginaAlumnos, paginaAlumno, paginaAlumnoEditar } from './pages/alumnos';
import { paginaRespaldos } from './pages/respaldos';
import { paginaEscuelaEditar, paginaEscuelaNueva } from './pages/escuela-formulario';
import { paginaEscuela } from './pages/escuela';
import { paginaCiclo } from './pages/ciclo';
import { paginaHorario } from './pages/horario';
import { paginaAsistente } from './pages/asistente';
import { paginaPersonal } from './pages/personal';
import { paginaMaterias } from './pages/materias';
import { paginaGrupo } from './pages/grupo';
import { paginaDocente } from './pages/docente';
import { paginaImportar } from './pages/importar';
import { paginaImportarDatos } from './pages/importarDatos';
import { paginaDocentes } from './pages/docentes';
import { paginaAlumnosCiclo } from './pages/alumnosCiclo';
import { paginaHorariosCiclo, paginaHorariosInicio } from './pages/horarios';
import { iniciarIndicadorConexion, iniciarPWA } from './pwa';
import { paginaAplicacion } from './pages/aplicacion';
import { paginaAccesosEscuela, paginaCuenta } from './pages/cuenta';
import { paginaSincronizacion } from './pages/sincronizacion';
import { paginaMigracion } from './pages/migracion';
import { iniciarSincronizacion } from './sincronizador';
import { paginaBancoActividades, paginaCobertura, paginaPrefectura, paginaPrefecturaInicio, paginaReportesPrefectura } from './pages/prefectura';

const principal = document.getElementById('contenido');
const conexion = document.getElementById('conexion');

if (!principal || !conexion) throw new Error('Estructura de index.html incompleta.');

if (typeof indexedDB === 'undefined') {
  principal.textContent = 'Este navegador no permite guardar datos locales (IndexedDB). Usa un navegador actualizado y evita el modo privado.';
} else {
  const servicios = crearServicios();
  const indicadorSinc = document.getElementById('sincronizacion') as HTMLAnchorElement | null;
  if (indicadorSinc) iniciarSincronizacion(servicios, indicadorSinc);
  new Aplicacion(servicios, principal)
    .ruta('/', paginaRaiz)
    .ruta('/escuelas', paginaInicio)
    .ruta('/perfil', paginaPerfil)
    .ruta('/respaldos', paginaRespaldos)
    .ruta('/aplicacion', paginaAplicacion)
    .ruta('/cuenta', paginaCuenta)
    .ruta('/sincronizacion', paginaSincronizacion)
    .ruta('/migracion', paginaMigracion)
    .ruta('/cuenta/escuela/:id', paginaAccesosEscuela)
    .ruta('/prefectura', paginaPrefecturaInicio)
    .ruta('/ciclo/:id/prefectura/:fecha', paginaPrefectura)
    .ruta('/ciclo/:id/prefectura-actividades', paginaBancoActividades)
    .ruta('/ciclo/:id/prefectura-reportes', paginaReportesPrefectura)
    .ruta('/cobertura/:id/:fecha', paginaCobertura)
    .ruta('/lista/:id/:fecha', paginaLista)
    .ruta('/alumnos/:id', paginaAlumnos)
    .ruta('/alumno/:id', paginaAlumno)
    .ruta('/alumno/:id/editar', paginaAlumnoEditar)
    .ruta('/asistente', paginaAsistente)
    .ruta('/escuela/nueva', paginaEscuelaNueva)
    .ruta('/escuela/:id', paginaEscuela)
    .ruta('/escuela/:id/editar', paginaEscuelaEditar)
    .ruta('/ciclo/:id', paginaCiclo)
    .ruta('/turno/:id', paginaHorario)
    .ruta('/escuela/:id/personal', paginaPersonal)
    .ruta('/personal/:id', paginaDocente)
    .ruta('/personal/:id/ciclo/:id', paginaDocente)
    .ruta('/horarios', paginaHorariosInicio)
    .ruta('/ciclo/:id/horarios', paginaHorariosCiclo)
    .ruta('/ciclo/:id/materias', paginaMaterias)
    .ruta('/ciclo/:id/importar', paginaImportar)
    .ruta('/ciclo/:id/importar-datos', paginaImportarDatos)
    .ruta('/ciclo/:id/docentes', paginaDocentes)
    .ruta('/ciclo/:id/alumnos', paginaAlumnosCiclo)
    .ruta('/grupo/:id', paginaGrupo)
    .iniciar();
}

iniciarIndicadorConexion(conexion);
iniciarPWA();
