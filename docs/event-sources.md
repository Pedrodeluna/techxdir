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
