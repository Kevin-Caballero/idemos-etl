import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientsModule, Transport } from '@nestjs/microservices';
import {
  Initiative,
  InitiativeStep,
  InitiativeLink,
  InitiativeSummary,
  OfficialVoteResult,
} from '@idemos/common';
import { CongresoModule } from '../congreso/congreso.module.js';
import { VotacionesModule } from '../votaciones/votaciones.module.js';
import { SyncService } from './sync.service.js';
import { SyncLog } from './sync-log.entity.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Initiative,
      InitiativeStep,
      InitiativeLink,
      InitiativeSummary,
      OfficialVoteResult,
      SyncLog,
    ]),
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
    VotacionesModule,
  ],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
