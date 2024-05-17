import { Column, Entity, Index, PrimaryColumn } from 'typeorm'

@Entity('output_tx')
export default class OutputTxEntity {
  @PrimaryColumn('text')
  txHash!: string

  @Column({ type: 'int' })
  @Index('output_tx_output_index_index')
  outputIndex!: number

  @Column({ type: 'boolean', default: false })
  processed!: boolean
}
