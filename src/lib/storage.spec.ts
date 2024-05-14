import { WithdrawStorage } from './storage'
import { sha3_256 } from './util'

const v1 = [
  {
    bridge_id: BigInt(1),
    sequence: BigInt(1),
    sender: 'init1wzenw7r2t2ra39k4l9yqq95pw55ap4sm4vsa9g',
    receiver: 'init174knscjg688ddtxj8smyjz073r3w5mmsp3m0m2',
    l1_denom: 'uinit',
    amount: BigInt(1000000)
  },
  {
    bridge_id: BigInt(1),
    sequence: BigInt(2),
    sender: 'init1wzenw7r2t2ra39k4l9yqq95pw55ap4sm4vsa9g',
    receiver: 'init174knscjg688ddtxj8smyjz073r3w5mmsp3m0m2',
    l1_denom: 'uinit',
    amount: BigInt(1000000)
  },
  {
    bridge_id: BigInt(1),
    sequence: BigInt(3),
    sender: 'init1wzenw7r2t2ra39k4l9yqq95pw55ap4sm4vsa9g',
    receiver: 'init174knscjg688ddtxj8smyjz073r3w5mmsp3m0m2',
    l1_denom: 'uinit',
    amount: BigInt(1000000)
  }
]

describe('WithdrawStorage', () => {
  it('getmerkleproof', async () => {
    const tx = {
      bridge_id: BigInt(1),
      sequence: BigInt(4),
      sender: '0000000000000000000000000000000000000004',
      receiver: '0000000000000000000000000000000000000001',
      l1_denom: 'l1denom',
      amount: BigInt(3000000)
    }
    const bridge_id_buf = Buffer.alloc(8)
    bridge_id_buf.writeBigInt64BE(tx.bridge_id)

    const sequence_buf = Buffer.alloc(8)
    sequence_buf.writeBigInt64BE(tx.sequence)

    const amount_buf = Buffer.alloc(8)
    amount_buf.writeBigInt64BE(tx.amount)

    const result = sha3_256(
      Buffer.concat([
        bridge_id_buf,
        sequence_buf,
        Buffer.from(tx.sender, 'hex'),
        Buffer.from('|'),
        Buffer.from(tx.receiver, 'hex'),
        Buffer.from('|'),
        Buffer.from(tx.l1_denom, 'utf8'),
        Buffer.from('|'),
        amount_buf
      ])).toString('base64')
    expect(result == "F+mzhRVdcwLS5tk2NDB2MbgMm7A0nk39G+NGEjXpTV0=").toBeTruthy()
  })

  it('verify v1', async () => {
    const airdrop = new WithdrawStorage(v1)
    const target = v1[0]

    const merkleRoot = airdrop.getMerkleRoot()
    const merkleProof = airdrop.getMerkleProof(target)
    const version = 2
    const stateRoot = 'C2ZdjJ7uX41NaadA/FjlMiG6btiDfYnxE2ABqJocHxI='
    const lastBlockHash = 'tgmfQJT4uipVToW631xz0RXdrfzu7n5XxGNoPpX6isI='
    const outputRoot = sha3_256(
      Buffer.concat([
        sha3_256(version),
        Buffer.from(stateRoot, 'base64'), // state root
        Buffer.from(merkleRoot, 'base64'),
        Buffer.from(lastBlockHash, 'base64') // block hash
      ])
    ).toString('base64')
    expect(airdrop.verify(merkleProof, target)).toBeTruthy()
  })
})
