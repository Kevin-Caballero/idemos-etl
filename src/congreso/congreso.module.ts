import { Module } from '@nestjs/common';
import { CongresoService } from './congreso.service.js';

@Module({
  providers: [CongresoService],
  exports: [CongresoService],
})
export class CongresoModule {}
