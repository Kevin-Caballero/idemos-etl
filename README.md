# ETL Service

Servicio encargado de mantener la base de datos actualizada con las iniciativas parlamentarias del Congreso. Se ejecuta diariamente, descarga los datos publicados en open data y los persiste en la base de datos compartida. Al terminar, notifica al servicio de IA por RabbitMQ para que genere los resúmenes pendientes.

## Cómo funciona

El Congreso publica los datos en [opendata](https://www.congreso.es/es/opendata/iniciativas) como dos JSON (Proyectos de Ley + Proposiciones). El problema es que el nombre del fichero cambia con cada publicación, asi que hay que hacer scraping de la página para encontrar la URL actualizada antes de descargarlo.

Una vez descargado, los datos vienen bastante sucios: fechas en `DD/MM/YYYY`, legislaturas como `Leg.15`, fases de tramitación como texto libre multilínea... El servicio lo limpia todo y hace upsert en la base de datos (actualiza si ya existe, inserta si es nuevo). Solo procesa la legislatura más reciente del dataset.

Cada ejecución queda registrada en `sync_log` con estado, contadores y mensaje de error si algo falla.

## Cuándo se ejecuta

- **Al arrancar**: si no se ha sincronizado hoy, sincroniza al momento.
- **Cron diario a las 6:00 UTC**: la fuente publica sobre las 5:00, así que hay margen.

## Estructura

```text
src/
- congreso/
  - congreso.service.ts   # Scraping + descarga de los JSON
  - congreso.types.ts     # Tipos del JSON crudo del Congreso
- sync/
  - sync.service.ts       # Transforma, guarda en BD y notifica a la IA
  - sync-log.entity.ts    # Tabla sync_log
```

> Lo más complicado es `parseSteps` en `sync.service.ts`, que parsea el campo `TRAMITACIONSEGUIDA` — un bloque de texto libre con fases y fechas intercaladas.

## Variables de entorno

| Variable       | Default                 |
| -------------- | ----------------------- |
| `DB_HOST`      | `localhost`             |
| `DB_PORT`      | `5432`                  |
| `DB_NAME`      | `idemos`                |
| `DB_USER`      | `postgres`              |
| `DB_PASSWORD`  | `postgres`              |
| `RABBITMQ_URL` | `amqp://localhost:5672` |

## Desarrollo

```bash
npm install
npm run start:dev
```
