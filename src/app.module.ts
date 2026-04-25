import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { CongresoModule } from './congreso/congreso.module.js';
import { SyncModule } from './sync/sync.module.js';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST ?? 'localhost',
      port: Number(process.env.DB_PORT ?? '5432'),
      database: process.env.DB_NAME ?? 'idemos',
      username: process.env.DB_USER ?? 'postgres',
      password: process.env.DB_PASSWORD ?? 'postgres',
      synchronize: process.env.NODE_ENV === 'development',
      autoLoadEntities: true,
    }),
    ClientsModule.register([
      {
        name: 'AI_SERVICE',
        transport: Transport.RMQ,
        options: {
          urls: [process.env.RABBITMQ_URL ?? 'amqp://localhost:5672'],
          queue: 'ai_queue',
          queueOptions: { durable: true },
        },
      },
    ]),
    CongresoModule,
    SyncModule,
  ],
})
export class AppModule {}
