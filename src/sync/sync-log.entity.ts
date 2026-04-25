import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type SyncStatus = 'pending' | 'success' | 'error';

@Entity('sync_log')
export class SyncLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt!: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt!: Date | null;

  @Column({ type: 'varchar', default: 'pending' })
  status!: SyncStatus;

  @Column({ type: 'int', default: 0 })
  inserted!: number;

  @Column({ type: 'int', default: 0 })
  updated!: number;

  @Column({ type: 'int', default: 0 })
  failed!: number;

  @Column({ type: 'int', default: 0 })
  total!: number;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;
}
