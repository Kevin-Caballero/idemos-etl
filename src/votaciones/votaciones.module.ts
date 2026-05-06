import { Module } from '@nestjs/common';
import { VotacionesService } from './votaciones.service.js';

@Module({
  providers: [VotacionesService],
  exports: [VotacionesService],
})
export class VotacionesModule {}
