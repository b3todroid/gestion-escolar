import type { Servicios } from './services';
import { h, vaciar } from './components/dom';
import { esErrorDominio } from './domain/errores';
import { confirmar } from './components/dialogo';

export interface Vista {
  titulo: string;
  contenido: Node;
}

export interface ContextoPagina {
  s: Servicios;
  /** Navega a otra ruta (por ejemplo "#/escuela/ID"). */
  ir(ruta: string): void;
  /** Vuelve a dibujar la vista actual tras un cambio; opcionalmente enfoca un selector. */
  recargar(enfocar?: string): Promise<void>;
}

type Render = (ctx: ContextoPagina, ...params: string[]) => Promise<Vista>;

interface Ruta {
  patron: RegExp;
  render: Render;
}

const ID = '([0-9a-f-]{36})';

/** Router mínimo basado en hash: funciona sin servidor y sin conexión. */
export class Aplicacion {
  private readonly rutas: Ruta[] = [];
  private generacion = 0;
  private rutaActual = window.location.hash;
  private ignorarCambio = false;

  constructor(private readonly s: Servicios, private readonly principal: HTMLElement) {}

  ruta(patron: string, render: Render): this {
    this.rutas.push({ patron: new RegExp(`^${patron.replaceAll(':id', ID).replaceAll(':fecha', '(\\d{4}-\\d{2}-\\d{2})')}$`), render });
    return this;
  }

  iniciar(): void {
    // Marca los formularios con cambios sin guardar (el asistente se excluye: guarda borrador).
    this.principal.addEventListener('input', (ev) => {
      const form = (ev.target as Element).closest('form');
      if (form && !form.hasAttribute('data-autoguardado')) form.setAttribute('data-sin-guardar', '');
    });
    window.addEventListener('beforeunload', (ev) => {
      if (this.hayCambiosSinGuardar()) ev.preventDefault(); // aviso nativo al recargar o cerrar
    });
    window.addEventListener('hashchange', () => void this.alCambiarRuta());
    void this.dibujar(false);
  }

  private hayCambiosSinGuardar(): boolean {
    return this.principal.querySelector('form[data-sin-guardar]') !== null;
  }

  /** Antes de navegar, si hay cambios sin guardar, pregunta y permite quedarse. */
  private async alCambiarRuta(): Promise<void> {
    if (this.ignorarCambio) { this.ignorarCambio = false; return; }
    if (this.hayCambiosSinGuardar()) {
      const destino = window.location.hash;
      this.ignorarCambio = true;
      window.location.hash = this.rutaActual; // se queda en la vista actual mientras decide
      const salir = await confirmar({
        titulo: 'Tienes cambios sin guardar',
        mensaje: 'Si sales ahora, se perderá lo que escribiste en el formulario.',
        textoConfirmar: 'Salir sin guardar',
        textoCancelar: 'Seguir editando',
        peligro: true,
      });
      if (!salir) return;
      this.principal.querySelectorAll('form[data-sin-guardar]').forEach((f) => f.removeAttribute('data-sin-guardar'));
      window.location.hash = destino;
      return;
    }
    await this.dibujar(true);
  }

  private contexto(): ContextoPagina {
    return {
      s: this.s,
      ir: (ruta) => { window.location.hash = ruta; },
      recargar: (enfocar) => this.dibujar(false, enfocar),
    };
  }

  private async dibujar(enfocarTitulo: boolean, enfocar?: string): Promise<void> {
    const gen = ++this.generacion;
    const ruta = window.location.hash.replace(/^#/, '') || '/';
    const scroll = window.scrollY;
    let vista: Vista;
    try {
      const coincidencia = this.rutas.map((r) => ({ r, m: r.patron.exec(ruta) })).find((x) => x.m);
      vista = coincidencia
        ? await coincidencia.r.render(this.contexto(), ...coincidencia.m!.slice(1))
        : vistaError('Página no encontrada', 'La dirección no corresponde a ninguna sección de la aplicación.');
    } catch (e) {
      if (!esErrorDominio(e)) console.error(e);
      vista = vistaError('No se pudo mostrar la información', esErrorDominio(e) ? e.message : 'Ocurrió un error inesperado al leer los datos locales.');
    }
    if (gen !== this.generacion) return; // llegó una navegación más reciente
    this.rutaActual = window.location.hash;
    document.title = `${vista.titulo} · Gestión Escolar`;
    vaciar(this.principal);
    this.principal.appendChild(vista.contenido);
    if (enfocarTitulo) {
      window.scrollTo(0, 0);
      this.principal.querySelector<HTMLElement>('h1')?.focus();
    } else {
      window.scrollTo(0, scroll);
      // Tras un alta, el foco vuelve al formulario para capturar el siguiente registro.
      const el = enfocar ? this.principal.querySelector<HTMLElement>(enfocar) : null;
      if (el) {
        const panel = el.closest('details');
        if (panel) panel.open = true;
        el.focus();
      }
    }
  }
}

function vistaError(titulo: string, mensaje: string): Vista {
  return {
    titulo,
    contenido: h('section', { class: 'pagina' },
      h('h1', { tabindex: '-1' }, titulo),
      h('p', { class: 'mensaje mensaje--error', role: 'alert' }, mensaje),
      h('a', { class: 'boton', href: '#/' }, 'Volver al inicio'),
    ),
  };
}
