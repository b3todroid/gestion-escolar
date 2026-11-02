import './styles/main.css';
import { Aplicacion } from './app';
import { crearServicios } from './services';
import { paginaInicio } from './pages/inicio';
import { paginaEscuelaEditar, paginaEscuelaNueva } from './pages/escuela-formulario';
import { paginaEscuela } from './pages/escuela';
import { paginaCiclo } from './pages/ciclo';
import { paginaHorario } from './pages/horario';
import { iniciarIndicadorConexion, iniciarPWA } from './pwa';

const principal = document.getElementById('contenido');
const conexion = document.getElementById('conexion');

if (!principal || !conexion) throw new Error('Estructura de index.html incompleta.');

if (typeof indexedDB === 'undefined') {
  principal.textContent = 'Este navegador no permite guardar datos locales (IndexedDB). Usa un navegador actualizado y evita el modo privado.';
} else {
  new Aplicacion(crearServicios(), principal)
    .ruta('/', paginaInicio)
    .ruta('/escuela/nueva', paginaEscuelaNueva)
    .ruta('/escuela/:id', paginaEscuela)
    .ruta('/escuela/:id/editar', paginaEscuelaEditar)
    .ruta('/ciclo/:id', paginaCiclo)
    .ruta('/turno/:id', paginaHorario)
    .iniciar();
}

iniciarIndicadorConexion(conexion);
iniciarPWA();
