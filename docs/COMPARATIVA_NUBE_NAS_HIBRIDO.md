# Comparativa de infraestructura: nube, NAS o servidor local, e híbrido (Fase 11)

**No se contrató ni se cotizó nada.** No se incluyen precios: cambian seguido y no hay información comercial verificada en este entorno. Cada costo se describe por sus **componentes**, que requieren **cotización** antes de decidir.

Lo que necesita cualquier modelo (requisito real del proyecto):
- **Contenedores:** servidor (Node 22), web (Caddy) y db (PostgreSQL 16), ya preparados en `deploy/`.
- **Red y correo:** un nombre público con HTTPS y un SMTP institucional.
- **Respaldos:** cifrados, con copia fuera del sitio.

La aplicación **no depende de una computadora personal**. Cada dispositivo guarda una copia local y sigue funcionando sin conexión; el servidor consolida y sincroniza.

## Modelo A — Nube (IaaS: máquina virtual con Docker, o servicios administrados)
| Aspecto | Evaluación |
|---|---|
| Frontend | Lo sirve el mismo Caddy (`web`). Alternativa: un CDN de archivos estáticos, aunque se perdería el mismo origen con `/api`; requeriría ajustar la CSP y las cookies. No se recomienda |
| Backend | Una máquina virtual con Docker Compose (lo preparado), o un servicio de contenedores administrado |
| Base de datos | PostgreSQL 16 en el contenedor (lo probado), o **PostgreSQL administrado** (respaldos y parches del proveedor). Con uno administrado, la migración 0004 necesita un usuario dueño con `CREATEROLE`: verificar que el proveedor lo permita |
| Archivos | No hace falta almacenamiento de objetos (los adjuntos viven en la base). Para la copia externa de respaldos sirve un almacenamiento de objetos en otra región o con otro proveedor |
| Autenticación | La propia (Better Auth); no requiere un servicio externo. SSO opcional con Google Workspace o Microsoft 365 |
| HTTPS | Automático (Let's Encrypt con Caddy) con un dominio propio |
| Respaldos | Los scripts del proyecto, más las instantáneas de disco del proveedor (complementarias, no sustitutas) |
| Disponibilidad | Alta (centro de datos, energía, red). Sin redundancia, una sola máquina virtual es un punto único de falla: recuperación con respaldo (RTO) |
| Escalabilidad | Alta (cambiar el tamaño de la máquina virtual, réplicas de la API, base administrada) |
| Costos (cotizar) | Cómputo mensual (2 vCPU / 4 GB para empezar) · disco SSD · tráfico de salida · IP pública · almacenamiento de respaldos · dominio anual · SMTP institucional (muchas veces incluido en Google Workspace o Microsoft 365) · base administrada (opcional, suele costar más que el cómputo) |
| Mantenimiento | Bajo a medio. Actualizaciones del sistema operativo (o ninguna, con servicios administrados) |
| Ubicación de los datos | **Elegir una región en México** (al cotizar se verifica la disponibilidad: AWS, Microsoft Azure, Google Cloud y Oracle anuncian regiones en Querétaro y Monterrey). Contrato y transferencia de datos a revisar jurídicamente (§ protección de datos) |

## Modelo B — NAS o servidor local en la escuela
| Aspecto | Evaluación |
|---|---|
| Equipo | NAS con soporte de contenedores (procesador x86-64, ≥ 4 GB de RAM, discos en espejo RAID 1) **o** un mini PC o servidor con Linux (Ubuntu LTS o Debian) y SSD. Ver los requisitos de hardware en `docs/FASE_11_DESPLIEGUE.md` |
| Contenedores | Docker Compose con los mismos archivos de `deploy/` |
| Base de datos | PostgreSQL en el contenedor, en un volumen sobre discos en espejo |
| Red local | Funciona dentro de la escuela. Para **iPhone, Android y PWA instalable hace falta HTTPS con un certificado válido**: requiere un dominio público (DNS) aunque el acceso sea local. Si no, sólo funciona con certificados propios instalados a mano en cada dispositivo (no recomendable) |
| Acceso remoto | **VPN** (WireGuard u OpenVPN) o un **túnel saliente** (proxy inverso en la nube que llega al NAS sin abrir puertos). **Nunca** exponer a internet la administración del NAS, SSH ni PostgreSQL |
| HTTPS | Let's Encrypt con desafío DNS o por el túnel |
| Firewall | Entrada sólo a 443 (y 80 para la redirección) desde la red permitida; la administración sólo por la red local o la VPN |
| Actualizaciones | Firmware del NAS, sistema operativo, Docker e imágenes: **responsabilidad de la escuela** |
| Respaldos externos | Obligatorios. Un respaldo en el mismo NAS no protege contra robo, incendio ni ransomware |
| Energía | **UPS obligatoria**, con apagado ordenado. Sin ella, un corte puede dañar la base o los discos |
| Disponibilidad | Depende de la luz y del internet de la escuela. Si se cae la conexión de la escuela, los docentes fuera de la red no sincronizan (siguen trabajando sin conexión) |
| Recuperación | Hardware de reemplazo, más el respaldo externo y el plan (`docs/PLAN_RECUPERACION.md`) |
| Costos (cotizar) | Compra del equipo y los discos (pago único) · UPS · energía · internet con IP o túnel · dominio · tiempo de la persona que administra |
| Mantenimiento | **Alto:** requiere una persona técnica responsable |
| Datos | Se quedan físicamente en la escuela (ventaja para el tratamiento) |

## Modelo C — Híbrido (aplicación en la nube y respaldos cifrados en el NAS de la institución)
| Aspecto | Evaluación |
|---|---|
| Aplicación y backend | En la nube, en una región de México (Modelo A) |
| Respaldos | Cifrados en el servidor de la nube con la clave **pública**. Se copian al **NAS institucional**, y una tercera copia va a otro almacenamiento externo (3-2-1) |
| Recuperación | Si la nube falla: restaurar en otra máquina virtual o en el propio NAS (mismos archivos de `deploy/`) desde la copia del NAS. La clave privada para descifrar está bajo custodia de la institución, fuera de la nube |
| Costos (cotizar) | Los del Modelo A, más un NAS modesto (sólo guarda archivos) y el almacenamiento externo |
| Complejidad | Media: hay que automatizar y **vigilar** la copia de la nube al NAS |
| Riesgos | Credenciales de la copia (que sólo puedan escribir y no borrar: inmutabilidad o versiones en el NAS); clave privada de age (custodia dual y copia sellada) |

## Comparación
| Criterio | A · Nube | B · NAS local | C · Híbrido |
|---|---|---|---|
| Uso desde cualquier lugar y dispositivo | ★★★ | ★ (requiere VPN o túnel) | ★★★ |
| Disponibilidad | ★★★ | ★ (luz e internet de la escuela) | ★★★ |
| Varias escuelas | ★★★ | ★★ (si se aloja en una) | ★★★ |
| Control físico de los datos | ★ | ★★★ | ★★ (las copias quedan en la institución) |
| Recuperación ante desastres | ★★ | ★ | ★★★ |
| Mantenimiento técnico | Bajo a medio | Alto | Medio |
| Costo inicial | Bajo | Medio a alto (equipo) | Medio |
| Costo mensual | Medio (cotizar) | Bajo (energía e internet) | Medio (cotizar) |
| Riesgo de exposición por mala configuración | Medio (todo está detrás de Caddy) | Alto (administración del NAS, puertos) | Medio |

## Recomendación
**Modelo C (híbrido): aplicación y base de datos en una nube con región en México, con respaldos cifrados copiados al NAS de la institución y una tercera copia externa.**
- Es el único que cumple a la vez:
  - uso desde Android, iPhone, tabletas y computadoras en cualquier lugar, con HTTPS válido (necesario para instalar la PWA);
  - varias escuelas;
  - disponibilidad que no depende de la luz ni del internet de un plantel;
  - una copia de los datos bajo control físico de la institución.
- **Para empezar (piloto):** una sola máquina virtual con Docker Compose (lo preparado y probado en `deploy/`), con PostgreSQL en el contenedor.
- **Para crecer:** PostgreSQL administrado y réplicas de la API, tras medir el servidor con volumen (B-06).
- **El NAS:** sólo recibe copias cifradas. **No** se expone a internet.
- **Si la institución no puede contratar nube:** el Modelo B es viable para **una** escuela, con UPS, VPN o túnel, dominio público para HTTPS y respaldos externos. Hay que aceptar que la disponibilidad depende del plantel.

**Decisión pendiente** (institucional, con cotizaciones): proveedor, región, tamaño, presupuesto y quién administra.
