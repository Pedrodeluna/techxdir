# Agenda local · septiembre y octubre de 2026

Comprobación: 2 de octubre de 2026. Fechas de calendario del lugar del evento; no se deducen horarios, precios, asistentes ni permisos de organización.

| Evento | Fechas de 2026 | Ciudad | Fuente del organizador o sede |
| --- | --- | --- | --- |
| HackSpain | 18–20 septiembre | Madrid | https://hackspain.com/ |
| Café Helmcode Madrid | 22 septiembre | Madrid | https://www.madtechcampus.com/noticias/2026-09-22-cafe-helmcode-madrid/ |
| React Alicante | 24–26 septiembre | Alicante | https://reactalicante.es/ |
| Grok Bot Madrid Meetup | 29 septiembre | Madrid | https://luma.com/grokbotmadrid1 |
| Extremadura Digital Day | 3 octubre | Cáceres | https://extremaduradigitalday.com/ |
| Kernel Panic · Helmcode | 6 octubre | Madrid | https://luma.com/p50cydsf |
| Software Crafters Barcelona | 16–17 octubre | Barcelona | https://softwarecrafters.barcelona/ |
| TRGCON / TarugoConf | 22–24 octubre | Madrid | https://www.trgcon.com/ |

HackSpain también está confirmado por la agenda institucional de ETSIT-UPM. La fecha del encuentro Grok figura en su descripción pública; el calendario de su comunidad lo sitúa el martes 29 de septiembre de 2026.

Café Cursor Madrid: se encontró https://luma.com/relaxingcup, pero el contenido accesible no permite confirmar una fecha en septiembre/octubre de 2026. No se ha insertado. El anuncio encontrado de Café Cursor Barcelona es de febrero y queda fuera del periodo solicitado. No se han inventado ediciones recurrentes.

## Datos y reposición local

`supabase/seed.sql` contiene los ocho eventos y sus siete organizaciones. Desde el 4 de octubre es solo de inserción: conserva los IDs y no sobrescribe campos existentes al repetirlo. Las correcciones posteriores se hacen editando el evento. La limpieza local corrige `hackspain-26` únicamente si todos sus campos siguen coincidiendo con el ejemplo anterior, preservando su ID y sus asistencias.

La limpieza es una operación local explícita, fuera de las migraciones de producción:

1. Guardar una copia privada de los datos de `public` con `pg_dump` antes de ejecutar la limpieza.
2. Copiar `seed.sql` y `local/replace-example-events.sql` al contenedor `supabase_db_techxdir`, manteniendo su estructura relativa.
3. Ejecutar `psql -U postgres -d postgres -f /ruta/local/replace-example-events.sql` dentro de ese contenedor.

El script elimina únicamente registros que coinciden con todos los campos del seed anterior; conserva eventos modificados o creados por usuarios. Las asistencias a ejemplos eliminados se borran por la FK existente. La corrección de HackSpain preserva sus asistencias. No toca perfiles, cuentas ni permisos. La carga y la limpieza se realizan en una transacción.

En esta ejecución se guardó la copia privada `/tmp/techxdir-before-events-20261002.sql`, se eliminaron 12 ejemplos y se corrigió HackSpain. Resultado comprobado por SQL y por la API anónima local: 7 eventos en septiembre/octubre. No se aplicó ningún cambio remoto.

## Carga en producción · 4 de octubre de 2026

Se cargaron los siete eventos y sus siete organizaciones en el proyecto `hwerwvjndbufjcswlgpo` mediante `supabase/imports/20261004_public_events.sql`. Ambas tablas estaban vacías antes de la carga. El archivo es una operación explícita, fuera de las migraciones y de los despliegues automáticos.

- La importación es transaccional y solo inserta. Los IDs existentes prevalecen, incluyendo sus ediciones manuales.
- Reutiliza organizaciones con el mismo nombre (ignorando mayúsculas y espacios exteriores), aunque tengan otro ID. Si hay varias coincidencias posibles, cancela la transacción.
- Omite eventos existentes de la misma organización, nombre, ciudad y fecha de inicio, aunque tengan otro ID.
- No modifica el esquema, políticas RLS, perfiles, asistencias, administradores ni gestores. No crea un proceso de sincronización que reponga cambios periódicamente.
- Las organizaciones importadas no tienen gestores asignados. Los administradores pueden editarlas, añadir gestores y crear o editar sus eventos desde el panel existente.

