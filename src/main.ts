import './styles/main.css';
import { Aplicacion } from './app';
import { crearServicios } from './services';
import { paginaInicio } from './pages/inicio';
import { paginaRaiz } from './pages/miDia';
import { paginaPerfil } from './pages/perfil';
import { paginaLista } from './pages/lista';
import { paginaAlumnos, paginaAlumno } from './pages/alumnos';
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
import { iniciarIndicadorConexion, iniciarPWA } from './pwa';

const principal = document.getElementById('contenido');
const conexion = document.getElementById('conexion');

if (!principal || !conexion) throw new Error('Estructura de index.html incompleta.');

if (typeof indexedDB === 'undefined') {
  principal.textContent = 'Este navegador no permite guardar datos locales (IndexedDB). Usa un navegador actualizado y evita el modo privado.';
} else {
  new Aplicacion(crearServicios(), principal)
    .ruta('/', paginaRaiz)
    .ruta('/escuelas', paginaInicio)
    .ruta('/perfil', paginaPerfil)
    .ruta('/lista/:id/:fecha', paginaLista)
    .ruta('/alumnos/:id', paginaAlumnos)
    .ruta('/alumno/:id', paginaAlumno)
    .ruta('/asistente', paginaAsistente)
    .ruta('/escuela/nueva', paginaEscuelaNueva)
    .ruta('/escuela/:id', paginaEscuela)
    .ruta('/escuela/:id/editar', paginaEscuelaEditar)
    .ruta('/ciclo/:id', paginaCiclo)
    .ruta('/turno/:id', paginaHorario)
    .ruta('/escuela/:id/personal', paginaPersonal)
    .ruta('/personal/:id', paginaDocente)
    .ruta('/ciclo/:id/materias', paginaMaterias)
    .ruta('/ciclo/:id/importar', paginaImportar)
    .ruta('/grupo/:id', paginaGrupo)
    .iniciar();
}

iniciarIndicadorConexion(conexion);
iniciarPWA();
