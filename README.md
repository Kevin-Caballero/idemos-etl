# ETL Service

Servicio encargado de mantener la base de datos actualizada con las iniciativas parlamentarias del Congreso. Se ejecuta diariamente, descarga los datos publicados en open data y los persiste en la base de datos compartida. Al terminar, notifica al servicio de IA por RabbitMQ para que genere los resúmenes pendientes.

## Cómo funciona

El Congreso publica los datos en [opendata](https://www.congreso.es/es/opendata/iniciativas) como dos JSON (Proyectos de Ley + Proposiciones). El problema es que el nombre del fichero cambia con cada publicación, asi que hay que hacer scraping de la página para encontrar la URL actualizada antes de descargarlo.

Una vez descargado, los datos vienen bastante sucios: fechas en `DD/MM/YYYY`, legislaturas como `Leg.15`, fases de tramitación como texto libre multilínea... El servicio lo limpia todo (o lo intenta) y hace upsert en la base de datos (actualiza si ya existe, inserta si es nuevo). Solo procesa la legislatura más reciente del dataset.

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

| Variable       | Por defecto             | Descripción                                   |
| -------------- | ----------------------- | --------------------------------------------- |
| `DB_HOST`      | `localhost`             | Host de PostgreSQL                            |
| `DB_PORT`      | `5432`                  | Puerto de PostgreSQL                          |
| `DB_NAME`      | `idemos`                | Nombre de la base de datos                    |
| `DB_USER`      | `postgres`              | Usuario de PostgreSQL                         |
| `DB_PASSWORD`  | `postgres`              | Contraseña de PostgreSQL                      |
| `RABBITMQ_URL` | `amqp://localhost:5672` | URL de conexión a RabbitMQ                    |
| `NODE_ENV`     | —                       | `development` activa `synchronize` en TypeORM |

## Requisitos

| Tool / Package          | Version |
| ----------------------- | ------- |
| Node.js                 | >= 20.0 |
| npm                     | >= 10.0 |
| TypeScript              | ^5.7.3  |
| NestJS (`@nestjs/core`) | ^11.0.1 |
| TypeORM                 | ^0.3.20 |
| `@nestjs/typeorm`       | ^11.0.0 |
| `@nestjs/schedule`      | ^4.1.2  |
| `@nestjs/microservices` | ^11.0.1 |
| PostgreSQL (`pg`)       | ^8.13.3 |
| RxJS                    | ^7.8.1  |

> Se requiere Node.js 20+ para la carga nativa de archivos `.env` mediante `--env-file`.

## Scripts

```bash
npm run start:dev   # development (watch mode)
npm run start:prod  # production
npm run test        # unit tests
npm run test:e2e    # e2e tests
```
