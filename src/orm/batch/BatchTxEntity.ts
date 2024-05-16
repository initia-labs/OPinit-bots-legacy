import { Column, Entity, Index, PrimaryColumn } from 'typeorm'

@Entity('batch_tx')
export default class BatchTxEntity {
  @PrimaryColumn('text')
  hash: string

  @Column()
  @Index('batch_tx_batch_index_index')
  batchIndex: number

  @Column()
  subIndex: number

  @Column()
  txBytes: string
}