Para añadir eventos a mano, seleccionar una de las organizaciones existentes o crear otra desde el panel. Cada evento nuevo debe tener un identificador distinto; la clave primaria rechaza los repetidos sin sobrescribir. Para corregir un evento importado, editar su fila existente. Una nueva edición anual puede usar otro identificador.

Validación: `python3 scripts/test-catalog-import.py` crea PostgreSQL desechable y comprueba carga inicial, repetición sin cambios, edición posterior, nuevas altas manuales, rechazo de IDs duplicados, reutilización de IDs alternativos y rollback ante ambigüedad. Requiere `initdb`, `pg_ctl` y `psql`; no utiliza credenciales ni bases de Supabase.

También se comprobó en producción, dentro de una transacción revertida, que el rol `authenticated` con un administrador existente puede crear una organización y un evento mediante las mismas operaciones del panel, y editar organizaciones y eventos importados. No quedaron registros de prueba. La API anónima devuelve los siete eventos y siete organizaciones con todos los campos iguales al catálogo verificado; los recuentos de perfiles, asistencias, gestores y administradores se conservan.

## Alta en producción · 5 de octubre de 2026

El 5 de octubre se añadió Kernel Panic en producción mediante `supabase/imports/20261005_kernel_panic.sql`, reutilizando Helmcode. Fecha y sede confirmadas por [el anuncio del organizador Borja Pérez](https://es.linkedin.com/posts/borjaperfra_abrimos-entradas-para-kernel-panic-nuestra-activity-7505192760329682944-x3Pa): 6 de octubre, Auditorio Casa del Lector, Matadero Madrid. Enlace de inscripción: https://luma.com/p50cydsf. La carga no sobrescribe eventos existentes y reconoce el ID, el enlace o la coincidencia de nombre, ciudad y fecha. El catálogo queda con ocho eventos y siete organizaciones.

## Interfaz

Selector Mapa / Lista en la portada y en Descubrir dentro de la acreditación. Las vistas son excluyentes y mantienen los filtros de ciudad y fecha al alternar. Desde una ciudad del mapa se puede abrir su lista de eventos. Usa la geometría SVG de Natural Earth 5.1.2 (dominio público), adaptada desde tech-X-Spaña. Mantiene papel, tinta, Space Grotesk, etiquetas mono y una señal naranja para la ciudad seleccionada. No solicita teselas ni geolocalización. La vista usa una trama de puntos, marcas de referencia y nodos con recuentos de eventos; al seleccionar una ciudad aparece una retícula de localización. Se han retirado el selector plano/relieve y la nota cartográfica visible; la procedencia se conserva aquí y en el archivo de geometría.

Las posiciones son centros aproximados de ciudades, no direcciones de sedes. Las ciudades desconocidas y los eventos online siguen disponibles en la lista. Los botones de ciudad ofrecen una alternativa al SVG y sus nodos admiten Enter/Espacio. El filtro por fecha conserva los eventos de varios días como próximos/en curso hasta su fecha final.

El catálogo real viene de Supabase tanto en la portada como en las fichas, recuentos y exportación de la acreditación con sesión. `/ejemplo` mantiene los datos de demostración separados. Hay estados de carga, vacío, error, reintento y cancelación de peticiones.

## Validación

- `node scripts/test-event-catalog.mjs`: aislamiento catálogo real/ejemplo, IDs retirados, organizaciones, texto compartido, eventos en curso y proyección de ciudades.
- `npm run build` y `npm run lint`.
- Consulta anónima a Supabase local y respuesta HTTP 200 del módulo del mapa en Vite.
- Revisión visual pendiente: el entorno no expone navegador automatizable ni ventanas de Chrome/Safari (`cgWindowNotFound`).

## Calendarios de Luma

Comprobación: 13 de octubre de 2026, con `api.lu.ma/calendar/get-items`. Las cifras son eventos en España: futuros / pasados (con "+", la página de 50 tenía más). Es la lista inicial de fuentes para la ingesta automática (`docs/spec-auto-ingest.md`).

### Comunidades españolas

| Calendario | Ciudad | Futuros | Pasados |
| --- | --- | --- | --- |
| https://luma.com/tetuanvalley | Madrid | 5 | 40+ |
| https://luma.com/madrid-tech-brunch | Madrid | 1 | 28 |
| https://luma.com/sobremesatech | Madrid | 1 | 21 |
| https://luma.com/MadridAIBuilders | Madrid | 1 | 13 |
| https://luma.com/spacexai-madrid | Madrid | 0 | 7 |
| https://luma.com/devmad-socials | Madrid | 1 | 6 |
| https://luma.com/madai | Madrid | 1 | 5 |
| https://luma.com/cto-circle | Madrid | 2 | 7 |
| https://luma.com/helmcode | Madrid | 0 | 1 |
| https://luma.com/alumni.etsit.upm | Madrid | 3 | 2 |
| https://luma.com/es.uxpa | Madrid | 1 | 3 |
| https://luma.com/hitl-madrid | Madrid | 1 | 0 |
| https://luma.com/the-tech-nation | Barcelona | 2 | 31 |
| https://luma.com/Buzoku | Barcelona | 6 | 17 |
| https://luma.com/aisummitbarcelona | Barcelona | 0 | 41+ |
| https://luma.com/ATIHxBCN | Barcelona | 1 | 8 |
| https://luma.com/crea | Barcelona | 1 | 8 |
| https://luma.com/ai-safety-bcn | Barcelona | 3 | 7 |
| https://luma.com/barcelonacybersecurity | Barcelona | 1 | 6 |
| https://luma.com/aibarcelona | Barcelona | 1 | 4 |
| https://luma.com/lewagonspain | Barcelona | 4 | 3 |
| https://luma.com/spacexai-barcelona | Barcelona | 0 | 3 |
| https://luma.com/bcnrust | Barcelona | 1 | 0 |
| https://luma.com/masia | Barcelona | 1 | 3 |
| https://luma.com/deepdivelectures | Barcelona | 2 | 2 |
| https://luma.com/codeway | Barcelona | 2 | 0 |
| https://luma.com/spainclouds | Madrid y Barcelona | 2 | 7 |
| https://luma.com/ghspain | Varias | 3 | 7 |
| https://luma.com/calendar/cal-Xn9E7cBORCIEdMP (Startup Valencia) | Valencia | 0 | 11+ |

### Calendarios globales (importar con `country_filter='ES'`)

| Calendario | Futuros en España / total |
| --- | --- |
| https://luma.com/claudecommunity | 1 / 41+ |
| https://luma.com/n8n-events | 3 / 31+ |
| https://luma.com/codex-community | 1 / 50+ |
| https://luma.com/clickhouse-events | 1 / 20 |

Kernel Panic (`luma.com/p50cydsf`) pertenece a `helmcode`, pero no aparece en el listado del calendario. Los eventos no listados solo entran por URL suelta. Málaga, Bilbao y Sevilla no tienen calendarios propios relevantes en Luma; ahí se dependerá de Meetup.

## Ampliación aprobada · 11 de octubre de 2026

Importación explícita: `supabase/imports/20261011_autumn_public_events.sql`.
33 eventos nuevos del 1 de septiembre al 31 de diciembre de 2026, aprobados por el usuario. Se excluyen el reto del Gobierno de IA abierta y Tech for All.

Se conservan las filas existentes y sus ediciones. Se reutilizan organizaciones por ID o nombre normalizado y se cancela ante nombres ambiguos. Los duplicados se detectan por ID o por fecha y ciudad con nombre o URL coincidentes. La misma URL puede representar distintas ciudades o ediciones (Agent-a-thon). No se crean gestores ni asistencias.

| Evento | Fecha inicial | Fecha final | Ciudad | Organización / agrupación del catálogo | Fuente |
| --- | --- | --- | --- | --- | --- |
| HackBarna AI Summit 26 | 2026-09-19 | 2026-09-20 | Barcelona | HackBarna | https://aisummitbarcelona.com/hackathon |
| AI Summit Barcelona 2026 | 2026-09-22 | 2026-09-23 | Barcelona | AI Summit Barcelona | https://aisummitbarcelona.com/ |
| FabCon Europe + SQLCon Europe 2026 | 2026-09-28 | 2026-10-01 | Barcelona | European Microsoft Fabric + SQL Community | https://community.codemotion.com/european-microsoft-fabric-community/meetups/european-microsoft-fabric-community-conference-2026 |
| GitHub Dev Days Madrid 2026 | 2026-10-01 | 2026-10-01 | Madrid | GitHub Community Spain + Tech Riders | https://luma.com/s3r4fn9c |
| People Behind AI · Madrid | 2026-10-01 | 2026-10-01 | Madrid | Sovrano AI | https://luma.com/57r7xdj3 |
| GLTHDAY 2026 · Empower the Future | 2026-10-05 | 2026-10-07 | Madrid | Global LegalTech Hub | https://luma.com/glthday |
| Talent4Cyber 2026 | 2026-10-14 | 2026-10-15 | Online | Mando Conjunto del Ciberespacio | https://talent4cyber.es/ |
| DevFest Alicante 2026 | 2026-10-15 | 2026-10-15 | San Vicente del Raspeig | GDG Alicante | https://gdg.community.dev/events/details/google-gdg-alicante-presents-devfest-2026-alicante/ |
| AImpacto Hackathon 2026 | 2026-10-16 | 2026-10-17 | Madrid | AImpacto | https://aimpactorotaract.com/es/events/aimpacto-hackathon-2026/ |
| Microsoft Agent-a-thon Barcelona 2026 | 2026-10-21 | 2026-10-21 | Barcelona | Microsoft | https://info.microsoft.com/SE-CAW-CNTNTO-FY27-09Sep-02-Microsoft-Agent-a-thon-SREVM96098_Catalog-Display-Page.html |
| VDS 2026 | 2026-10-21 | 2026-10-22 | Valencia | Startup Valencia | https://startupvalencia.org/es/vds/ |
| J On The Beach 2026 | 2026-10-29 | 2026-10-30 | Torremolinos | J On The Beach | https://jonthebeach.com/ |
| Lambda World 2026 | 2026-10-29 | 2026-10-30 | Torremolinos | Lambda World | https://lambda.world/ |
| Wey Wey Web 2026 | 2026-10-29 | 2026-10-30 | Torremolinos | Wey Wey Web | https://weyweyweb.com/ |
| Smart City Expo World Congress 2026 | 2026-11-03 | 2026-11-05 | Barcelona | Smart City Expo World Congress | https://www.smartcityexpo.com/events/smart-city-expo-world-congress/ |
| DevFest Santiago de Compostela 2026 | 2026-11-04 | 2026-11-05 | Santiago de Compostela | GDG Santiago de Compostela | https://gdg.community.dev/events/details/google-gdg-santiago-de-compostela-presents-devfest-santiago-de-compostela-2026/ |
| Tech Show Madrid 2026 | 2026-11-04 | 2026-11-05 | Madrid | Tech Show Madrid | https://www.techshowmadrid.es/ |
| Qiskit Fall Fest 2026 | 2026-11-04 | 2026-11-06 | Bilbao / Donostia / Vitoria-Gasteiz | BasQ + IBM | https://www.basquequantum.eus/index.php/es/eventos/qiskit-fall-fest-2026 |
| PyConES 2026 | 2026-11-06 | 2026-11-08 | Barcelona | PyConES | https://pretalx.com/pycones-2026/ |
| BiznagaFest 2026 | 2026-11-07 | 2026-11-07 | Málaga | GDG Málaga | https://gdg.community.dev/events/details/google-gdg-malaga-presents-biznagafest-2026/ |
| DevOpsDays Barcelona 2026 | 2026-11-13 | 2026-11-14 | Barcelona | DevOpsDays Barcelona | https://devopsdays.org/events/2026-barcelona/welcome/ |
| Microsoft Agent-a-thon Madrid 2026 | 2026-11-18 | 2026-11-18 | Madrid | Microsoft | https://info.microsoft.com/SE-CAW-CNTNTO-FY27-09Sep-02-Microsoft-Agent-a-thon-SREVM96098_Catalog-Display-Page.html |
| DevFest Zaragoza 2026 | 2026-11-20 | 2026-11-20 | Zaragoza | GDG Zaragoza | https://gdg.community.dev/events/details/google-gdg-zaragoza-presents-devfest-zaragoza-2026/ |
| DevFest Jerez de la Frontera 2026 | 2026-11-21 | 2026-11-21 | Jerez de la Frontera | GDG Jerez de la Frontera | https://gdg.community.dev/events/details/google-gdg-jerez-de-la-frontera-presents-devfest-jerez-de-la-frontera/ |
| IndesIAhack 2026 | 2026-11-25 | 2026-11-27 | Madrid | IndesIA | https://indesiahack.org/ |
| Designing AI Products That Fit the Work People Actually Do | 2026-11-26 | 2026-11-26 | Online | Barcelona Data and AI Product Management meetup | https://luma.com/0bi86pqh |
| DevFest Madrid 2026 | 2026-11-27 | 2026-11-27 | Madrid | GDG Madrid | https://gdg.community.dev/events/details/google-gdg-madrid-presents-devfest-madrid-2026/ |
| DevFest Córdoba 2026 | 2026-11-28 | 2026-11-28 | Córdoba | GDG Córdoba | https://gdg.community.dev/events/details/google-gdg-cordoba-presents-devfest-cordoba/ |
| III Congreso de Hackers de Segovia 2026 | 2026-12-01 | 2026-12-02 | Segovia | Congreso de Hackers de Segovia | https://congresodehackers.es/ |
| Collaborate Toledo 2026 · Aimagine | 2026-12-01 | 2026-12-02 | Toledo | Atlas Tecnológico | https://atlastecnologico.com/es/noticia/todo-lo-que-tienes-que-saber-sobre-el-collaborate-toledo-2026/ |
| Tech Spirit Barcelona 2026 | 2026-12-02 | 2026-12-03 | Barcelona | Tech Barcelona | https://www.techbarcelona.com/event/tech-spirit-barcelona-2026/ |
| Chipnation 2026 | 2026-12-09 | 2026-12-11 | Barcelona | AESEMI | https://chipnation.es/ |
| DevFest Lleida 2026 · Intel·ligència Artesanal | 2026-12-18 | 2026-12-18 | Lleida | GDG Lleida | https://www.meetup.com/es-es/flutter-lleida/events/316007168/ |

Notas: People Behind AI requiere invitación. Talent4Cyber es universitario y online. Qiskit tiene tres sedes simultáneas; se guarda una sola convocatoria con ciudad múltiple. DevFest Lleida tiene sesiones presenciales y online. J On The Beach, Lambda World y Wey Wey Web son conferencias distintas del mismo encuentro conjunto. Barraca BDS sigue siendo provisional según la web del organizador; esta carga no modifica esa fila existente. Los nombres de organización incluyen marcas de eventos/comunidades, como en el catálogo previo; no atribuyen representación legal ni permisos.

Resultado en producción (`hwerwvjndbufjcswlgpo`), verificado el 11 de octubre de 2026: 33 eventos y 32 organizaciones/agrupaciones añadidos; total 44 eventos y 40 organizaciones. La API pública anónima devuelve todas las filas y sus campos coinciden con la consulta SQL. Los 11 eventos y 8 organizaciones anteriores se conservaron exactamente, y los recuentos de perfiles, asistencias, gestores, administradores y bloqueos permanecieron iguales. Ninguno de los dos eventos excluidos está presente.

Validación previa: `python3 scripts/test-catalog-import.py` pasó en PostgreSQL desechable, incluyendo repetición sin cambios, conservación de filas, URL compartida entre ciudades, IDs alternativos, reutilización de organización y rollback por ambigüedad. No se ha realizado revisión visual del catálogo en el navegador.
